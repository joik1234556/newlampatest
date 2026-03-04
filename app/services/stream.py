"""
Stream service — manages job lifecycle:
  queued → preparing → ready | failed

Jobs are stored in Redis (via CacheBackend) with an in-memory fallback.
TorBox polling uses an adaptive strategy:
  - first TORBOX_POLL_FAST_SECONDS: poll every TORBOX_POLL_FAST_INTERVAL seconds
  - afterwards:                      poll every TORBOX_POLL_SLOW_INTERVAL seconds
  - total cap:                       TORBOX_POLL_MAX_SECONDS

Deduplication:
  magnet_job:{sha1(magnet)} → job_id
  If the same magnet is submitted again while a job is in-flight, the existing
  job_id is returned immediately (no new TorBox request).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import uuid
from typing import Optional

from tenacity import RetryError

from app import torbox
from app.cache import direct_url_cache, job_cache, magnet_job_cache
from app.config import (
    JOB_TTL,
    TORBOX_POLL_FAST_INTERVAL,
    TORBOX_POLL_FAST_SECONDS,
    TORBOX_POLL_MAX_SECONDS,
    TORBOX_POLL_SLOW_INTERVAL,
)
from app.models import StreamJob, StreamStartRequest

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Video file extensions recognised as playable content
_VIDEO_EXTS = frozenset(
    (".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts", ".mpg", ".mpeg", ".flv")
)

# Extensions with best browser codec support (MP4/AAC is universally supported;
# MKV/AVI often contain AC3/DTS audio that browsers cannot play)
_BROWSER_FRIENDLY_EXTS = frozenset((".mp4", ".m4v", ".mov"))


def _pick_video_file(files: list[dict]) -> dict | None:
    """
    Return the best video file from a TorBox torrent file list.

    Strategy:
    1. Keep only files whose name ends with a known video extension.
    2. Among those, prefer browser-friendly formats (MP4/M4V/MOV) over MKV/AVI
       because browsers typically support AAC audio in MP4 containers, whereas
       MKV files often carry AC3/DTS audio tracks that browsers cannot decode.
    3. Within each group, return the file with the largest reported size
       (largest = highest quality / main feature).
    4. If no file has a recognised extension, fall back to the largest file overall.
    5. If the list is empty, return None.
    """
    if not files:
        return None
    video_files = [
        f for f in files
        if any((f.get("name") or f.get("short_name") or "").lower().endswith(ext) for ext in _VIDEO_EXTS)
    ]
    candidates = video_files if video_files else files
    # Prefer MP4/M4V/MOV for better browser audio codec compatibility
    browser_friendly = [
        f for f in candidates
        if any((f.get("name") or f.get("short_name") or "").lower().endswith(ext)
               for ext in _BROWSER_FRIENDLY_EXTS)
    ]
    best_pool = browser_friendly if browser_friendly else candidates
    return max(best_pool, key=lambda f: int(f.get("size", 0) or 0), default=None)


def _magnet_hash(magnet: str) -> str:
    """SHA-1 hex digest of the raw magnet string."""
    return hashlib.sha1(magnet.encode()).hexdigest()


def _extract_infohash(magnet: str) -> Optional[str]:
    m = re.search(r"xt=urn:btih:([0-9a-fA-F]{40}|[A-Z2-7]{32})", magnet, re.IGNORECASE)
    return m.group(1).lower() if m else None


# === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
# Regex patterns for extracting episode and season numbers from filenames.
# Keep in sync with _EP_RE / _fileEpNum() in app/routers/stream.py and easy-mod.js.
_SVC_EP_RE = re.compile(
    r"[Ss]\d{1,2}[Ee](\d{1,3})"                             # S01E03 → group 1
    r"|\b\d{1,2}[xX](\d{1,3})\b"                            # 1x03   → group 2
    r"|[Ee][Pp]?(\d{1,3})"                                   # E03, EP03 → group 3
    r"|\b(?:episode|серия)\s*(\d{1,3})\b"                    # episode/серия 3 → group 4
    r"|\b(\d{1,3})\s+серия\b"                                # 12 серия → group 5
    r"|\[0*([1-9]\d?)\]|\(0*([1-9]\d?)\)"                   # [03] or (03) → groups 6-7
    r"|(?:^|[\s._\-])0*([1-9]\d?)(?:v\d)?(?:[\s._\-]|$)",  # standalone 1-99 → group 8
    re.IGNORECASE,
)

_SVC_SEASON_RE = re.compile(
    r"[Ss](\d{1,2})[Ee]\d"                                  # S01E03 → group 1
    r"|\b[Ss]eason\s*(\d{1,2})\b"                           # Season 1 → group 2
    r"|\b[Сс]езон\s*(\d{1,2})\b"                            # Сезон 1 → group 3
    r"|\b(\d{1,2})[xX]\d{1,3}\b",                           # 1x03 → group 4
    re.IGNORECASE,
)


def _ep_num_from_file(name: str) -> int:
    """Extract episode number from a filename. Returns 0 when not found."""
    basename = (name or "").split("/")[-1].split("\\")[-1]
    m = _SVC_EP_RE.search(basename)
    if not m:
        return 0
    for g in m.groups():
        if g is not None:
            return int(g)
    return 0


def _season_num_from_file(name: str) -> int:
    """Extract season number from a filename. Returns 0 when not found."""
    basename = (name or "").split("/")[-1].split("\\")[-1]
    m = _SVC_SEASON_RE.search(basename)
    if not m:
        return 0
    for g in m.groups():
        if g is not None:
            return int(g)
    return 0


def _pick_video_file_for_episode(
    files: list[dict],
    episode: Optional[int] = None,
    season: Optional[int] = None,
) -> dict | None:
    """
    === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
    Pick the video file matching the requested season/episode from a torrent file list.

    When ``episode`` is given, narrows to files whose name matches that episode.
    When ``season`` is also given, further filters by season.
    Files with no detectable season number (returns 0) are kept as valid candidates
    because some episode-only filenames omit the season prefix.
    Falls back to _pick_video_file() when no episode-specific match is found.
    """
    if episode is None:
        return _pick_video_file(files)

    video_files = [
        f for f in files
        if any((f.get("name") or f.get("short_name") or "").lower().endswith(ext)
               for ext in _VIDEO_EXTS)
    ]
    if not video_files:
        return _pick_video_file(files)

    # Filter by episode number
    ep_match = [f for f in video_files
                if _ep_num_from_file(f.get("name") or f.get("short_name") or "") == episode]

    # Further narrow by season when specified (0 = no season tag in filename → keep)
    if season and ep_match:
        season_match = [
            f for f in ep_match
            if _season_num_from_file(f.get("name") or f.get("short_name") or "") in (0, season)
        ]
        if season_match:
            ep_match = season_match

    if ep_match:
        logger.info(
            "[Easy-Mod][Stream] episode-aware pick: %d match(es) for S%02dE%02d",
            len(ep_match), season or 0, episode,
        )
        return max(ep_match, key=lambda f: int(f.get("size", 0) or 0))

    logger.info(
        "[Easy-Mod][Stream] episode-aware pick: no match for S%02dE%02d — fallback to largest",
        season or 0, episode,
    )
    return _pick_video_file(files)


# ---------------------------------------------------------------------------
# Job persistence (Redis-backed via CacheBackend)
# ---------------------------------------------------------------------------

async def _save_job(job: StreamJob) -> None:
    await job_cache.aset(job.job_id, job.model_dump(), ttl=JOB_TTL)


async def _load_job(job_id: str) -> Optional[StreamJob]:
    data = await job_cache.aget(job_id)
    if data is None:
        return None
    try:
        return StreamJob(**data)
    except Exception as exc:
        logger.warning("[Easy-Mod][Stream] corrupt job data job_id=%s: %s", job_id, exc)
        return None


async def _save_torrent_meta(magnet_hash: str, magnet: str, torrent_id: str, file_id: str) -> None:
    """
    Persist torrent_id:file_id to cache so future requests can obtain a fresh CDN URL
    via request_download_link instead of re-using an expiring direct CDN URL.
    """
    meta = f"{torrent_id}:{file_id}"
    await direct_url_cache.aset(magnet_hash, meta)
    infohash = _extract_infohash(magnet)
    if infohash:
        await direct_url_cache.aset(infohash, meta)
        logger.debug("[Easy-Mod][Stream] torrent_meta cached by infohash=%s", infohash)


async def _update_job(job_id: str, **kwargs) -> Optional[StreamJob]:
    """Load, patch, save, return updated job (or None if missing)."""
    job = await _load_job(job_id)
    if job is None:
        return None
    for k, v in kwargs.items():
        setattr(job, k, v)
    await _save_job(job)
    return job


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def load_job(job_id: str) -> Optional[StreamJob]:
    """Async public accessor — used by routers that need the latest job state."""
    return await _load_job(job_id)


def get_job(job_id: str) -> Optional[StreamJob]:
    """Sync accessor used by the status router (via the in-memory mirror)."""
    data = job_cache.get(job_id)
    if data is None:
        return None
    try:
        return StreamJob(**data)
    except Exception:
        return None


def list_jobs() -> list[StreamJob]:
    """Not recommended for large-scale use; only for debugging."""
    return []   # can't enumerate Redis keys without scanning; omit for now


async def create_job(req: StreamStartRequest) -> StreamJob:
    """
    Create (or return an existing) StreamJob for the given magnet.

    Flow:
      1. torrent_meta cache hit → get fresh CDN URL via request_download_link and return ready job
      2. magnet_job dedup → return existing in-flight/done job
      3. Create new job, persist, launch background polling
    """
    mhash = _magnet_hash(req.magnet)

    # ── 1. Torrent metadata already cached ────────────────────────────────
    # The cache stores "torrent_id:file_id" (new format) which lets us obtain
    # a fresh CDN URL on every request — avoiding 404s from expired CDN links.
    # Old format entries (raw CDN URLs starting with "http") are ignored.
    cached_meta = await direct_url_cache.aget(mhash)
    if not cached_meta:
        # Also try by infohash (legacy key from previous implementation)
        infohash = _extract_infohash(req.magnet)
        if infohash:
            cached_meta = await direct_url_cache.aget(infohash)

    if cached_meta and isinstance(cached_meta, str) and not cached_meta.startswith("http"):
        # New format: "torrent_id:file_id"
        parts = cached_meta.split(":", 1)
        if len(parts) == 2:
            t_id, f_id = parts
            logger.info(
                "[Easy-Mod][Stream] torrent_meta cache hit torrent_id=%s magnet_hash=%s",
                t_id, mhash,
            )
            try:
                fresh_url = await torbox.request_download_link(t_id, f_id)
                if fresh_url:
                    job = StreamJob(
                        variant_id=req.variant_id,
                        magnet=req.magnet,
                        magnet_hash=mhash,
                        title=req.title,
                        torrent_id=t_id,
                        file_id=f_id,
                        state="ready",
                        progress=1.0,
                        direct_url=fresh_url,
                        message="Cached torrent",
                        # === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
                        season=req.season or None,
                        episode=req.episode or None,
                    )
                    await _save_job(job)
                    return job
                logger.info(
                    "[Easy-Mod][Stream] cache-hit requestdl returned empty url "
                    "torrent_id=%s — falling through to normal processing",
                    t_id,
                )
            except Exception as exc:
                logger.warning(
                    "[Easy-Mod][Stream] cache-hit fresh URL failed torrent_id=%s: %s "
                    "— falling through to normal processing",
                    t_id, exc,
                )
    elif cached_meta and isinstance(cached_meta, str):
        # Old format: raw CDN URL (expires quickly — ignore and let normal processing run)
        logger.info(
            "[Easy-Mod][Stream] ignoring stale CDN URL in cache (old format) magnet_hash=%s",
            mhash,
        )

    # ── 2. Dedup — same magnet already being processed ────────────────────
    existing_job_id = await magnet_job_cache.aget(mhash)
    if existing_job_id:
        existing = await _load_job(existing_job_id)
        if existing and existing.state not in ("failed",):
            logger.info(
                "[Easy-Mod][Stream] dedup — returning existing job job_id=%s state=%s",
                existing_job_id, existing.state,
            )
            return existing

    # ── 3. Create new job ─────────────────────────────────────────────────
    job = StreamJob(
        variant_id=req.variant_id,
        magnet=req.magnet,
        magnet_hash=mhash,
        title=req.title,
        state="queued",
        # === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
        season=req.season or None,
        episode=req.episode or None,
    )
    await _save_job(job)
    await magnet_job_cache.aset(mhash, job.job_id, ttl=JOB_TTL)
    logger.info(
        "[Easy-Mod][Stream] job created job_id=%s title=%s",
        job.job_id, req.title,
    )

    asyncio.create_task(_process_job(job.job_id))
    return job


# ---------------------------------------------------------------------------
# Background processing
# ---------------------------------------------------------------------------

async def _process_job(job_id: str) -> None:
    """Background coroutine: add magnet to TorBox → adaptive poll until ready."""
    job = await _load_job(job_id)
    if job is None:
        logger.warning("[Easy-Mod][Stream] _process_job: job not found job_id=%s", job_id)
        return

    logger.info("[Easy-Mod][Stream] processing job_id=%s", job_id)
    job = await _update_job(job_id, state="preparing", progress=0.05)
    if job is None:
        return

    try:
        # ── Fast path A + B: parallel check — mylist AND global cache ────
        # Run both checks concurrently to save one network round-trip.
        # Fast Path A: is the torrent already in the user's mylist (seeding or
        #   even downloading)?  If yes and ready → serve directly, no add_magnet.
        # Fast Path B: is the infohash in TorBox's global cache?  If yes the
        #   torrent will enter "seeding" state immediately after add_magnet.
        is_torrent_url = job.magnet.startswith("http://") or job.magnet.startswith("https://")
        existing_torrent_id: Optional[str] = None
        _is_globally_cached = False

        if not is_torrent_url:
            infohash = _extract_infohash(job.magnet)
            if infohash:
                # Both calls go to TorBox simultaneously — saves ~300 ms compared
                # to the previous sequential A-then-B approach.
                # return_exceptions=True means task exceptions are returned as values,
                # not re-raised, so no try/except wrapper is needed here.
                _pa_result, _pb_result = await asyncio.gather(
                    torbox.get_torrent_by_hash(infohash, bypass_cache=True),
                    torbox.check_cached(infohash),
                    return_exceptions=True,
                )

                # ── Process Fast Path A result ────────────────────────────
                existing = _pa_result if not isinstance(_pa_result, BaseException) else None
                if existing:
                    existing_torrent_id = str(existing.get("id"))
                    ex_state = existing.get("download_state", "")
                    ex_files = existing.get("files") or []
                    logger.info(
                        "[Easy-Mod][TorBox] found existing torrent torrent_id=%s "
                        "state=%s files=%d job_id=%s",
                        existing_torrent_id, ex_state, len(ex_files), job_id,
                    )
                    # If already seeding/completed and files are listed, get link now
                    _READY_STATES = frozenset(("seeding", "completed", "cached", "ready"))
                    if ex_state in _READY_STATES and ex_files:
                        # === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
                        best_file = _pick_video_file_for_episode(ex_files, job.episode, job.season)
                        file_id = best_file.get("id") if best_file else None
                        if file_id is not None:
                            try:
                                direct_url = await torbox.request_download_link(
                                    existing_torrent_id, file_id
                                )
                            except Exception as exc:
                                logger.warning(
                                    "[Easy-Mod][TorBox] fast-path requestdl error: %s", exc
                                )
                                direct_url = None
                            if direct_url:
                                mhash = job.magnet_hash or _magnet_hash(job.magnet)
                                await _save_torrent_meta(mhash, job.magnet, existing_torrent_id, str(file_id))
                                await _update_job(
                                    job_id,
                                    torrent_id=existing_torrent_id,
                                    file_id=str(file_id),
                                    state="ready",
                                    progress=1.0,
                                    direct_url=direct_url,
                                    message="",
                                )
                                logger.info(
                                    "[Easy-Mod][TorBox] fast-path ready job_id=%s url=%.80s",
                                    job_id, direct_url,
                                )
                                return
                elif isinstance(_pa_result, BaseException):
                    logger.warning("[Easy-Mod][TorBox] fast-path lookup error: %s", _pa_result)

                # ── Process Fast Path B result ────────────────────────────
                # Only use the global-cache flag when the torrent is NOT already
                # in the user's mylist — otherwise _imm_attempts stays at 1.
                if not existing_torrent_id:
                    if isinstance(_pb_result, bool):
                        _is_globally_cached = _pb_result
                    if _is_globally_cached:
                        logger.info(
                            "[Easy-Mod][TorBox] infohash in global cache job_id=%s ih=%s",
                            job_id, infohash,
                        )
                    elif isinstance(_pb_result, BaseException):
                        logger.debug(
                            "[Easy-Mod][TorBox] checkcached pre-flight error: %s", _pb_result
                        )

        # ── Add magnet or torrent file URL to TorBox ──────────────────────
        logger.info(
            "[Easy-Mod][TorBox] %s job_id=%s value=%.60s",
            "add_torrent_url" if is_torrent_url else "add_magnet",
            job_id, job.magnet,
        )
        try:
            if is_torrent_url:
                result = await torbox.add_torrent_from_url(job.magnet)
            else:
                result = await torbox.add_magnet(job.magnet)
        except RetryError as retry_err:
            cause = retry_err.last_attempt.exception()
            if cause is not None and hasattr(cause, "response"):
                msg = (
                    f"TorBox HTTP {cause.response.status_code}: "
                    f"{cause.response.text[:300]}"
                )
            elif cause is not None:
                msg = f"TorBox: {type(cause).__name__}: {cause}"
            else:
                msg = "TorBox unreachable (all retry attempts exhausted)"
            logger.error(
                "[Easy-Mod][TorBox] add_magnet RetryError job_id=%s: %s",
                job_id, msg,
            )
            await _update_job(job_id, state="failed", message=msg)
            return

        data = result.get("data") or {}
        torrent_id = data.get("torrent_id") or data.get("id")

        if not torrent_id:
            # TorBox may return null data when the torrent already exists in the queue.
            # Try to find it by infohash before giving up.
            if not is_torrent_url:
                infohash = _extract_infohash(job.magnet)
                if infohash:
                    try:
                        found = await torbox.get_torrent_by_hash(infohash)
                        if found:
                            torrent_id = str(found.get("id"))
                            logger.info(
                                "[Easy-Mod][TorBox] recovered torrent_id=%s via infohash "
                                "after null-data response job_id=%s",
                                torrent_id, job_id,
                            )
                    except Exception as exc:
                        logger.warning(
                            "[Easy-Mod][TorBox] infohash fallback error job_id=%s: %s",
                            job_id, exc,
                        )

        if not torrent_id:
            detail = result.get("detail") or result.get("error") or ""
            msg = f"TorBox did not return a torrent ID ({detail})" if detail else "TorBox did not return a torrent ID"
            logger.warning(
                "[Easy-Mod][TorBox] no torrent_id returned job_id=%s resp=%s",
                job_id, result,
            )
            await _update_job(
                job_id,
                state="failed",
                message=msg,
            )
            return

        torrent_id = str(torrent_id)
        await _update_job(job_id, torrent_id=torrent_id, progress=0.10)
        logger.info(
            "[Easy-Mod][TorBox] torrent added torrent_id=%s job_id=%s",
            torrent_id, job_id,
        )

        # ── Immediate check — TorBox cached torrents are ready instantly ──
        # When TorBox has the torrent in its global cache, it enters "seeding"
        # state right after add_magnet (no download required). Checking once
        # without sleeping lets the user start watching immediately instead of
        # waiting at least TORBOX_POLL_FAST_INTERVAL seconds.
        # For globally-cached torrents, retry several times with a short sleep
        # since TorBox may need a moment to populate the files list.
        _TORBOX_READY_STATES = frozenset(("seeding", "completed", "cached", "ready"))
        _imm_attempts = 6 if _is_globally_cached else 1  # 6 attempts, 5 × 0.5 s = 2.5 s max
        for _imm_try in range(_imm_attempts):
            if _imm_try > 0:
                await asyncio.sleep(0.5)  # 0.5 s between attempts (was 1 s)
            try:
                # bypass_cache=True: force TorBox to return a fresh response so we
                # see the current download_state and the populated files list.
                # Without this, TorBox may serve a stale cached response where
                # download_state is still "downloading" even though the torrent is
                # already seeding, causing us to miss the instant-play window.
                torrent_imm = await torbox.get_torrent_by_id(torrent_id, bypass_cache=True)
                if torrent_imm:
                    st_imm = torrent_imm.get("download_state", "")
                    files_imm = torrent_imm.get("files") or []
                    logger.info(
                        "[Easy-Mod][TorBox] immediate check attempt=%d state=%s files=%d job_id=%s",
                        _imm_try + 1, st_imm, len(files_imm), job_id,
                    )
                    if st_imm in _TORBOX_READY_STATES and files_imm:
                        # === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
                        best_imm = _pick_video_file_for_episode(files_imm, job.episode, job.season)
                        fid = best_imm.get("id") if best_imm else None
                        if fid is not None:
                            try:
                                dl_url = await torbox.request_download_link(torrent_id, fid)
                            except Exception as exc:
                                logger.warning(
                                    "[Easy-Mod][TorBox] immediate requestdl error job_id=%s: %s",
                                    job_id, exc,
                                )
                                dl_url = None
                            if dl_url:
                                mhash = job.magnet_hash or _magnet_hash(job.magnet)
                                await _save_torrent_meta(mhash, job.magnet, torrent_id, str(fid))
                                await _update_job(
                                    job_id,
                                    torrent_id=torrent_id,
                                    file_id=str(fid),
                                    state="ready",
                                    progress=1.0,
                                    direct_url=dl_url,
                                    message="",
                                )
                                logger.info(
                                    "[Easy-Mod][TorBox] instant cache-hit ready job_id=%s url=%.80s",
                                    job_id, dl_url,
                                )
                                return
            except Exception as exc:
                logger.debug(
                    "[Easy-Mod][TorBox] immediate check error (non-fatal) job_id=%s: %s",
                    job_id, exc,
                )

        # ── Adaptive polling ──────────────────────────────────────────────
        elapsed = 0
        stall_ticks = 0
        # TorBox states that mean the download will never complete
        _TORBOX_DEAD_STATES = frozenset(
            ("error", "stalledDL", "missingFiles", "uploaderror", "checkingResumeData")
        )
        # After this many consecutive zero-progress ticks, give up.
        # Breakdown: 15 fast ticks × 2 s = 30 s; 5 slow ticks × 5 s = 25 s → 55 s total.
        _STALL_TICK_LIMIT = 20  # 15 fast + 5 slow ticks ≈ 55 s
        # Use bypass_cache for the first few polls so TorBox can't serve a stale
        # list right after add_magnet (happens when the torrent transitions from
        # "downloading" to "seeding" faster than TorBox's own cache TTL).
        _bypass_polls_left = 3

        while elapsed < TORBOX_POLL_MAX_SECONDS:
            interval = (
                TORBOX_POLL_FAST_INTERVAL
                if elapsed < TORBOX_POLL_FAST_SECONDS
                else TORBOX_POLL_SLOW_INTERVAL
            )
            await asyncio.sleep(interval)
            elapsed += interval

            _use_bypass = _bypass_polls_left > 0
            if _use_bypass:
                _bypass_polls_left -= 1

            try:
                torrent = await torbox.get_torrent_by_id(torrent_id, bypass_cache=_use_bypass)
            except Exception as exc:
                logger.warning(
                    "[Easy-Mod][TorBox] poll error elapsed=%ds job_id=%s: %s",
                    elapsed, job_id, exc,
                )
                continue

            if torrent is None:
                logger.debug(
                    "[Easy-Mod][TorBox] torrent not visible yet elapsed=%ds job_id=%s",
                    elapsed, job_id,
                )
                prog = min(0.50, 0.10 + elapsed / TORBOX_POLL_MAX_SECONDS * 0.40)
                await _update_job(job_id, progress=prog)
                continue

            state = torrent.get("download_state", "")
            files = torrent.get("files") or []
            progress_raw = float(torrent.get("progress", 0))

            # ── Detect TorBox-level dead states immediately ───────────────
            if state in _TORBOX_DEAD_STATES:
                dead_msg = (
                    f"TorBox: торрент завис ({state}). "
                    "Возможные причины: нет сидеров, лимит TorBox исчерпан, "
                    "файл недоступен. Попробуйте другой источник."
                )
                logger.warning(
                    "[Easy-Mod][TorBox] torrent in dead state=%s job_id=%s",
                    state, job_id,
                )
                await _update_job(job_id, state="failed", message=dead_msg)
                return

            # ── Progress: use TorBox value when non-zero, else elapsed-based
            if progress_raw > 0:
                prog = min(0.90, 0.10 + progress_raw * 0.80)
                stall_ticks = 0
            else:
                stall_ticks += 1
                prog = min(0.45, 0.10 + (elapsed / TORBOX_POLL_MAX_SECONDS) * 0.35)

            logger.info(
                "[Easy-Mod][TorBox] poll state=%s progress=%.2f elapsed=%ds job_id=%s",
                state, prog, elapsed, job_id,
            )
            await _update_job(job_id, progress=prog)

            # ── Try to get download link as soon as files are available ───
            # TorBox direct links support Range requests — player can stream
            # even while the torrent is still downloading (progressive play).
            if files:
                # === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
                best_file = _pick_video_file_for_episode(files, job.episode, job.season)
                file_id = best_file.get("id") if best_file else None
                if file_id is not None:
                    try:
                        direct_url = await torbox.request_download_link(torrent_id, file_id)
                    except Exception as exc:
                        logger.error(
                            "[Easy-Mod][TorBox] request_download_link failed job_id=%s: %s",
                            job_id, exc,
                        )
                        direct_url = None

                    if direct_url:
                        mhash = job.magnet_hash or _magnet_hash(job.magnet)
                        await _save_torrent_meta(mhash, job.magnet, torrent_id, str(file_id))
                        await _update_job(
                            job_id,
                            torrent_id=torrent_id,
                            file_id=str(file_id),
                            state="ready",
                            progress=1.0,
                            direct_url=direct_url,
                            message="",
                        )
                        logger.info(
                            "[Easy-Mod][TorBox] ready job_id=%s url=%.80s",
                            job_id, direct_url,
                        )
                        return

            # ── Stall detection: no progress and no usable files for too long
            if stall_ticks >= _STALL_TICK_LIMIT:
                stall_msg = (
                    "TorBox не начал загрузку за отведённое время. "
                    "Возможные причины: нет сидеров, закончился лимит TorBox, "
                    "TorBox перегружен. Попробуйте другой источник."
                )
                logger.warning(
                    "[Easy-Mod][TorBox] stall timeout stall_ticks=%d job_id=%s",
                    stall_ticks, job_id,
                )
                await _update_job(job_id, state="failed", message=stall_msg)
                return

        # ── Timed out ─────────────────────────────────────────────────────
        await _update_job(
            job_id,
            state="failed",
            message=f"Timeout after {TORBOX_POLL_MAX_SECONDS}s waiting for TorBox",
        )
        logger.warning("[Easy-Mod][Stream] timeout job_id=%s", job_id)

    except Exception as exc:
        logger.error("[Easy-Mod][Stream] fatal error job_id=%s: %s", job_id, exc)
        try:
            await _update_job(job_id, state="failed", message=str(exc))
        except Exception:
            pass

