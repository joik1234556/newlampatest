"""
GET /variants?title=&year=&tmdb_id=
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from app.limiter_shared import limiter
from app.models import VariantsResponse
from app.services.variants import get_variants

logger = logging.getLogger(__name__)
router = APIRouter(tags=["variants"])


@router.get("/variants", response_model=VariantsResponse)
@limiter.limit("60/minute")
async def variants(
    request: Request,
    title: str = Query(..., description="Film or series title"),
    year: Optional[int] = Query(None, description="Release year"),
    tmdb_id: Optional[str] = Query(None, description="TMDB ID for deduplication"),
    original_title: Optional[str] = Query(None, description="Original (English) title for better Jackett search"),
    quality: Optional[str] = Query(None, description="Filter by quality tier: 4k|2160p|1080p|720p|480p"),
    season: Optional[int] = Query(None, description="TV series season number (1-based)"),
) -> VariantsResponse:
    """
    Return sorted, deduplicated playback variants for a title.
    Results are cached for 30 minutes.
    Pass ``season`` for TV-series season-specific searches.
    Optionally filter to a single quality tier with the ``quality`` param.
    """
    if not title.strip():
        raise HTTPException(status_code=400, detail="title must not be empty")

    try:
        result = await get_variants(title.strip(), year, tmdb_id, original_title, season)
    except Exception as exc:
        logger.error("[Easy-Mod][/variants] error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if quality:
        # Normalise: "4k" → "2160p"
        q_norm = quality.strip().lower()
        if q_norm in ("4k", "uhd"):
            q_norm = "2160p"
        result.variants = [v for v in result.variants if v.quality.lower() == q_norm]

    return result
