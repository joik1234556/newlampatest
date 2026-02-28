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
        # ── Add magnet or torrent file URL to TorBox ──────────────────────
        is_torrent_url = job.magnet.startswith("http://") or job.magnet.startswith("https://")
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
                file_id = files[0].get("id", 0)
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
                    await direct_url_cache.aset(mhash, direct_url)
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

