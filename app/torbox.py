"""TorBox API client."""
from __future__ import annotations

import logging
import os
from urllib.parse import urlparse
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
        if not resp.is_success:
            logger.error("TorBox GET %s status=%d body=%.300s", path, resp.status_code, resp.text)
        resp.raise_for_status()
        return resp.json()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=5))
async def _post(path: str, data: dict | None = None) -> Any:
    async with _client() as client:
        resp = await client.post(f"{TORBOX_BASE_URL}{path}", data=data)
        if not resp.is_success:
            logger.error("TorBox POST %s status=%d body=%.300s", path, resp.status_code, resp.text)
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


async def add_torrent_from_url(torrent_url: str) -> dict:
    """
    Download a .torrent file from ``torrent_url`` and upload it to TorBox.
    Used as a fallback when Jackett provides a Link instead of a MagnetUri.
    """
    # Validate URL to prevent SSRF — only allow http(s) to public hosts
    _parsed = urlparse(torrent_url)
    if _parsed.scheme not in ("http", "https"):
        raise ValueError(f"torrent_url must use http or https scheme, got: {_parsed.scheme!r}")
    hostname = _parsed.hostname or ""
    if not hostname:
        raise ValueError("torrent_url has no hostname")
    # Block internal/private networks
    import ipaddress
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError(f"torrent_url resolves to a private/internal address: {hostname}")
    except ValueError as exc:
        # Not a raw IP — check for localhost by name
        if hostname.lower() in ("localhost", "127.0.0.1", "::1"):
            raise ValueError(f"torrent_url hostname not allowed: {hostname}") from exc
    logger.info("TorBox add_torrent_from_url url=%.80s", torrent_url)
    async with httpx.AsyncClient(timeout=30) as dl_client:
        # follow_redirects=False prevents redirect-based SSRF
        file_resp = await dl_client.get(torrent_url, follow_redirects=False)
        if file_resp.is_redirect:
            raise ValueError("torrent_url returned a redirect; redirects are not followed for security")
        file_resp.raise_for_status()
        torrent_bytes = file_resp.content

    # Derive a meaningful filename from the URL for easier debugging
    parsed_path = urlparse(torrent_url).path
    filename = os.path.basename(parsed_path) or "file.torrent"
    if not filename.endswith(".torrent"):
        filename += ".torrent"

    async with _client() as upload_client:
        resp = await upload_client.post(
            f"{TORBOX_BASE_URL}/torrents/createtorrent",
            files={"torrent": (filename, torrent_bytes, "application/x-bittorrent")},
        )
        if not resp.is_success:
            logger.error(
                "TorBox upload torrent status=%d body=%.300s", resp.status_code, resp.text
            )
        resp.raise_for_status()
        result = resp.json()
    logger.info("TorBox createtorrent (url upload) response: %s", result)
    return result


async def request_download_link(torrent_id: int | str, file_id: int | str) -> str | None:
    """Request a direct download URL for a file inside a torrent."""
    # TorBox requires the API token both via the Authorization header AND as the
    # ?token= query parameter for the /requestdl endpoint.
    logger.debug("TorBox requestdl using Authorization header + token param")
    result = await _get(
        "/torrents/requestdl",
        params={
            "torrent_id": str(torrent_id),
            "file_id": str(file_id),
            "token": TORBOX_API_KEY,
        },
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


def _guess_quality(name: str) -> str:
    """Guess video quality from a filename or label string."""
    name_lower = name.lower()
    for q in ("2160p", "4k", "1080p", "720p", "480p", "360p"):
        if q in name_lower:
            return q.upper() if q == "4k" else q
    return "unknown"


async def build_direct_links(
    torrent_id: int | str, files: list[dict]
) -> list[dict]:
    """
    Request direct download URLs for every file inside a torrent and return
    a list of ``{ title, quality, url, size }`` dicts ready for the Lampa player.
    """
    result: list[dict] = []
    for idx, f in enumerate(files):
        file_id = f.get("id")
        if file_id is None:
            continue
        try:
            url = await request_download_link(torrent_id, file_id)
            if url:
                name = f.get("name") or f.get("short_name") or f"File {idx + 1}"
                result.append(
                    {
                        "title": name,
                        "quality": _guess_quality(name),
                        "url": url,
                        "size": f.get("size", 0),
                    }
                )
        except Exception as exc:
            logger.error(
                "build_direct_links torrent_id=%s file_id=%s error: %s",
                torrent_id, file_id, exc,
            )
    return result
