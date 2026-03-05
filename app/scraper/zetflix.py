"""
# === ZETFLIX SOURCE ===
# === ZETFLIX v3 - M3U8 PROXY FIX ===
Zetflix scraper — search and detail parsing.

Zetflix embeds its video via third-party players (Kodik, Alloha, Moonwalk, etc.).
The scraper:
  1. Searches for a title on each mirror in parallel.
  2. On the detail page extracts the embedded iframe src (player URL).
  3. Follows the iframe URL to extract the real m3u8 from the player JS
     (e.g. ``Playerjs({file:"https://...m3u8"})``, Kodik, Alloha patterns).
  4. Returns m3u8 links wrapped through the Cloudflare Workers proxy so Lampa
     gets an absolute, CORS-friendly URL.

All HTTP requests are routed through the Cloudflare Workers proxy
(``CLOUDFLARE_PROXY``) which handles User-Agent spoofing and Cloudflare
JS challenges for free.  Falls back to ``cloudscraper_get`` on proxy errors.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse, urlencode

import httpx
from bs4 import BeautifulSoup

from app.scraper import cloudscraper_get, try_mirrors
from app.config import (
    ZETFLIX_MIRRORS,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Cloudflare Workers proxy helper
# ---------------------------------------------------------------------------

CLOUDFLARE_PROXY = "https://lampaproxy.egorkorotkov5.workers.dev/"


def _proxy_get(url: str) -> str:
    """
    Fetch url via the Cloudflare Workers proxy.
    The proxy automatically sets correct User-Agent, Origin, Referer headers
    and bypasses Cloudflare JS challenges.
    Falls back to cloudscraper_get if proxy request fails.
    """
    proxy_url = CLOUDFLARE_PROXY + url
    logger.info("[ZETFLIX PROXY] Fetching via CF worker: %s", url)
    try:
        resp = httpx.get(
            proxy_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
            },
            timeout=30,
            follow_redirects=True,
        )
        resp.raise_for_status()
        logger.info("[ZETFLIX PROXY] OK status=%s for %s", resp.status_code, url)
        return resp.text
    except Exception as exc:
        logger.warning("[ZETFLIX PROXY] Failed for %s: %s — falling back to cloudscraper", url, exc)
        return cloudscraper_get(url)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wrap_m3u8_url(url: str) -> str:
    """
    Wrap a raw m3u8/mp4 URL through Cloudflare Workers proxy so Lampa
    gets correct CORS headers and the URL is always absolute (playable).
    """
    if not url:
        return url
    # Normalize protocol-relative URLs
    if url.startswith("//"):
        url = "https:" + url
    if not url.startswith("http"):
        return url
    # Always proxy through CF worker — this gives Lampa an absolute,
    # CORS-friendly URL that works even without the FastAPI backend running.
    wrapped = CLOUDFLARE_PROXY + url
    logger.info("[ZETFLIX PROXY] m3u8 wrapped: %s", wrapped)
    return wrapped


# === ZETFLIX v3 - M3U8 PROXY FIX ===
# Patterns that appear in Kodik / Alloha / Playerjs / generic player init blocks:
#   new Playerjs({file:"https://cdn.../master.m3u8"})
#   player.setup({sources: [{file: "https://...m3u8"}]})
#   var file = "https://cdn.../playlist.m3u8"
#   hls.loadSource("https://cdn.../index.m3u8")
_IFRAME_M3U8_RE = re.compile(
    r'(?:'
    r'["\']?(?:file|url|src|stream|source)["\']?\s*[=:]\s*["\']'
    r'|new\s+Hls\s*\(\s*\)\s*;\s*hls\.loadSource\s*\(\s*["\']'
    r'|hls\.loadSource\s*\(\s*["\']'
    r')'
    r'(https?://[^"\'<>\s]+\.m3u8[^"\'<>\s]*)',
    re.IGNORECASE,
)
# Broader fallback regex: any quoted https URL containing .m3u8
_BROAD_M3U8_RE = re.compile(r"""["'](https?://[^"'<>\s]+\.m3u8[^"'<>\s]*)["']""")

# Kodik pattern: protocol-relative URLs like //cdn.kodik.info/...m3u8
_KODIK_M3U8_RE = re.compile(
    r'["\']?(//(?:cdn|cloud|st|stream)\.[^"\'<>\s]*\.m3u8[^"\'<>\s]*)["\']?',
    re.IGNORECASE,
)

# Alloha pattern: JSON-encoded stream URLs
_ALLOHA_URL_RE = re.compile(
    r'"hls"\s*:\s*"(https?://[^"]+\.m3u8[^"]*)"',
    re.IGNORECASE,
)

# Generic: any URL with .m3u8 including after query params
_ANY_M3U8_RE = re.compile(
    r'["\s]?(https?://[^\s"\'<>]+\.m3u8(?:[^\s"\'<>]*)?)["\s]?',
    re.IGNORECASE,
)


def _extract_m3u8_from_player_html(html: str) -> list[str]:
    """
    # === ZETFLIX v3 - M3U8 PROXY FIX ===
    Scan the HTML / JS of a player iframe page and extract all m3u8 URLs.
    Handles Kodik, Alloha, Playerjs and generic HLS player patterns.
    Returns a deduplicated list of absolute m3u8 URLs found.
    """
    found: list[str] = []
    seen: set[str] = set()

    def _add(u: str) -> None:
        if not u:
            return
        # Normalize protocol-relative
        if u.startswith("//"):
            u = "https:" + u
        if not u.startswith("http"):
            return
        if u in seen:
            return
        seen.add(u)
        found.append(u)

    # Primary patterns
    for m in _IFRAME_M3U8_RE.finditer(html):
        _add(m.group(1))
    # Broad fallback
    for m in _BROAD_M3U8_RE.finditer(html):
        _add(m.group(1))
    # Kodik protocol-relative
    for m in _KODIK_M3U8_RE.finditer(html):
        _add(m.group(1))
    # Alloha JSON
    for m in _ALLOHA_URL_RE.finditer(html):
        _add(m.group(1))
    # Any remaining m3u8 URL
    for m in _ANY_M3U8_RE.finditer(html):
        _add(m.group(1))

    logger.debug("[ZETFLIX DEBUG] _extract_m3u8_from_player_html found=%d", len(found))
    return found


async def _follow_iframe_for_m3u8(iframe_url: str) -> list[str]:
    """
    # === ZETFLIX v3 - M3U8 PROXY FIX ===
    Follow a player iframe URL, parse its HTML/JS, and return any m3u8 URLs found.
    Returns an empty list on any error (non-fatal — we fall back to the iframe URL).

    Uses the Cloudflare Workers proxy so JS-rendered player pages are
    correctly parsed (Kodik, Alloha, etc.).
    """
    loop = asyncio.get_event_loop()
    urls_to_try = [iframe_url]
    # Kodik/Alloha often need autoplay=1 to expose stream URLs in JS
    if "kodik" in iframe_url or "alloha" in iframe_url:
        sep = "&" if "?" in iframe_url else "?"
        urls_to_try.append(iframe_url + sep + "autoplay=1")

    all_found: list[str] = []
    seen_iframe: set[str] = set()
    for url_try in urls_to_try:
        try:
            html = await loop.run_in_executor(None, _proxy_get, url_try)
        except Exception as exc:
            logger.debug("[ZETFLIX DEBUG] Could not fetch iframe url=%s: %s", url_try, exc)
            continue

        urls = _extract_m3u8_from_player_html(html)
        for u in urls:
            if u not in seen_iframe:
                seen_iframe.add(u)
                all_found.append(u)
                logger.info("[ZETFLIX DEBUG] Found m3u8 in iframe url=%s m3u8=%s", url_try, u)

        if all_found:
            break  # found something — no need to try more variants

    return all_found


def _guess_quality(text: str) -> str:
    text_lower = text.lower()
    for q in ("2160p", "4k", "1080p", "720p", "480p", "360p"):
        if q in text_lower:
            return "2160p" if q == "4k" else q
    return "1080p"


# Maximum number of player iframes to follow when looking for m3u8 URLs
_MAX_IFRAME_FOLLOW_COUNT: int = 3


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def _parse_search_results(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    items: list[dict] = []

    # Zetflix typically renders film cards with class `.movie-item`, `.film-item`,
    # `.item`, or generic `article` tags.  We try all common selectors.
    selectors = [
        ".movie-item",
        ".film-item",
        ".card-item",
        "article.item",
        ".item",
        ".shortstory",
        ".short-film",
    ]
    cards = []
    for sel in selectors:
        found = soup.select(sel)
        if found:
            cards = found
            break

    # Fallback: any anchor with a recognisable film path
    if not cards:
        for a in soup.select("a[href]"):
            href = a.get("href", "")
            # Zetflix film pages typically contain /film/ or /serial/
            if re.search(r"/(film|serial|movies|series)/", href):
                title_text = a.get_text(strip=True)
                if not title_text:
                    continue
                url = href if href.startswith("http") else urljoin(base_url, href)
                year_m = re.search(r"\b(19|20)\d{2}\b", a.get_text())
                items.append({
                    "title": title_text,
                    "year": year_m.group(0) if year_m else None,
                    "poster": "",
                    "url": url,
                    "source": "zetflix",
                })
        return items

    for card in cards:
        title_tag = card.select_one("h2 a, h3 a, .title a, .film-name a, a.film-link")
        if not title_tag:
            # try any anchor
            title_tag = card.select_one("a[href]")
        if not title_tag:
            continue
        title = title_tag.get_text(strip=True)
        href = title_tag.get("href", "")
        if not href:
            continue
        url = href if href.startswith("http") else urljoin(base_url, href)

        poster_tag = card.select_one("img")
        poster = ""
        if poster_tag:
            poster = poster_tag.get("src") or poster_tag.get("data-src") or ""
            if poster and not poster.startswith("http"):
                poster = urljoin(base_url, poster)

        year_m = re.search(r"\b(19|20)\d{2}\b", card.get_text())
        year = year_m.group(0) if year_m else None

        if title:
            items.append({
                "title": title,
                "year": year,
                "poster": poster,
                "url": url,
                "source": "zetflix",
            })

    logger.info("[ZETFLIX] Found %d results", len(items))
    return items


async def _search_mirror(mirror: str, query: str) -> list[dict]:
    # Common Zetflix search URL patterns
    qs = urlencode({"do": "search", "subaction": "search", "story": query})
    search_url = f"{mirror}index.php?{qs}"
    loop = asyncio.get_event_loop()
    try:
        html = await loop.run_in_executor(None, _proxy_get, search_url)
        results = _parse_search_results(html, mirror)
        if results:
            return results
    except Exception as exc:
        logger.debug("[Zetflix] search via index.php failed mirror=%s: %s", mirror, exc)

    # Fallback: try ?s= query param (WordPress-style)
    try:
        search_url2 = f"{mirror}?s={query}"
        html2 = await loop.run_in_executor(None, _proxy_get, search_url2)
        return _parse_search_results(html2, mirror)
    except Exception as exc2:
        logger.debug("[Zetflix] search via ?s= failed mirror=%s: %s", mirror, exc2)
        return []


async def search(query: str) -> list[dict]:
    return await try_mirrors(
        ZETFLIX_MIRRORS,
        lambda mirror: _search_mirror(mirror, query),
    )


# Regex: match file/url/src/stream keys pointing at m3u8 or mp4 stream URLs in inline JS
_STREAM_URL_RE = re.compile(
    r'(?:file|url|src|stream)["\s]*:\s*["\']([^"\']+\.(?:m3u8|mp4)[^"\']*)["\']'
)

# Domains of known third-party video players embedded on CIS film sites
_KNOWN_PLAYER_DOMAINS = (
    "kodik",
    "moonwalk",
    "alloha",
    "video.sibnet",
    "videoframe",
)
# Regex built from KNOWN_PLAYER_DOMAINS — matches full embed URLs in inline JS
_PLAYER_EMBED_RE = re.compile(
    r'["\']?(https?://(?:' + "|".join(re.escape(d) for d in _KNOWN_PLAYER_DOMAINS) + r')[^"\'<>\s]+)["\']?'
)


# ---------------------------------------------------------------------------
# Detail / player extraction
# ---------------------------------------------------------------------------

def _extract_player_iframes(
    soup: BeautifulSoup, base_url: str
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Extract embedded player URLs from the detail page.
    Returns a tuple of (files, iframe_urls) where:
      - files: list of dicts with keys ``quality`` and ``url``
      - iframe_urls: list of player iframe URLs to follow for m3u8 extraction
    """
    files: list[dict] = []
    seen: set[str] = set()
    # Track iframe URLs found for async follow-up in get_detail
    iframe_urls: list[str] = []

    def _add(src: str, quality: str = "1080p") -> None:
        if not src or src in seen:
            return
        seen.add(src)
        # === ZETFLIX PROXY ===
        # Wrap m3u8 playlists through the proxy to fix CORS; leave other URLs unchanged
        proxied_src = _wrap_m3u8_url(src)
        files.append({"quality": quality, "url": proxied_src})

    # 1. iframe[src] — most common player embedding method
    for iframe in soup.select("iframe[src]"):
        src = iframe.get("src", "")
        if not src:
            continue
        if not src.startswith("http"):
            src = urljoin(base_url, src)
        # Filter out obviously non-video iframes (ads, social buttons, etc.)
        if any(x in src for x in ("facebook.com", "vk.com", "twitter.com", "disqus.com")):
            continue
        quality = _guess_quality(iframe.get("class", "") + " " + iframe.get("data-quality", ""))
        _add(src, quality)
        # === ZETFLIX v3 - M3U8 PROXY FIX ===
        # Remember iframe URL for follow-up: we'll try to extract the real m3u8 from it
        if src not in iframe_urls:
            iframe_urls.append(src)

    # 2. data-src (lazy-loaded iframes)
    for iframe in soup.select("iframe[data-src]"):
        src = iframe.get("data-src", "")
        if not src:
            continue
        if not src.startswith("http"):
            src = urljoin(base_url, src)
        _add(src)
        if src not in iframe_urls:
            iframe_urls.append(src)

    # 3. <source> tags (direct video files)
    for source in soup.select("source[src]"):
        src = source.get("src", "")
        if not src:
            continue
        quality_label = source.get("label") or source.get("size") or "unknown"
        _add(src, _guess_quality(str(quality_label)))

    # 4. Inline JS — look for player initialisation with stream URLs
    for script in soup.find_all("script"):
        text = script.string or ""
        if not text:
            continue
        # Match file/url/src/stream keys pointing at m3u8/mp4 URLs
        for m in _STREAM_URL_RE.finditer(text):
            url_candidate = m.group(1)
            if url_candidate.startswith("//"):
                url_candidate = "https:" + url_candidate
            quality = _guess_quality(url_candidate)
            _add(url_candidate, quality)

        # Match known third-party player embed URLs (Kodik, Moonwalk, Alloha, etc.)
        for m in _PLAYER_EMBED_RE.finditer(text):
            _add(m.group(1))

    return files, iframe_urls


async def get_detail(url: str) -> dict:
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, _proxy_get, url)
    soup = BeautifulSoup(html, "lxml")

    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}/"

    title_tag = soup.select_one("h1.film-title, h1.entry-title, h1.movie-title, h1")
    title = title_tag.get_text(strip=True) if title_tag else ""

    poster_tag = soup.select_one(".poster img, .film-poster img, .full-film img")
    poster = ""
    if poster_tag:
        poster = poster_tag.get("src") or poster_tag.get("data-src") or ""
        if poster and not poster.startswith("http"):
            poster = urljoin(base_url, poster)

    files, iframe_urls = _extract_player_iframes(soup, base_url)

    # === ZETFLIX v3 - M3U8 PROXY FIX ===
    # If no direct m3u8 found on the detail page, follow each iframe URL and
    # try to extract the real m3u8 from the player page (Kodik/Alloha/Playerjs).
    direct_m3u8_found = any(
        ".m3u8" in (f.get("url") or "").lower() for f in files
    )
    if not direct_m3u8_found and iframe_urls:
        logger.info(
            "[ZETFLIX DEBUG] No direct m3u8 on detail page, following %d iframe(s)",
            len(iframe_urls),
        )
        seen_m3u8: set[str] = set()
        tasks = [_follow_iframe_for_m3u8(iu) for iu in iframe_urls[:_MAX_IFRAME_FOLLOW_COUNT]]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for m3u8_list in results:
            if isinstance(m3u8_list, Exception):
                continue
            for m3u8_url in m3u8_list:
                if m3u8_url in seen_m3u8:
                    continue
                seen_m3u8.add(m3u8_url)
                quality = _guess_quality(m3u8_url)
                wrapped = _wrap_m3u8_url(m3u8_url)
                logger.info("[ZETFLIX DEBUG] Wrapped: %s", wrapped)
                files.append({"quality": quality, "url": wrapped})

    return {
        "title": title,
        "poster": poster,
        "files": files,
    }

