"""Zetflix scraper — fetches stream data via CF-proxy (ScrapingBee as optional priority)."""
import logging
import os
import re
from typing import Optional

import httpx

from app.config import CF_PROXY_URL, SCRAPINGBEE_API_KEY, ZETFLIX_MIRRORS

logger = logging.getLogger(__name__)

_CF_PROXY = CF_PROXY_URL.rstrip("/") + "/"


def _cf_proxy_get(url: str) -> str:
    """Fetch *url* via CF Workers proxy."""
    proxied = _CF_PROXY + url.lstrip("/")
    logger.debug("Zetflix CF-proxy GET %s", proxied)
    resp = httpx.get(proxied, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def _scrapingbee_get(url: str) -> str:
    """Fetch *url* through ScrapingBee (JS rendering).  Requires SCRAPINGBEE_API_KEY."""
    api_key = SCRAPINGBEE_API_KEY
    if not api_key:
        raise RuntimeError("SCRAPINGBEE_API_KEY is not set")
    endpoint = (
        "https://app.scrapingbee.com/api/v1/"
        f"?api_key={api_key}&url={url}&render_js=false"
    )
    resp = httpx.get(endpoint, timeout=60)
    resp.raise_for_status()
    return resp.text


def _fetch(url: str) -> str:
    """Fetch *url*: ScrapingBee if key is available, otherwise CF-proxy."""
    if SCRAPINGBEE_API_KEY:
        try:
            return _scrapingbee_get(url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ScrapingBee failed (%s), falling back to CF-proxy", exc)
    return _cf_proxy_get(url)


def search_zetflix(title: str, year: Optional[int] = None) -> list:
    """Search Zetflix for *title* and return a list of result dicts."""
    query = title
    if year:
        query = f"{title} {year}"

    for mirror in ZETFLIX_MIRRORS:
        search_url = mirror.rstrip("/") + "/index.php?do=search&subaction=search&q=" + _urlencode(query)
        try:
            html = _fetch(search_url)
            items = _parse_search_results(html, mirror)
            if items:
                return items
        except Exception as exc:  # noqa: BLE001
            logger.warning("Zetflix mirror %s search failed: %s", mirror, exc)

    return []


def get_zetflix_streams(film_url: str) -> list:
    """Fetch the film page and extract stream URLs."""
    try:
        html = _fetch(film_url)
        return _parse_streams(html, film_url)
    except Exception as exc:  # noqa: BLE001
        logger.error("Zetflix stream extraction failed for %s: %s", film_url, exc)
        return []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _urlencode(text: str) -> str:
    from urllib.parse import quote_plus
    return quote_plus(text)


def _parse_search_results(html: str, base_url: str) -> list:
    """Parse Zetflix search result HTML and return list of {title, url}."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for a in soup.select(".b-content__inline_item .b-content__inline_item-link a"):
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if href and text:
            if not href.startswith("http"):
                href = base_url.rstrip("/") + "/" + href.lstrip("/")
            results.append({"title": text, "url": href})
    return results


def _parse_streams(html: str, page_url: str) -> list:
    """Extract stream data from a Zetflix movie page."""
    import base64
    streams = []

    # Try to find encoded stream data in inline scripts
    patterns = [
        r'var\s+streams\s*=\s*[\'"]([A-Za-z0-9+/=#@%&*]+)[\'"]',
        r'"streams"\s*:\s*\[([^\]]+)\]',
        r'streams\s*:\s*\[([^\]]+)\]',
    ]

    for pattern in patterns:
        m = re.search(pattern, html)
        if m:
            raw = m.group(1)
            decoded = _decode_hdrezka_streams(raw)
            if decoded:
                streams.extend(_parse_stream_string(decoded, page_url))
                if streams:
                    return streams

    # Fallback: return page as iframe
    return [{"quality": "iframe", "url": page_url, "translation": "Zetflix"}]


def _decode_hdrezka_streams(encoded: str) -> Optional[str]:
    """Decode HDRezka/Zetflix base64-encoded stream list."""
    from app.scraper import decode_hdrezka_streams
    return decode_hdrezka_streams(encoded)


def _parse_stream_string(decoded: str, page_url: str) -> list:
    """Parse decoded stream string like '720p[url1]\\n1080p[url2]'."""
    streams = []
    for line in decoded.splitlines():
        m = re.match(r"(\d+p)\[(.+?)\]", line.strip())
        if m:
            quality, url = m.group(1), m.group(2)
            # Pick first URL if multiple separated by '/'
            url = url.split("/")[0].strip()
            if url:
                streams.append({"quality": quality, "url": url, "translation": "Zetflix"})
    return streams
