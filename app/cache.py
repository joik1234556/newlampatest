"""
Simple TTL in-memory cache.
Thread-safe for asyncio single-threaded use.
"""
from __future__ import annotations

import time
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


class TTLCache:
    """Key-value store with per-entry TTL (seconds)."""

    def __init__(self, default_ttl: int = 1800) -> None:
        self._store: dict[str, tuple[Any, float]] = {}
        self.default_ttl = default_ttl

    def get(self, key: str) -> Optional[Any]:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            logger.debug("[Cache] expired key=%s", key)
            return None
        logger.debug("[Cache] hit key=%s", key)
        return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        ttl = ttl if ttl is not None else self.default_ttl
        self._store[key] = (value, time.monotonic() + ttl)
        logger.debug("[Cache] set key=%s ttl=%ds", key, ttl)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        now = time.monotonic()
        return sum(1 for _, (_, exp) in self._store.items() if exp > now)


# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------

# Cache for /variants responses (TTL 30 min)
variants_cache: TTLCache = TTLCache(default_ttl=1800)

# Cache for magnet → direct_url (TTL 2 hours)
direct_url_cache: TTLCache = TTLCache(default_ttl=7200)
