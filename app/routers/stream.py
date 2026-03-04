"""
POST /stream/start  — create a streaming job
GET  /stream/status — poll job status
GET  /stream/files  — list video files in a ready torrent (episode picker)
GET  /stream/proxy  — CORS-safe proxy for TorBox direct URLs
"""
from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

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

    # ── Fast-path wait: poll for up to 5 s so instantly-cached torrents
    # return direct_url in the initial response (no client polling needed).
    # The background task's immediate-cache check can take up to ~4 s for
    # globally-cached torrents (4 attempts × 1 s sleep), so we wait slightly
    # longer here to cover that window and avoid the client ever showing a
    # progress screen for an already-ready torrent.
    if job.state not in ("ready", "failed"):
        for _ in range(10):  # 10 × 0.5 s = 5 s max
            await asyncio.sleep(0.5)
            updated = await stream_svc.load_job(job.job_id)
            if updated is None:
                break
            job = updated
            if job.state in ("ready", "failed"):
                break

    # Normalize intermediate states to "queued" — client only needs ready/queued/failed
    reported_status = job.state if job.state in ("ready", "failed") else "queued"
    response: dict = {"job_id": job.job_id, "status": reported_status}
    if job.state == "ready" and job.direct_url:
        response["direct_url"] = job.direct_url
        response["proxy_url"] = f"/stream/proxy?job_id={job.job_id}"
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
        proxy_url=(
            f"/stream/proxy?job_id={job.job_id}"
            if job.state == "ready" and job.direct_url
            else None
        ),
        message=job.message,
    )


# ---------------------------------------------------------------------------
# /stream/files — list video files in a ready torrent (for episode/file picker)
# ---------------------------------------------------------------------------

_VIDEO_EXTS = frozenset(
    (".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts", ".mpg", ".mpeg", ".flv")
)

# Patterns to extract episode number from a filename, in priority order.
# Captures: SxxExx, Exx/EPxx, "episode N".
# The standalone-number pattern is intentionally limited to 1-2 digits (1-99)
# to avoid false-positive matches with years (2021), resolutions (1080/720),
# or other 3–4 digit metadata that commonly appear in video filenames.
_EP_RE = re.compile(
    r"[Ss]\d{1,2}[Ee](\d{1,3})"          # S01E03 → group 1
    r"|[Ee][Pp]?(\d{1,3})"               # E03, EP03 → group 2
    r"|\bepisode\s*(\d{1,3})\b"          # episode 3 → group 3
    r"|(?:^|[\s._\-])0*([1-9]\d?)(?:v\d)?(?:[\s._\-]|$)",  # standalone 1-99 → group 4
    re.IGNORECASE,
)


def _episode_num(name: str) -> int:
    """Extract episode number from a filename. Returns 0 when not found (sorts last)."""
    # Use only the basename, not directory parts
    basename = name.split("/")[-1].split("\\")[-1]
    m = _EP_RE.search(basename)
    if not m:
        return 0
    for g in m.groups():
        if g is not None:
            return int(g)
    return 0


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

    # Sort: video files first; within video files sort by episode number ascending
    # (ep 0 = no episode detected → sort to end within video group).
    # Non-video files follow after all video files, sorted by size desc.
    def _sort_key(f: TorrentFileItem) -> tuple:
        if f.is_video:
            ep = _episode_num(f.name)
            return (0, ep if ep > 0 else 9999, -f.size_mb)
        return (1, 9999, -f.size_mb)

    items.sort(key=_sort_key)

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


# ---------------------------------------------------------------------------
# /stream/proxy — CORS-safe streaming proxy for TorBox direct URLs
# ---------------------------------------------------------------------------

def _is_safe_proxy_url(url: str) -> bool:
    """
    Return True when *url* is safe to proxy.

    Security model: the URL stored in ``job.direct_url`` was obtained from the
    TorBox API by our own backend — it is never supplied directly by end-users.
    We therefore only need to ensure the scheme is http(s) to prevent abuse of
    other URI schemes (``file://``, ``gopher://``, etc.).
    """
    scheme = (urlparse(url).scheme or "").lower()
    return scheme in ("http", "https")


async def _proxy_url(request: Request, url: str) -> StreamingResponse:
    """
    Stream *url* through our server so the browser receives the content from
    our origin (which already has ``Access-Control-Allow-Origin: *`` via
    CORSMiddleware).  Supports ``Range`` requests so the video player can seek.

    Each call creates its own AsyncClient.  The inner generator's ``finally``
    block guarantees the client is closed regardless of whether the response
    is fully consumed or the browser disconnects mid-stream.
    """
    upstream_headers: dict[str, str] = {}
    if "range" in request.headers:
        upstream_headers["Range"] = request.headers["range"]

    # Start the upstream request in streaming mode (does NOT buffer the body).
    # We use send(stream=True) so we can read response headers before yielding
    # the body — context-manager .stream() would require nesting inside the
    # generator which makes header access awkward.
    client = httpx.AsyncClient(timeout=httpx.Timeout(None, connect=15.0))
    try:
        resp = await client.send(
            httpx.Request("GET", url, headers=upstream_headers),
            stream=True,
            follow_redirects=True,
        )
    except Exception as exc:
        await client.aclose()
        logger.error("[proxy] upstream request error url=%.80s: %s", url, exc)
        raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

    # Collect response headers to forward (skip hop-by-hop headers)
    resp_headers: dict[str, str] = {"Accept-Ranges": "bytes"}
    for h in ("Content-Type", "Content-Length", "Content-Range", "Last-Modified", "ETag"):
        val = resp.headers.get(h.lower())
        if val:
            resp_headers[h] = val

    async def _iter_body():
        # Both resp and client are captured from the enclosing scope.
        # finally runs whether the generator is fully consumed or abandoned.
        try:
            async for chunk in resp.aiter_bytes(chunk_size=65_536):
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(
        _iter_body(),
        status_code=resp.status_code,
        headers=resp_headers,
        media_type=resp.headers.get("content-type", "video/mp4"),
    )


@router.get("/proxy")
@limiter.limit("60/minute")
async def stream_proxy(
    request: Request,
    job_id: str = Query(..., description="Job ID from /stream/start"),
) -> StreamingResponse:
    """
    CORS-safe streaming proxy for a job's TorBox direct_url.

    Routes the video bytes through our server so browsers always receive
    ``Access-Control-Allow-Origin: *`` regardless of TorBox CDN settings.
    Supports ``Range`` requests so the video player can seek.

    Security: only URLs stored by our own backend (fetched from TorBox API)
    are proxied; the ``job_id`` is the access-control boundary.
    """
    if not job_id.strip():
        raise HTTPException(status_code=400, detail="job_id must not be empty")

    job = stream_svc.get_job(job_id.strip())
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    if not job.direct_url:
        raise HTTPException(status_code=409, detail="No direct URL available for this job yet")

    if not _is_safe_proxy_url(job.direct_url):
        logger.error("[proxy] unsafe scheme in stored direct_url: %s", urlparse(job.direct_url).scheme)
        raise HTTPException(status_code=500, detail="Stored URL uses an unsupported scheme")

    return await _proxy_url(request, job.direct_url)


@router.get("/proxy_file")
@limiter.limit("60/minute")
async def stream_proxy_file(
    request: Request,
    job_id: str = Query(..., description="Job ID from /stream/start"),
    file_id: str = Query(..., description="File ID from /stream/files"),
) -> StreamingResponse:
    """
    CORS-safe streaming proxy for a specific file inside a TorBox torrent.
    Fetches a fresh TorBox requestdl URL for the given file, then streams it
    through our server with proper CORS headers.

    Security: only URLs returned directly by the TorBox API are proxied;
    ``job_id`` and ``file_id`` are the access-control boundary.
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
        logger.error("[proxy_file] TorBox requestdl error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not direct_url:
        raise HTTPException(status_code=404, detail="TorBox returned no URL for this file")

    if not _is_safe_proxy_url(direct_url):
        logger.error("[proxy_file] unexpected scheme in TorBox URL: %s", urlparse(direct_url).scheme)
        raise HTTPException(status_code=502, detail="Unexpected URL scheme in TorBox response")

    return await _proxy_url(request, direct_url)
