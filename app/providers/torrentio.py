"""
Torrentio provider — searches torrents via the public Torrentio API.

Uses TMDB ID (preferred) or falls back to a title-based lookup via
Cinemeta (Stremio metadata service) when only a title is available.

API format:
  https://torrentio.strem.fun/stream/movie/tmdb:{id}.json   (movie)
  https://torrentio.strem.fun/stream/series/tmdb:{id}:1:1.json  (series ep 1x1)
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Optional

import httpx

from app.models import Variant
from app.providers.base import BaseProvider

logger = logging.getLogger(__name__)

TORRENTIO_BASE = "https://torrentio.strem.fun"
_CINEMETA_BASE = "https://v3-cinemeta.strem.io"

_QUALITY_RE = re.compile(r"(2160p|4k|uhd|1080p|720p|480p|360p)", re.IGNORECASE)
_SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(GB|MB)", re.IGNORECASE)
_SEEDERS_RE = re.compile(r"👤\s*(\d+)")


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
    ) -> list[Variant]:
        if not tmdb_id:
            logger.info("[TorrentioProvider] no tmdb_id for '%s', skipping", title)
            return []

        url = f"{TORRENTIO_BASE}/stream/movie/tmdb:{tmdb_id}.json"
        logger.info("[TorrentioProvider] GET %s", url)

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, follow_redirects=True)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning("[TorrentioProvider] request error for tmdb:%s: %s", tmdb_id, exc)
            return []

        streams = data.get("streams") or []
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

            # Build magnet
            magnet = f"magnet:?xt=urn:btih:{info_hash}"
            sources = stream.get("sources") or []
            if sources:
                magnet += "&tr=" + "&tr=".join(sources)

            vid = hashlib.sha1(f"torrentio:{info_hash}:{quality}".encode()).hexdigest()[:12]
            label = f"{name} • {quality.upper()}"

            variants.append(
                Variant(
                    id=vid,
                    label=label,
                    language="multi",
                    voice=name,
                    quality=quality,
                    size_mb=size_mb,
                    seeders=seeders,
                    codec=codec,
                    magnet=magnet,
                )
            )

        logger.info(
            "[TorrentioProvider] found %d streams for tmdb:%s", len(variants), tmdb_id
        )
        return variants
