"""
Demo provider — returns static test variants.
Used for UI development and smoke-testing without external dependencies.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Optional

from app.models import Variant
from app.providers.base import BaseProvider

logger = logging.getLogger(__name__)


def _make_id(*parts: str) -> str:
    """Stable SHA-1-based variant ID (first 12 hex chars)."""
    return hashlib.sha1(":".join(parts).encode()).hexdigest()[:12]


class DemoProvider(BaseProvider):
    name = "demo"

    async def search_variants(
        self,
        title: str,
        year: Optional[int] = None,
        tmdb_id: Optional[str] = None,
        original_title: Optional[str] = None,
        season: Optional[int] = None,
        imdb_id: Optional[str] = None,
        episode: Optional[int] = None,
    ) -> list[Variant]:
        logger.info("[Easy-Mod][DemoProvider] search title=%s year=%s", title, year)

        base_magnet = (
            "magnet:?xt=urn:btih:DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"
            "&dn=" + title.replace(" ", "+")
        )

        demo_data = [
            {
                "voice": "LostFilm",
                "quality": "1080p",
                "language": "ru",
                "codec": "H264",
                "size_mb": 8200,
                "seeders": 215,
            },
            {
                "voice": "HDRezka",
                "quality": "1080p",
                "language": "ru",
                "codec": "H265",
                "size_mb": 5100,
                "seeders": 180,
            },
            {
                "voice": "Jaskier",
                "quality": "2160p",
                "language": "ru",
                "codec": "H265",
                "size_mb": 22400,
                "seeders": 95,
            },
            {
                "voice": "Baibako",
                "quality": "720p",
                "language": "ru",
                "codec": "H264",
                "size_mb": 3100,
                "seeders": 310,
            },
        ]

        variants: list[Variant] = []
        for d in demo_data:
            vid = _make_id(title, str(year or ""), d["voice"], d["quality"])
            label = f"{d['voice']} • {d['language'].upper()} • {d['quality']}"
            variants.append(
                Variant(
                    id=vid,
                    label=label,
                    language=d["language"],
                    voice=d["voice"],
                    quality=d["quality"],
                    size_mb=d["size_mb"],
                    seeders=d["seeders"],
                    codec=d["codec"],
                    magnet=base_magnet,
                )
            )

        return variants
