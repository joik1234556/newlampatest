"""
# === ZETFLIX SOURCE ===
Zetflix scraper — search and detail parsing.

Zetflix embeds its video via third-party players (Kodik, Alloha, Moonwalk, etc.).
The scraper:
  1. Searches for a title on each mirror in parallel.
  2. On the detail page extracts the embedded iframe src (player URL).
  3. Returns those player URLs as "files" so the OnlineProviderBase can build
     Variant objects with instant-play links.

Player iframe URLs are suitable for direct Lampa playback (most are m3u8/mp4 or
accepted by Lampa's built-in iframe player).
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse, urlencode, quote as _quote

from bs4 import BeautifulSoup

from app.scraper import cloudscraper_get, try_mirrors
from app.config import ZETFLIX_MIRRORS, PROXY_M3U8_ENABLED

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _guess_quality(text: str) -> str:
    text_lower = text.lower()
    for q in ("2160p", "4k", "1080p", "720p", "480p", "360p"):
        if q in text_lower:
            return "2160p" if q == "4k" else q
    return "1080p"


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

    return items


async def _search_mirror(mirror: str, query: str) -> list[dict]:
    # Common Zetflix search URL patterns
    qs = urlencode({"do": "search", "subaction": "search", "story": query})
    search_url = f"{mirror}index.php?{qs}"
    loop = asyncio.get_event_loop()
    try:
        html = await loop.run_in_executor(None, cloudscraper_get, search_url)
        results = _parse_search_results(html, mirror)
        if results:
            return results
    except Exception as exc:
        logger.debug("[Zetflix] search via index.php failed mirror=%s: %s", mirror, exc)

    # Fallback: try ?s= query param (WordPress-style)
    try:
        search_url2 = f"{mirror}?s={query}"
        html2 = await loop.run_in_executor(None, cloudscraper_get, search_url2)
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

def _extract_player_iframes(soup: BeautifulSoup, base_url: str) -> list[dict[str, Any]]:
    """
    Extract embedded player URLs from the detail page.
    Returns list of dicts with keys: quality, url.
    """
    files: list[dict] = []
    seen: set[str] = set()

    def _add(src: str, quality: str = "1080p") -> None:
        if not src or src in seen:
            return
        seen.add(src)
        files.append({"quality": quality, "url": src})

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

    # 2. data-src (lazy-loaded iframes)
    for iframe in soup.select("iframe[data-src]"):
        src = iframe.get("data-src", "")
        if not src:
            continue
        if not src.startswith("http"):
            src = urljoin(base_url, src)
        _add(src)

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

    return files


async def get_detail(url: str) -> dict:
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, cloudscraper_get, url)
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

    files = _extract_player_iframes(soup, base_url)

    # === ZETFLIX PROXY ===
    # Wrap m3u8 stream URLs so Lampa receives them via /proxy/m3u8 which
    # adds CORS headers and rewrites relative segment paths to absolute CDN URLs.
    # The .ts media segments themselves are served directly from CDN (no server traffic).
    if PROXY_M3U8_ENABLED:
        wrapped: list[dict] = []
        for f in files:
            file_url = f.get("url", "")
            if file_url and ".m3u8" in file_url and file_url.startswith("http"):
                proxied = f"/proxy/m3u8?url={_quote(file_url, safe='')}"
                logger.debug("[ZETFLIX] Wrapped m3u8 url: %s", proxied)
                wrapped.append({"quality": f.get("quality", "1080p"), "url": proxied})
            else:
                wrapped.append(f)
        files = wrapped

    return {
        "title": title,
        "poster": poster,
        "files": files,
    }
