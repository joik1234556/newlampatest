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
) -> VariantsResponse:
    """
    Return sorted, deduplicated playback variants for a title.
    Results are cached for 30 minutes.
    """
    if not title.strip():
        raise HTTPException(status_code=400, detail="title must not be empty")

    try:
        return await get_variants(title.strip(), year, tmdb_id)
    except Exception as exc:
        logger.error("[Easy-Mod][/variants] error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
