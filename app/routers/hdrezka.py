"""
GET /hdrezka  — fetch direct video streams from HDRezka via HdRezkaApi library.

Endpoint
--------
GET /hdrezka?title=<str>&year=<int>&season=<int>&episode=<int>
  - Searches HDRezka for the title (using the existing rezka scraper),
    picks the best match, then calls HdRezkaApi to extract direct m3u8/mp4 links.
  - Optional ``url`` param skips the search step.

Returns
-------
{ "title": str, "url": str|null, "files": [{"quality": str, "url": str}] }
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query, Request

from app.config import RATE_LIMIT
from app.limiter_shared import limiter
from app.scraper import rezka as _rezka_scraper

logger = logging.getLogger(__name__)
router = APIRouter(tags=["hdrezka"])

# Simple in-memory cache (no Redis dependency for this lightweight path)
_MEM_CACHE: dict[str, dict] = {}
_CACHE_TTL: int = 1800  # 30 minutes


def _cache_key(title: str, year: Optional[int], season: Optional[int], episode: Optional[int]) -> str:
    raw = f"{title.lower().strip()}:{year or ''}:{season or ''}:{episode or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _get_streams_sync(page_url: str, season: Optional[int], episode: Optional[int]) -> list[dict]:
    """Call HdRezkaApi synchronously (runs in threadpool executor so asyncio is not blocked)."""
    try:
        from HdRezkaApi import HdRezkaApi  # type: ignore[import]
    except ImportError:
        logger.warning(
            "[HDRezka] HdRezkaApi library not installed. "
            "Install with: pip install HdRezkaApi"
        )
        return []

    try:
        api = HdRezkaApi(page_url)
        if not api.ok:
            logger.warning("[HDRezka] api.ok=False url=%s exc=%s", page_url, getattr(api, "exception", ""))
            return []

        if season is not None and episode is not None:
            stream = api.getStream(season=season, episode=episode)
        else:
            stream = api.getStream()

        files: list[dict] = []
        for quality in ("2160p", "1080p", "720p", "480p", "360p"):
            try:
                # stream(quality) returns a list of URLs; take the first mp4/m3u8 link
                urls = stream(quality)
                if urls:
                    files.append({"quality": quality, "url": str(urls[0])})
            except Exception:
                pass
        logger.info("[HDRezka] found %d stream(s) for url=%s", len(files), page_url)
        return files
    except Exception as exc:
        logger.warning("[HDRezka] getStream error url=%s: %s", page_url, exc)
        return []


@router.get("/hdrezka")
@limiter.limit(RATE_LIMIT)
async def hdrezka_streams(
    request: Request,
    title: str = Query(..., description="Film or series title to search for on HDRezka"),
    year: Optional[int] = Query(None, description="Release year (improves match accuracy)"),
    season: Optional[int] = Query(None, description="Season number for TV series (1-based)"),
    episode: Optional[int] = Query(None, description="Episode number for TV series (1-based)"),
    url: Optional[str] = Query(None, description="Direct HDRezka page URL — skips the search step"),
) -> dict:
    """
    Return direct video streams (m3u8/mp4) for a film/series from HDRezka via HdRezkaApi.

    - If ``url`` is provided it is used directly (no search).
    - Otherwise searches HDRezka for ``title`` (filtered by ``year`` if given).

    Returns ``{ title, url, files: [{quality, url}] }``.
    Each file entry: ``quality`` (e.g. ``"1080p"``) and ``url`` (direct playback link).
    """
    key = _cache_key(title, year, season, episode)
    entry = _MEM_CACHE.get(key)
    if entry and time.time() - entry["ts"] < _CACHE_TTL:
        logger.info("[HDRezka] cache hit title=%s season=%s ep=%s", title, season, episode)
        return entry["data"]

    # ── Step 1: Resolve HDRezka page URL ─────────────────────────────────
    page_url = url
    if not page_url:
        try:
            results = await _rezka_scraper.search(title)
        except Exception as exc:
            logger.error("[HDRezka] search error title=%s: %s", title, exc)
            results = []

        if not results:
            return {"title": title, "url": None, "files": [], "message": "Not found on HDRezka"}

        # Pick best match: prefer the result whose year is within ±1 of requested year;
        # fall back to the first search result.
        page_url = results[0]["url"]
        if year:
            for r in results:
                try:
                    r_year = int(r.get("year") or 0)
                except (ValueError, TypeError):
                    r_year = 0
                if r_year and abs(r_year - year) <= 1:
                    page_url = r["url"]
                    break

    logger.info("[HDRezka] fetching streams url=%s season=%s ep=%s", page_url, season, episode)

    # ── Step 2: Get streams via HdRezkaApi (sync → threadpool) ───────────
    loop = asyncio.get_event_loop()
    files = await loop.run_in_executor(None, _get_streams_sync, page_url, season, episode)

    result: dict = {"title": title, "url": page_url, "files": files}
    if not files:
        result["message"] = "No streams found for this title on HDRezka"

    _MEM_CACHE[key] = {"data": result, "ts": time.time()}
    return result
