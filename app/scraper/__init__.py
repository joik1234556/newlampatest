"""Shared HTTP helpers for mirror scrapers."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Coroutine

import cloudscraper  # type: ignore
from app.config import MIRROR_TIMEOUT

logger = logging.getLogger(__name__)


def cloudscraper_get(url: str, **kwargs: Any) -> str:
    """Synchronous GET via cloudscraper (handles Cloudflare JS challenges)."""
    scraper = cloudscraper.create_scraper()
    scraper.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            )
        }
    )
    resp = scraper.get(url, timeout=MIRROR_TIMEOUT, **kwargs)
    resp.raise_for_status()
    return resp.text


async def try_mirrors(
    mirrors: list[str],
    task_factory: Callable[[str], Coroutine[Any, Any, list[dict]]],
) -> list[dict]:
    """
    Try each mirror in parallel, return the first non-empty result.
    Collect from ALL mirrors that respond and deduplicate by url.
    """

    async def _safe(mirror: str) -> list[dict]:
        try:
            return await task_factory(mirror)
        except Exception as exc:
            logger.warning("Mirror %s failed: %s", mirror, exc)
            return []

    results = await asyncio.gather(*[_safe(m) for m in mirrors])
    seen: set[str] = set()
    merged: list[dict] = []
    for batch in results:
        for item in batch:
            key = item.get("url", "")
            if key and key not in seen:
                seen.add(key)
                merged.append(item)
    return merged
