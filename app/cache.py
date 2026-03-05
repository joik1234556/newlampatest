"""
Cache layer — Redis with automatic in-memory fallback.

Redis keys (prefixed per backend instance):
  variants:{sha1}      → JSON (VariantsResponse)      TTL VARIANTS_CACHE_TTL
  direct:{magnet_sha1} → str (direct URL)             TTL DIRECT_URL_CACHE_TTL
  job:{job_id}         → JSON (StreamJob fields)       TTL JOB_TTL
  magnet_job:{sha1}    → str (job_id, dedup sentinel)  TTL JOB_TTL

Design:
  CacheBackend wraps an async Redis client with a sync in-memory TTLCache fallback.
  - Sync interface (get/set/delete)  : always operates on in-memory store.
    Used by unit tests that import singletons directly.
  - Async interface (aget/aset/adelete): tries Redis first; on failure falls back
    to the in-memory store and logs a WARNING.
  This makes tests work without Redis while production benefits from Redis persistence.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# TTLCache — simple in-memory TTL store (used by tests + CacheBackend fallback)
# ---------------------------------------------------------------------------

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
# CacheBackend — Redis + in-memory fallback
# ---------------------------------------------------------------------------

class CacheBackend:
    """
    Unified cache backend.

    - Sync ``get`` / ``set`` / ``delete`` always use the in-memory fallback.
      This keeps unit tests simple (no async needed).
    - Async ``aget`` / ``aset`` / ``adelete`` try Redis first and transparently
      fall back to the in-memory store when Redis is unreachable.
    """

    def __init__(self, prefix: str, default_ttl: int) -> None:
        self._prefix = prefix
        self._ttl = default_ttl
        self._mem = TTLCache(default_ttl)
        self._redis: Any = None          # redis.asyncio.Redis, lazy init
        self._redis_ok: bool = False     # True once a successful ping

    # ------------------------------------------------------------------
    # Lazy Redis initialisation (called once from the first async method)
    # ------------------------------------------------------------------

    async def _ensure_redis(self) -> None:
        if self._redis is not None:
            return
        try:
            import redis.asyncio as aioredis  # type: ignore[import]
            from app.config import REDIS_URL
            self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            await self._redis.ping()
            self._redis_ok = True
            logger.info("[Cache] Redis connected prefix=%s url=%s", self._prefix, REDIS_URL)
        except Exception as exc:
            logger.warning(
                "[Cache] Redis unavailable for prefix=%s — using in-memory fallback: %s",
                self._prefix, exc,
            )
            self._redis = None
            self._redis_ok = False

    def _fk(self, key: str) -> str:
        return f"{self._prefix}:{key}"

    @staticmethod
    def _serialize(value: Any) -> str:
        if isinstance(value, str):
            return value
        return json.dumps(value)

    @staticmethod
    def _deserialize(raw: str, original: Any = None) -> Any:
        """Return the original Python type if it was serialized from JSON."""
        if isinstance(original, str):
            return raw
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return raw

    # ------------------------------------------------------------------
    # Sync interface (for tests / direct in-process access)
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[Any]:
        return self._mem.get(self._fk(key))

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        self._mem.set(self._fk(key), value, ttl or self._ttl)

    def delete(self, key: str) -> None:
        self._mem.delete(self._fk(key))

    # ------------------------------------------------------------------
    # Async interface (for FastAPI route handlers / services)
    # ------------------------------------------------------------------

    async def aget(self, key: str) -> Optional[Any]:
        await self._ensure_redis()
        fk = self._fk(key)
        if self._redis_ok:
            try:
                raw = await self._redis.get(fk)
                if raw is not None:
                    # Try JSON decode; return str as-is
                    try:
                        return json.loads(raw)
                    except (TypeError, json.JSONDecodeError):
                        return raw
            except Exception as exc:
                logger.warning("[Cache] Redis get failed prefix=%s: %s", self._prefix, exc)
                self._redis_ok = False
        return self._mem.get(fk)

    async def aset(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        await self._ensure_redis()
        fk = self._fk(key)
        t = ttl or self._ttl
        serialized = self._serialize(value)
        if self._redis_ok:
            try:
                await self._redis.set(fk, serialized, ex=t)
                # Also mirror to in-memory so sync reads stay consistent
                self._mem.set(fk, value, t)
                return
            except Exception as exc:
                logger.warning("[Cache] Redis set failed prefix=%s: %s", self._prefix, exc)
                self._redis_ok = False
        self._mem.set(fk, value, t)

    async def adelete(self, key: str) -> None:
        await self._ensure_redis()
        fk = self._fk(key)
        if self._redis_ok:
            try:
                await self._redis.delete(fk)
            except Exception as exc:
                logger.warning("[Cache] Redis delete failed prefix=%s: %s", self._prefix, exc)
                self._redis_ok = False
        self._mem.delete(fk)


# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------

from app.config import VARIANTS_CACHE_TTL, DIRECT_URL_CACHE_TTL, JOB_TTL  # noqa: E402

# Variants response cache (TTL 30 min)
variants_cache: CacheBackend = CacheBackend(prefix="variants", default_ttl=VARIANTS_CACHE_TTL)

# Magnet infohash → direct stream URL (TTL 2 hours)
direct_url_cache: CacheBackend = CacheBackend(prefix="direct", default_ttl=DIRECT_URL_CACHE_TTL)

# Job state store: job_id → StreamJob dict (TTL 2 hours)
job_cache: CacheBackend = CacheBackend(prefix="job", default_ttl=JOB_TTL)

# Magnet hash → job_id  (deduplication sentinel, TTL 2 hours)
magnet_job_cache: CacheBackend = CacheBackend(prefix="magnet_job", default_ttl=JOB_TTL)

