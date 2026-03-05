"""Unit tests for Lampa backend."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient

# Provide a dummy API key so the app starts without error
import os
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

class TestHealth:
    def test_health_returns_ok(self, client):
        with patch("app.main.torbox.get_user_info", new_callable=AsyncMock) as mock_info:
            mock_info.return_value = {"email": "test@example.com"}
            resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert "torbox" in body

    def test_health_torbox_error(self, client):
        with patch("app.main.torbox.get_user_info", new_callable=AsyncMock) as mock_info:
            mock_info.side_effect = Exception("connection refused")
            resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["torbox"]["connected"] is False


# ---------------------------------------------------------------------------
# /search
# ---------------------------------------------------------------------------

class TestSearch:
    def test_search_empty_query_returns_empty(self, client):
        resp = client.get("/search?q=   ")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_search_returns_results(self, client):
        fake_kinogo = [{"title": "Фильм 1", "year": "2022", "poster": "", "url": "http://k/1", "source": "kinogo"}]
        fake_rezka = [{"title": "Фильм 2", "year": "2023", "poster": "", "url": "http://r/2", "source": "rezka"}]

        with (
            patch("app.main.kinogo.search", new_callable=AsyncMock) as mk,
            patch("app.main.rezka.search", new_callable=AsyncMock) as mr,
        ):
            mk.return_value = fake_kinogo
            mr.return_value = fake_rezka
            resp = client.get("/search?q=матрица")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        sources = {item["source"] for item in data}
        assert sources == {"kinogo", "rezka"}

    def test_search_source_filter_kinogo(self, client):
        fake_kinogo = [{"title": "Фильм", "year": None, "poster": "", "url": "http://k/1", "source": "kinogo"}]
        with patch("app.main.kinogo.search", new_callable=AsyncMock) as mk:
            mk.return_value = fake_kinogo
            resp = client.get("/search?q=test&source=kinogo")
        assert resp.status_code == 200
        assert all(r["source"] == "kinogo" for r in resp.json())

    def test_search_partial_error_still_returns(self, client):
        fake_rezka = [{"title": "Фильм", "year": None, "poster": "", "url": "http://r/1", "source": "rezka"}]
        with (
            patch("app.main.kinogo.search", new_callable=AsyncMock) as mk,
            patch("app.main.rezka.search", new_callable=AsyncMock) as mr,
        ):
            mk.side_effect = Exception("kinogo down")
            mr.return_value = fake_rezka
            resp = client.get("/search?q=test")
        assert resp.status_code == 200
        data = resp.json()
        assert any(r["source"] == "rezka" for r in data)


# ---------------------------------------------------------------------------
# /get
# ---------------------------------------------------------------------------

class TestGetDetail:
    def test_get_kinogo(self, client):
        fake_detail = {
            "title": "Фильм",
            "orig_title": None,
            "poster": "",
            "description": "",
            "files": [{"title": "Торрент 1", "quality": "1080p", "url": None, "magnet": "magnet:?xt=urn:btih:abc"}],
        }
        with patch("app.main.kinogo.get_detail", new_callable=AsyncMock) as mk:
            mk.return_value = fake_detail
            resp = client.get("/get?url=http://kinogo.my/film&source=kinogo")
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "Фильм"
        assert "files" in body

    def test_get_rezka(self, client):
        fake_detail = {
            "title": "Сериал",
            "orig_title": "Series",
            "poster": "http://img",
            "description": "desc",
            "files": [],
        }
        with patch("app.main.rezka.get_detail", new_callable=AsyncMock) as mr:
            mr.return_value = fake_detail
            resp = client.get("/get?url=http://rezka.ag/film&source=rezka")
        assert resp.status_code == 200

    def test_get_invalid_source(self, client):
        resp = client.get("/get?url=http://example.com&source=unknown")
        assert resp.status_code == 400

    def test_get_scraper_error(self, client):
        with patch("app.main.kinogo.get_detail", new_callable=AsyncMock) as mk:
            mk.side_effect = Exception("scraper failed")
            resp = client.get("/get?url=http://kinogo.my/film&source=kinogo")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# /easy/direct
# ---------------------------------------------------------------------------

class TestEasyDirect:
    def test_no_params_returns_400(self, client):
        resp = client.get("/easy/direct")
        assert resp.status_code == 400

    def test_torrent_id_file_idx_ready(self, client):
        with patch("app.main.torbox.request_download_link", new_callable=AsyncMock) as mdl:
            mdl.return_value = "https://cdn.torbox.app/file.mkv"
            resp = client.get("/easy/direct?torrent_id=123&file_idx=0")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ready"
        assert body["direct_url"].startswith("https://")

    def test_torrent_id_file_idx_processing(self, client):
        with patch("app.main.torbox.request_download_link", new_callable=AsyncMock) as mdl:
            mdl.return_value = None
            resp = client.get("/easy/direct?torrent_id=456&file_idx=0")
        assert resp.status_code == 202
        assert resp.json()["status"] == "processing"

    def test_torrent_id_file_idx_error(self, client):
        with patch("app.main.torbox.request_download_link", new_callable=AsyncMock) as mdl:
            mdl.side_effect = Exception("TorBox error")
            resp = client.get("/easy/direct?torrent_id=789&file_idx=0")
        assert resp.status_code == 502
        assert resp.json()["status"] == "error"

    def test_magnet_processing(self, client):
        with (
            patch("app.main.torbox.check_cached", new_callable=AsyncMock) as mcc,
            patch("app.main.torbox.add_magnet", new_callable=AsyncMock) as mam,
            patch("app.main.torbox.get_torrent_by_id", new_callable=AsyncMock) as mgt,
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            mcc.return_value = False
            mam.return_value = {"data": {"torrent_id": "999"}}
            mgt.return_value = None  # still processing
            resp = client.get(
                "/easy/direct?magnet=magnet:?xt=urn:btih:aabbccdd1122334455667788990011223344556677"
            )
        # Should be 202 processing
        assert resp.status_code == 202
        assert resp.json()["status"] == "processing"


# ---------------------------------------------------------------------------
# /torbox/search
# ---------------------------------------------------------------------------

class TestTorboxSearch:
    def test_torbox_search_empty_query(self, client):
        resp = client.get("/torbox/search?q=   ")
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []
        assert "message" in body

    def test_torbox_search_returns_structure(self, client):
        resp = client.get("/torbox/search?q=Дюна+2")
        assert resp.status_code == 200
        body = resp.json()
        # Must always have results (list) and message (str)
        assert isinstance(body["results"], list)
        assert isinstance(body["message"], str)
        assert body["query"] == "Дюна 2"

    def test_torbox_search_missing_param(self, client):
        resp = client.get("/torbox/search")
        assert resp.status_code == 422  # Unprocessable Entity — required param missing


# ---------------------------------------------------------------------------
# /torbox/get
# ---------------------------------------------------------------------------

class TestTorboxGet:
    def test_torbox_get_invalid_magnet(self, client):
        resp = client.get("/torbox/get?magnet=not-a-magnet")
        assert resp.status_code == 400

    def test_torbox_get_missing_param(self, client):
        resp = client.get("/torbox/get")
        assert resp.status_code == 400

    def test_torbox_get_ready(self, client):
        fake_files = [{"title": "film.mkv", "quality": "1080p", "url": "https://cdn.torbox.app/film.mkv", "size": 1000}]
        with (
            patch("app.main.torbox.check_cached", new_callable=AsyncMock) as mcc,
            patch("app.main.torbox.add_magnet", new_callable=AsyncMock) as mam,
            patch("app.main.torbox.get_torrent_by_id", new_callable=AsyncMock) as mgt,
            patch("app.main.torbox.build_direct_links", new_callable=AsyncMock) as mbl,
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            mcc.return_value = False
            mam.return_value = {"data": {"torrent_id": "42"}}
            mgt.return_value = {
                "id": "42",
                "download_state": "seeding",
                "files": [{"id": 1, "name": "film.mkv"}],
            }
            mbl.return_value = fake_files
            resp = client.get(
                "/torbox/get?magnet=magnet:?xt=urn:btih:DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ready"
        assert len(body["files"]) == 1
        assert body["files"][0]["url"].startswith("https://")

    def test_torbox_get_processing(self, client):
        with (
            patch("app.main.torbox.check_cached", new_callable=AsyncMock) as mcc,
            patch("app.main.torbox.add_magnet", new_callable=AsyncMock) as mam,
            patch("app.main.torbox.get_torrent_by_id", new_callable=AsyncMock) as mgt,
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            mcc.return_value = False
            mam.return_value = {"data": {"torrent_id": "55"}}
            mgt.return_value = None  # still not in list
            resp = client.get(
                "/torbox/get?magnet=magnet:?xt=urn:btih:DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"
            )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "processing"
        assert body["files"] == []

    def test_torbox_get_add_magnet_error(self, client):
        with (
            patch("app.main.torbox.check_cached", new_callable=AsyncMock) as mcc,
            patch("app.main.torbox.add_magnet", new_callable=AsyncMock) as mam,
        ):
            mcc.return_value = False
            mam.side_effect = Exception("TorBox API error")
            resp = client.get(
                "/torbox/get?magnet=magnet:?xt=urn:btih:DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"
            )
        assert resp.status_code == 502
        body = resp.json()
        assert body["status"] == "error"


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

class TestCORS:
    def test_cors_header_present(self, client):
        resp = client.get("/health", headers={"Origin": "http://lampa.app"})
        assert resp.headers.get("access-control-allow-origin") == "*"


# ---------------------------------------------------------------------------
# Scraper helpers
# ---------------------------------------------------------------------------

class TestExtractInfohash:
    def test_extract_infohash_v1(self):
        from app.main import _extract_infohash
        # SHA1 of empty string (40 hex chars) used as test infohash
        magnet = "magnet:?xt=urn:btih:DA39A3EE5E6B4B0D3255BFEF95601890AFD80709&dn=test"
        ih = _extract_infohash(magnet)
        assert ih == "da39a3ee5e6b4b0d3255bfef95601890afd80709"

    def test_extract_infohash_none(self):
        from app.main import _extract_infohash
        assert _extract_infohash("not a magnet") is None


# ---------------------------------------------------------------------------
# torbox helpers
# ---------------------------------------------------------------------------

class TestTorboxHelpers:
    def test_guess_quality_1080p(self):
        from app.torbox import _guess_quality
        assert _guess_quality("Movie.1080p.BluRay.mkv") == "1080p"

    def test_guess_quality_4k(self):
        from app.torbox import _guess_quality
        assert _guess_quality("Film.4K.HDR.mkv") == "4K"

    def test_guess_quality_unknown(self):
        from app.torbox import _guess_quality
        assert _guess_quality("somefile.avi") == "unknown"


# ---------------------------------------------------------------------------
# /proxy/m3u8
# ---------------------------------------------------------------------------

class TestProxyM3u8:
    def test_proxy_m3u8_success_rewrites_relative_links(self, client):
        m3u8_body = (
            "#EXTM3U\n"
            "#EXT-X-VERSION:3\n"
            "#EXT-X-TARGETDURATION:6\n"
            "#EXTINF:6.0,\n"
            "seg001.ts\n"
            "#EXTINF:6.0,\n"
            "seg002.ts\n"
            "#EXT-X-ENDLIST\n"
        )
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = m3u8_body

        async def mock_get(*args, **kwargs):
            return mock_response

        with patch("app.routers.proxy.httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_instance

            resp = client.get(
                "/proxy/m3u8?url=https://cdn.example.com/hls/master.m3u8"
            )

        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/vnd.apple.mpegurl")
        assert resp.headers.get("access-control-allow-origin") == "*"
        body = resp.text
        # Relative .ts links must be rewritten to absolute CDN URLs
        assert "https://cdn.example.com/hls/seg001.ts" in body
        assert "https://cdn.example.com/hls/seg002.ts" in body

    def test_proxy_m3u8_rejects_ts_segments(self, client):
        resp = client.get(
            "/proxy/m3u8?url=https://cdn.example.com/hls/seg001.ts"
        )
        assert resp.status_code == 400

    def test_proxy_m3u8_upstream_error_returns_502(self, client):
        with patch("app.routers.proxy.httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(side_effect=httpx.RequestError("connect failed", request=None))
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_instance

            resp = client.get(
                "/proxy/m3u8?url=https://cdn.example.com/hls/master.m3u8"
            )
        assert resp.status_code == 502

    def test_proxy_m3u8_upstream_404_propagates(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.text = ""

        with patch("app.routers.proxy.httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_instance

            resp = client.get(
                "/proxy/m3u8?url=https://cdn.example.com/hls/missing.m3u8"
            )
        assert resp.status_code == 404

    def test_proxy_m3u8_absolute_links_unchanged(self, client):
        m3u8_body = (
            "#EXTM3U\n"
            "#EXTINF:6.0,\n"
            "https://other-cdn.example.com/seg001.ts\n"
            "#EXT-X-ENDLIST\n"
        )
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = m3u8_body

        with patch("app.routers.proxy.httpx.AsyncClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_instance

            resp = client.get(
                "/proxy/m3u8?url=https://cdn.example.com/hls/master.m3u8"
            )

        assert resp.status_code == 200
        # Already-absolute links must pass through unchanged
        assert "https://other-cdn.example.com/seg001.ts" in resp.text


# ---------------------------------------------------------------------------
# _rewrite_m3u8 unit tests
# ---------------------------------------------------------------------------

class TestRewriteM3u8:
    def test_relative_ts_becomes_absolute(self):
        from app.routers.proxy import _rewrite_m3u8
        content = "#EXTM3U\n#EXTINF:6.0,\nseg001.ts\n"
        out, count = _rewrite_m3u8(content, "https://cdn.example.com/hls/")
        assert "https://cdn.example.com/hls/seg001.ts" in out
        assert count == 1

    def test_absolute_links_not_counted(self):
        from app.routers.proxy import _rewrite_m3u8
        content = "#EXTM3U\n#EXTINF:6.0,\nhttps://cdn.example.com/seg001.ts\n"
        out, count = _rewrite_m3u8(content, "https://cdn.example.com/hls/")
        assert count == 0

    def test_protocol_relative_rewritten(self):
        from app.routers.proxy import _rewrite_m3u8
        content = "#EXTM3U\n#EXTINF:6.0,\n//cdn.example.com/seg001.ts\n"
        out, count = _rewrite_m3u8(content, "https://cdn.example.com/hls/")
        assert "https://cdn.example.com/seg001.ts" in out
        assert count == 1

    def test_ext_tags_not_rewritten(self):
        from app.routers.proxy import _rewrite_m3u8
        content = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n"
        out, count = _rewrite_m3u8(content, "https://cdn.example.com/hls/")
        assert count == 0
        assert out == content
