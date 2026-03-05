"""Kodik scraper – search and iframe/direct link extraction."""
from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import urljoin, urlencode

from bs4 import BeautifulSoup

from app.scraper import cloudscraper_get, try_mirrors
from app.config import KODIK_MIRRORS

logger = logging.getLogger(__name__)


def _parse_search_results(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    items: list[dict] = []
    for card in soup.select(".search-result-item, .shortstory, article.item"):
        title_tag = card.select_one("h2 a, h3 a, .title a, a.name")
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
        items.append({"title": title, "year": year, "poster": poster, "url": url, "source": "kodik"})
    return items


async def search_mirror(mirror: str, query: str) -> list[dict]:
    qs = urlencode({"q": query})
    search_url = f"{mirror}search/?{qs}"
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, cloudscraper_get, search_url)
    return _parse_search_results(html, mirror)


async def search(query: str) -> list[dict]:
    return await try_mirrors(KODIK_MIRRORS, lambda mirror: search_mirror(mirror, query))


async def get_detail(url: str) -> dict:
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, cloudscraper_get, url)
    soup = BeautifulSoup(html, "lxml")

    from urllib.parse import urlparse
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}/"

    title_tag = soup.select_one("h1.film-title, h1.entry-title, h1")
    title = title_tag.get_text(strip=True) if title_tag else ""

    orig_tag = soup.select_one(".orig-title, .original-title")
    orig_title = orig_tag.get_text(strip=True) if orig_tag else None

    poster_tag = soup.select_one(".poster img, .film-poster img")
    poster = ""
    if poster_tag:
        poster = poster_tag.get("src") or poster_tag.get("data-src") or ""
        if poster and not poster.startswith("http"):
            poster = urljoin(base_url, poster)

    desc_tag = soup.select_one(".description, .full-text")
    description = desc_tag.get_text(strip=True) if desc_tag else ""

    files: list[dict] = []
    for iframe in soup.select("iframe[src], .kodik-player[src]"):
        src = iframe["src"]
        if not src.startswith("http"):
            src = urljoin(base_url, src)
        files.append({"title": "Kodik Player", "quality": "unknown", "url": src, "magnet": None})
    for source in soup.select("source[src]"):
        src = source["src"]
        quality = source.get("label") or source.get("size") or "unknown"
        files.append({"title": "Видео", "quality": str(quality), "url": src, "magnet": None})

    return {
        "title": title,
        "orig_title": orig_title,
        "poster": poster,
        "description": description,
        "files": files,
    }
