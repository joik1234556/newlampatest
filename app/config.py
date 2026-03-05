"""Application configuration loaded from environment variables."""
import os

# CF Workers proxy URL (required for HDRezka, Zetflix, Collaps, Bazon)
CF_PROXY_URL: str = os.getenv("CF_PROXY_URL", "https://lampaproxy.egorkorotkov5.workers.dev/")

# ScrapingBee API key (optional; used as priority scraper for Zetflix when set)
SCRAPINGBEE_API_KEY: str = os.getenv("SCRAPINGBEE_API_KEY", "")

# HDRezka mirrors
HDREZKA_MIRRORS: list = [
    m.strip()
    for m in os.getenv(
        "HDREZKA_MIRRORS",
        "https://rezka.ag,https://hdrezka.ag,https://rezka.me",
    ).split(",")
    if m.strip()
]

# Zetflix mirrors
ZETFLIX_MIRRORS: list = [
    m.strip()
    for m in os.getenv(
        "ZETFLIX_MIRRORS",
        "https://zetflix.org,https://zetflix.cc",
    ).split(",")
    if m.strip()
]
