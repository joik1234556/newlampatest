"""Scraper utilities: CF-proxy HTTP helpers."""
import logging
import os
from typing import List, Optional

import httpx

from app.config import CF_PROXY_URL

logger = logging.getLogger(__name__)


def cloudscraper_get(url: str, timeout: int = 30) -> str:
    """Fetch *url* through the Cloudflare Workers proxy and return response text."""
    proxied = CF_PROXY_URL.rstrip("/") + "/" + url.lstrip("/")
    logger.debug("CF-proxy GET %s -> %s", url, proxied)
    resp = httpx.get(proxied, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def try_mirrors(mirrors: List[str], path: str = "", timeout: int = 20) -> Optional[str]:
    """Try each mirror in order; return first successful response text or None."""
    for mirror in mirrors:
        target = mirror.rstrip("/") + "/" + path.lstrip("/")
        try:
            text = cloudscraper_get(target, timeout=timeout)
            if text:
                return text
        except Exception as exc:  # noqa: BLE001
            logger.warning("Mirror %s failed: %s", mirror, exc)
    return None


def decode_hdrezka_streams(encoded: str) -> Optional[str]:
    """Decode HDRezka/Zetflix obfuscated base64 stream string.

    HDRezka embeds stream URLs as a base64-encoded string with ``#h`` markers
    and ``/**/0`` padding removed before encoding.  This function strips those
    markers and decodes the result.

    The expression ``(-len(raw)) % 4`` calculates the number of ``=`` pad
    characters needed to make the base64 string a multiple of 4 bytes, as
    required by the base64 specification.
    """
    import base64

    try:
        raw = encoded.replace("#h", "").replace("/**/0", "").replace("#", "")
        # base64 strings must be a multiple of 4 bytes; pad as needed
        raw += "=" * ((-len(raw)) % 4)
        return base64.b64decode(raw).decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return None
