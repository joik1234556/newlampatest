"""FastAPI router for Zetflix stream search."""
import hashlib
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from app.limiter_shared import limiter
from app.scraper.zetflix import get_zetflix_streams, search_zetflix

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory cache: key -> (expiry_ts, payload)
_cache: dict = {}
_CACHE_TTL = 1800  # 30 minutes


def _cache_key(**kwargs) -> str:
    raw = "&".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
    return hashlib.sha256(raw.encode()).hexdigest()


def _from_cache(key: str):
    entry = _cache.get(key)
    if entry and entry[0] > time.time():
        return entry[1]
    return None


def _to_cache(key: str, value) -> None:
    _cache[key] = (time.time() + _CACHE_TTL, value)


@router.get("/zetflix")
@limiter.limit("60/minute")
async def zetflix_search(
    request: Request,
    title: str = Query(..., description="Movie/show title"),
    year: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    episode: Optional[int] = Query(None),
):
    """Search Zetflix for streams by title."""
    key = _cache_key(title=title, year=year or "", season=season or "", episode=episode or "")
    cached = _from_cache(key)
    if cached is not None:
        return cached

    try:
        results = search_zetflix(title, year=year)
        files = []
        for item in results[:5]:
            streams = get_zetflix_streams(item["url"])
            for s in streams:
                files.append(
                    {
                        "quality": s.get("quality", ""),
                        "translation": s.get("translation", "Zetflix"),
                        "url": s.get("url", ""),
                    }
                )

        payload = {"title": title, "files": files}
        _to_cache(key, payload)
        return payload
    except Exception as exc:  # noqa: BLE001
        logger.error("Zetflix error: %s", exc)
        return {"title": title, "files": []}
