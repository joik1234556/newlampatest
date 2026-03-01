"""
POST /stream/start  — create a streaming job
GET  /stream/status — poll job status
GET  /stream/files  — list video files in a ready torrent (episode picker)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from app.limiter_shared import limiter
from app.models import StreamJob, StreamStartRequest, StreamStatusResponse, TorrentFilesResponse, TorrentFileItem
from app.services import stream as stream_svc
import app.torbox as torbox

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stream", tags=["stream"])


@router.post("/start", response_model=dict)
async def stream_start(
    request: Request,
    body: StreamStartRequest,
) -> dict:
    """
    Submit a magnet link for TorBox processing.

    Returns immediately with one of:
    - ``{ job_id, status: "ready", direct_url }``  — cache hit, play now
    - ``{ job_id, status: "queued" }``              — job created, poll /stream/status
    """
    if not body.magnet.startswith(("magnet:", "http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid magnet or torrent URL — must start with 'magnet:', 'http://', or 'https://'")
    if not body.variant_id:
        raise HTTPException(status_code=400, detail="variant_id is required")

    logger.info(
        "[Easy-Mod][/stream/start] variant_id=%s title=%s magnet=%.60s",
        body.variant_id, body.title, body.magnet,
    )

    try:
        job: StreamJob = await stream_svc.create_job(body)
    except Exception as exc:
        logger.error("[Easy-Mod][/stream/start] error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    response: dict = {"job_id": job.job_id, "status": job.state}
    if job.state == "ready" and job.direct_url:
        response["direct_url"] = job.direct_url
    return response


@router.get("/status", response_model=StreamStatusResponse)
@limiter.limit("120/minute")
async def stream_status(
    request: Request,
    job_id: str = Query(..., description="Job ID returned by /stream/start"),
) -> StreamStatusResponse:
    """
    Poll the status of a streaming job.
    Returns state, progress (0..1), and direct_url when ready.
    """
    if not job_id.strip():
        raise HTTPException(status_code=400, detail="job_id must not be empty")

    job = stream_svc.get_job(job_id.strip())
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    return StreamStatusResponse(
        job_id=job.job_id,
        state=job.state,
        progress=job.progress,
        direct_url=job.direct_url,
        message=job.message,
    )


# ---------------------------------------------------------------------------
# /stream/files — list video files in a ready torrent (for episode/file picker)
# ---------------------------------------------------------------------------

_VIDEO_EXTS = frozenset(
    (".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts", ".mpg", ".mpeg", ".flv")
)


@router.get("/files", response_model=TorrentFilesResponse)
@limiter.limit("60/minute")
async def stream_files(
    request: Request,
    job_id: str = Query(..., description="Job ID returned by /stream/start"),
) -> TorrentFilesResponse:
    """
    Return the list of video files inside a ready TorBox torrent.
    Useful when a whole-season torrent is added — the user can pick a specific episode.
    Only works when the job is in 'ready' or 'preparing' state with a torrent_id.
    """
    if not job_id.strip():
        raise HTTPException(status_code=400, detail="job_id must not be empty")

    job = stream_svc.get_job(job_id.strip())
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    if not job.torrent_id:
        raise HTTPException(status_code=409, detail="Torrent not yet assigned to this job")

    try:
        torrent = await torbox.get_torrent_by_id(job.torrent_id)
    except Exception as exc:
        logger.error("[Easy-Mod][/stream/files] TorBox error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if torrent is None:
        raise HTTPException(status_code=404, detail=f"Torrent not found in TorBox: {job.torrent_id}")

    raw_files: list[dict] = torrent.get("files") or []
    items: list[TorrentFileItem] = []
    for f in raw_files:
        fid = f.get("id")
        if fid is None:
            continue
        name = f.get("name") or f.get("short_name") or str(fid)
        size_bytes = int(f.get("size", 0) or 0)
        size_mb = size_bytes // (1024 * 1024)
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        is_video = ext in _VIDEO_EXTS
        quality = torbox.guess_quality(name)
        items.append(TorrentFileItem(
            file_id=str(fid),
            name=name,
            size_mb=size_mb,
            quality=quality,
            is_video=is_video,
        ))

    # Sort: video files first, then by size desc (largest = main feature / best episode)
    items.sort(key=lambda f: (0 if f.is_video else 1, -f.size_mb))

    return TorrentFilesResponse(
        job_id=job_id.strip(),
        torrent_id=job.torrent_id,
        files=items,
    )


# ---------------------------------------------------------------------------
# /stream/play_file — get a direct URL for a specific file (episode)
# ---------------------------------------------------------------------------

@router.get("/play_file", response_model=dict)
@limiter.limit("60/minute")
async def stream_play_file(
    request: Request,
    job_id: str = Query(..., description="Job ID returned by /stream/start"),
    file_id: str = Query(..., description="File ID from /stream/files"),
) -> dict:
    """
    Request a direct download URL for a specific file inside a torrent.
    Use this after /stream/files to let the user select a specific episode.
    """
    if not job_id.strip():
        raise HTTPException(status_code=400, detail="job_id must not be empty")
    if not file_id.strip():
        raise HTTPException(status_code=400, detail="file_id must not be empty")

    job = stream_svc.get_job(job_id.strip())
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    if not job.torrent_id:
        raise HTTPException(status_code=409, detail="Torrent not yet assigned to this job")

    try:
        direct_url = await torbox.request_download_link(job.torrent_id, file_id.strip())
    except Exception as exc:
        logger.error("[Easy-Mod][/stream/play_file] TorBox requestdl error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not direct_url:
        raise HTTPException(status_code=404, detail="TorBox returned no URL for this file")

    return {"direct_url": direct_url, "job_id": job_id.strip(), "file_id": file_id.strip()}
