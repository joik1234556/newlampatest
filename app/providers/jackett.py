"""
Jackett provider — searches torrents via a self-hosted Jackett REST API.

Requires environment variables:
  JACKETT_URL      e.g. http://localhost:9117
  JACKETT_API_KEY  Jackett API key

If either is missing, this provider silently returns [].

Jackett JSON endpoint:
  GET {JACKETT_URL}/api/v2.0/indexers/all/results
      ?apikey={key}&t=search&q={query}&cat=2000,5000
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Optional

import httpx

from app.config import JACKETT_API_KEY, JACKETT_URL
from app.models import Variant
from app.providers.base import BaseProvider

logger = logging.getLogger(__name__)

_QUALITY_RE = re.compile(r"(2160p|4k|uhd|1080p|720p|480p|360p)", re.IGNORECASE)


def _guess_quality(name: str) -> str:
    m = _QUALITY_RE.search(name)
    if not m:
        return "1080p"
    q = m.group(1).lower()
    if q in ("4k", "uhd"):
        return "2160p"
    return q


def _guess_codec(name: str) -> str:
    t = name.lower()
    if "x265" in t or "hevc" in t or "h265" in t:
        return "H265"
    if "av1" in t:
        return "AV1"
    return "H264"


class JackettProvider(BaseProvider):
    """Fetch torrent search results from a Jackett instance."""

    name = "jackett"

    async def search_variants(
        self,
        title: str,
        year: Optional[int] = None,
        tmdb_id: Optional[str] = None,
        original_title: Optional[str] = None,
    ) -> list[Variant]:
        if not JACKETT_URL or not JACKETT_API_KEY:
            logger.debug("[JackettProvider] not configured, skipping")
            return []

        # Build list of queries: primary title first, then original_title if it differs
        queries: list[str] = []
        primary = f"{title} {year}" if year else title
        queries.append(primary)
        if original_title and original_title.lower() != title.lower():
            queries.append(f"{original_title} {year}" if year else original_title)

        url = f"{JACKETT_URL.rstrip('/')}/api/v2.0/indexers/all/results"
        seen_magnets: set[str] = set()
        variants: list[Variant] = []

        for query in queries:
            params = {
                "apikey": JACKETT_API_KEY,
                "t": "search",
                "q": query,
                "cat": "2000,5000",  # Movies + TV
            }
            logger.info("[JackettProvider] GET %s query=%s", url, query)

            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    resp = await client.get(url, params=params)
                    resp.raise_for_status()
                    data = resp.json()
            except Exception as exc:
                logger.warning("[JackettProvider] request error query=%s: %s", query, exc)
                continue

            results = data.get("Results") or []

            count_before = len(variants)
            for r in results:
                magnet = r.get("MagnetUri") or ""
                # Fall back to torrent file URL when MagnetUri is absent
                if not magnet.startswith("magnet:"):
                    link = r.get("Link") or r.get("link") or ""
                    if link.startswith("http"):
                        magnet = link
                    else:
                        continue

                if magnet in seen_magnets:
                    continue
                seen_magnets.add(magnet)

                title_r = r.get("Title", "")
                seeders = int(r.get("Seeders", 0) or 0)
                size_bytes = int(r.get("Size", 0) or 0)
                size_mb = size_bytes // (1024 * 1024) if size_bytes else 0
                quality = _guess_quality(title_r)
                codec = _guess_codec(title_r)

                vid = hashlib.sha1(
                    f"jackett:{title_r}:{quality}:{seeders}".encode()
                ).hexdigest()[:12]
                label = f"Jackett • {quality.upper()}"

                variants.append(
                    Variant(
                        id=vid,
                        label=label,
                        language="ru",
                        voice="",
                        quality=quality,
                        size_mb=size_mb,
                        seeders=seeders,
                        codec=codec,
                        magnet=magnet,
                    )
                )

            logger.info(
                "[JackettProvider] query=%s found %d new results", query, len(variants) - count_before
            )

        logger.info(
            "[JackettProvider] total %d results for title='%s' original_title='%s'",
            len(variants), title, original_title or "",
        )
        return variants
