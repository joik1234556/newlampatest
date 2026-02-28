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
from app.config import ENABLE_DEMO_PROVIDER, VARIANTS_CACHE_TTL
from app.models import Variant, VariantsResponse
from app.providers.demo_provider import DemoProvider
from app.providers.jackett import JackettProvider, MAX_VARIANTS
from app.providers.public_jackett import PublicJackettProvider
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
    original_title: Optional[str] = None,
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
        "[Easy-Mod][Variants] fetching title=%s year=%s tmdb_id=%s original_title=%s",
        title, year, tmdb_id, original_title,
    )

    # Build provider pipeline:
    #   1. TorrentioProvider – real results when tmdb_id is available (no config needed)
    #   2. JackettProvider   – real results when JACKETT_URL + JACKETT_API_KEY are set
    #   3. PublicJackettProvider – fallback using public jac.red / jacred.xyz servers
    providers = [TorrentioProvider(), JackettProvider()]
    all_variants: list[Variant] = []
    jackett_found = 0
    for provider in providers:
        try:
            results = await provider.search_variants(title, year, tmdb_id, original_title=original_title)
            all_variants.extend(results)
            if provider.name == "jackett":
                jackett_found = len(results)
            logger.info(
                "[Easy-Mod][Variants] provider=%s returned %d variants",
                provider.name, len(results),
            )
        except Exception as exc:
            logger.error("[Easy-Mod][Variants] provider=%s error: %s", provider.name, exc)

    # If private Jackett returned nothing, try public Jackett servers as fallback
    if jackett_found == 0:
        try:
            pub_results = await PublicJackettProvider().search_variants(
                title, year, tmdb_id, original_title=original_title
            )
            all_variants.extend(pub_results)
            logger.info(
                "[Easy-Mod][Variants] provider=public_jackett returned %d variants",
                len(pub_results),
            )
        except Exception as exc:
            logger.error("[Easy-Mod][Variants] provider=public_jackett error: %s", exc)

    if not all_variants:
        logger.info("[Easy-Mod][Variants] no results from any provider for title=%s", title)
        # Last resort: demo variants — only when explicitly enabled (dev/testing)
        if ENABLE_DEMO_PROVIDER:
            try:
                demo = await DemoProvider().search_variants(title, year, tmdb_id, original_title=original_title)
                all_variants.extend(demo)
                logger.info("[Easy-Mod][Variants] provider=demo (fallback) returned %d variants", len(demo))
            except Exception as exc:
                logger.error("[Easy-Mod][Variants] provider=demo error: %s", exc)
        else:
            logger.info("[Easy-Mod][Variants] DemoProvider disabled (ENABLE_DEMO_PROVIDER=0)")

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

    # Return all variants (up to MAX_VARIANTS), sorted by quality+seeders.
    # The filter bar in the frontend lets the user narrow down by quality/voice.
    final = deduped[:MAX_VARIANTS]

    response = VariantsResponse(title=title, year=year, variants=final)
    # Store as dict so Redis serialisation is straightforward
    await variants_cache.aset(key, response.model_dump(), ttl=VARIANTS_CACHE_TTL)
    logger.info(
        "[Easy-Mod][Variants] returning %d variants for title=%s",
        len(final), title,
    )
    return response

