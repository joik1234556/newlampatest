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


async def _save_direct_url(magnet_hash: str, magnet: str, url: str) -> None:
    """Persist direct_url to cache keyed by both magnet-hash and infohash."""
    await direct_url_cache.aset(magnet_hash, url)
    infohash = _extract_infohash(magnet)
    if infohash:
        await direct_url_cache.aset(infohash, url)
        logger.debug("[Easy-Mod][Stream] direct_url cached by infohash=%s", infohash)


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
      1. direct_url cache hit → return ready job immediately
      2. magnet_job dedup → return existing in-flight/done job
      3. Create new job, persist, launch background polling
    """
    mhash = _magnet_hash(req.magnet)

    # ── 1. Direct URL already cached ──────────────────────────────────────
    cached_url = await direct_url_cache.aget(mhash)
    if not cached_url:
        # Also try by infohash (legacy key from previous implementation)
        infohash = _extract_infohash(req.magnet)
        if infohash:
            cached_url = await direct_url_cache.aget(infohash)

    if cached_url:
        logger.info("[Easy-Mod][Stream] direct_url cache hit magnet_hash=%s", mhash)
        job = StreamJob(
            variant_id=req.variant_id,
            magnet=req.magnet,
            magnet_hash=mhash,
            title=req.title,
            state="ready",
            progress=1.0,
            direct_url=cached_url,
            message="Cached direct link",
        )
        await _save_job(job)
        return job

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
        # ── Fast path A: check if TorBox already has this torrent ────────
        # This handles: (a) re-opened film after server restart,
        # (b) user opens same film twice while first job still running.
        is_torrent_url = job.magnet.startswith("http://") or job.magnet.startswith("https://")
        existing_torrent_id: Optional[str] = None
        if not is_torrent_url:
            infohash = _extract_infohash(job.magnet)
            if infohash:
                try:
                    # bypass_cache=True: force TorBox to return a fresh response
                    # including the files list for the torrent.  Without this,
                    # TorBox may serve a stale cached response where files=[],
                    # which would prevent Fast Path A from getting a download link
                    # for an already-seeding torrent.
                    existing = await torbox.get_torrent_by_hash(infohash, bypass_cache=True)
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
                            best_file = _pick_video_file(ex_files)
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
                                    await _save_direct_url(mhash, job.magnet, direct_url)
                                    await _update_job(
                                        job_id,
                                        torrent_id=existing_torrent_id,
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
                except Exception as exc:
                    logger.warning("[Easy-Mod][TorBox] fast-path lookup error: %s", exc)

        # ── Fast path B: TorBox global cache check (checkcached) ─────────
        # If TorBox has this infohash in its global cache (not necessarily the
        # user's mylist), adding the magnet returns a torrent that is immediately
        # in "seeding"/"cached" state — no download required.
        # We do a pre-flight check so we can skip the polling loop entirely.
        _is_globally_cached = False
        if not is_torrent_url and not existing_torrent_id:
            _ih = _extract_infohash(job.magnet)
            if _ih:
                try:
                    _is_globally_cached = await torbox.check_cached(_ih)
                    if _is_globally_cached:
                        logger.info(
                            "[Easy-Mod][TorBox] infohash in global cache job_id=%s ih=%s",
                            job_id, _ih,
                        )
                except Exception as _exc:
                    logger.debug("[Easy-Mod][TorBox] checkcached pre-flight error: %s", _exc)

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
        # For globally-cached torrents, retry a few times with a short sleep
        # since TorBox may need a moment to populate the files list.
        _TORBOX_READY_STATES = frozenset(("seeding", "completed", "cached", "ready"))
        _imm_attempts = 4 if _is_globally_cached else 1
        for _imm_try in range(_imm_attempts):
            if _imm_try > 0:
                await asyncio.sleep(1)
            try:
                torrent_imm = await torbox.get_torrent_by_id(torrent_id)
                if torrent_imm:
                    st_imm = torrent_imm.get("download_state", "")
                    files_imm = torrent_imm.get("files") or []
                    logger.info(
                        "[Easy-Mod][TorBox] immediate check attempt=%d state=%s files=%d job_id=%s",
                        _imm_try + 1, st_imm, len(files_imm), job_id,
                    )
                    if st_imm in _TORBOX_READY_STATES and files_imm:
                        best_imm = _pick_video_file(files_imm)
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
                                await _save_direct_url(mhash, job.magnet, dl_url)
                                await _update_job(
                                    job_id,
                                    torrent_id=torrent_id,
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

        while elapsed < TORBOX_POLL_MAX_SECONDS:
            interval = (
                TORBOX_POLL_FAST_INTERVAL
                if elapsed < TORBOX_POLL_FAST_SECONDS
                else TORBOX_POLL_SLOW_INTERVAL
            )
            await asyncio.sleep(interval)
            elapsed += interval

            try:
                torrent = await torbox.get_torrent_by_id(torrent_id)
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
                best_file = _pick_video_file(files)
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
                        await _save_direct_url(mhash, job.magnet, direct_url)
                        await _update_job(
                            job_id,
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

