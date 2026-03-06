"""
Online provider base — wraps HTML scrapers (Rezka, Kinogo, VideoCDN, Kodik) and
converts scraper results into Variant objects with ``url`` set for instant play.
"""
from __future__ import annotations

import hashlib
import logging
from types import ModuleType
from typing import Optional

from app.models import Variant
from app.providers.base import BaseProvider

logger = logging.getLogger(__name__)

_ONLINE_SOURCES = frozenset({"rezka", "kinogo", "videocdn", "kodik"})


def _guess_quality(text: str) -> str:
    for q in ("2160p", "1080p", "720p", "480p", "360p"):
        if q in text.lower():
            return q
    return "1080p"


def _year_match(result_year: Optional[str], wanted_year: Optional[int]) -> bool:
    """Allow ±1 year tolerance."""
    if not result_year or not wanted_year:
        return True
    try:
        return abs(int(result_year) - wanted_year) <= 1
    except ValueError:
        return True


def _make_id(source: str, query_title: str, player_url: str) -> str:
    raw = f"{source}:{query_title}:{player_url}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


class OnlineProviderBase(BaseProvider):
    """
    Base class for online (non-torrent) providers.
    Subclasses set ``name``, ``_source_label``, and ``_scraper_module``
    (a reference to the scraper module; functions are looked up via the module
    at call time so that unit-test patching of module-level names works correctly).
    """

    name: str = "online"
    _source_label: str = ""
    _scraper_module: Optional[ModuleType] = None  # set in each subclass

    async def search_variants(
        self,
        title: str,
        year: Optional[int] = None,
        tmdb_id: Optional[str] = None,
        original_title: Optional[str] = None,
        season: Optional[int] = None,
        imdb_id: Optional[str] = None,
        episode: Optional[int] = None,
    ) -> list[Variant]:
        scraper = self._scraper_module
        if scraper is None:
            return []

        # Try original title first (usually in English — better search results),
        # then fall back to localised title.
        query = original_title or title
        try:
            results = await scraper.search(query)
            if not results and original_title and original_title != title:
                results = await scraper.search(title)
        except Exception as exc:
            logger.warning("[%s] search error query=%s: %s", self.name, query, exc)
            return []

        if not results:
            logger.info("[%s] no search results for %s", self.name, query)
            return []

        # Pick the best-matching result (year filter, take first match)
        chosen = None
        for r in results:
            if _year_match(r.get("year"), year):
                chosen = r
                break
        if not chosen:
            chosen = results[0]

        film_url = chosen.get("url", "")
        if not film_url:
            return []

        try:
            detail = await scraper.get_detail(film_url)
        except Exception as exc:
            logger.warning("[%s] get_detail error url=%s: %s", self.name, film_url, exc)
            return []

        files = detail.get("files") or []
        if not files:
            logger.info("[%s] no files for %s", self.name, film_url)
            return []

        # Build a Variant per player/stream URL found on the detail page
        variants: list[Variant] = []
        for f in files:
            player_url = f.get("url", "")
            if not player_url:
                continue
            raw_quality = f.get("quality", "unknown")
            quality = (
                raw_quality
                if raw_quality in ("1080p", "720p", "480p", "360p", "2160p")
                else _guess_quality(raw_quality)
            )
            vid = _make_id(self.name, title, player_url)
            label = f"{self._source_label or self.name.capitalize()} • RU • {quality.upper()} (Online)"
            variants.append(Variant(
                id=vid,
                label=label,
                language="ru",   # These providers primarily deliver Russian/Ukrainian content
                voice="",
                quality=quality,
                size_mb=0,
                seeders=0,
                codec="",
                magnet="",
                is_cached=True,   # online = instant play
                url=player_url,
                source=self.name,
            ))
        logger.info("[%s] found %d online variants for title=%s", self.name, len(variants), title)
        return variants
