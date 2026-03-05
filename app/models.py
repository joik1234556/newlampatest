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
    is_cached: bool = Field(False, description="True when TorBox already has this torrent cached (instant play)")
    url: Optional[str] = Field(None, description="Direct player/stream URL for online providers (no TorBox needed)")
    source: str = Field("", description="Provider source name, e.g. 'rezka', 'kinogo', 'torrentio'")


class VariantsResponse(BaseModel):
    title: str
    year: Optional[int] = None
    variants: list[Variant] = []
    source: Optional[str] = Field(None, description="'torbox_direct' when TorBox cache fast-path was used")


# ---------------------------------------------------------------------------
# Stream jobs
# ---------------------------------------------------------------------------

class StreamStartRequest(BaseModel):
    variant_id: str = Field(..., description="Variant ID from /variants")
    magnet: str = Field(..., description="Magnet link to submit to TorBox")
    title: str = Field("", description="Human-readable title for logging")
    # === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
    season: Optional[int] = Field(None, description="TV series season number (for episode-specific file selection)")
    episode: Optional[int] = Field(None, description="TV series episode number (for episode-specific file selection)")


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
    file_id: Optional[str] = None  # TorBox file ID used to generate direct_url (for URL refresh)
    message: str = ""
    # === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===
    season: Optional[int] = None   # requested TV season (for episode-specific file picking)
    episode: Optional[int] = None  # requested TV episode (for episode-specific file picking)


class StreamStatusResponse(BaseModel):
    job_id: str
    state: str
    progress: float
    direct_url: Optional[str] = None
    proxy_url: Optional[str] = None  # relative path to /stream/proxy on our server (CORS-safe)
    message: str = ""


# ---------------------------------------------------------------------------
# File list (for episode/file picker)
# ---------------------------------------------------------------------------

class TorrentFileItem(BaseModel):
    """A single file inside a TorBox torrent."""
    file_id: str = Field(..., description="TorBox file ID for requestdl")
    name: str = Field(..., description="File name or path inside the torrent")
    size_mb: int = Field(0, description="File size in megabytes")
    quality: str = Field("", description="Guessed quality from filename")
    is_video: bool = Field(False, description="True when file extension is a video format")


class TorrentFilesResponse(BaseModel):
    job_id: str
    torrent_id: str
    files: list[TorrentFileItem] = []


# === НОВАЯ ЛОГИКА ДЛЯ СЕРИАЛОВ ===

class TorrentEpisodeItem(BaseModel):
    """A single episode entry inside a season pack."""
    episode: int = Field(..., description="Episode number")
    title: str = Field(..., description="Episode title / filename label")
    file_id: str = Field(..., description="TorBox file ID for requestdl / proxy_file")
    quality: str = Field("", description="Guessed quality from filename")
    size_mb: int = Field(0, description="File size in megabytes")


class TorrentSeasonItem(BaseModel):
    """A single season inside a season-pack torrent."""
    season: int = Field(..., description="Season number")
    episodes: list[TorrentEpisodeItem] = []


class TorrentSeasonsResponse(BaseModel):
    """Structured season/episode list for a whole-season-pack torrent."""
    job_id: str
    torrent_id: str
    title: str = ""
    seasons: list[TorrentSeasonItem] = []
