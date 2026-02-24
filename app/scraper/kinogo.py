"""Kinogo scraper – search and detail parsing."""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlencode

from bs4 import BeautifulSoup
from urllib.parse import urlparse

from app.scraper import cloudscraper_get, try_mirrors
from app.config import KINOGO_MIRRORS

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def _parse_search_results(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    items: list[dict] = []

    # Kinogo typically lists results in .shortstory / .short-film / article tags
    for card in soup.select(".shortstory, .short-film, article.card"):
        title_tag = card.select_one("h2 a, h3 a, .title a")
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

        # Extract year from text like (2023) or from a dedicated element
        year_match = re.search(r"\b(19|20)\d{2}\b", card.get_text())
        year = year_match.group(0) if year_match else None

        items.append(
            {"title": title, "year": year, "poster": poster, "url": url, "source": "kinogo"}
        )
    return items


async def search_mirror(mirror: str, query: str) -> list[dict]:
    qs = urlencode({"do": "search", "subaction": "search", "story": query})
    search_url = f"{mirror}index.php?{qs}"
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, cloudscraper_get, search_url)
    return _parse_search_results(html, mirror)


async def search(query: str) -> list[dict]:
    return await try_mirrors(
        KINOGO_MIRRORS,
        lambda mirror: search_mirror(mirror, query),
    )


# ---------------------------------------------------------------------------
# Detail / player parsing
# ---------------------------------------------------------------------------

def _extract_magnets(html: str) -> list[dict[str, Any]]:
    """Find magnet links embedded anywhere in the page."""
    magnets = re.findall(r'(magnet:\?[^"\'<>\s]+)', html)
    files: list[dict] = []
    for i, mag in enumerate(magnets):
        files.append(
            {
                "title": f"Торрент {i + 1}",
                "quality": _guess_quality(mag),
                "url": None,
                "magnet": mag,
            }
        )
    return files


def _extract_player_links(soup: BeautifulSoup, base_url: str) -> list[dict[str, Any]]:
    """Extract iframe / direct video links."""
    files: list[dict] = []
    for iframe in soup.select("iframe[src]"):
        src = iframe["src"]
        if not src.startswith("http"):
            src = urljoin(base_url, src)
        files.append({"title": "Плеер", "quality": "unknown", "url": src, "magnet": None})
    for source in soup.select("source[src]"):
        src = source["src"]
        quality = source.get("label") or source.get("size") or "unknown"
        files.append({"title": "Видео", "quality": str(quality), "url": src, "magnet": None})
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

    title_tag = soup.select_one("h1.entry-title, h1.film-title, h1")
    title = title_tag.get_text(strip=True) if title_tag else ""

    poster_tag = soup.select_one(".poster img, .film-poster img, .full-film img")
    poster = ""
    if poster_tag:
        poster = poster_tag.get("src") or poster_tag.get("data-src") or ""
        if poster and not poster.startswith("http"):
            poster = urljoin(base_url, poster)

    desc_tag = soup.select_one(".full-text, .film-description, .description")
    description = desc_tag.get_text(strip=True) if desc_tag else ""

    orig_tag = soup.select_one(".orig-title, .original-title")
    orig_title = orig_tag.get_text(strip=True) if orig_tag else None

    files = _extract_magnets(html) + _extract_player_links(soup, base_url)

    return {
        "title": title,
        "orig_title": orig_title,
        "poster": poster,
        "description": description,
        "files": files,
    }
