"""
Pydantic models for Easy-Mod API contract.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field
import uuid


# ---------------------------------------------------------------------------
# Variants
# ---------------------------------------------------------------------------

class Variant(BaseModel):
    """A single playback variant (source + quality + voice)."""
    id: str = Field(..., description="Unique stable hash for this variant")
    label: str = Field(..., description="Human-readable label, e.g. 'HDRezka • RU • 1080p'")
    language: str = Field("ru", description="Audio language code")
    voice: str = Field("", description="Dubbing / voice studio name")
    quality: str = Field("1080p", description="Video quality label")
    size_mb: int = Field(0, description="Approximate file size in megabytes")
    seeders: int = Field(0, description="Number of seeders")
    codec: str = Field("H264", description="Video codec")
    magnet: str = Field("", description="Magnet link")
    torrent_url: Optional[str] = Field(None, description="Torrent file download URL (alternative to magnet)")


class VariantsResponse(BaseModel):
    title: str
    year: Optional[int] = None
    variants: list[Variant] = []


# ---------------------------------------------------------------------------
# Stream jobs
# ---------------------------------------------------------------------------

class StreamStartRequest(BaseModel):
    variant_id: str = Field(..., description="Variant ID from /variants")
    magnet: str = Field(..., description="Magnet link to submit to TorBox")
    title: str = Field("", description="Human-readable title for logging")


class StreamJob(BaseModel):
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    variant_id: str = ""
    magnet: str = ""
    magnet_hash: str = ""          # sha1 of magnet string (for dedup + cache lookup)
    title: str = ""
    state: str = "queued"          # queued | preparing | ready | failed
    progress: float = 0.0
    direct_url: Optional[str] = None
    torrent_id: Optional[str] = None
    message: str = ""


class StreamStatusResponse(BaseModel):
    job_id: str
    state: str
    progress: float
    direct_url: Optional[str] = None
    message: str = ""
