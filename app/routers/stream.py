"""
POST /stream/start  — create a streaming job
GET  /stream/status — poll job status
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from app.limiter_shared import limiter
from app.models import StreamJob, StreamStartRequest, StreamStatusResponse
from app.services import stream as stream_svc

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
    if not body.magnet.startswith("magnet:"):
        raise HTTPException(status_code=400, detail="Invalid magnet link")
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
