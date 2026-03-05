"""
# === ZETFLIX SOURCE ===
GET /zetflix  — search and fetch stream links from Zetflix mirrors.

Endpoint
--------
GET /zetflix?title=<str>&year=<int>&season=<int>&episode=<int>

Returns
-------
{ "title": str, "url": str|null, "files": [{"quality": str, "url": str}] }
"""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query, Request

from app.config import RATE_LIMIT
from app.limiter_shared import limiter
from app.scraper import zetflix as _zetflix_scraper

logger = logging.getLogger(__name__)
router = APIRouter(tags=["zetflix"])

# Simple in-memory cache (same pattern as hdrezka router)
_MEM_CACHE: dict[str, dict] = {}
_CACHE_TTL: int = 1800  # 30 minutes


def _cache_key(
    title: str,
    year: Optional[int],
    season: Optional[int],
    episode: Optional[int],
) -> str:
    raw = f"zetflix:{title.lower().strip()}:{year or ''}:{season or ''}:{episode or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


@router.get("/zetflix")
@limiter.limit(RATE_LIMIT)
async def zetflix_streams(
    request: Request,
    title: str = Query(..., description="Film or series title"),
    year: Optional[int] = Query(None, description="Release year"),
    season: Optional[int] = Query(None, description="Season number for TV series"),
    episode: Optional[int] = Query(None, description="Episode number for TV series"),
) -> dict:
    """
    Return direct player/stream URLs for a film or series from Zetflix.

    Searches Zetflix mirrors in parallel, picks the best-matching result,
    and returns embedded player URLs (iframe sources — Kodik, Alloha, etc.).

    Returns ``{ title, url, files: [{quality, url}] }``.
    """
    key = _cache_key(title, year, season, episode)
    entry = _MEM_CACHE.get(key)
    if entry and time.time() - entry["ts"] < _CACHE_TTL:
        logger.info("[Zetflix] cache hit title=%s", title)
        return entry["data"]

    # Search Zetflix mirrors
    try:
        results = await _zetflix_scraper.search(title)
    except Exception as exc:
        logger.error("[Zetflix] search error title=%s: %s", title, exc)
        results = []

    if not results:
        return {"title": title, "url": None, "files": [], "message": "Not found on Zetflix"}

    # Pick best match (prefer year match within ±1)
    chosen = results[0]
    if year:
        for r in results:
            try:
                r_year = int(r.get("year") or 0)
            except (ValueError, TypeError):
                r_year = 0
            if r_year and abs(r_year - year) <= 1:
                chosen = r
                break

    film_url = chosen.get("url", "")
    if not film_url:
        return {"title": title, "url": None, "files": [], "message": "No film URL from Zetflix search"}

    # Fetch detail page
    try:
        detail = await _zetflix_scraper.get_detail(film_url)
    except Exception as exc:
        logger.error("[Zetflix] get_detail error url=%s: %s", film_url, exc)
        return {"title": title, "url": film_url, "files": [], "message": str(exc)}

    files = detail.get("files") or []
    result: dict = {"title": title, "url": film_url, "files": files}
    if not files:
        result["message"] = "No streams found on Zetflix for this title"

    _MEM_CACHE[key] = {"data": result, "ts": time.time()}
    return result
