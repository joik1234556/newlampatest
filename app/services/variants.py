"""
Variants service — aggregates providers, deduplicates and sorts results.
Cache keys use SHA-1 of normalised title+year+tmdb_id+imdb_id+season.
All cache I/O goes through the async CacheBackend interface.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from typing import Optional

from app.cache import variants_cache
from app.config import ENABLE_DEMO_PROVIDER, TORBOX_SEARCH_MIN_RESULTS, VARIANTS_CACHE_TTL
from app import torbox as torbox_client
from app.models import Variant, VariantsResponse
from app.providers.demo_provider import DemoProvider
from app.providers.jackett import (
    JackettProvider, MAX_VARIANTS,
    detect_language, guess_quality, guess_codec, guess_voice,
)
from app.providers.public_jackett import PublicJackettProvider
from app.providers.torrentio import TorrentioProvider

logger = logging.getLogger(__name__)

# Quality ordering for secondary sort key (higher value = higher priority)
_QUALITY_ORDER = {"360p": 0, "480p": 1, "720p": 2, "1080p": 3, "2160p": 4, "4k": 4}

# How many variants to return to the user (top N after dedup+sort).
# Raised from 4 to 10 so that diverse dubbing/language options are visible.
_MAX_RESULTS = 10


def _quality_rank(q: str) -> int:
    return _QUALITY_ORDER.get(q.lower(), 2)


async def _torbox_search_variants(query: str, year: Optional[int]) -> list[Variant]:
    """
    Query TorBox's native search API for cached torrents.

    Converts raw TorBox search results to ``Variant`` objects (all pre-marked
    ``is_cached=True``).  Returns ``[]`` on any error so the caller can
    continue with Jackett/Torrentio normally.
    """
    search_q = f"{query} {year}" if year else query
    try:
        results = await torbox_client.search_torbox(search_q, cached_only=True, limit=20)
    except Exception as exc:
        logger.warning("[Variants] TorBox search error: %s", exc)
        return []

    variants: list[Variant] = []
    for r in results:
        name = r.get("name") or r.get("title") or ""
        if not name:
            continue
        h = r.get("hash") or r.get("info_hash") or ""
        if not h:
            continue
        magnet = f"magnet:?xt=urn:btih:{h}&dn={name}"
        seeders  = int(r.get("seeders") or 0)
        size_bytes = int(r.get("size") or 0)
        size_mb  = size_bytes // (1024 * 1024) if size_bytes else 0
        quality  = guess_quality(name)
        codec    = guess_codec(name)
        voice    = guess_voice(name)
        language = detect_language(name)
        vid = hashlib.sha1(f"torbox_search:{h}:{quality}".encode()).hexdigest()[:12]
        label = f"{voice} • {quality.upper()}" if voice else name[:55].rstrip(" .-")
        variants.append(Variant(
            id=vid, label=label, language=language, voice=voice,
            quality=quality, size_mb=size_mb, seeders=seeders,
            codec=codec, magnet=magnet,
            is_cached=True,
        ))
    return variants


def _cache_key(
    title: str,
    year: Optional[int],
    tmdb_id: Optional[str],
    season: Optional[int] = None,
    imdb_id: Optional[str] = None,
    episode: Optional[int] = None,
) -> str:
    raw = f"{title.lower().strip()}:{year or ''}:{tmdb_id or ''}:{imdb_id or ''}:{season or ''}:{episode or ''}"
    return hashlib.sha1(raw.encode()).hexdigest()


async def get_variants(
    title: str,
    year: Optional[int] = None,
    tmdb_id: Optional[str] = None,
    original_title: Optional[str] = None,
    season: Optional[int] = None,
    imdb_id: Optional[str] = None,
    episode: Optional[int] = None,
) -> VariantsResponse:
    """
    Return sorted, deduplicated variants for a given title.
    Results are cached for VARIANTS_CACHE_TTL seconds.
    When ``imdb_id`` is supplied providers use exact IMDB-based search
    instead of title text matching, eliminating wrong-film results.
    Pass ``season`` + ``episode`` for TV-series episode-specific searches.
    """
    key = _cache_key(title, year, tmdb_id, season, imdb_id, episode)

    cached = await variants_cache.aget(key)
    if cached is not None:
        logger.info("[Easy-Mod][Variants] cache hit title=%s season=%s episode=%s", title, season, episode)
        if isinstance(cached, dict):
            return VariantsResponse(**cached)
        return cached  # already a VariantsResponse (in-memory path)

    logger.info(
        "[Easy-Mod][Variants] fetching title=%s year=%s tmdb_id=%s imdb_id=%s original_title=%s season=%s episode=%s",
        title, year, tmdb_id, imdb_id, original_title, season, episode,
    )

    # ── Step 0: TorBox hybrid search (fast path for popular / cached content) ──
    # Run TorBox native search in parallel with the provider pipeline.  If
    # TorBox already has the content cached we get instant variants without
    # waiting for Jackett's slower Torznab scraping.
    search_title = original_title or title
    torbox_task = _torbox_search_variants(search_title, year)

    # Build provider pipeline:
    #   TorrentioProvider and JackettProvider run IN PARALLEL for speed.
    #   PublicJackettProvider is a fallback (only when private Jackett finds nothing).
    torrentio = TorrentioProvider()
    jackett   = JackettProvider()

    provider_tasks = [
        torrentio.search_variants(title, year, tmdb_id, original_title=original_title, season=season, imdb_id=imdb_id, episode=episode),
        jackett.search_variants(title, year, tmdb_id, original_title=original_title, season=season, imdb_id=imdb_id, episode=episode),
    ]

    # Gather TorBox search + provider results concurrently
    torbox_variants, *raw_results = await asyncio.gather(
        torbox_task, *provider_tasks, return_exceptions=True
    )

    all_variants: list[Variant] = []

    # Integrate TorBox search results
    torbox_fast_path = False
    if isinstance(torbox_variants, Exception):
        logger.warning("[Easy-Mod][Variants] torbox_search error: %s", torbox_variants)
        torbox_variants = []
    else:
        all_variants.extend(torbox_variants)
        logger.info(
            "[Easy-Mod][Variants] torbox_search returned %d cached variants for title=%s",
            len(torbox_variants), search_title,
        )
        if len(torbox_variants) >= TORBOX_SEARCH_MIN_RESULTS:
            torbox_fast_path = True
            logger.info(
                "[Easy-Mod][Variants] TorBox fast-path: %d cached variants >= min=%d for title=%s",
                len(torbox_variants), TORBOX_SEARCH_MIN_RESULTS, search_title,
            )

    jackett_found = 0
    provider_names = [torrentio.name, jackett.name]
    for provider_name, result in zip(provider_names, raw_results):
        if isinstance(result, Exception):
            logger.error("[Easy-Mod][Variants] provider=%s error: %s", provider_name, result)
        else:
            all_variants.extend(result)
            if provider_name == "jackett":
                jackett_found = len(result)
            logger.info(
                "[Easy-Mod][Variants] provider=%s returned %d variants",
                provider_name, len(result) if not isinstance(result, Exception) else 0,
            )

    # If private Jackett returned nothing, try public Jackett servers as fallback
    if jackett_found == 0:
        try:
            pub_results = await PublicJackettProvider().search_variants(
                title, year, tmdb_id, original_title=original_title, season=season, imdb_id=imdb_id, episode=episode,
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
                demo = await DemoProvider().search_variants(
                    title, year, tmdb_id, original_title=original_title, season=season, imdb_id=imdb_id, episode=episode,
                )
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

    # ── Batch TorBox cache check ────────────────────────────────────────────
    # Extract infohash from each magnet, then check all at once.
    # Cached variants are sorted to the top and marked with is_cached=True.
    _IH_RE = re.compile(r"xt=urn:btih:([0-9a-fA-F]{40}|[A-Z2-7]{32})", re.IGNORECASE)
    ih_map: dict[str, str] = {}   # infohash_lower → variant.id
    for v in deduped:
        m = _IH_RE.search(v.magnet or "")
        if m:
            ih_map[m.group(1).lower()] = v.id

    cached_set: set[str] = set()
    if ih_map:
        try:
            cache_result = await torbox_client.batch_check_cached(list(ih_map.keys()))
            cached_set = {ih for ih, ok in cache_result.items() if ok}
            logger.info(
                "[Easy-Mod][Variants] TorBox cache check: %d/%d cached for title=%s",
                len(cached_set), len(ih_map), title,
            )
        except Exception as exc:
            logger.warning("[Easy-Mod][Variants] batch_check_cached failed: %s", exc)

    # Mark cached variants; rebuild list mapping infohash back to variant id
    cached_variant_ids: set[str] = {ih_map[ih] for ih in cached_set if ih in ih_map}
    for v in deduped:
        if v.id in cached_variant_ids:
            v.is_cached = True

    # Sort: cached first, then seeders desc, quality desc, size_mb desc
    def _sort_key(v: Variant):
        return (
            1 if v.is_cached else 0,
            v.seeders if v.seeders > 0 else -1,
            _quality_rank(v.quality),
            v.size_mb,
        )

    deduped.sort(key=_sort_key, reverse=True)

    # Return top _MAX_RESULTS variants by seeders.
    # MAX_VARIANTS (from jackett.py) is used as the provider-level fetch cap.
    final = deduped[:_MAX_RESULTS]

    source = "torbox_direct" if torbox_fast_path else None
    response = VariantsResponse(title=title, year=year, variants=final, source=source)
    # Store as dict so Redis serialisation is straightforward
    await variants_cache.aset(key, response.model_dump(), ttl=VARIANTS_CACHE_TTL)
    logger.info(
        "[Easy-Mod][Variants] returning %d variants for title=%s season=%s source=%s",
        len(final), title, season, source,
    )
    return response
