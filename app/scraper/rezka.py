"""Rezka (HDRezka) scraper – search and detail parsing."""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from urllib.parse import urlparse

from app.scraper import cloudscraper_get, try_mirrors
from app.config import REZKA_MIRRORS

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def _parse_search_results(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    items: list[dict] = []

    for card in soup.select(".b-content__inline_item, article.item, .search-result-item"):
        title_tag = card.select_one(".b-content__inline_item-link a, h2 a, h3 a, .title a")
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

        year_match = re.search(r"\b(19|20)\d{2}\b", card.get_text())
        year = year_match.group(0) if year_match else None

        items.append(
            {"title": title, "year": year, "poster": poster, "url": url, "source": "rezka"}
        )
    return items


async def search_mirror(mirror: str, query: str) -> list[dict]:
    search_url = f"{mirror}search/?do=search&subaction=search&q={query}"
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, cloudscraper_get, search_url)
    return _parse_search_results(html, mirror)


async def search(query: str) -> list[dict]:
    return await try_mirrors(
        REZKA_MIRRORS,
        lambda mirror: search_mirror(mirror, query),
    )


# ---------------------------------------------------------------------------
# Detail parsing
# ---------------------------------------------------------------------------

_STREAM_RE = re.compile(r"streams\s*:\s*\[([^\]]+)\]")
_CDN_VIDEO_RE = re.compile(r'"file"\s*:\s*"([^"]+)"')


def _parse_stream_block(html: str) -> list[dict[str, Any]]:
    """Try to extract Rezka CDN streams from inline JS."""
    files: list[dict] = []
    # Pattern 1: streams array
    m = _STREAM_RE.search(html)
    if m:
        raw = m.group(1)
        for entry in re.finditer(r'\{[^}]+\}', raw):
            block = entry.group(0)
            label_m = re.search(r'"label"\s*:\s*"([^"]+)"', block)
            file_m = re.search(r'"file"\s*:\s*"([^"]+)"', block)
            if file_m:
                files.append(
                    {
                        "title": label_m.group(1) if label_m else "Стрим",
                        "quality": label_m.group(1) if label_m else "unknown",
                        "url": file_m.group(1),
                        "magnet": None,
                    }
                )
    # Pattern 2: CDN video file
    for m2 in _CDN_VIDEO_RE.finditer(html):
        url = m2.group(1)
        if "cdn" in url or ".m3u8" in url or ".mp4" in url:
            quality = _guess_quality(url)
            files.append({"title": "CDN", "quality": quality, "url": url, "magnet": None})
    return files


def _guess_quality(text: str) -> str:
    for q in ("2160p", "1080p", "720p", "480p", "360p"):
        if q in text:
            return q
    return "unknown"


async def get_detail(url: str) -> dict:
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, cloudscraper_get, url)
    soup = BeautifulSoup(html, "lxml")

    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}/"

    title_tag = soup.select_one("h1.b-post__title, h1[itemprop='name'], h1")
    title = title_tag.get_text(strip=True) if title_tag else ""

    orig_tag = soup.select_one(".b-post__origtitle, [itemprop='alternativeHeadline']")
    orig_title = orig_tag.get_text(strip=True) if orig_tag else None

    poster_tag = soup.select_one(".b-sidecover img, [itemprop='image']")
    poster = ""
    if poster_tag:
        poster = poster_tag.get("src") or poster_tag.get("data-src") or ""
        if poster and not poster.startswith("http"):
            poster = urljoin(base_url, poster)

    desc_tag = soup.select_one(".b-post__description_text, [itemprop='description']")
    description = desc_tag.get_text(strip=True) if desc_tag else ""

    files = _parse_stream_block(html)

    # Fallback: iframes
    if not files:
        for iframe in soup.select("iframe[src]"):
            src = iframe["src"]
            if not src.startswith("http"):
                src = urljoin(base_url, src)
            files.append({"title": "Плеер", "quality": "unknown", "url": src, "magnet": None})

    return {
        "title": title,
        "orig_title": orig_title,
        "poster": poster,
        "description": description,
        "files": files,
    }
