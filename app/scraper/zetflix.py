"""
Zetflix scraper v4 — uses Cloudflare Workers proxy for all HTTP requests.
No ScrapingBee dependency.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse, urlencode, quote

import httpx
from bs4 import BeautifulSoup

from app.scraper import try_mirrors
from app.config import ZETFLIX_MIRRORS, CF_PROXY_URL

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cloudflare Workers proxy — handles CF JS challenges, sets correct headers
# ---------------------------------------------------------------------------
CF_PROXY = CF_PROXY_URL

_HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}


def _proxy_get(url: str) -> str:
    """GET url via Cloudflare Workers proxy. Falls back to direct httpx on error."""
    proxy_url = CF_PROXY + url
    logger.info("[Zetflix] proxy fetch: %s", url[:80])
    try:
        resp = httpx.get(proxy_url, headers=_HTTP_HEADERS, timeout=30, follow_redirects=True)
        resp.raise_for_status()
        logger.info("[Zetflix] proxy OK status=%s url=%s", resp.status_code, url[:60])
        return resp.text
    except Exception as exc:
        logger.warning("[Zetflix] proxy failed for %s: %s — trying direct", url[:60], exc)
        try:
            resp2 = httpx.get(url, headers=_HTTP_HEADERS, timeout=20, follow_redirects=True)
            resp2.raise_for_status()
            return resp2.text
        except Exception as exc2:
            logger.error("[Zetflix] direct also failed for %s: %s", url[:60], exc2)
            raise


def _wrap_url(url: str) -> str:
    """
    Wrap a stream URL through CF proxy so Lampa gets CORS-friendly absolute URL.
    Returns CF_PROXY + url for m3u8/mp4, else original url.
    """
    if not url:
        return url
    if url.startswith("//"):
        url = "https:" + url
    if not url.startswith("http"):
        return url
    # Only proxy actual media streams — not player iframe pages
    low = url.lower()
    if ".m3u8" in low or ".mp4" in low or "/hls/" in low or "/stream/" in low:
        return CF_PROXY + url
    return url


# ---------------------------------------------------------------------------
# m3u8 extraction patterns
# ---------------------------------------------------------------------------

_IFRAME_M3U8_RE = re.compile(
    r'(?:'
    r'["\']?(?:file|url|src|stream|source|hls)["\']?\s*[=:]\s*["\']'
    r'|hls\.loadSource\s*\(\s*["\']'
    r'|new\s+Hls\s*\(.*?\)\s*;?\s*\w+\.loadSource\s*\(\s*["\']'
    r')'
    r'((?:https?:)?//[^"\'<>\s]+\.m3u8[^"\'<>\s]*)',
    re.IGNORECASE | re.DOTALL,
)
_BROAD_M3U8_RE = re.compile(r"""["'](https?://[^"'<>\s]+\.m3u8[^"'<>\s]*)["']""")
_PROTO_REL_RE  = re.compile(r"""["'](//[^"'<>\s]+\.m3u8[^"'<>\s]*)["']""")
_ALLOHA_RE     = re.compile(r'"(?:hls|url|file)"\s*:\s*"(https?://[^"]+\.m3u8[^"]*)"', re.IGNORECASE)
_PLAYERJS_RE   = re.compile(r'Playerjs\s*\(\s*\{[^}]*file\s*:\s*["\']([^"\']+)["\']', re.IGNORECASE)
_ANY_M3U8_RE   = re.compile(r'[=\s,"\'](https?://[^\s"\'<>]+\.m3u8(?:[^\s"\'<>]*)?)', re.IGNORECASE)


def _extract_m3u8_urls(html: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()

    def _add(u: str) -> None:
        if not u:
            return
        if u.startswith("//"):
            u = "https:" + u
        if not u.startswith("http"):
            return
        u = u.strip("\"' \t\n")
        if u not in seen:
            seen.add(u)
            found.append(u)

    for pat in (_IFRAME_M3U8_RE, _BROAD_M3U8_RE, _PROTO_REL_RE, _ALLOHA_RE, _ANY_M3U8_RE):
        for m in pat.finditer(html):
            _add(m.group(1))

    for m in _PLAYERJS_RE.finditer(html):
        val = m.group(1)
        if ".m3u8" in val.lower() or ".mp4" in val.lower():
            _add(val)

    logger.debug("[Zetflix] _extract_m3u8_urls found=%d", len(found))
    return found


async def _follow_iframe(iframe_url: str) -> list[str]:
    """Fetch player iframe page and extract m3u8 URLs. Tries with autoplay=1 for Kodik/Alloha."""
    loop = asyncio.get_event_loop()
    candidates = [iframe_url]
    if any(x in iframe_url for x in ("kodik", "alloha", "moonwalk")):
        sep = "&" if "?" in iframe_url else "?"
        candidates.append(iframe_url + sep + "autoplay=1")

    seen_urls: set[str] = set()
    result: list[str] = []

    for url_try in candidates:
        try:
            html = await loop.run_in_executor(None, _proxy_get, url_try)
        except Exception as exc:
            logger.debug("[Zetflix] iframe fetch failed url=%s: %s", url_try[:60], exc)
            continue
        for u in _extract_m3u8_urls(html):
            if u not in seen_urls:
                seen_urls.add(u)
                result.append(u)
                logger.info("[Zetflix] m3u8 found in iframe: %s", u[:80])
        if result:
            break

    return result


def _guess_quality(text: str) -> str:
    t = text.lower()
    for q in ("2160p", "4k", "1080p", "720p", "480p", "360p"):
        if q in t:
            return "2160p" if q == "4k" else q
    return "1080p"


_MAX_IFRAMES = 4

# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def _parse_search_results(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    items: list[dict] = []
    selectors = [".movie-item", ".film-item", ".card-item", "article.item", ".item", ".shortstory", ".short-film"]
    cards = []
    for sel in selectors:
        found = soup.select(sel)
        if found:
            cards = found
            break

    if not cards:
        for a in soup.select("a[href]"):
            href = a.get("href", "")
            if re.search(r"/(film|serial|movies|series)/", href):
                title_text = a.get_text(strip=True)
                if not title_text:
                    continue
                url = href if href.startswith("http") else urljoin(base_url, href)
                year_m = re.search(r"\b(19|20)\d{2}\b", a.get_text())
                items.append({"title": title_text, "year": year_m.group(0) if year_m else None, "poster": "", "url": url, "source": "zetflix"})
        return items

    for card in cards:
        title_tag = card.select_one("h2 a, h3 a, .title a, .film-name a, a.film-link") or card.select_one("a[href]")
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
        if title:
            items.append({"title": title, "year": year_m.group(0) if year_m else None, "poster": poster, "url": url, "source": "zetflix"})

    logger.info("[Zetflix] found %d search results from %s", len(items), base_url)
    return items


async def _search_mirror(mirror: str, query: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    qs = urlencode({"do": "search", "subaction": "search", "story": query})
    for search_url in [f"{mirror}index.php?{qs}", f"{mirror}?s={query}"]:
        try:
            html = await loop.run_in_executor(None, _proxy_get, search_url)
            results = _parse_search_results(html, mirror)
            if results:
                return results
        except Exception as exc:
            logger.debug("[Zetflix] search failed mirror=%s url=%s: %s", mirror, search_url, exc)
    return []


async def search(query: str) -> list[dict]:
    return await try_mirrors(ZETFLIX_MIRRORS, lambda mirror: _search_mirror(mirror, query))


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------

_STREAM_URL_RE = re.compile(r'(?:file|url|src|stream)["\s]*:\s*["\']([^"\']+\.(?:m3u8|mp4)[^"\']*)["\']')
_KNOWN_PLAYERS = ("kodik", "moonwalk", "alloha", "video.sibnet", "videoframe", "plyr", "playerjs")
_PLAYER_EMBED_RE = re.compile(r'["\']?(https?://(?:' + "|".join(re.escape(d) for d in _KNOWN_PLAYERS) + r')[^"\'<>\s]+)["\']?')


def _extract_player_iframes(soup: BeautifulSoup, base_url: str) -> tuple[list[dict], list[str]]:
    files: list[dict] = []
    seen: set[str] = set()
    iframe_urls: list[str] = []

    def _add(src: str, quality: str = "1080p") -> None:
        if not src or src in seen:
            return
        seen.add(src)
        wrapped = _wrap_url(src)
        files.append({"quality": quality, "url": wrapped})

    for iframe in soup.select("iframe[src], iframe[data-src]"):
        src = iframe.get("src") or iframe.get("data-src", "")
        if not src:
            continue
        if not src.startswith("http"):
            src = urljoin(base_url, src)
        if any(x in src for x in ("facebook.com", "vk.com", "twitter.com", "disqus.com")):
            continue
        quality = _guess_quality(str(iframe.get("class", "")) + " " + str(iframe.get("data-quality", "")))
        _add(src, quality)
        if src not in iframe_urls:
            iframe_urls.append(src)

    for source in soup.select("source[src]"):
        src = source.get("src", "")
        if src:
            _add(src, _guess_quality(str(source.get("label") or source.get("size") or "")))

    for script in soup.find_all("script"):
        text = script.string or ""
        if not text:
            continue
        for m in _STREAM_URL_RE.finditer(text):
            u = m.group(1)
            if u.startswith("//"):
                u = "https:" + u
            _add(u, _guess_quality(u))
        for m in _PLAYER_EMBED_RE.finditer(text):
            embed = m.group(1)
            if embed not in iframe_urls:
                iframe_urls.append(embed)

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

    # Follow iframes to extract real m3u8 if not found directly
    direct_m3u8 = any(".m3u8" in (f.get("url") or "").lower() for f in files)
    if not direct_m3u8 and iframe_urls:
        logger.info("[Zetflix] no direct m3u8, following %d iframe(s)", len(iframe_urls))
        seen_m3u8: set[str] = set()
        tasks = [_follow_iframe(iu) for iu in iframe_urls[:_MAX_IFRAMES]]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for m3u8_list in results:
            if isinstance(m3u8_list, Exception):
                continue
            for m3u8_url in m3u8_list:
                if m3u8_url not in seen_m3u8:
                    seen_m3u8.add(m3u8_url)
                    files.append({"quality": _guess_quality(m3u8_url), "url": _wrap_url(m3u8_url)})

    return {"title": title, "poster": poster, "files": files}
