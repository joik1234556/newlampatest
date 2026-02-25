"""
Variants service — aggregates providers, deduplicates and sorts results.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Optional

from app.cache import variants_cache
from app.models import Variant, VariantsResponse
from app.providers.demo_provider import DemoProvider

logger = logging.getLogger(__name__)

# Quality ordering for sorting (higher index = higher priority)
_QUALITY_ORDER = {"360p": 0, "480p": 1, "720p": 2, "1080p": 3, "2160p": 4, "4k": 4}


def _quality_rank(q: str) -> int:
    return _QUALITY_ORDER.get(q.lower(), 2)


def _cache_key(title: str, year: Optional[int], tmdb_id: Optional[str]) -> str:
    raw = f"{title.lower().strip()}:{year}:{tmdb_id}"
    return hashlib.md5(raw.encode()).hexdigest()


async def get_variants(
    title: str,
    year: Optional[int] = None,
    tmdb_id: Optional[str] = None,
) -> VariantsResponse:
    """
    Return sorted, deduplicated variants for a given title.
    Results are cached for 30 minutes.
    """
    key = _cache_key(title, year, tmdb_id)
    cached = variants_cache.get(key)
    if cached is not None:
        logger.info("[Easy-Mod][Variants] cache hit title=%s", title)
        return cached

    logger.info("[Easy-Mod][Variants] fetching title=%s year=%s tmdb_id=%s", title, year, tmdb_id)

    # Gather from all active providers
    providers = [DemoProvider()]
    all_variants: list[Variant] = []
    for provider in providers:
        try:
            results = await provider.search_variants(title, year, tmdb_id)
            all_variants.extend(results)
            logger.info("[Easy-Mod][Variants] provider=%s returned %d variants", provider.name, len(results))
        except Exception as exc:
            logger.error("[Easy-Mod][Variants] provider=%s error: %s", provider.name, exc)

    # Deduplicate by variant id
    seen: set[str] = set()
    deduped: list[Variant] = []
    for v in all_variants:
        if v.id not in seen:
            seen.add(v.id)
            deduped.append(v)

    # Sort: quality desc, then seeders desc
    deduped.sort(key=lambda v: (_quality_rank(v.quality), v.seeders), reverse=True)

    response = VariantsResponse(title=title, year=year, variants=deduped)
    variants_cache.set(key, response, ttl=1800)
    logger.info("[Easy-Mod][Variants] returning %d variants for title=%s", len(deduped), title)
    return response
