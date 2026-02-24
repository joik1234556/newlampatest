"""
Lampa backend – FastAPI application.

Endpoints
---------
GET /search?q=          – parallel search across Kinogo + Rezka mirrors
GET /get?url=&source=   – parse film/series detail page
GET /easy/direct        – TorBox direct-download link via magnet or torrent_id+file_idx
GET /health             – TorBox auth check + service status
"""
from __future__ import annotations

import asyncio
import logging
import re
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app import torbox
from app.scraper import kinogo, rezka
from app.config import RATE_LIMIT, TORBOX_API_KEY

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address)

# TorBox polling settings
_MAX_POLL_ATTEMPTS: int = 12
_POLL_DELAY_SECONDS: int = 5


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    if not TORBOX_API_KEY:
        logger.warning("TORBOX_API_KEY is not set – TorBox endpoints will fail")
    else:
        try:
            info = await torbox.get_user_info()
            logger.info("TorBox auth OK: %s", info)
        except Exception as exc:
            logger.error("TorBox auth check failed: %s", exc)
    yield


app = FastAPI(
    title="Lampa Backend",
    description="Промежуточный слой между Lampa и источниками Kinogo / Rezka / TorBox",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_infohash(magnet: str) -> str | None:
    m = re.search(r"xt=urn:btih:([0-9a-fA-F]{40}|[A-Z2-7]{32})", magnet)
    return m.group(1).lower() if m else None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health", tags=["service"])
async def health(request: Request):  # noqa: ARG001
    """Check TorBox connectivity and return service status."""
    torbox_ok = False
    torbox_info = None
    if TORBOX_API_KEY:
        try:
            torbox_info = await torbox.get_user_info()
            torbox_ok = True
        except Exception as exc:
            logger.error("Health check TorBox error: %s", exc)
    return {
        "status": "ok",
        "torbox": {"connected": torbox_ok, "info": torbox_info},
    }


@app.get("/search", tags=["search"])
@limiter.limit(RATE_LIMIT)
async def search(
    request: Request,
    q: str = Query(..., description="Search query string"),
    source: Optional[str] = Query(None, description="Filter source: kinogo|rezka|all"),
):
    """
    Search for films/series across Kinogo and Rezka mirrors in parallel.
    Returns a list of ``{ title, year, poster, url, source }`` objects.
    """
    if not q.strip():
        return []

    tasks: list[asyncio.Task] = []
    src = (source or "all").lower()

    if src in ("all", "kinogo"):
        tasks.append(asyncio.create_task(kinogo.search(q)))
    if src in ("all", "rezka"):
        tasks.append(asyncio.create_task(rezka.search(q)))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    merged: list[dict] = []
    for res in results:
        if isinstance(res, Exception):
            logger.error("Search task error: %s", res)
        else:
            merged.extend(res)

    return merged


@app.get("/get", tags=["detail"])
@limiter.limit(RATE_LIMIT)
async def get_detail(
    request: Request,
    url: str = Query(..., description="Full URL of the film/series page"),
    source: str = Query(..., description="Source identifier: kinogo or rezka"),
):
    """
    Parse a film/series detail page and return player links / torrent files.
    Returns ``{ title, orig_title, poster, description, files: [...] }``.
    """
    src = source.lower()
    try:
        if src == "kinogo":
            data = await kinogo.get_detail(url)
        elif src == "rezka":
            data = await rezka.get_detail(url)
        else:
            raise HTTPException(status_code=400, detail="source must be 'kinogo' or 'rezka'")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_detail error url=%s source=%s: %s", url, source, exc)
        raise HTTPException(status_code=502, detail=f"Failed to fetch detail page: {exc}") from exc

    return data


@app.get("/easy/direct", tags=["easy"])
@limiter.limit(RATE_LIMIT)
async def easy_direct(
    request: Request,
    magnet: Optional[str] = Query(None, description="Magnet link to add to TorBox"),
    torrent_id: Optional[str] = Query(None, description="Existing TorBox torrent ID"),
    file_idx: Optional[int] = Query(None, description="File index inside the torrent"),
):
    """
    Obtain a direct HTTPS download link via TorBox.

    - If **magnet** is provided → add to TorBox, poll until file is ready, return link.
    - If **torrent_id** + **file_idx** are provided → immediately request download link.
    """
    if not TORBOX_API_KEY:
        raise HTTPException(status_code=503, detail="TorBox API key not configured")

    # --- Case 1: resolve existing torrent_id + file_idx ---
    if torrent_id is not None and file_idx is not None:
        try:
            direct_url = await torbox.request_download_link(torrent_id, file_idx)
        except Exception as exc:
            logger.error("TorBox requestdl error: %s", exc)
            return JSONResponse(
                status_code=502,
                content={"direct_url": None, "status": "error", "error": str(exc)},
            )
        if direct_url:
            return {"direct_url": direct_url, "status": "ready"}
        return JSONResponse(
            status_code=202,
            content={"direct_url": None, "status": "processing", "error": None},
        )

    # --- Case 2: add magnet and return status ---
    if magnet:
        # Optional: check cache first for fast response
        infohash = _extract_infohash(magnet)
        if infohash:
            cached = await torbox.check_cached(infohash)
            if cached:
                logger.info("TorBox cache hit for %s", infohash)

        try:
            result = await torbox.add_magnet(magnet)
        except Exception as exc:
            logger.error("TorBox add_magnet error: %s", exc)
            return JSONResponse(
                status_code=502,
                content={"direct_url": None, "status": "error", "error": str(exc)},
            )

        data = result.get("data") or {}
        new_id = data.get("torrent_id") or data.get("id")

        if not new_id:
            return JSONResponse(
                status_code=202,
                content={
                    "direct_url": None,
                    "status": "processing",
                    "torrent_id": None,
                    "error": "Torrent added, but no ID returned. Check mylist.",
                },
            )

        # Poll for readiness (up to ~60 seconds)
        for _ in range(_MAX_POLL_ATTEMPTS):
            await asyncio.sleep(_POLL_DELAY_SECONDS)
            torrent = await torbox.get_torrent_by_id(new_id)
            if torrent is None:
                continue
            torrent_status = torrent.get("download_state", "")
            files = torrent.get("files") or []
            if torrent_status in ("seeding", "downloading", "completed") and files:
                file_id = files[0].get("id", 0)
                try:
                    direct_url = await torbox.request_download_link(new_id, file_id)
                    if direct_url:
                        return {"direct_url": direct_url, "status": "ready"}
                except Exception as exc:
                    logger.error("TorBox requestdl after add error: %s", exc)
                break

        return JSONResponse(
            status_code=202,
            content={
                "direct_url": None,
                "status": "processing",
                "torrent_id": new_id,
                "error": None,
            },
        )

    raise HTTPException(
        status_code=400,
        detail="Provide either 'magnet' or both 'torrent_id' and 'file_idx'",
    )
