"""
Stream service — manages job lifecycle:
  queued → preparing → ready | failed

Jobs are kept in an in-memory dict (keyed by job_id).
TorBox polling runs as an asyncio background task per job.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from typing import Optional

from app import torbox
from app.cache import direct_url_cache
from app.models import StreamJob, StreamStartRequest

logger = logging.getLogger(__name__)

# In-memory job store  { job_id -> StreamJob }
_jobs: dict[str, StreamJob] = {}

# TorBox polling config
_POLL_INTERVAL = 5   # seconds between polls
_POLL_TIMEOUT = 240  # seconds total before marking failed


def _extract_infohash(magnet: str) -> Optional[str]:
    m = re.search(r"xt=urn:btih:([0-9a-fA-F]{40}|[A-Z2-7]{32})", magnet)
    return m.group(1).lower() if m else None


def get_job(job_id: str) -> Optional[StreamJob]:
    return _jobs.get(job_id)


def list_jobs() -> list[StreamJob]:
    return list(_jobs.values())


async def create_job(req: StreamStartRequest) -> StreamJob:
    """Create a StreamJob and launch background polling."""
    # Check direct_url cache first (magnet hash → url)
    infohash = _extract_infohash(req.magnet)
    if infohash:
        cached_url = direct_url_cache.get(infohash)
        if cached_url:
            logger.info("[Easy-Mod][Stream] cache hit for infohash=%s", infohash)
            job = StreamJob(
                variant_id=req.variant_id,
                magnet=req.magnet,
                title=req.title,
                state="ready",
                progress=1.0,
                direct_url=cached_url,
                message="Cached direct link",
            )
            _jobs[job.job_id] = job
            return job

    job = StreamJob(
        variant_id=req.variant_id,
        magnet=req.magnet,
        title=req.title,
        state="queued",
    )
    _jobs[job.job_id] = job
    logger.info(
        "[Easy-Mod][Stream] job created job_id=%s title=%s",
        job.job_id, req.title,
    )

    # Launch background task without awaiting
    asyncio.create_task(_process_job(job.job_id))
    return job


async def _process_job(job_id: str) -> None:
    """Background coroutine: add magnet to TorBox → poll until ready."""
    job = _jobs.get(job_id)
    if job is None:
        return

    logger.info("[Easy-Mod][Stream] processing job_id=%s", job_id)
    job.state = "preparing"
    job.progress = 0.05

    try:
        # Add magnet to TorBox
        logger.info("[Easy-Mod][TorBox] add_magnet job_id=%s magnet=%.60s", job_id, job.magnet)
        result = await torbox.add_magnet(job.magnet)
        data = result.get("data") or {}
        torrent_id = data.get("torrent_id") or data.get("id")

        if not torrent_id:
            logger.warning(
                "[Easy-Mod][TorBox] no torrent_id returned job_id=%s resp=%s",
                job_id, result,
            )
            job.state = "failed"
            job.message = "TorBox did not return a torrent ID"
            return

        job.torrent_id = str(torrent_id)
        job.progress = 0.1
        logger.info(
            "[Easy-Mod][TorBox] torrent added torrent_id=%s job_id=%s",
            torrent_id, job_id,
        )

        # Poll for readiness
        elapsed = 0
        ready_states = ("seeding", "downloading", "completed", "cached", "ready")

        while elapsed < _POLL_TIMEOUT:
            await asyncio.sleep(_POLL_INTERVAL)
            elapsed += _POLL_INTERVAL

            torrent = await torbox.get_torrent_by_id(torrent_id)
            if torrent is None:
                logger.debug(
                    "[Easy-Mod][TorBox] torrent not visible yet elapsed=%ds job_id=%s",
                    elapsed, job_id,
                )
                job.progress = min(0.5, 0.1 + elapsed / _POLL_TIMEOUT * 0.4)
                continue

            state = torrent.get("download_state", "")
            files = torrent.get("files") or []
            progress_raw = torrent.get("progress", 0)
            job.progress = min(0.9, 0.1 + float(progress_raw) * 0.8)

            logger.info(
                "[Easy-Mod][TorBox] poll state=%s progress=%.2f elapsed=%ds job_id=%s",
                state, job.progress, elapsed, job_id,
            )

            if state in ready_states and files:
                file_id = files[0].get("id", 0)
                direct_url = await torbox.request_download_link(torrent_id, file_id)
                if direct_url:
                    job.direct_url = direct_url
                    job.state = "ready"
                    job.progress = 1.0
                    job.message = ""

                    # Cache by infohash
                    infohash = _extract_infohash(job.magnet)
                    if infohash:
                        direct_url_cache.set(infohash, direct_url)

                    logger.info(
                        "[Easy-Mod][TorBox] ready job_id=%s url=%.80s",
                        job_id, direct_url,
                    )
                    return

        # Timed out
        job.state = "failed"
        job.message = "Timeout waiting for TorBox"
        logger.warning("[Easy-Mod][Stream] timeout job_id=%s", job_id)

    except Exception as exc:
        logger.error("[Easy-Mod][Stream] error job_id=%s: %s", job_id, exc)
        job.state = "failed"
        job.message = str(exc)
