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

# Shared async client — reuses TCP/TLS connections across requests (faster)
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    """Return a module-level shared httpx client, creating it on first call."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=20,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client

_QUALITY_RE = re.compile(r"(2160p|4k|uhd|1080p|720p|480p|360p)", re.IGNORECASE)
_YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")
# Season patterns: "S01", "S1E01", "сезон 1", "season 1"
_SEASON_RE = re.compile(r"\bS(\d{1,2})(?:E\d+)?\b|\bсезон\s*(\d+)\b|\bseason\s*(\d+)\b", re.IGNORECASE)

# Technical tokens commonly appended to torrent titles (codec, quality, format, tracker …)
_TECH_TOKENS_RE = re.compile(
    r"\b(2160p|4k|uhd|1080p|720p|480p|360p|"
    r"bluray|bdrip|brrip|webrip|web[-_.]?dl|dvdrip|hdtv|"
    r"x264|x265|hevc|h264|h265|avc|xvid|divx|av1|"
    r"multi|rus|eng|dub|sub(?:bed|titles?)?|srt|"
    r"19\d{2}|20\d{2}|"
    r"hdr10?|dolby|dts|ac3|aac|mp3|flac|"
    r"yts|rarbg|cm8|galaxyrg|ettv|"
    r"s\d{1,2}e\d{1,2}|s\d{1,2})\b",
    re.IGNORECASE,
)

# Newznab/Jackett movie category range
_MOVIE_CAT_MIN = 2000
_MOVIE_CAT_MAX = 2999

# Maximum variants fetched per provider call — stops early HTTP requests
MAX_VARIANTS = 20

# Maximum characters for the human-readable card label (used by all providers)
MAX_LABEL_LEN = 55

# Known RU dubbing studio patterns (lowercased needle → display name)
_VOICE_STUDIOS: list[tuple[str, str]] = [
    ("lostfilm",     "LostFilm"),
    ("лостфильм",    "LostFilm"),
    ("baibako",      "BaibaKo"),
    ("байбако",      "BaibaKo"),
    ("novafilm",     "NovaFilm"),
    ("nova film",    "NovaFilm"),
    ("новафильм",    "NovaFilm"),
    ("coldfilm",     "ColdFilm"),
    ("newstudio",    "NewStudio"),
    ("нью студио",   "NewStudio"),
    ("amedia",       "Amedia"),
    ("амедиа",       "Amedia"),
    ("jaskier",      "Jaskier"),
    ("жасмин",       "Жасмин"),
    ("кубик в кубе", "Кубик"),
    ("kubik",        "Кубик"),
    ("юсупов",       "Юсупов"),
    ("гоблин",       "Гоблин"),
    ("goblin",       "Гоблин"),
    ("колобок",      "Колобок"),
    ("sdi media",    "SDI Media"),
]
_DUB_RE = re.compile(r"\bdub\b|\bдубляж\b|\bдублирован", re.IGNORECASE)
_SUB_RE = re.compile(r"\bsub(?:bed|title)?\b|\bсубтитры\b", re.IGNORECASE)
_RU_LANG_RE = re.compile(r"\[(?:[^]]*\b(?:rus|рус)\b[^]]*)\]", re.IGNORECASE)


def _guess_voice(title: str) -> str:
    """
    Try to extract a dubbing studio or audio type from a torrent title.
    Returns a short display string, or '' if nothing is recognised.
    """
    t = title.lower()
    for needle, display in _VOICE_STUDIOS:
        if needle in t:
            return display
    if _DUB_RE.search(title):
        return "Дубляж"
    if _SUB_RE.search(title):
        return "Субтитры"
    # e.g. "[Rus/Eng]" → infer Russian dub present
    if _RU_LANG_RE.search(title):
        return "RU"
    return ""


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


def _strip_tech(text: str) -> str:
    """Remove technical torrent metadata tokens to expose only the core title."""
    t = _normalize(text)
    t = _TECH_TOKENS_RE.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def _title_matches(query: str, candidate: str, threshold: float = 0.82) -> bool:
    """Return True when *candidate* title is sufficiently similar to *query*.

    Strategy:
    1. Strip technical tokens (resolution, codec, year, tracker, …) from the
       candidate so "Inception 2010 1080p BluRay x264" becomes "inception".
    2. Check direct substring containment on the stripped candidate.
    3. Fall back to SequenceMatcher ratio on the stripped forms.

    Threshold 0.82 was chosen empirically: it passes "breaking bad" vs
    "breaking bad lostfilm" (0.88) and rejects "inception" vs "interstellar"
    (0.55).  The year filter (_year_ok) provides additional protection against
    same-prefix titles from different years ("Dark Knight" vs "Dark Knight
    Rises").
    """
    q = _normalize(query)
    c_stripped = _strip_tech(candidate)
    if not q:
        return True
    # Direct containment after stripping technical tokens
    if q in c_stripped:
        return True
    # SequenceMatcher on stripped forms (shorter strings → higher ratios)
    return SequenceMatcher(None, q, c_stripped).ratio() >= threshold


def _is_movie_category(cats: "list[int] | int | None") -> bool:
    """Return True if the result belongs to a movie category or has no/unknown category."""
    if not cats:
        return True  # no category info — don't discard
    if isinstance(cats, int):
        cats = [cats]
    # Accept if any entry is zero (unclassified), or falls in the movie range
    return any(c == 0 or _MOVIE_CAT_MIN <= c <= _MOVIE_CAT_MAX for c in cats)


def _year_ok(title_r: str, year: Optional[int]) -> bool:
    """
    Return True when the torrent title is acceptable for the requested year.
    - If no year was requested, always accept.
    - If the torrent title contains no year at all, accept (many valid torrents omit it).
    - If it contains a year, accept with ±1 tolerance.
    """
    if not year:
        return True
    years_in_title = [int(m) for m in _YEAR_RE.findall(title_r)]
    if not years_in_title:
        return True  # no year in torrent title — keep it
    return any(abs(y - year) <= 1 for y in years_in_title)


class JackettProvider(BaseProvider):
    """Fetch torrent search results from a Jackett instance."""

    name = "jackett"

    def _build_queries(
        self,
        title: str,
        year: Optional[int],
        original_title: Optional[str],
        season: Optional[int] = None,
    ) -> list[str]:
        """Build ordered list of query strings to try, most specific first."""
        seen: set[str] = set()
        queries: list[str] = []

        def add(q: str) -> None:
            key = q.lower().strip()
            if key and key not in seen:
                seen.add(key)
                queries.append(q)

        if season:
            # Season-specific queries: Cyrillic + Latin formats
            s2 = f"{season:02d}"
            add(f"{title} сезон {season}")
            add(f"{title} S{s2}")
            if original_title and original_title.lower() != title.lower():
                add(f"{original_title} S{s2}")
                add(f"{original_title} Season {season}")
        else:
            # Primary: title + year (most specific — avoids picking up unrelated films)
            if year:
                add(f"{title} {year}")
                if original_title and original_title.lower() != title.lower():
                    add(f"{original_title} {year}")
            # Secondary: title alone (catches results that omit the year)
            add(title)
            if original_title and original_title.lower() != title.lower():
                add(original_title)

        return queries

    def _season_ok(self, title_r: str, season: Optional[int]) -> bool:
        """
        When a season is requested, check that the torrent title targets that season.
        - If no season requested, always accept.
        - If torrent title has no season indicator at all, keep it (may be a full-series pack).
        - If it has a season indicator, accept only if it matches.
        """
        if not season:
            return True
        m = _SEASON_RE.search(title_r)
        if not m:
            return True  # no season marker — could be a full-series pack; keep it
        found_str = m.group(1) or m.group(2) or m.group(3) or "0"
        found = int(found_str)
        return found == season

    async def _id_search(
        self,
        url: str,
        params: dict,
        seen_magnets: set,
        variants: list,
        season: Optional[int] = None,
    ) -> None:
        """Execute one ID-based Jackett call and append valid variants (no title matching)."""
        try:
            client = _get_http_client()
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            for r in data.get("Results") or []:
                title_r = r.get("Title", "")
                magnet = r.get("MagnetUri") or ""
                if not magnet.startswith("magnet:?xt=urn:btih"):
                    continue
                # For season-scoped queries, still validate the season in the title
                if season and not self._season_ok(title_r, season):
                    continue
                if magnet in seen_magnets:
                    continue
                seen_magnets.add(magnet)
                seeders  = int(r.get("Seeders", 0) or 0)
                size_mb  = int(r.get("Size", 0) or 0) // (1024 * 1024)
                quality  = _guess_quality(title_r)
                codec    = _guess_codec(title_r)
                voice    = _guess_voice(title_r)
                vid = hashlib.sha1(
                    f"jackett:{title_r}:{quality}:{seeders}".encode()
                ).hexdigest()[:12]
                label = f"{voice} • {quality.upper()}" if voice else title_r[:MAX_LABEL_LEN].rstrip(" .-")
                variants.append(Variant(
                    id=vid, label=label, language="ru", voice=voice,
                    quality=quality, size_mb=size_mb, seeders=seeders,
                    codec=codec, magnet=magnet,
                ))
        except Exception as exc:
            logger.warning("[JackettProvider] ID search error: %s", exc)

    async def search_variants(
        self,
        title: str,
        year: Optional[int] = None,
        tmdb_id: Optional[str] = None,
        original_title: Optional[str] = None,
        season: Optional[int] = None,
        imdb_id: Optional[str] = None,
    ) -> list[Variant]:
        if not JACKETT_URL or not JACKETT_API_KEY:
            logger.debug("[JackettProvider] not configured, skipping")
            return []

        url = f"{JACKETT_URL.rstrip('/')}/api/v2.0/indexers/all/results"
        # For TV series, also include TV categories (5000 range)
        if season:
            cat_str = "2000,2010,2020,2030,2040,2045,2050,2060,5000,5030,5040,5045"
        else:
            # Include all Newznab movie sub-categories:
            # 2000=Movies, 2010=Movies/Foreign, 2020=Movies/Other,
            # 2030=Movies/SD, 2040=Movies/HD, 2045=Movies/UHD,
            # 2050=Movies/BluRay, 2060=Movies/3D
            cat_str = "2000,2010,2020,2030,2040,2045,2050,2060"
        seen_magnets: set[str] = set()
        variants: list[Variant] = []

        # ── ID-based search (exact Newznab lookup — greatly reduces wrong-film results) ──
        # Priority order:
        #   1. IMDB ID + season  → t=tvsearch&imdbid=&season=  (TV series season)
        #   2. IMDB ID, no season → t=movie&imdbid=             (movie)
        #   3. TMDB ID, no season → t=movie&tmdbid=             (movie, IMDB not available)
        imdb_norm = (imdb_id if imdb_id.startswith("tt") else f"tt{imdb_id}") if imdb_id else None

        if imdb_norm:
            if season:
                # TV-series exact search: tvsearch + imdbid + season
                id_params: dict[str, str] = {
                    "apikey": JACKETT_API_KEY,
                    "t": "tvsearch",
                    "imdbid": imdb_norm,
                    "season": str(season),
                    "cat": cat_str,
                }
                logger.info("[JackettProvider] tvsearch imdbid=%s season=%s", imdb_norm, season)
            else:
                # Movie exact search: movie + imdbid
                id_params = {
                    "apikey": JACKETT_API_KEY,
                    "t": "movie",
                    "imdbid": imdb_norm,
                    "cat": cat_str,
                }
                logger.info("[JackettProvider] movie search imdbid=%s", imdb_norm)
            await self._id_search(url, id_params, seen_magnets, variants, season=season)
            logger.info("[JackettProvider] ID(imdb) search found %d results for %s", len(variants), imdb_norm)
            if len(variants) >= MAX_VARIANTS:
                return variants

        elif tmdb_id and not season:
            # Fallback: TMDB-based movie search (when IMDB ID is not available)
            tmdb_params: dict[str, str] = {
                "apikey": JACKETT_API_KEY,
                "t": "movie",
                "tmdbid": tmdb_id,
                "cat": cat_str,
            }
            logger.info("[JackettProvider] movie search tmdbid=%s", tmdb_id)
            await self._id_search(url, tmdb_params, seen_magnets, variants, season=None)
            logger.info("[JackettProvider] ID(tmdb) search found %d results for tmdb:%s", len(variants), tmdb_id)
            if len(variants) >= MAX_VARIANTS:
                return variants

        # ── Fallback: title-based text search ────────────────────────────────
        queries = self._build_queries(title, year, original_title, season)
        for query in queries:
            params: dict[str, str] = {
                "apikey": JACKETT_API_KEY,
                "t": "search",
                "q": query,
                "cat": cat_str,
            }
            logger.info("[JackettProvider] GET %s query=%s", url, query)

            try:
                client = _get_http_client()
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

                # ── 2. Year soft-filter (±1 year, skip if no year in title) ──
                if not _year_ok(title_r, year):
                    logger.debug(
                        "[JackettProvider] skip '%s': year mismatch (want %s)",
                        title_r, year,
                    )
                    continue

                # ── 3. Season filter ──────────────────────────────────────────
                if not self._season_ok(title_r, season):
                    logger.debug(
                        "[JackettProvider] skip '%s': season mismatch (want S%02d)",
                        title_r, season,
                    )
                    continue

                # ── 4. Title similarity — check both title and original_title ─
                matched = _title_matches(title, title_r)
                if not matched and original_title:
                    matched = _title_matches(original_title, title_r)
                if not matched:
                    logger.debug(
                        "[JackettProvider] skip '%s': title mismatch for '%s'",
                        title_r, title,
                    )
                    continue

                # ── 5. Deduplication ─────────────────────────────────────────
                if magnet in seen_magnets:
                    continue
                seen_magnets.add(magnet)

                seeders = int(r.get("Seeders", 0) or 0)
                size_bytes = int(r.get("Size", 0) or 0)
                size_mb = size_bytes // (1024 * 1024) if size_bytes else 0
                quality = _guess_quality(title_r)
                codec = _guess_codec(title_r)
                voice = _guess_voice(title_r)

                # Extract year from the torrent title for the label (if known)
                year_in_title = _YEAR_RE.search(title_r)
                year_str = year_in_title.group(0) if year_in_title else (str(year) if year else "")

                # Build human-readable label: voice + quality (no "Jackett" prefix to avoid
                # the UI showing every card with the same "Jackett" banner)
                if voice:
                    label = f"{voice} • {quality.upper()}"
                else:
                    # Fall back to a trimmed torrent title so each card looks unique
                    label = title_r[:MAX_LABEL_LEN].rstrip(" .-")

                vid = hashlib.sha1(
                    f"jackett:{title_r}:{quality}:{seeders}".encode()
                ).hexdigest()[:12]

                variants.append(
                    Variant(
                        id=vid,
                        label=label,
                        language="ru",
                        voice=voice,
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

            # Stop early once we have enough results to avoid unnecessary requests
            if len(variants) >= MAX_VARIANTS:
                break

        logger.info(
            "[JackettProvider] total %d results for title='%s' original_title='%s' season=%s",
            len(variants), title, original_title or "", season,
        )
        return variants
