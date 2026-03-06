"""FastAPI router for HDRezka stream search.

Uses direct HTTP via CF Workers proxy — no HdRezkaApi dependency.
"""
import hashlib
import logging
import re
import time
from typing import Optional
from urllib.parse import quote

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Query, Request

from app.config import CF_PROXY_URL, HDREZKA_MIRRORS
from app.limiter_shared import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

_CF_PROXY = CF_PROXY_URL.rstrip("/") + "/"

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

def _cf_get(url: str, timeout: int = 20) -> str:
    proxied = _CF_PROXY + url.lstrip("/")
    logger.debug("HDRezka CF-proxy GET %s", proxied)
    resp = httpx.get(proxied, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def _search_mirror(mirror: str, title: str) -> list:
    """Return list of {title, url} from a single mirror search page."""
    search_url = mirror.rstrip("/") + "/search/?do=search&subaction=search&q=" + quote(title)
    html = _cf_get(search_url)
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for a in soup.select(".b-content__inline_item .b-content__inline_item-link a"):
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if href and text:
            results.append({"title": text, "url": href})
    return results


def _search(title: str) -> list:
    """Search across configured mirrors; return first non-empty result list."""
    for mirror in HDREZKA_MIRRORS:
        try:
            results = _search_mirror(mirror, title)
            if results:
                return results
        except Exception as exc:  # noqa: BLE001
            logger.warning("HDRezka mirror %s search failed: %s", mirror, exc)
    return []


# ---------------------------------------------------------------------------
# Stream extraction
# ---------------------------------------------------------------------------

def _decode_stream_data(encoded: str) -> Optional[str]:
    """Decode HDRezka's obfuscated base64 stream data."""
    from app.scraper import decode_hdrezka_streams
    return decode_hdrezka_streams(encoded)


def _parse_stream_string(decoded: str) -> list:
    """Parse decoded string like '720p[url1]\\n1080p[url2]'."""
    streams = []
    for line in decoded.splitlines():
        m = re.match(r"(\d+p)\[(.+?)\]", line.strip())
        if m:
            quality, url_part = m.group(1), m.group(2)
            # Multiple URLs separated by " или "
            url = url_part.split(" или ")[0].strip()
            if url:
                streams.append({"quality": quality, "url": url})
    return streams


def _extract_streams(html: str, page_url: str) -> list:
    """Extract stream list from an HDRezka movie page."""
    # Patterns to find encoded stream data in inline <script> blocks
    patterns = [
        r'var\s+streams\s*=\s*[\'"]([A-Za-z0-9+/=@#%&* ]+)[\'"]',
        r'"streams"\s*:\s*[\'"]([A-Za-z0-9+/=@#%&* ]+)[\'"]',
    ]

    for pattern in patterns:
        m = re.search(pattern, html)
        if m:
            decoded = _decode_stream_data(m.group(1))
            if decoded:
                streams = _parse_stream_string(decoded)
                if streams:
                    return streams

    # Fallback: look for iframe / cdn player src
    for pat in [
        r'<iframe[^>]+src=["\']([^"\']+)["\']',
        r'data-streams=["\']([^"\']+)["\']',
    ]:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return [{"quality": "iframe", "url": m.group(1)}]

    return [{"quality": "iframe", "url": page_url}]


def _get_streams(film_url: str) -> list:
    html = _cf_get(film_url, timeout=25)
    return _extract_streams(html, film_url)


# ---------------------------------------------------------------------------
# Router endpoint
# ---------------------------------------------------------------------------

@router.get("/hdrezka")
@limiter.limit("60/minute")
async def hdrezka_search(
    request: Request,
    title: str = Query(..., description="Movie/show title"),
    year: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    episode: Optional[int] = Query(None),
    kp_id: Optional[int] = Query(None),
    imdb_id: Optional[str] = Query(None),
):
    """Search HDRezka for streams by title (via CF Workers proxy)."""
    key = _cache_key(
        title=title,
        year=year or "",
        season=season or "",
        episode=episode or "",
        kp_id=kp_id or "",
        imdb_id=imdb_id or "",
    )
    cached = _from_cache(key)
    if cached is not None:
        return cached

    try:
        results = _search(title)
        files = []
        for item in results[:3]:
            streams = _get_streams(item["url"])
            for s in streams:
                files.append(
                    {
                        "quality": s.get("quality", ""),
                        "translation": item.get("title", "HDRezka"),
                        "url": s.get("url", ""),
                    }
                )

        payload = {"title": title, "files": files}
        _to_cache(key, payload)
        return payload
    except Exception as exc:  # noqa: BLE001
        logger.error("HDRezka error: %s", exc)
        return {"title": title, "files": []}
