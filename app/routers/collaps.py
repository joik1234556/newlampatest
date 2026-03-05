"""FastAPI router for Collaps free API (no token required).

All requests are made through the CF Workers proxy.
"""
import hashlib
import logging
import time
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Query, Request

from app.config import CF_PROXY_URL
from app.limiter_shared import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

_CF_PROXY = CF_PROXY_URL.rstrip("/") + "/"
_COLLAPS_API = "https://api.collaps.to"
_COLLAPS_SITE = "https://collaps.to"

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
    logger.debug("Collaps CF-proxy GET %s", proxied)
    resp = httpx.get(proxied, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    return resp


# ---------------------------------------------------------------------------
# Collaps API calls
# ---------------------------------------------------------------------------

def _search_by_kp(kp_id: int, media_type: str) -> list:
    """Search Collaps API by Kinopoisk ID (movie or tv)."""
    url = f"{_COLLAPS_API}/{media_type}/search/kp/{kp_id}"
    resp = _cf_get(url)
    data = resp.json()
    return data if isinstance(data, list) else []


def _search_by_imdb(imdb_id: str, media_type: str) -> list:
    """Search Collaps API by IMDB ID (movie or tv)."""
    url = f"{_COLLAPS_API}/{media_type}/search/imdb/{imdb_id}"
    resp = _cf_get(url)
    data = resp.json()
    return data if isinstance(data, list) else []


def _search_collaps_site(title: str) -> list:
    """HTML fallback: search collaps.to site directly via CF-proxy."""
    from urllib.parse import quote_plus
    url = f"{_COLLAPS_SITE}/search?q={quote_plus(title)}"
    resp = _cf_get(url)
    soup = BeautifulSoup(resp.text, "html.parser")
    items = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if "/film/" in href or "/serial/" in href:
            if not href.startswith("http"):
                href = _COLLAPS_SITE + href
            items.append({"iframe": href, "translation": text or "Collaps", "quality": ""})
    return items[:10]


def _fetch_collaps(title: str, kp_id: Optional[int], imdb_id: Optional[str]) -> list:
    """Try all Collaps API endpoints; fall back to HTML search."""
    results = []

    for media_type in ("movie", "tv"):
        if kp_id:
            try:
                found = _search_by_kp(kp_id, media_type)
                results.extend(found)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Collaps kp search (%s/%s) failed: %s", media_type, kp_id, exc)

        if imdb_id and not results:
            try:
                found = _search_by_imdb(imdb_id, media_type)
                results.extend(found)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Collaps imdb search (%s/%s) failed: %s", media_type, imdb_id, exc)

    if not results and title:
        try:
            results = _search_collaps_site(title)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Collaps HTML fallback failed: %s", exc)

    return results


# ---------------------------------------------------------------------------
# Router endpoint
# ---------------------------------------------------------------------------

@router.get("/collaps")
@limiter.limit("60/minute")
async def collaps_search(
    request: Request,
    title: str = Query(..., description="Movie/show title"),
    kp_id: Optional[int] = Query(None, description="Kinopoisk ID"),
    imdb_id: Optional[str] = Query(None, description="IMDB ID (tt...)"),
    year: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    episode: Optional[int] = Query(None),
):
    """Search Collaps (free, no token) for streams."""
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
        items = _fetch_collaps(title, kp_id, imdb_id)
        files = []
        for item in items:
            iframe = item.get("iframe") or item.get("url") or ""
            if not iframe:
                continue
            files.append(
                {
                    "quality": item.get("quality") or "HD",
                    "translation": item.get("translation") or "Collaps",
                    "url": iframe,
                    "seasons": item.get("seasons") or [],
                }
            )

        payload = {"title": title, "files": files}
        _to_cache(key, payload)
        return payload
    except Exception as exc:  # noqa: BLE001
        logger.error("Collaps error: %s", exc)
        return {"title": title, "files": []}
