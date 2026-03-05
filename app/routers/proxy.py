"""
# === PROXY M3U8 - ONLY PLAYLIST ===
GET /proxy/m3u8?url=<str>  — proxy m3u8 playlists only.

Purpose
-------
Solves CORS + 404 issues when Lampa tries to fetch m3u8 playlists from CDN
domains that block browser-side requests (e.g. wiggle-as.newplayjj.com).

Only master.m3u8 / playlist.m3u8 / chunklist.m3u8 are proxied through this
server.  All .ts video segments are rewritten to absolute URLs and served
directly from the CDN, keeping server traffic minimal (50–200 KB per film).

Endpoint
--------
GET /proxy/m3u8?url=https://cdn.../master.m3u8

Returns
-------
The m3u8 playlist content with:
  - All relative links rewritten to absolute CDN URLs.
  - CORS header Access-Control-Allow-Origin: *
  - Content-Type: application/vnd.apple.mpegurl
"""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.config import PROXY_M3U8_ENABLED, RATE_LIMIT
from app.limiter_shared import limiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["proxy"])

# Timeout for fetching remote m3u8 playlists
_FETCH_TIMEOUT: float = 15.0

# Only these URL schemes are permitted (block file://, ftp://, etc.)
_ALLOWED_SCHEMES = {"http", "https"}


def _validate_proxy_url(url: str) -> None:
    """
    Guard against SSRF attacks by validating the proxy target URL.

    Raises HTTPException(400) when the URL:
      - Uses a non-http(s) scheme
      - Points to a private/loopback/link-local IP address
      - Has no hostname
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise HTTPException(
            status_code=400,
            detail=f"[PROXY M3U8] Only http/https URLs are allowed, got: {parsed.scheme!r}",
        )
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="[PROXY M3U8] URL has no hostname")

    # Resolve hostname and block private/internal address ranges
    try:
        addr_str = socket.getaddrinfo(hostname, None)[0][4][0]
        addr = ipaddress.ip_address(addr_str)
    except (socket.gaierror, ValueError):
        # If we cannot resolve the hostname, let httpx handle the error
        return

    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        logger.warning(
            "[PROXY M3U8] SSRF guard: blocked request to private address hostname=%s addr=%s",
            hostname,
            addr_str,
        )
        raise HTTPException(
            status_code=400,
            detail="[PROXY M3U8] Requests to private/internal addresses are not allowed",
        )


def _rewrite_m3u8(content: str, base_url: str) -> tuple[str, int]:
    """
    Rewrite relative links inside an m3u8 playlist to absolute CDN URLs.

    Returns the rewritten content and the count of links that were rewritten.
    .ts segments and nested m3u8 paths are turned into absolute URLs so that
    Lampa (or any HLS player) can fetch them directly from the CDN without
    going through this proxy.

    Also rewrites URI="..." attributes on #EXT tag lines (e.g. AES-128
    encryption key URLs in #EXT-X-KEY:METHOD=AES-128,URI="key.bin").
    """
    _uri_attr_re = re.compile(r'(URI=")([^"]+)(")')

    def _make_abs(raw: str) -> tuple[str, bool]:
        """Return (absolute_url, was_changed)."""
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw, False
        if raw.startswith("//"):
            return "https:" + raw, True
        return urljoin(base_url, raw), True

    lines = content.splitlines(keepends=True)
    rewritten: list[str] = []
    count = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            rewritten.append(line)
            continue

        if stripped.startswith("#"):
            # Rewrite URI="..." attributes within EXT tag lines (AES keys, etc.)
            def _replace_uri_attr(m: re.Match) -> str:
                nonlocal count
                abs_url, changed = _make_abs(m.group(2))
                if changed:
                    count += 1
                return m.group(1) + abs_url + m.group(3)

            new_line = _uri_attr_re.sub(_replace_uri_attr, line)
            rewritten.append(new_line)
            continue

        # Non-comment line: segment URI or sub-playlist path
        abs_url, changed = _make_abs(stripped)
        if changed:
            rewritten.append(line.replace(stripped, abs_url, 1))
            count += 1
        else:
            rewritten.append(line)

    return "".join(rewritten), count


@router.get("/proxy/m3u8")
@limiter.limit(RATE_LIMIT)
async def proxy_m3u8(
    request: Request,
    url: str = Query(..., description="Absolute URL of the m3u8 playlist to proxy"),
) -> Response:
    """
    Proxy an m3u8 playlist, rewriting all relative segment/playlist links to
    absolute CDN URLs and adding CORS headers.

    Only m3u8 playlists are proxied; .ts video segments must be fetched directly
    from the CDN by the HLS player (Lampa).
    """
    # === PROXY M3U8 - ONLY PLAYLIST ===
    if not PROXY_M3U8_ENABLED:
        raise HTTPException(status_code=503, detail="M3U8 proxy is disabled")

    # Guard against SSRF – only allow public http/https URLs
    _validate_proxy_url(url)

    # Refuse to proxy .ts segments – they should go directly to CDN
    parsed_path = urlparse(url).path.lower()
    if parsed_path.endswith(".ts"):
        raise HTTPException(
            status_code=400,
            detail="[PROXY M3U8] .ts segments must be fetched directly from CDN",
        )

    logger.info("[PROXY M3U8] Fetching playlist url=%s", url)

    # Forward User-Agent and Referer from Lampa so CDN does not block us
    headers: dict[str, str] = {}
    if ua := request.headers.get("user-agent"):
        headers["User-Agent"] = ua
    if referer := request.headers.get("referer"):
        headers["Referer"] = referer

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=_FETCH_TIMEOUT,
        ) as client:
            resp = await client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        logger.error("[PROXY M3U8] Timeout fetching url=%s: %s", url, exc)
        raise HTTPException(status_code=504, detail="Upstream timeout") from exc
    except httpx.RequestError as exc:
        logger.error("[PROXY M3U8] Request error url=%s: %s", url, exc)
        raise HTTPException(status_code=502, detail="Upstream request failed") from exc

    if resp.status_code != 200:
        logger.warning(
            "[PROXY M3U8] Upstream returned status=%d url=%s",
            resp.status_code,
            url,
        )
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Upstream returned HTTP {resp.status_code}",
        )

    content = resp.text
    content_len_before = len(content)

    # Compute base URL for resolving relative links (strip query/fragment)
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rsplit('/', 1)[0]}/"

    rewritten_content, rewrite_count = _rewrite_m3u8(content, base_url)

    logger.info(
        "[PROXY M3U8] Done url=%s status=%d size=%dB links_rewritten=%d",
        url,
        resp.status_code,
        content_len_before,
        rewrite_count,
    )

    return Response(
        content=rewritten_content,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        },
    )
