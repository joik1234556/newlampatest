"""TorBox API client."""
from __future__ import annotations

import logging
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import TORBOX_API_KEY, TORBOX_BASE_URL

logger = logging.getLogger(__name__)

_HEADERS = {"Authorization": f"Bearer {TORBOX_API_KEY}"}


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(headers=_HEADERS, timeout=30)


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=5))
async def _get(path: str, params: dict | None = None) -> Any:
    async with _client() as client:
        resp = await client.get(f"{TORBOX_BASE_URL}{path}", params=params)
        resp.raise_for_status()
        return resp.json()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=5))
async def _post(path: str, data: dict | None = None) -> Any:
    async with _client() as client:
        resp = await client.post(f"{TORBOX_BASE_URL}{path}", data=data)
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_user_info() -> dict:
    """Return current TorBox user info (used as a health-check)."""
    return await _get("/user/me")


async def get_torrent_list() -> list[dict]:
    """Return list of user's torrents."""
    result = await _get("/torrents/mylist")
    return result.get("data", [])


async def add_magnet(magnet: str) -> dict:
    """Add a magnet link to TorBox and return the created torrent record."""
    result = await _post("/torrents/createtorrent", data={"magnet": magnet})
    logger.info("TorBox createtorrent response: %s", result)
    return result


async def request_download_link(torrent_id: int | str, file_id: int | str) -> str | None:
    """Request a direct download URL for a file inside a torrent."""
    result = await _get(
        "/torrents/requestdl",
        params={"torrent_id": str(torrent_id), "file_id": str(file_id)},
    )
    logger.info("TorBox requestdl response: %s", result)
    return result.get("data")


async def check_cached(infohash: str) -> bool:
    """Check whether a torrent is already cached in TorBox."""
    try:
        result = await _get("/torrents/checkcached", params={"infohash": infohash})
        data = result.get("data", {})
        if isinstance(data, dict):
            return data.get(infohash, False)
        return bool(data)
    except Exception as exc:
        logger.warning("TorBox checkcached error: %s", exc)
        return False


async def get_torrent_by_id(torrent_id: int | str) -> dict | None:
    """Return a single torrent record from mylist by id."""
    try:
        torrents = await get_torrent_list()
        for t in torrents:
            if str(t.get("id")) == str(torrent_id):
                return t
    except Exception as exc:
        logger.error("TorBox get_torrent_by_id error: %s", exc)
    return None
