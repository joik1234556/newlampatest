"""
Jackett provider — searches torrents via a self-hosted Jackett REST API.

Requires environment variables:
  JACKETT_URL      e.g. http://localhost:9117
  JACKETT_API_KEY  Jackett API key

If either is missing, this provider silently returns [].

Jackett JSON endpoint:
  GET {JACKETT_URL}/api/v2.0/indexers/all/results
      ?apikey={key}&t=search&q={query}&cat=2000
"""
from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Optional

import httpx

from app.config import JACKETT_API_KEY, JACKETT_URL
from app.models import Variant
from app.providers.base import BaseProvider

logger = logging.getLogger(__name__)

_QUALITY_RE = re.compile(r"(2160p|4k|uhd|1080p|720p|480p|360p)", re.IGNORECASE)

# Newznab/Jackett movie category range
_MOVIE_CAT_MIN = 2000
_MOVIE_CAT_MAX = 2999


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


def _normalize(text: str) -> str:
    """Lowercase, strip accents/punctuation, collapse whitespace."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _title_matches(query: str, candidate: str, threshold: float = 0.70) -> bool:
    """Return True when *candidate* title is sufficiently similar to *query*."""
    q = _normalize(query)
    c = _normalize(candidate)
    if not q:
        return True
    # Fast path: all query words present in candidate
    query_words = q.split()
    if query_words and all(w in c.split() for w in query_words):
        return True
    # Substring containment (handles multi-word queries)
    if q in c:
        return True
    # Fallback: SequenceMatcher ratio
    return SequenceMatcher(None, q, c).ratio() >= threshold


def _is_movie_category(cats: "list[int] | int | None") -> bool:
    """Return True if the result belongs to a movie category or has no category info."""
    if not cats:
        return True  # no category info — don't discard
    if isinstance(cats, int):
        cats = [cats]
    return any(_MOVIE_CAT_MIN <= c <= _MOVIE_CAT_MAX for c in cats)


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
                "cat": "2000",  # Movies only
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
                title_r = r.get("Title", "")

                # ── 1. Magnet only — reject HTTP download links ──────────────
                magnet = r.get("MagnetUri") or ""
                if not magnet.startswith("magnet:?xt=urn:btih"):
                    logger.debug(
                        "[JackettProvider] skip '%s': no valid magnet URI (got: %s)",
                        title_r, magnet[:60] if magnet else "<empty>",
                    )
                    continue

                # ── 2. Seeders > 0 ───────────────────────────────────────────
                seeders = int(r.get("Seeders", 0) or 0)
                if seeders == 0:
                    logger.debug("[JackettProvider] skip '%s': zero seeders", title_r)
                    continue

                # ── 3. Year filter ───────────────────────────────────────────
                if year and not re.search(r"\b" + str(year) + r"\b", title_r):
                    logger.debug(
                        "[JackettProvider] skip '%s': year %s not in title",
                        title_r, year,
                    )
                    continue

                # ── 4. Title similarity ≥ 70 % ───────────────────────────────
                search_q = original_title if original_title else title
                if not _title_matches(search_q, title_r):
                    logger.debug(
                        "[JackettProvider] skip '%s': title mismatch for query '%s'",
                        title_r, search_q,
                    )
                    continue

                # ── 5. Movie category ────────────────────────────────────────
                cats = r.get("Category") or []
                if not _is_movie_category(cats):
                    logger.debug(
                        "[JackettProvider] skip '%s': non-movie category %s",
                        title_r, cats,
                    )
                    continue

                # ── 6. Deduplication ─────────────────────────────────────────
                if magnet in seen_magnets:
                    continue
                seen_magnets.add(magnet)

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
