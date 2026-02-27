"""Tests for Easy-Mod endpoints: /health, /variants, /stream/start, /stream/status."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("TORBOX_API_KEY", "test-key-dummy")

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

    def test_variants_sorted_by_quality(self, client):
        resp = client.get("/variants?title=Test+Movie")
        assert resp.status_code == 200
        variants = resp.json()["variants"]
        quality_order = {"360p": 0, "480p": 1, "720p": 2, "1080p": 3, "2160p": 4, "4k": 4}
        if len(variants) >= 2:
            q0 = quality_order.get(variants[0]["quality"].lower(), 2)
            q1 = quality_order.get(variants[1]["quality"].lower(), 2)
            assert q0 >= q1  # descending

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
            with patch("app.services.stream.torbox.add_magnet", side_effect=retry_err):
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

