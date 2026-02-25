"""
Abstract base class for variant providers.
Implement this interface to add new torrent sources (Jackett, Kinogo, etc.).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from app.models import Variant


class BaseProvider(ABC):
    """Every provider must implement search_variants."""

    name: str = "base"

    @abstractmethod
    async def search_variants(
        self,
        title: str,
        year: Optional[int] = None,
        tmdb_id: Optional[str] = None,
    ) -> list[Variant]:
        """
        Return a list of Variant objects for the given title.
        Must never raise — return [] on any error and log internally.
        """
