"""
Torrentio provider — searches torrents via the public Torrentio API.

Uses IMDB ID (preferred, most accurate) or TMDB ID to fetch torrent streams.

API format:
  https://torrentio.strem.fun/stream/movie/{id}.json    (movie)
  https://torrentio.strem.fun/stream/series/{id}:1:1.json  (series ep 1x1)
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Optional

import httpx

from app.models import Variant
from app.providers.base import BaseProvider
from app.providers.jackett import _guess_voice

logger = logging.getLogger(__name__)

TORRENTIO_BASE = "https://torrentio.strem.fun"
_CINEMETA_BASE = "https://v3-cinemeta.strem.io"

_QUALITY_RE = re.compile(r"(2160p|4k|uhd|1080p|720p|480p|360p)", re.IGNORECASE)
_SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(GB|MB)", re.IGNORECASE)
_SEEDERS_RE = re.compile(r"👤\s*(\d+)")

# Shared async client — reuses TCP/TLS connections across requests
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    """Return a module-level shared httpx client, creating it on first call."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=15,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _http_client


def _parse_quality(text: str) -> str:
    m = _QUALITY_RE.search(text)
    if not m:
        return "1080p"
    q = m.group(1).lower()
    if q in ("4k", "uhd"):
        return "2160p"
    return q


def _parse_size_mb(text: str) -> int:
    m = _SIZE_RE.search(text)
    if not m:
        return 0
    val = float(m.group(1))
    unit = m.group(2).upper()
    return int(val * 1024) if unit == "GB" else int(val)


def _parse_seeders(text: str) -> int:
    m = _SEEDERS_RE.search(text)
    return int(m.group(1)) if m else 0


def _guess_codec(text: str) -> str:
    t = text.lower()
    if "x265" in t or "hevc" in t or "h265" in t:
        return "H265"
    if "av1" in t:
        return "AV1"
    return "H264"


class TorrentioProvider(BaseProvider):
    """Fetch torrent streams for a given TMDB ID from Torrentio."""

    name = "torrentio"

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
        # Prefer IMDB ID (most accurate), fall back to TMDB ID
        if imdb_id:
            # Normalise to bare numeric part that Torrentio expects after "tt"
            imdb_norm = imdb_id if imdb_id.startswith("tt") else f"tt{imdb_id}"
            id_prefix = imdb_norm
        elif tmdb_id:
            id_prefix = f"tmdb:{tmdb_id}"
        else:
            logger.info("[TorrentioProvider] no imdb_id or tmdb_id for '%s', skipping", title)
            return []

        # For series with a specific season/episode, query that episode
        ep_season  = season  if season  else 1
        ep_episode = episode if episode else 1
        # Try movie format first, then series format
        candidate_urls = [
            f"{TORRENTIO_BASE}/stream/movie/{id_prefix}.json",
            f"{TORRENTIO_BASE}/stream/series/{id_prefix}:{ep_season}:{ep_episode}.json",
        ]

        streams: list = []
        for url in candidate_urls:
            logger.info("[TorrentioProvider] GET %s", url)
            try:
                client = _get_http_client()
                resp = await client.get(url, follow_redirects=True)
                resp.raise_for_status()
                data = resp.json()
                candidates = data.get("streams") or []
                if candidates:
                    streams = candidates
                    break  # found streams — no need to try series format
            except Exception as exc:
                logger.warning("[TorrentioProvider] request error %s: %s", url, exc)
        variants: list[Variant] = []

        for stream in streams:
            info_hash = stream.get("infoHash")
            if not info_hash:
                continue

            name = stream.get("name", "")
            title_text = stream.get("title", "")
            combined = f"{name} {title_text}"

            quality = _parse_quality(combined)
            size_mb = _parse_size_mb(combined)
            seeders = _parse_seeders(combined)
            codec = _guess_codec(combined)
            # Use known dubbing-studio patterns rather than raw stream group name
            voice = _guess_voice(combined)

            # Build magnet
            magnet = f"magnet:?xt=urn:btih:{info_hash}"
            sources = stream.get("sources") or []
            if sources:
                magnet += "&tr=" + "&tr=".join(sources)

            vid = hashlib.sha1(f"torrentio:{info_hash}:{quality}".encode()).hexdigest()[:12]
            # Show group name + quality in label; voice field holds the dubbing studio
            label = f"{name} • {quality.upper()}"

            variants.append(
                Variant(
                    id=vid,
                    label=label,
                    language="multi",
                    voice=voice,
                    quality=quality,
                    size_mb=size_mb,
                    seeders=seeders,
                    codec=codec,
                    magnet=magnet,
                )
            )

        logger.info(
            "[TorrentioProvider] found %d streams for %s", len(variants), id_prefix
        )
        return variants
