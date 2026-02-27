"""
Variants service — aggregates providers, deduplicates and sorts results.
Cache keys use SHA-1 of normalised title+year+tmdb_id.
All cache I/O goes through the async CacheBackend interface.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Optional

from app.cache import variants_cache
from app.config import VARIANTS_CACHE_TTL
from app.models import Variant, VariantsResponse
from app.providers.jackett import JackettProvider
from app.providers.torrentio import TorrentioProvider

logger = logging.getLogger(__name__)

# Quality ordering for sorting (higher value = higher priority)
_QUALITY_ORDER = {"360p": 0, "480p": 1, "720p": 2, "1080p": 3, "2160p": 4, "4k": 4}


def _quality_rank(q: str) -> int:
    return _QUALITY_ORDER.get(q.lower(), 2)


def _cache_key(title: str, year: Optional[int], tmdb_id: Optional[str]) -> str:
    raw = f"{title.lower().strip()}:{year or ''}:{tmdb_id or ''}"
    return hashlib.sha1(raw.encode()).hexdigest()


async def get_variants(
    title: str,
    year: Optional[int] = None,
    tmdb_id: Optional[str] = None,
) -> VariantsResponse:
    """
    Return sorted, deduplicated variants for a given title.
    Results are cached for VARIANTS_CACHE_TTL seconds.
    """
    key = _cache_key(title, year, tmdb_id)

    cached = await variants_cache.aget(key)
    if cached is not None:
        logger.info("[Easy-Mod][Variants] cache hit title=%s", title)
        if isinstance(cached, dict):
            return VariantsResponse(**cached)
        return cached  # already a VariantsResponse (in-memory path)

    logger.info(
        "[Easy-Mod][Variants] fetching title=%s year=%s tmdb_id=%s",
        title, year, tmdb_id,
    )

    # Build provider pipeline:
    #   1. TorrentioProvider – real results when tmdb_id is available (no config needed)
    #   2. JackettProvider   – real results when JACKETT_URL + JACKETT_API_KEY are set
    providers = [TorrentioProvider(), JackettProvider()]
    all_variants: list[Variant] = []
    for provider in providers:
        try:
            results = await provider.search_variants(title, year, tmdb_id)
            all_variants.extend(results)
            logger.info(
                "[Easy-Mod][Variants] provider=%s returned %d variants",
                provider.name, len(results),
            )
        except Exception as exc:
            logger.error("[Easy-Mod][Variants] provider=%s error: %s", provider.name, exc)

    if not all_variants:
        logger.info("[Easy-Mod][Variants] no results from any provider for title=%s", title)

    # Deduplicate by variant.id (stable SHA-1 hash from provider)
    seen: set[str] = set()
    deduped: list[Variant] = []
    for v in all_variants:
        if v.id not in seen:
            seen.add(v.id)
            deduped.append(v)

    # Sort: quality desc → seeders desc → size_mb asc
    # Zero-seeder entries go to the end
    def _sort_key(v: Variant):
        return (
            _quality_rank(v.quality),
            v.seeders if v.seeders > 0 else -1,
            -v.size_mb,
        )

    deduped.sort(key=_sort_key, reverse=True)

    response = VariantsResponse(title=title, year=year, variants=deduped)
    # Store as dict so Redis serialisation is straightforward
    await variants_cache.aset(key, response.model_dump(), ttl=VARIANTS_CACHE_TTL)
    logger.info(
        "[Easy-Mod][Variants] returning %d variants for title=%s",
        len(deduped), title,
    )
    return response

