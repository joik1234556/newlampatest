"""
PublicJackettProvider — searches torrents via publicly available Jackett proxies.

These are the same public servers used by modss plugin:
  - https://jac.red       (public, no auth needed)
  - https://jacred.xyz    (fallback)

No JACKETT_URL / JACKETT_API_KEY environment variables needed.
Only used when the private JackettProvider is not configured (i.e. returns empty).
Automatically skipped when the private JackettProvider already found results.
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Optional

import httpx

from app.models import Variant
from app.providers.base import BaseProvider
from app.providers.jackett import _is_movie_category, _normalize, _title_matches

logger = logging.getLogger(__name__)

# Public Jackett-compatible servers (tried in order until one responds)
_PUBLIC_SERVERS = [
    "https://jac.red",
    "https://jacred.xyz",
]

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


class PublicJackettProvider(BaseProvider):
    """Fetch torrent results from public Jackett proxy servers."""

    name = "public_jackett"

    async def search_variants(
        self,
        title: str,
        year: Optional[int] = None,
        tmdb_id: Optional[str] = None,
        original_title: Optional[str] = None,
    ) -> list[Variant]:
        # Build query list
        queries: list[str] = []
        primary = f"{title} {year}" if year else title
        queries.append(primary)
        if original_title and original_title.lower() != title.lower():
            queries.append(f"{original_title} {year}" if year else original_title)

        seen_magnets: set[str] = set()
        variants: list[Variant] = []

        for server in _PUBLIC_SERVERS:
            url = f"{server.rstrip('/')}/api/v2.0/indexers/all/results"
            server_ok = False

            for query in queries:
                params: dict = {
                    "apikey": "",       # public servers accept empty key
                    "t": "search",
                    "q": query,
                    "cat": "2000",      # Movies only
                }
                logger.info("[PublicJackettProvider] GET %s query=%s", url, query)

                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.get(url, params=params)
                        resp.raise_for_status()
                        data = resp.json()
                    server_ok = True
                except Exception as exc:
                    logger.warning(
                        "[PublicJackettProvider] %s query=%s error: %s", server, query, exc
                    )
                    break  # try next server

                results = data.get("Results") or []
                count_before = len(variants)
                for r in results:
                    title_r = r.get("Title", "")

                    # ── 1. Magnet only ─────────────────────────────────────
                    magnet = r.get("MagnetUri") or ""
                    if not magnet.startswith("magnet:?xt=urn:btih"):
                        logger.debug(
                            "[PublicJackettProvider] skip '%s': no valid magnet URI",
                            title_r,
                        )
                        continue

                    # ── 2. Seeders > 0 ─────────────────────────────────────
                    seeders = int(r.get("Seeders", 0) or 0)
                    if seeders == 0:
                        logger.debug(
                            "[PublicJackettProvider] skip '%s': zero seeders", title_r
                        )
                        continue

                    # ── 3. Year filter ──────────────────────────────────────
                    if year and not re.search(r"\b" + str(year) + r"\b", title_r):
                        logger.debug(
                            "[PublicJackettProvider] skip '%s': year %s not in title",
                            title_r, year,
                        )
                        continue

                    # ── 4. Title similarity ≥ 70 % ──────────────────────────
                    search_q = original_title if original_title else title
                    if not _title_matches(search_q, title_r):
                        logger.debug(
                            "[PublicJackettProvider] skip '%s': title mismatch for '%s'",
                            title_r, search_q,
                        )
                        continue

                    # ── 5. Movie category ───────────────────────────────────
                    cats = r.get("Category") or []
                    if not _is_movie_category(cats):
                        logger.debug(
                            "[PublicJackettProvider] skip '%s': non-movie category %s",
                            title_r, cats,
                        )
                        continue

                    # ── 6. Deduplication ────────────────────────────────────
                    if magnet in seen_magnets:
                        continue
                    seen_magnets.add(magnet)

                    size_bytes = int(r.get("Size", 0) or 0)
                    size_mb = size_bytes // (1024 * 1024) if size_bytes else 0
                    quality = _guess_quality(title_r)
                    codec = _guess_codec(title_r)

                    vid = hashlib.sha1(
                        f"pubjac:{title_r}:{quality}:{seeders}".encode()
                    ).hexdigest()[:12]

                    variants.append(
                        Variant(
                            id=vid,
                            label=f"Public • {quality.upper()}",
                            language="multi",
                            voice="",
                            quality=quality,
                            size_mb=size_mb,
                            seeders=seeders,
                            codec=codec,
                            magnet=magnet,
                        )
                    )
                logger.info(
                    "[PublicJackettProvider] %s query=%s found %d new results",
                    server, query, len(variants) - count_before,
                )

            if server_ok:
                # Got a response from this server — don't try others
                break

        logger.info(
            "[PublicJackettProvider] total %d results for title='%s'", len(variants), title
        )
        return variants
