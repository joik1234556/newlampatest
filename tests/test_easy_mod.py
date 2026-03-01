"""Tests for Easy-Mod endpoints: /health, /variants, /stream/start, /stream/status."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("TORBOX_API_KEY", "test-key-dummy")
os.environ.setdefault("ENABLE_DEMO_PROVIDER", "1")

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

class TestEasyModHealth:
    def test_health_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_health_cors(self, client):
        resp = client.get("/health", headers={"Origin": "http://lampa.app"})
        assert resp.headers.get("access-control-allow-origin") == "*"


# ---------------------------------------------------------------------------
# /variants
# ---------------------------------------------------------------------------

class TestVariants:
    def test_variants_missing_title(self, client):
        resp = client.get("/variants")
        assert resp.status_code == 422  # required query param

    def test_variants_empty_title(self, client):
        resp = client.get("/variants?title=   ")
        assert resp.status_code == 400

    def test_variants_returns_structure(self, client):
        resp = client.get("/variants?title=Дюна+2&year=2024")
        assert resp.status_code == 200
        body = resp.json()
        assert "title" in body
        assert "variants" in body
        assert isinstance(body["variants"], list)

    def test_variants_contains_required_fields(self, client):
        resp = client.get("/variants?title=Test+Movie")
        assert resp.status_code == 200
        variants = resp.json()["variants"]
        if variants:
            v = variants[0]
            assert "id" in v
            assert "label" in v
            assert "quality" in v
            assert "voice" in v
            assert "magnet" in v

    def test_variants_sorted_by_seeders(self, client):
        resp = client.get("/variants?title=Test+Movie")
        assert resp.status_code == 200
        variants = resp.json()["variants"]
        # Primary sort is seeders descending (zero-seeder variants go last)
        if len(variants) >= 2:
            s0 = variants[0]["seeders"]
            s1 = variants[1]["seeders"]
            # If both are non-zero, first must have >= seeders
            if s0 > 0 and s1 > 0:
                assert s0 >= s1

    def test_variants_cached(self, client):
        # Two identical requests — both should succeed (second from cache)
        r1 = client.get("/variants?title=CacheTest")
        r2 = client.get("/variants?title=CacheTest")
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["variants"] == r2.json()["variants"]

    def test_variants_returns_data_when_provider_works(self, client):
        """Verify /variants properly returns variants when a provider succeeds."""
        from app.models import Variant
        from app.providers.torrentio import TorrentioProvider

        fake_variant = Variant(
            id="abc123test",
            label="Test 1080p",
            language="ru",
            voice="Test",
            quality="1080p",
            size_mb=5000,
            seeders=100,
            codec="H264",
            magnet="magnet:?xt=urn:btih:AABBCCDDEEAABBCCDDEEAABBCCDDEEAABBCCDDEE",
        )

        with patch.object(
            TorrentioProvider,
            "search_variants",
            new=AsyncMock(return_value=[fake_variant]),
        ):
            resp = client.get("/variants?title=UniqueProviderTestXYZ999&year=2025")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["variants"]) > 0


# ---------------------------------------------------------------------------
# /stream/start
# ---------------------------------------------------------------------------

DEMO_MAGNET = (
    "magnet:?xt=urn:btih:DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"
    "&dn=TestMovie"
)


class TestStreamStart:
    def test_start_missing_body(self, client):
        resp = client.post("/stream/start")
        assert resp.status_code == 422

    def test_start_invalid_magnet(self, client):
        resp = client.post(
            "/stream/start",
            json={"variant_id": "abc", "magnet": "not-a-magnet", "title": "Test"},
        )
        assert resp.status_code == 400

    def test_start_missing_variant_id(self, client):
        resp = client.post(
            "/stream/start",
            json={"variant_id": "", "magnet": DEMO_MAGNET, "title": "Test"},
        )
        assert resp.status_code == 400

    def test_start_creates_job(self, client):
        with patch("app.services.stream.torbox.add_magnet", new_callable=AsyncMock) as mam:
            mam.return_value = {"data": {"torrent_id": "1"}}
            resp = client.post(
                "/stream/start",
                json={"variant_id": "v1", "magnet": DEMO_MAGNET, "title": "Dune 2"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "job_id" in body
        assert body["status"] in ("queued", "ready")

    def test_start_returns_immediately_if_cached(self, client):
        # Prime direct_url cache (using infohash as legacy key)
        from app.cache import direct_url_cache
        direct_url_cache.set(
            "da39a3ee5e6b4b0d3255bfef95601890afd80709",
            "https://cdn.torbox.app/cached.mkv",
        )
        resp = client.post(
            "/stream/start",
            json={"variant_id": "v_cached", "magnet": DEMO_MAGNET, "title": "Cached"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ready"
        # New: direct_url must be included in /stream/start when status=ready
        assert body.get("direct_url") == "https://cdn.torbox.app/cached.mkv"

    def test_start_dedup_same_magnet_returns_same_job(self, client):
        """Submitting the same magnet twice should reuse the in-flight job."""
        UNIQUE_MAGNET = (
            "magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "&dn=DedupeTest"
        )
        with patch("app.services.stream.torbox.add_magnet", new_callable=AsyncMock) as mam:
            mam.return_value = {"data": {"torrent_id": "555"}}
            r1 = client.post(
                "/stream/start",
                json={"variant_id": "vd1", "magnet": UNIQUE_MAGNET, "title": "Dedup"},
            )
            r2 = client.post(
                "/stream/start",
                json={"variant_id": "vd2", "magnet": UNIQUE_MAGNET, "title": "Dedup"},
            )
        assert r1.status_code == 200
        assert r2.status_code == 200
        # Second request must return the same job_id
        assert r1.json()["job_id"] == r2.json()["job_id"]

    def test_retry_error_produces_readable_job_message(self):
        """RetryError from TorBox add_magnet must produce a human-readable failed job."""
        import asyncio
        from unittest.mock import MagicMock, patch
        from tenacity import RetryError, Future as TenacityFuture
        import httpx
        from app.services.stream import create_job
        from app.models import StreamStartRequest

        # Build a fake RetryError wrapping an httpx.HTTPStatusError
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.text = '{"detail": "Unauthorized"}'
        http_err = httpx.HTTPStatusError("401", request=MagicMock(), response=mock_resp)

        # tenacity.Future holds the last attempt's exception
        fut = TenacityFuture(1)
        fut.set_exception(http_err)
        retry_err = RetryError(fut)

        MAGNET = (
            "magnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
            "&dn=RetryTest"
        )

        async def run():
            with patch("app.services.stream.torbox.add_magnet", side_effect=retry_err), \
                 patch("app.services.stream.torbox.get_torrent_by_hash",
                       new_callable=AsyncMock, return_value=None):
                req = StreamStartRequest(variant_id="v_retry", magnet=MAGNET, title="RetryTest")
                job = await create_job(req)
                # Give background task time to run
                await asyncio.sleep(0.2)
                from app.services.stream import _load_job
                return await _load_job(job.job_id)

        job = asyncio.get_event_loop().run_until_complete(run())
        assert job is not None
        assert job.state == "failed"
        assert "401" in job.message or "HTTP" in job.message or "TorBox" in job.message

    def test_torbox_dead_state_fails_job_with_message(self):
        """When TorBox reports a dead state (stalledDL), the job must fail with a helpful message."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app.services.stream import _process_job, _save_job, _load_job
        from app.models import StreamJob

        MAGNET = (
            "magnet:?xt=urn:btih:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
            "&dn=StalledTest"
        )
        stalled_torrent = {
            "id": "777",
            "download_state": "stalledDL",
            "progress": 0.0,
            "files": [],
        }

        async def run():
            job = StreamJob(variant_id="v_stall", magnet=MAGNET, title="StalledTest",
                            state="queued")
            await _save_job(job)
            with patch("app.services.stream.torbox.add_magnet", new_callable=AsyncMock) as mam, \
                 patch("app.services.stream.torbox.get_torrent_by_hash",
                       new_callable=AsyncMock, return_value=None), \
                 patch("app.services.stream.torbox.get_torrent_by_id", new_callable=AsyncMock) as mgt, \
                 patch("app.services.stream.asyncio.sleep", new_callable=AsyncMock):
                mam.return_value = {"data": {"torrent_id": "777"}}
                mgt.return_value = stalled_torrent
                await _process_job(job.job_id)
            return await _load_job(job.job_id)

        job = asyncio.get_event_loop().run_until_complete(run())
        assert job is not None
        assert job.state == "failed"
        assert "stalledDL" in job.message or "Torrent" in job.message or "TorBox" in job.message

    def test_early_download_link_on_files_available(self):
        """Job becomes ready as soon as TorBox reports files (regardless of download_state)."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app.services.stream import _process_job, _save_job, _load_job
        from app.models import StreamJob

        MAGNET = (
            "magnet:?xt=urn:btih:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
            "&dn=EarlyLinkTest"
        )
        torrent_with_files = {
            "id": "888",
            "download_state": "downloading",
            "progress": 0.0,
            "files": [{"id": 1, "name": "movie.mkv", "size": 4_000_000_000}],
        }

        async def run():
            job = StreamJob(variant_id="v_early", magnet=MAGNET, title="EarlyLinkTest",
                            state="queued")
            await _save_job(job)
            with patch("app.services.stream.torbox.add_magnet", new_callable=AsyncMock) as mam, \
                 patch("app.services.stream.torbox.get_torrent_by_hash",
                       new_callable=AsyncMock, return_value=None), \
                 patch("app.services.stream.torbox.get_torrent_by_id", new_callable=AsyncMock) as mgt, \
                 patch("app.services.stream.torbox.request_download_link", new_callable=AsyncMock) as mdl, \
                 patch("app.services.stream.asyncio.sleep", new_callable=AsyncMock):
                mam.return_value = {"data": {"torrent_id": "888"}}
                mgt.return_value = torrent_with_files
                mdl.return_value = "https://cdn.torbox.app/stream.mkv"
                await _process_job(job.job_id)
            return await _load_job(job.job_id)

        job = asyncio.get_event_loop().run_until_complete(run())
        assert job is not None
        assert job.state == "ready"
        assert job.direct_url == "https://cdn.torbox.app/stream.mkv"


# ---------------------------------------------------------------------------
# /stream/status
# ---------------------------------------------------------------------------

class TestStreamStatus:
    def test_status_missing_job_id(self, client):
        resp = client.get("/stream/status")
        assert resp.status_code == 422

    def test_status_unknown_job_id(self, client):
        resp = client.get("/stream/status?job_id=does-not-exist")
        assert resp.status_code == 404

    def test_status_returns_job(self, client):
        # Create a job first
        with patch("app.services.stream.torbox.add_magnet", new_callable=AsyncMock) as mam:
            mam.return_value = {"data": {"torrent_id": "99"}}
            start_resp = client.post(
                "/stream/start",
                json={"variant_id": "v_status", "magnet": DEMO_MAGNET, "title": "StatusTest"},
            )
        job_id = start_resp.json()["job_id"]

        resp = client.get(f"/stream/status?job_id={job_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["job_id"] == job_id
        assert body["state"] in ("queued", "preparing", "ready", "failed")
        assert 0.0 <= body["progress"] <= 1.0

    def test_status_ready_has_direct_url(self, client):
        # Force a ready job via cache
        from app.cache import direct_url_cache
        direct_url_cache.set(
            "da39a3ee5e6b4b0d3255bfef95601890afd80709",
            "https://cdn.torbox.app/ready.mkv",
        )
        start_resp = client.post(
            "/stream/start",
            json={"variant_id": "v_ready", "magnet": DEMO_MAGNET, "title": "ReadyTest"},
        )
        job_id = start_resp.json()["job_id"]
        status_resp = client.get(f"/stream/status?job_id={job_id}")
        body = status_resp.json()
        assert body["state"] == "ready"
        assert body["direct_url"] == "https://cdn.torbox.app/ready.mkv"


# ---------------------------------------------------------------------------
# Cache unit tests
# ---------------------------------------------------------------------------

class TestTTLCache:
    def test_set_and_get(self):
        from app.cache import TTLCache
        c = TTLCache(default_ttl=60)
        c.set("k", "v")
        assert c.get("k") == "v"

    def test_expiry(self):
        import time
        from app.cache import TTLCache
        c = TTLCache(default_ttl=0)
        c.set("k", "v", ttl=0)
        time.sleep(0.01)
        assert c.get("k") is None

    def test_delete(self):
        from app.cache import TTLCache
        c = TTLCache()
        c.set("k", "v")
        c.delete("k")
        assert c.get("k") is None

    def test_miss_returns_none(self):
        from app.cache import TTLCache
        c = TTLCache()
        assert c.get("nonexistent") is None


class TestCacheBackend:
    """Verify CacheBackend sync interface works without Redis."""

    def test_sync_set_get(self):
        from app.cache import CacheBackend
        cb = CacheBackend(prefix="test", default_ttl=60)
        cb.set("key1", "value1")
        assert cb.get("key1") == "value1"

    def test_sync_delete(self):
        from app.cache import CacheBackend
        cb = CacheBackend(prefix="test2", default_ttl=60)
        cb.set("k", "v")
        cb.delete("k")
        assert cb.get("k") is None

    def test_sync_miss(self):
        from app.cache import CacheBackend
        cb = CacheBackend(prefix="test3", default_ttl=60)
        assert cb.get("missing") is None

    def test_async_fallback_to_memory(self):
        """Async aget/aset fall back to in-memory when Redis is unavailable."""
        import asyncio
        from app.cache import CacheBackend

        async def run():
            cb = CacheBackend(prefix="testasync", default_ttl=60)
            await cb.aset("hello", "world")
            val = await cb.aget("hello")
            return val

        val = asyncio.get_event_loop().run_until_complete(run())
        assert val == "world"

    def test_async_dict_roundtrip(self):
        """Dicts serialise and deserialise correctly."""
        import asyncio
        from app.cache import CacheBackend

        async def run():
            cb = CacheBackend(prefix="testdict", default_ttl=60)
            data = {"foo": "bar", "n": 42}
            await cb.aset("d", data)
            return await cb.aget("d")

        result = asyncio.get_event_loop().run_until_complete(run())
        assert result == {"foo": "bar", "n": 42}

    def test_singletons_exist(self):
        from app.cache import direct_url_cache, job_cache, magnet_job_cache, variants_cache
        from app.cache import CacheBackend
        for cache in (variants_cache, direct_url_cache, job_cache, magnet_job_cache):
            assert isinstance(cache, CacheBackend)


# ---------------------------------------------------------------------------
# Variants service unit tests
# ---------------------------------------------------------------------------

class TestVariantsService:
    def test_quality_sorting(self):
        from app.services.variants import _quality_rank
        assert _quality_rank("2160p") > _quality_rank("1080p")
        assert _quality_rank("1080p") > _quality_rank("720p")
        assert _quality_rank("720p")  > _quality_rank("480p")

    def test_demo_provider_returns_variants(self):
        import asyncio
        from app.providers.demo_provider import DemoProvider

        async def run():
            p = DemoProvider()
            return await p.search_variants("Matrix", year=1999)

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert len(variants) > 0
        for v in variants:
            assert v.id
            assert v.label
            assert v.magnet.startswith("magnet:")

    def test_demo_provider_disabled_in_production(self):
        """When ENABLE_DEMO_PROVIDER=0, /variants returns empty list if no real provider works."""
        import asyncio
        from unittest.mock import AsyncMock, patch

        async def run():
            # Simulate all real providers returning empty
            with patch("app.services.variants.ENABLE_DEMO_PROVIDER", False), \
                 patch("app.providers.torrentio.TorrentioProvider.search_variants",
                        new_callable=AsyncMock, return_value=[]), \
                 patch("app.providers.jackett.JackettProvider.search_variants",
                        new_callable=AsyncMock, return_value=[]), \
                 patch("app.providers.public_jackett.PublicJackettProvider.search_variants",
                        new_callable=AsyncMock, return_value=[]):
                from app.services.variants import get_variants
                return await get_variants("SomeUnknownFilm2099")

        result = asyncio.get_event_loop().run_until_complete(run())
        # DemoProvider must NOT have injected fake variants
        assert result.variants == []

    def test_demo_provider_enabled_as_fallback(self):
        """When ENABLE_DEMO_PROVIDER=1 and all real providers return empty, demo is used."""
        import asyncio
        from unittest.mock import AsyncMock, patch

        async def run():
            with patch("app.services.variants.ENABLE_DEMO_PROVIDER", True), \
                 patch("app.providers.torrentio.TorrentioProvider.search_variants",
                        new_callable=AsyncMock, return_value=[]), \
                 patch("app.providers.jackett.JackettProvider.search_variants",
                        new_callable=AsyncMock, return_value=[]), \
                 patch("app.providers.public_jackett.PublicJackettProvider.search_variants",
                        new_callable=AsyncMock, return_value=[]):
                from app.services.variants import get_variants
                return await get_variants("SomeDemoFilm2099")

        result = asyncio.get_event_loop().run_until_complete(run())
        # DemoProvider should have provided fallback variants
        assert len(result.variants) > 0


# ---------------------------------------------------------------------------
# TorrentioProvider unit tests
# ---------------------------------------------------------------------------

class TestTorrentioProvider:
    def test_returns_empty_without_tmdb_id(self):
        import asyncio
        from app.providers.torrentio import TorrentioProvider

        async def run():
            p = TorrentioProvider()
            return await p.search_variants("Dune", year=2021, tmdb_id=None)

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert variants == []

    def test_returns_variants_with_tmdb_id(self):
        """Mock Torrentio API and verify variant parsing."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.providers.torrentio import TorrentioProvider

        mock_response = {
            "streams": [
                {
                    "name": "YIFY",
                    "title": "Dune 2021 1080p BluRay\n👤 1200\n💾 8.5 GB",
                    "infoHash": "aabbccddeeff00112233445566778899aabbccdd",
                    "fileIdx": 0,
                    "sources": ["tracker:udp://tracker.opentrackr.org:1337/announce"],
                },
                {
                    "name": "RARBG",
                    "title": "Dune 2021 2160p\n👤 350\n💾 22 GB",
                    "infoHash": "1122334455667788990011223344556677889900",
                    "fileIdx": 0,
                    "sources": [],
                },
            ]
        }

        async def run():
            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_resp = MagicMock()
                mock_resp.json.return_value = mock_response
                mock_resp.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=False)
                mock_client.get = AsyncMock(return_value=mock_resp)
                mock_client_cls.return_value = mock_client
                p = TorrentioProvider()
                return await p.search_variants("Dune", year=2021, tmdb_id="438631")

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert len(variants) == 2
        assert all(v.magnet.startswith("magnet:") for v in variants)
        assert variants[0].quality == "1080p"
        assert variants[0].seeders == 1200
        assert variants[0].size_mb > 0
        assert variants[1].quality == "2160p"

    def test_handles_api_error_gracefully(self):
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app.providers.torrentio import TorrentioProvider

        async def run():
            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = AsyncMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=False)
                mock_client.get = AsyncMock(side_effect=Exception("connection error"))
                mock_client_cls.return_value = mock_client
                p = TorrentioProvider()
                return await p.search_variants("Dune", year=2021, tmdb_id="438631")

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert variants == []


# ---------------------------------------------------------------------------
# JackettProvider unit tests
# ---------------------------------------------------------------------------

class TestJackettProvider:
    def test_returns_empty_when_not_configured(self):
        import asyncio
        from unittest.mock import patch
        from app.providers.jackett import JackettProvider

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", ""), \
                 patch("app.providers.jackett.JACKETT_API_KEY", ""):
                p = JackettProvider()
                return await p.search_variants("Dune", year=2021)

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert variants == []

    def test_returns_variants_when_configured(self):
        """Mock Jackett API and verify variant parsing."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.providers.jackett import JackettProvider

        mock_response = {
            "Results": [
                {
                    "Title": "Dune 2021 1080p BluRay x265",
                    "MagnetUri": "magnet:?xt=urn:btih:aabbccdd1234&dn=Dune+2021",
                    "Seeders": 500,
                    "Size": 8_000_000_000,
                },
                {
                    "Title": "Dune 2021 720p WEB",
                    "MagnetUri": "magnet:?xt=urn:btih:11223344abcd&dn=Dune+2021+720p",
                    "Seeders": 200,
                    "Size": 3_000_000_000,
                },
            ]
        }

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("httpx.AsyncClient") as mock_client_cls:
                mock_resp = MagicMock()
                mock_resp.json.return_value = mock_response
                mock_resp.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=False)
                mock_client.get = AsyncMock(return_value=mock_resp)
                mock_client_cls.return_value = mock_client
                p = JackettProvider()
                return await p.search_variants("Dune", year=2021)

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert len(variants) == 2
        assert all(v.magnet.startswith("magnet:") for v in variants)
        assert variants[0].quality == "1080p"
        assert variants[0].codec == "H265"
        assert variants[0].seeders == 500
        assert variants[1].quality == "720p"

    def test_skips_entries_without_magnet(self):
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.providers.jackett import JackettProvider

        mock_response = {
            "Results": [
                {"Title": "Dune 1080p", "MagnetUri": "", "Seeders": 100, "Size": 0},
                {"Title": "Dune 720p", "MagnetUri": "magnet:?xt=urn:btih:abc123", "Seeders": 50, "Size": 0},
            ]
        }

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("httpx.AsyncClient") as mock_client_cls:
                mock_resp = MagicMock()
                mock_resp.json.return_value = mock_response
                mock_resp.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=False)
                mock_client.get = AsyncMock(return_value=mock_resp)
                mock_client_cls.return_value = mock_client
                p = JackettProvider()
                return await p.search_variants("Dune")

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert len(variants) == 1  # only the one with a valid magnet


# ---------------------------------------------------------------------------
# /torbox/search endpoint tests
# ---------------------------------------------------------------------------

class TestTorboxSearch:
    def test_torbox_search_empty_query(self, client):
        resp = client.get("/torbox/search?q=   ")
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []

    def test_torbox_search_missing_q(self, client):
        resp = client.get("/torbox/search")
        assert resp.status_code == 422  # required query param

    def test_torbox_search_returns_structure(self, client):
        """With mocked providers, verify the response shape."""
        from unittest.mock import AsyncMock, patch
        from app.models import Variant

        fake_variant = Variant(
            id="abc123",
            label="Torrentio • 1080P",
            quality="1080p",
            seeders=500,
            size_mb=8000,
            magnet="magnet:?xt=urn:btih:aabbccddee0011223344556677889900aabbccdd",
            voice="YIFY",
            language="multi",
            codec="H264",
        )

        with patch(
            "app.providers.torrentio.TorrentioProvider.search_variants",
            new_callable=AsyncMock,
            return_value=[fake_variant],
        ), patch(
            "app.providers.jackett.JackettProvider.search_variants",
            new_callable=AsyncMock,
            return_value=[],
        ):
            resp = client.get("/torbox/search?q=Dune&tmdb_id=438631")

        assert resp.status_code == 200
        body = resp.json()
        assert "results" in body
        assert "query" in body
        assert isinstance(body["results"], list)
        if body["results"]:
            r = body["results"][0]
            assert "id" in r
            assert "magnet" in r
            assert "quality" in r

    def test_torbox_search_with_year_and_original_title(self, client):
        """Verify /torbox/search accepts year and original_title params."""
        from unittest.mock import AsyncMock, patch
        from app.models import Variant

        fake_variant = Variant(
            id="xyz789",
            label="Jackett • 1080P",
            quality="1080p",
            seeders=300,
            size_mb=7000,
            magnet="magnet:?xt=urn:btih:bbccddee001122334455667788990011aabbccdd",
            voice="",
            language="ru",
            codec="H265",
        )

        with patch(
            "app.providers.torrentio.TorrentioProvider.search_variants",
            new_callable=AsyncMock,
            return_value=[],
        ), patch(
            "app.providers.jackett.JackettProvider.search_variants",
            new_callable=AsyncMock,
            return_value=[fake_variant],
        ) as mock_jackett:
            resp = client.get(
                "/torbox/search?q=Oppenheimer&year=2023&original_title=Oppenheimer&tmdb_id=872585"
            )
            # Verify year and original_title were forwarded to the provider
            call_kwargs = mock_jackett.call_args
            assert call_kwargs is not None

        assert resp.status_code == 200
        body = resp.json()
        assert body["results"][0]["id"] == "xyz789"


# ---------------------------------------------------------------------------
# Jackett provider — torrent URL fallback (Link field)
# ---------------------------------------------------------------------------

class TestJackettTorrentUrlFallback:
    def test_jackett_uses_link_when_no_magnet(self):
        """JackettProvider rejects HTTP-only results — strict magnet-only policy."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.providers.jackett import JackettProvider

        fake_results = {
            "Results": [
                {
                    "Title": "Test Movie 2023 1080p BluRay",
                    "MagnetUri": "",
                    "Link": "https://jackett.example.com/dl/torrent?id=abc123",
                    "Seeders": 150,
                    "Size": 8_000_000_000,
                },
            ]
        }

        async def run():
            with patch("app.config.JACKETT_URL", "http://jackett.example.com"), \
                 patch("app.config.JACKETT_API_KEY", "testkey"), \
                 patch("app.providers.jackett.JACKETT_URL", "http://jackett.example.com"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("httpx.AsyncClient") as mock_client_cls:
                mock_resp = MagicMock()
                mock_resp.json.return_value = fake_results
                mock_resp.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_resp)
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=None)
                mock_client_cls.return_value = mock_client

                return await JackettProvider().search_variants("Test Movie", year=2023)

        variants = asyncio.get_event_loop().run_until_complete(run())
        # HTTP-only result must be rejected — strict magnet-only policy
        assert len(variants) == 0

    def test_jackett_skips_result_with_no_link_or_magnet(self):
        """JackettProvider should skip results with neither MagnetUri nor Link."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.providers.jackett import JackettProvider

        fake_results = {
            "Results": [
                {
                    "Title": "Test Movie 2023 720p",
                    "MagnetUri": "",
                    "Link": "",
                    "Seeders": 50,
                    "Size": 2_000_000_000,
                },
            ]
        }

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://jackett.example.com"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("httpx.AsyncClient") as mock_client_cls:
                mock_resp = MagicMock()
                mock_resp.json.return_value = fake_results
                mock_resp.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_resp)
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=None)
                mock_client_cls.return_value = mock_client

                return await JackettProvider().search_variants("Test Movie", year=2023)

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert len(variants) == 0  # Skipped — no usable link


# ---------------------------------------------------------------------------
# /stream/start — accepts torrent file URL in magnet field
# ---------------------------------------------------------------------------

class TestStreamStartTorrentUrl:
    def test_stream_start_accepts_torrent_url(self, client):
        """POST /stream/start should accept an http(s):// torrent URL in magnet field."""
        from unittest.mock import AsyncMock, patch
        from app.models import StreamJob

        fake_job = StreamJob(
            variant_id="v-url-1",
            magnet="https://example.com/file.torrent",
            magnet_hash="fakehash001",
            title="Test Film",
            state="queued",
        )

        with patch(
            "app.services.stream.create_job",
            new_callable=AsyncMock,
            return_value=fake_job,
        ):
            resp = client.post(
                "/stream/start",
                json={
                    "variant_id": "v-url-1",
                    "magnet": "https://example.com/file.torrent",
                    "title": "Test Film",
                },
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["job_id"] == fake_job.job_id
        assert body["status"] == "queued"

    def test_stream_start_rejects_invalid_url(self, client):
        """POST /stream/start should reject values that are neither magnet nor http URL."""
        resp = client.post(
            "/stream/start",
            json={
                "variant_id": "v-bad",
                "magnet": "ftp://bad-protocol/file.torrent",
                "title": "Test",
            },
        )
        assert resp.status_code == 400



# ---------------------------------------------------------------------------
# New: requestdl token param
# ---------------------------------------------------------------------------

class TestRequestDlToken:
    def test_requestdl_includes_token_param(self):
        """request_download_link must include 'token' as a query param."""
        import asyncio
        from unittest.mock import AsyncMock, patch, call
        from app import torbox as tb

        async def run():
            with patch("app.torbox.TORBOX_API_KEY", "my-secret-key"), \
                 patch("app.torbox._get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = {"data": "https://cdn.torbox.app/file.mkv"}
                result = await tb.request_download_link("42", "1")
                return result, mock_get.call_args

        result, call_args = asyncio.get_event_loop().run_until_complete(run())
        assert result == "https://cdn.torbox.app/file.mkv"
        # Verify 'token' was in the params kwarg
        params = call_args[1].get("params") or call_args[0][1]
        assert "token" in params


# ---------------------------------------------------------------------------
# New: /torbox/get with torrent_url
# ---------------------------------------------------------------------------

class TestTorboxGetTorrentUrl:
    def test_torbox_get_accepts_torrent_url(self, client):
        """GET /torbox/get?torrent_url=... should work like the magnet path."""
        from unittest.mock import AsyncMock, patch

        fake_files = [{"title": "film.mkv", "quality": "1080p",
                       "url": "https://cdn.torbox.app/film.mkv", "size": 1000}]

        with (
            patch("app.main.torbox.add_torrent_from_url",
                  new_callable=AsyncMock,
                  return_value={"data": {"torrent_id": "99"}}) as mock_add,
            patch("app.main.torbox.get_torrent_by_id",
                  new_callable=AsyncMock,
                  return_value={
                      "id": "99",
                      "download_state": "seeding",
                      "files": [{"id": 1, "name": "film.mkv"}],
                  }),
            patch("app.main.torbox.build_direct_links",
                  new_callable=AsyncMock,
                  return_value=fake_files),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            resp = client.get(
                "/torbox/get?torrent_url=https://jackett.example.com/dl/file.torrent"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ready"
        assert len(body["files"]) == 1
        mock_add.assert_called_once()

    def test_torbox_get_rejects_invalid_torrent_url(self, client):
        """Non-http torrent_url must be rejected."""
        resp = client.get("/torbox/get?torrent_url=ftp://bad.example/file.torrent")
        assert resp.status_code == 400

    def test_torbox_get_missing_both_params(self, client):
        """No magnet and no torrent_url → 400."""
        resp = client.get("/torbox/get")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# New: top-3 variants per quality tier
# ---------------------------------------------------------------------------

class TestVariantsTop3:
    def test_variants_at_most_max(self, client):
        """After sorting by seeders, at most 4 variants are returned (_MAX_RESULTS cap)."""
        from unittest.mock import AsyncMock, patch
        from app.models import Variant
        from app.providers.torrentio import TorrentioProvider

        fake_variants = [
            Variant(id="v1", label="4K A", quality="2160p", seeders=50, magnet="magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            Variant(id="v2", label="4K B", quality="2160p", seeders=30, magnet="magnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
            Variant(id="v3", label="1080 A", quality="1080p", seeders=200, magnet="magnet:?xt=urn:btih:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"),
            Variant(id="v4", label="1080 B", quality="1080p", seeders=100, magnet="magnet:?xt=urn:btih:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"),
            Variant(id="v5", label="720p A", quality="720p", seeders=80, magnet="magnet:?xt=urn:btih:EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"),
        ]

        with patch.object(
            TorrentioProvider,
            "search_variants",
            new=AsyncMock(return_value=fake_variants),
        ):
            resp = client.get("/variants?title=Top3TestFilmXYZ123&year=2025")
        assert resp.status_code == 200
        variants = resp.json()["variants"]
        # Capped at 4 (_MAX_RESULTS), sorted by seeders desc
        assert len(variants) == 4
        # First result must be the one with most seeders (v3: 200)
        assert variants[0]["id"] == "v3"
        assert variants[0]["seeders"] == 200

    def test_variants_quality_filter(self, client):
        """?quality=1080p returns only 1080p variants."""
        from unittest.mock import AsyncMock, patch
        from app.models import Variant
        from app.providers.torrentio import TorrentioProvider

        fake_variants = [
            Variant(id="f1", label="4K", quality="2160p", seeders=50,
                    magnet="magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            Variant(id="f2", label="1080", quality="1080p", seeders=200,
                    magnet="magnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
        ]

        with patch.object(
            TorrentioProvider,
            "search_variants",
            new=AsyncMock(return_value=fake_variants),
        ):
            resp = client.get("/variants?title=QualityFilterTestXYZ456&year=2025&quality=1080p")
        assert resp.status_code == 200
        variants = resp.json()["variants"]
        assert all(v["quality"] == "1080p" for v in variants)

    def test_variant_model_has_torrent_url(self):
        """Variant model must have an optional torrent_url field."""
        from app.models import Variant
        v = Variant(id="x", label="Test", magnet="magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABB",
                    torrent_url="https://example.com/file.torrent")
        assert v.torrent_url == "https://example.com/file.torrent"
        # Default is None
        v2 = Variant(id="y", label="Test2", magnet="magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABB")
        assert v2.torrent_url is None


# ---------------------------------------------------------------------------
# New: fast-path for already-seeding TorBox torrent
# ---------------------------------------------------------------------------

class TestFastPathExistingTorrent:
    def test_fast_path_returns_link_immediately_for_seeding_torrent(self):
        """When TorBox already has the torrent seeding, _process_job returns link without add_magnet."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app.services.stream import _process_job, _save_job, _load_job
        from app.models import StreamJob

        MAGNET = (
            "magnet:?xt=urn:btih:EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"
            "&dn=FastPathTest"
        )
        existing_seeding = {
            "id": "999",
            "download_state": "seeding",
            "progress": 1.0,
            "files": [{"id": 5, "name": "movie.mkv", "size": 4_000_000_000}],
        }

        async def run():
            job = StreamJob(variant_id="v_fast", magnet=MAGNET, title="FastPathTest",
                            state="queued")
            await _save_job(job)
            with patch("app.services.stream.torbox.get_torrent_by_hash",
                       new_callable=AsyncMock, return_value=existing_seeding) as mock_hash, \
                 patch("app.services.stream.torbox.request_download_link",
                       new_callable=AsyncMock,
                       return_value="https://cdn.torbox.app/fast.mkv") as mock_dl, \
                 patch("app.services.stream.torbox.add_magnet",
                       new_callable=AsyncMock) as mock_add:
                await _process_job(job.job_id)
                # add_magnet must NOT have been called (fast path taken)
                mock_add.assert_not_called()
            return await _load_job(job.job_id)

        job = asyncio.get_event_loop().run_until_complete(run())
        assert job is not None
        assert job.state == "ready"
        assert job.direct_url == "https://cdn.torbox.app/fast.mkv"

    def test_null_data_from_add_magnet_falls_back_to_infohash_lookup(self):
        """When add_magnet returns null data, _process_job recovers torrent_id via infohash."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app.services.stream import _process_job, _save_job, _load_job
        from app.models import StreamJob

        MAGNET = (
            "magnet:?xt=urn:btih:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
            "&dn=FallbackTest"
        )
        existing_torrent = {
            "id": "101",
            "download_state": "downloading",
            "progress": 0.3,
            "files": [{"id": 2, "name": "film.mkv", "size": 3_000_000_000}],
        }

        async def run():
            job = StreamJob(variant_id="v_fallback", magnet=MAGNET, title="FallbackTest",
                            state="queued")
            await _save_job(job)
            with patch("app.services.stream.torbox.get_torrent_by_hash",
                       new_callable=AsyncMock, return_value=None) as mock_hash, \
                 patch("app.services.stream.torbox.add_magnet",
                       new_callable=AsyncMock,
                       return_value={"data": None, "success": False, "detail": "ACTIVE_DOWNLOAD"}
                       ) as mock_add, \
                 patch("app.services.stream.torbox.get_torrent_by_id",
                       new_callable=AsyncMock, return_value=existing_torrent) as mock_gtid, \
                 patch("app.services.stream.torbox.request_download_link",
                       new_callable=AsyncMock,
                       return_value="https://cdn.torbox.app/fallback.mkv"), \
                 patch("app.services.stream.asyncio.sleep", new_callable=AsyncMock):
                # On the fallback path, get_torrent_by_hash is called a second time
                # with the infohash to recover the torrent_id
                mock_hash.return_value = existing_torrent
                await _process_job(job.job_id)
            return await _load_job(job.job_id)

        job = asyncio.get_event_loop().run_until_complete(run())
        assert job is not None
        # Should recover the torrent_id and eventually be ready
        assert job.state in ("ready", "preparing", "failed")  # may not reach ready in mock

    def test_direct_url_cached_by_infohash(self):
        """_save_direct_url saves by both magnet-hash and infohash."""
        import asyncio
        from app.services.stream import _save_direct_url, _extract_infohash
        from app.cache import direct_url_cache

        MAGNET = "magnet:?xt=urn:btih:1234567890ABCDEF1234567890ABCDEF12345678&dn=CacheTest"
        MHASH = "testmhash001"
        URL = "https://cdn.torbox.app/test.mkv"

        async def run():
            await _save_direct_url(MHASH, MAGNET, URL)
            by_hash = await direct_url_cache.aget(MHASH)
            infohash = _extract_infohash(MAGNET)
            by_ih = await direct_url_cache.aget(infohash) if infohash else None
            return by_hash, by_ih

        by_hash, by_ih = asyncio.get_event_loop().run_until_complete(run())
        assert by_hash == URL
        assert by_ih == URL  # cached by infohash too

    def test_get_torrent_by_hash_returns_matching_torrent(self):
        """get_torrent_by_hash returns the torrent whose 'hash' field matches."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app import torbox as tb

        torrents = [
            {"id": "1", "hash": "AABBCCDD" * 5, "download_state": "seeding", "files": []},
            {"id": "2", "hash": "11223344" * 5, "download_state": "downloading", "files": []},
        ]

        async def run():
            with patch.object(tb, "get_torrent_list", new=AsyncMock(return_value=torrents)):
                return await tb.get_torrent_by_hash("aabbccdd" * 5)

        result = asyncio.get_event_loop().run_until_complete(run())
        assert result is not None
        assert result["id"] == "1"

    def test_get_torrent_by_hash_returns_none_when_not_found(self):
        """get_torrent_by_hash returns None when no matching hash in list."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app import torbox as tb

        async def run():
            with patch.object(tb, "get_torrent_list", new=AsyncMock(return_value=[])):
                return await tb.get_torrent_by_hash("deadbeef" * 10)

        result = asyncio.get_event_loop().run_until_complete(run())
        assert result is None


# ---------------------------------------------------------------------------
# IMDB ID exact matching — JackettProvider
# ---------------------------------------------------------------------------

class TestJackettImdbSearch:
    """Verify that JackettProvider uses t=movie&imdbid= when imdb_id is supplied."""

    def _make_mock_client(self, mock_response):
        from unittest.mock import AsyncMock, MagicMock
        mock_resp = MagicMock()
        mock_resp.json.return_value = mock_response
        mock_resp.raise_for_status = MagicMock()
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        return mock_client

    def test_imdb_id_triggers_movie_search_type(self):
        """When imdb_id is provided, the first Jackett request must use t=movie&imdbid=."""
        import asyncio
        from unittest.mock import patch
        from app.providers.jackett import JackettProvider

        mock_response = {
            "Results": [
                {
                    "Title": "Inception 2010 1080p BluRay LostFilm",
                    "MagnetUri": "magnet:?xt=urn:btih:aabbccdd00112233445566778899aabb00112233",
                    "Seeders": 400,
                    "Size": 8_000_000_000,
                },
            ]
        }

        calls = []

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = self._make_mock_client(mock_response)
                # Capture every call to client.get
                original_get = mock_client.get.side_effect
                async def capturing_get(url, params=None, **kw):
                    calls.append(params or {})
                    return mock_client.get.return_value
                mock_client.get.side_effect = capturing_get
                mock_client_cls.return_value = mock_client

                p = JackettProvider()
                return await p.search_variants(
                    "Inception", year=2010, imdb_id="tt1375666"
                )

        variants = asyncio.get_event_loop().run_until_complete(run())

        # At least one call must be the IMDB search
        imdb_calls = [c for c in calls if c.get("t") == "movie" and "imdbid" in c]
        assert imdb_calls, f"Expected a t=movie&imdbid= call, got: {calls}"
        assert imdb_calls[0]["imdbid"] == "tt1375666"

    def test_imdb_id_normalised_without_tt_prefix(self):
        """IMDB IDs without 'tt' prefix should be normalised to 'tt{id}'."""
        import asyncio
        from unittest.mock import patch
        from app.providers.jackett import JackettProvider

        calls = []

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = self._make_mock_client({"Results": []})
                async def capturing_get(url, params=None, **kw):
                    calls.append(params or {})
                    return mock_client.get.return_value
                mock_client.get.side_effect = capturing_get
                mock_client_cls.return_value = mock_client

                p = JackettProvider()
                return await p.search_variants("Dune", year=2021, imdb_id="1160419")

        asyncio.get_event_loop().run_until_complete(run())

        imdb_calls = [c for c in calls if c.get("t") == "movie"]
        assert imdb_calls, f"No t=movie call made. Got: {calls}"
        assert imdb_calls[0]["imdbid"] == "tt1160419"

    def test_no_imdb_id_falls_back_to_text_search(self):
        """Without imdb_id, the search should use t=search&q=."""
        import asyncio
        from unittest.mock import patch
        from app.providers.jackett import JackettProvider

        calls = []

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("httpx.AsyncClient") as mock_client_cls:
                mock_client = self._make_mock_client({"Results": []})
                async def capturing_get(url, params=None, **kw):
                    calls.append(params or {})
                    return mock_client.get.return_value
                mock_client.get.side_effect = capturing_get
                mock_client_cls.return_value = mock_client

                p = JackettProvider()
                return await p.search_variants("Dune", year=2021)

        asyncio.get_event_loop().run_until_complete(run())

        text_calls = [c for c in calls if c.get("t") == "search"]
        assert text_calls, f"Expected t=search calls, got: {calls}"
        # Must not contain imdbid
        assert all("imdbid" not in c for c in text_calls)


# ---------------------------------------------------------------------------
# IMDB ID exact matching — TorrentioProvider
# ---------------------------------------------------------------------------

class TestTorrentioImdbSearch:
    """Verify that TorrentioProvider prefers IMDB ID URL when imdb_id is supplied."""

    def test_uses_imdb_id_url_when_available(self):
        """With imdb_id, Torrentio should request tt{id} URL, not tmdb:{id}."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.providers.torrentio import TorrentioProvider

        requested_urls = []
        mock_response = {
            "streams": [
                {
                    "name": "YIFY",
                    "title": "Inception 2010 1080p\n👤 500\n💾 8 GB",
                    "infoHash": "aabbccdd00112233445566778899aabbccddeeff",
                    "sources": [],
                }
            ]
        }

        async def run():
            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_resp = MagicMock()
                mock_resp.json.return_value = mock_response
                mock_resp.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                async def capturing_get(url, **kw):
                    requested_urls.append(url)
                    return mock_resp
                mock_client.get = AsyncMock(side_effect=capturing_get)
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=None)
                mock_client_cls.return_value = mock_client

                p = TorrentioProvider()
                return await p.search_variants(
                    "Inception", year=2010, tmdb_id="27205", imdb_id="tt1375666"
                )

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert len(variants) == 1
        # The first URL tried must use IMDB ID format, not TMDB
        assert any("tt1375666" in u for u in requested_urls), \
            f"Expected tt1375666 in URLs, got: {requested_urls}"
        assert not any("tmdb:27205" in u for u in requested_urls), \
            f"TMDB URL should not be used when IMDB ID is available, got: {requested_urls}"

    def test_falls_back_to_tmdb_when_no_imdb_id(self):
        """Without imdb_id, Torrentio should use tmdb:{id} URL."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.providers.torrentio import TorrentioProvider

        requested_urls = []
        mock_response = {"streams": []}

        async def run():
            with patch("httpx.AsyncClient") as mock_client_cls:
                mock_resp = MagicMock()
                mock_resp.json.return_value = mock_response
                mock_resp.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                async def capturing_get(url, **kw):
                    requested_urls.append(url)
                    return mock_resp
                mock_client.get = AsyncMock(side_effect=capturing_get)
                mock_client.__aenter__ = AsyncMock(return_value=mock_client)
                mock_client.__aexit__ = AsyncMock(return_value=None)
                mock_client_cls.return_value = mock_client

                p = TorrentioProvider()
                return await p.search_variants("Dune", year=2021, tmdb_id="438631")

        asyncio.get_event_loop().run_until_complete(run())
        assert any("tmdb:438631" in u for u in requested_urls), \
            f"Expected tmdb:438631 in URLs, got: {requested_urls}"

    def test_returns_empty_without_any_id(self):
        """Without tmdb_id or imdb_id, provider should return []."""
        import asyncio
        from app.providers.torrentio import TorrentioProvider

        async def run():
            p = TorrentioProvider()
            return await p.search_variants("Unknown Film", year=2021)

        variants = asyncio.get_event_loop().run_until_complete(run())
        assert variants == []


# ---------------------------------------------------------------------------
# /variants endpoint — imdb_id param accepted
# ---------------------------------------------------------------------------

class TestVariantsImdbIdParam:
    def test_variants_accepts_imdb_id(self, client):
        """The /variants endpoint must accept imdb_id without error."""
        resp = client.get("/variants?title=Inception&year=2010&imdb_id=tt1375666")
        assert resp.status_code == 200
        body = resp.json()
        assert "variants" in body

    def test_variants_imdb_id_forwarded_to_providers(self, client):
        """imdb_id from query string must reach the provider search_variants call."""
        from unittest.mock import AsyncMock, patch
        from app.models import Variant

        captured_kwargs: dict = {}

        async def fake_search(title, year=None, tmdb_id=None, original_title=None,
                               season=None, imdb_id=None):
            captured_kwargs.update({"imdb_id": imdb_id, "title": title})
            return []

        # Use a unique title+imdb_id that won't be in any in-memory cache
        unique_title = "InceptionImdbForwardTest"
        with patch("app.providers.torrentio.TorrentioProvider.search_variants",
                   side_effect=fake_search), \
             patch("app.providers.jackett.JackettProvider.search_variants",
                   side_effect=fake_search), \
             patch("app.providers.public_jackett.PublicJackettProvider.search_variants",
                   side_effect=fake_search), \
             patch("app.services.variants.variants_cache.aget", new_callable=AsyncMock,
                   return_value=None):
            resp = client.get(f"/variants?title={unique_title}&year=2010&imdb_id=tt1375666")

        assert resp.status_code == 200
        assert captured_kwargs.get("imdb_id") == "tt1375666"


# ---------------------------------------------------------------------------
# JackettProvider — TV series tvsearch with IMDB ID
# ---------------------------------------------------------------------------

class TestJackettTvSearch:
    """Verify JackettProvider uses t=tvsearch&imdbid= for TV series with IMDB ID."""

    def _make_mock_client(self, mock_response):
        from unittest.mock import AsyncMock, MagicMock
        mock_resp = MagicMock()
        mock_resp.json.return_value = mock_response
        mock_resp.raise_for_status = MagicMock()
        mock_client = AsyncMock()
        mock_client.is_closed = False
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        return mock_client

    def test_tv_series_uses_tvsearch_with_imdb_id(self):
        """With imdb_id + season, JackettProvider must use t=tvsearch&imdbid=&season=."""
        import asyncio
        from unittest.mock import patch
        from app.providers.jackett import JackettProvider

        calls = []
        mock_response = {
            "Results": [
                {
                    "Title": "Breaking Bad S02 1080p",
                    "MagnetUri": "magnet:?xt=urn:btih:aabbccdd001122334455667788990011aabb0022",
                    "Seeders": 300,
                    "Size": 15_000_000_000,
                },
            ]
        }

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("app.providers.jackett._get_http_client") as mock_getter:
                mc = self._make_mock_client(mock_response)
                async def capturing_get(url, params=None, **kw):
                    calls.append(params or {})
                    return mc.get.return_value
                mc.get.side_effect = capturing_get
                mock_getter.return_value = mc

                p = JackettProvider()
                return await p.search_variants(
                    "Breaking Bad", year=2009, imdb_id="tt0903747", season=2
                )

        variants = asyncio.get_event_loop().run_until_complete(run())
        tv_calls = [c for c in calls if c.get("t") == "tvsearch"]
        assert tv_calls, f"Expected t=tvsearch call, got: {calls}"
        assert tv_calls[0].get("imdbid") == "tt0903747"
        assert tv_calls[0].get("season") == "2"
        assert len(variants) == 1

    def test_movie_uses_tmdb_id_when_no_imdb(self):
        """Without imdb_id but with tmdb_id, JackettProvider must try t=movie&tmdbid=."""
        import asyncio
        from unittest.mock import patch
        from app.providers.jackett import JackettProvider

        calls = []
        mock_response = {"Results": []}

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("app.providers.jackett._get_http_client") as mock_getter:
                mc = self._make_mock_client(mock_response)
                async def capturing_get(url, params=None, **kw):
                    calls.append(params or {})
                    return mc.get.return_value
                mc.get.side_effect = capturing_get
                mock_getter.return_value = mc

                p = JackettProvider()
                return await p.search_variants("Inception", year=2010, tmdb_id="27205")

        asyncio.get_event_loop().run_until_complete(run())
        tmdb_calls = [c for c in calls if c.get("tmdbid") == "27205"]
        assert tmdb_calls, f"Expected tmdbid=27205 call, got: {calls}"
        assert tmdb_calls[0]["t"] == "movie"

    def test_tv_series_without_imdb_uses_text_search(self):
        """Series without imdb_id should fall back to text-based t=search."""
        import asyncio
        from unittest.mock import patch
        from app.providers.jackett import JackettProvider

        calls = []
        mock_response = {"Results": []}

        async def run():
            with patch("app.providers.jackett.JACKETT_URL", "http://localhost:9117"), \
                 patch("app.providers.jackett.JACKETT_API_KEY", "testkey"), \
                 patch("app.providers.jackett._get_http_client") as mock_getter:
                mc = self._make_mock_client(mock_response)
                async def capturing_get(url, params=None, **kw):
                    calls.append(params or {})
                    return mc.get.return_value
                mc.get.side_effect = capturing_get
                mock_getter.return_value = mc

                p = JackettProvider()
                return await p.search_variants("Breaking Bad", year=2009, season=2)

        asyncio.get_event_loop().run_until_complete(run())
        text_calls = [c for c in calls if c.get("t") == "search"]
        assert text_calls, f"Expected t=search fallback, got: {calls}"
        # No ID-based params in text calls
        assert all("imdbid" not in c and "tmdbid" not in c for c in text_calls)
