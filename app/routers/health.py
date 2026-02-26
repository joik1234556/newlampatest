"""
GET /health — service status.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Return simple liveness check."""
    return {"status": "ok"}
