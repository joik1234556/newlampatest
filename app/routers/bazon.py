"""FastAPI router for Bazon stream API (demo token, free).

All requests are made through the CF Workers proxy.
"""
import hashlib
import logging
import time
from typing import Optional
from urllib.parse import quote_plus

import httpx
from fastapi import APIRouter, Query, Request

from app.config import CF_PROXY_URL
from app.limiter_shared import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

_CF_PROXY = CF_PROXY_URL.rstrip("/") + "/"
_BAZON_API = "https://bazon.cc/api"
_BAZON_TOKEN = "demo"

# In-memory cache: key -> (expiry_ts, payload)
_cache: dict = {}
_CACHE_TTL = 1800  # 30 minutes


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _cf_get(url: str, timeout: int = 20) -> httpx.Response:
    proxied = _CF_PROXY + url.lstrip("/")
    logger.debug("Bazon CF-proxy GET %s", proxied)
    resp = httpx.get(proxied, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    return resp


# ---------------------------------------------------------------------------
# Bazon API calls
# ---------------------------------------------------------------------------

def _search_by_kp(kp_id: int) -> list:
    url = f"{_BAZON_API}/search?token={_BAZON_TOKEN}&kp_id={kp_id}"
    resp = _cf_get(url)
    data = resp.json()
    return _extract_items(data)


def _search_by_query(query: str) -> list:
    url = f"{_BAZON_API}/search?token={_BAZON_TOKEN}&q={quote_plus(query)}"
    resp = _cf_get(url)
    data = resp.json()
    return _extract_items(data)


def _extract_items(data) -> list:
    """Normalise the Bazon API response to a list of dicts."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("results", "data", "items", "movies"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def _fetch_bazon(title: str, kp_id: Optional[int], imdb_id: Optional[str]) -> list:
    results = []

    if kp_id:
        try:
            results = _search_by_kp(kp_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Bazon kp search failed: %s", exc)

    if not results and title:
        try:
            results = _search_by_query(title)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Bazon query search failed: %s", exc)

    return results


# ---------------------------------------------------------------------------
# Router endpoint
# ---------------------------------------------------------------------------

@router.get("/bazon")
@limiter.limit("60/minute")
async def bazon_search(
    request: Request,
    title: str = Query(..., description="Movie/show title"),
    kp_id: Optional[int] = Query(None, description="Kinopoisk ID"),
    imdb_id: Optional[str] = Query(None, description="IMDB ID (tt...)"),
    year: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    episode: Optional[int] = Query(None),
):
    """Search Bazon (demo token, free) for streams."""
    key = _cache_key(
        title=title,
        kp_id=kp_id or "",
        imdb_id=imdb_id or "",
        year=year or "",
        season=season or "",
        episode=episode or "",
    )
    cached = _from_cache(key)
    if cached is not None:
        return cached

    try:
        items = _fetch_bazon(title, kp_id, imdb_id)
        files = []
        for item in items:
            url = item.get("iframe") or item.get("stream_url") or item.get("url") or ""
            if not url:
                continue
            files.append(
                {
                    "quality": item.get("quality") or "HD",
                    "translation": item.get("translation") or item.get("title") or "Bazon",
                    "url": url,
                    "seasons": item.get("seasons") or [],
                }
            )

        payload = {"title": title, "files": files}
        _to_cache(key, payload)
        return payload
    except Exception as exc:  # noqa: BLE001
        logger.error("Bazon error: %s", exc)
        return {"title": title, "files": []}
