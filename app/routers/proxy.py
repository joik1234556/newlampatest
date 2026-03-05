"""
# === PROXY M3U8 - ONLY PLAYLIST ===
GET /proxy/m3u8  — lightweight m3u8 playlist proxy with CORS headers.

Only playlists (master.m3u8, playlist.m3u8, chunklist.m3u8) are proxied.
All .ts segment URLs and non-m3u8 media are rewritten to absolute so that
Lampa fetches them **directly** from the CDN — keeping server traffic minimal
(typically 50–200 KB per film, only the playlist).

Endpoint
--------
GET /proxy/m3u8?url=<encoded_m3u8_url>

Returns
-------
The m3u8 playlist with:
  - All relative URI lines converted to absolute (full CDN URL).
  - `Access-Control-Allow-Origin: *` and related CORS headers.
  - Content-Type: application/vnd.apple.mpegurl
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.config import PROXY_M3U8_ENABLED

logger = logging.getLogger(__name__)

router = APIRouter(tags=["proxy"])

# Timeout for upstream m3u8 fetch (seconds).
_M3U8_TIMEOUT: int = 15

# CORS headers applied to every proxied m3u8 response.
_CORS_HEADERS: dict[str, str] = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}

# === PROXY M3U8 - ONLY PLAYLIST ===
# Private / loopback IP ranges that must never be reached via the proxy (SSRF protection).
_BLOCKED_HOSTS = (
    "localhost",
    "127.",
    "0.0.0.0",
    "::1",
    "169.254.",  # link-local
    "10.",       # RFC-1918
    "172.16.",   # RFC-1918
    "172.17.",
    "172.18.",
    "172.19.",
    "172.20.",
    "172.21.",
    "172.22.",
    "172.23.",
    "172.24.",
    "172.25.",
    "172.26.",
    "172.27.",
    "172.28.",
    "172.29.",
    "172.30.",
    "172.31.",
    "192.168.", # RFC-1918
)


def _validate_proxy_url(url: str) -> None:
    """Raise HTTPException if *url* is not safe to proxy."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http/https URLs are allowed")
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail="Missing host in URL")
    for blocked in _BLOCKED_HOSTS:
        if host == blocked.rstrip(".") or host.startswith(blocked):
            raise HTTPException(status_code=400, detail="Proxying internal addresses is not allowed")

# Timeout for upstream m3u8 fetch (seconds).
_M3U8_TIMEOUT: int = 15

# CORS headers applied to every proxied m3u8 response.
_CORS_HEADERS: dict[str, str] = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}

# Patterns that identify chunklist/sub-playlist lines inside a master playlist.
_URI_ATTR_RE = re.compile(r'(URI=")([^"]+)(")')
_SEGMENT_LINE_RE = re.compile(r"^(?!#)(.+\.(?:ts|m3u8|aac|mp4|m4s|vtt|webvtt)[^\s]*)$", re.MULTILINE)


def _make_absolute(line: str, base_url: str) -> str:
    """Return *line* as an absolute URL, resolving against *base_url* if needed."""
    line = line.strip()
    if not line:
        return line
    if line.startswith("http://") or line.startswith("https://"):
        return line
    if line.startswith("//"):
        scheme = urlparse(base_url).scheme or "https"
        return f"{scheme}:{line}"
    return urljoin(base_url, line)


def _rewrite_m3u8(content: str, base_url: str) -> tuple[str, int]:
    """
    Rewrite all relative segment / sub-playlist references in *content* to
    absolute URLs based on *base_url*.

    Returns (rewritten_content, rewrite_count).
    """
    count = 0

    # Rewrite URI="..." attributes (used in EXT-X-KEY, EXT-X-MEDIA, etc.)
    def _replace_uri(m: re.Match) -> str:
        nonlocal count
        abs_url = _make_absolute(m.group(2), base_url)
        count += 1
        return m.group(1) + abs_url + m.group(3)

    content = _URI_ATTR_RE.sub(_replace_uri, content)

    # Rewrite bare segment / sub-playlist lines (non-comment lines ending in
    # .ts / .m3u8 / .aac / .mp4 / .m4s / .vtt etc.)
    def _replace_segment(m: re.Match) -> str:
        nonlocal count
        original = m.group(1)
        abs_url = _make_absolute(original, base_url)
        if abs_url != original:
            count += 1
        return abs_url

    content = _SEGMENT_LINE_RE.sub(_replace_segment, content)

    return content, count


@router.options("/proxy/m3u8")
async def proxy_m3u8_options():
    """Handle CORS pre-flight for the proxy endpoint."""
    return Response(status_code=204, headers=_CORS_HEADERS)


@router.get("/proxy/m3u8")
async def proxy_m3u8(
    request: Request,
    url: str = Query(..., description="Full URL of the m3u8 playlist to proxy"),
) -> Response:
    """
    Fetch an m3u8 playlist, rewrite relative URLs to absolute, and return it
    with CORS headers so Lampa can play it cross-origin.

    Only playlists are proxied; .ts media segments are served directly from CDN.
    """
    if not PROXY_M3U8_ENABLED:
        raise HTTPException(status_code=503, detail="M3U8 proxy is disabled")

    # === PROXY M3U8 - ONLY PLAYLIST ===
    _validate_proxy_url(url)
    logger.info("[PROXY M3U8] fetching url=%s", url)

    # Forward User-Agent and Referer from the client request so CDNs don't block us.
    forward_headers = {
        "User-Agent": request.headers.get(
            "user-agent", "Mozilla/5.0 (SmartTV) AppleWebKit/537.36"
        ),
    }
    referer = request.headers.get("referer", "")
    if referer:
        forward_headers["Referer"] = referer

    async with httpx.AsyncClient(follow_redirects=True, timeout=_M3U8_TIMEOUT) as client:
        try:
            resp = await client.get(url, headers=forward_headers)
        except httpx.TimeoutException:
            logger.error("[PROXY M3U8] timeout url=%s", url)
            raise HTTPException(status_code=504, detail="Upstream timeout fetching m3u8")
        except httpx.RequestError as exc:
            logger.error("[PROXY M3U8] request error url=%s: %s", url, exc)
            raise HTTPException(status_code=502, detail=f"Upstream request error: {exc}")

    if resp.status_code != 200:
        logger.warning("[PROXY M3U8] upstream returned %d for url=%s", resp.status_code, url)
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Upstream returned HTTP {resp.status_code}",
        )

    content = resp.text

    # Build the base URL (directory of the playlist) for resolving relative refs.
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rsplit('/', 1)[0]}/"

    rewritten, count = _rewrite_m3u8(content, base_url)

    logger.info(
        "[PROXY M3U8] done url=%s status=%d size=%d rewritten=%d",
        url,
        resp.status_code,
        len(rewritten),
        count,
    )

    headers = dict(_CORS_HEADERS)
    headers["Content-Type"] = "application/vnd.apple.mpegurl"
    # Prevent browsers from caching stale playlists for too long.
    headers["Cache-Control"] = "no-cache"

    return Response(content=rewritten, media_type="application/vnd.apple.mpegurl", headers=headers)
