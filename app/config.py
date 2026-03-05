import os
from dotenv import load_dotenv

load_dotenv()

TORBOX_API_KEY: str = os.getenv("TORBOX_API_KEY", "")
TORBOX_BASE_URL: str = "https://api.torbox.app/v1/api"

# Mirror lists
KINOGO_MIRRORS: list[str] = [
    "https://kinogo.my/",
    "https://uakinogo.ec/",
    "https://kinogo.skin/",
    "https://uakinogo.org/",
    "https://kinogo.host/",
    "https://kinogo.no/",
    "https://uakinogo.io/",
]

REZKA_MIRRORS: list[str] = [
    "https://rezka.ag/",
    "https://hdrezka.fans/",
    "https://hdrezka.ink/",
    "https://hdrezka.loan/",
    "https://hdrezka.me/",
    "https://omnirezka.tv/",
    "https://hdrezka.vip/",
    "https://rezka.bid/",
    "https://hdrezka.sh/",
    "https://rezka.fm/",
    "https://hdrezka-ua.com/",
]

VIDEOCDN_MIRRORS: list[str] = [
    "https://videocdn.tv/",
    "https://videocdn.so/",
    "https://videocdn.net/",
]

KODIK_MIRRORS: list[str] = [
    "https://kodik.info/",
    "https://kodik.cc/",
    "https://kodik.biz/",
]

# === PROXY M3U8 - ONLY PLAYLIST ===
# Enable the /proxy/m3u8 endpoint (proxies only m3u8 playlists, not .ts segments)
PROXY_M3U8_ENABLED: bool = os.getenv("PROXY_M3U8_ENABLED", "1") == "1"
# Future flag: set PROXY_FULL_STREAM=1 to also proxy .ts segments (high bandwidth!).
# Not implemented yet — would significantly increase server bandwidth.
PROXY_FULL_STREAM: bool = os.getenv("PROXY_FULL_STREAM", "0") == "1"

# === ZETFLIX SOURCE ===
ZETFLIX_MIRRORS: list[str] = [
    "https://4mar.zet-flix.online/",
    "https://zetflix-online.run/",
    "https://zetflixhd.buzz/",
    "https://go.zetflix-online.lol/",
    "https://zetflix-online.icu/",
    # Add new mirrors here
]

# Request timeout for mirrors (seconds)
MIRROR_TIMEOUT: int = 10

# Rate-limit: requests per minute per IP
RATE_LIMIT: str = "60/minute"

# Redis connection URL
REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Cache TTL settings (seconds)
VARIANTS_CACHE_TTL: int = int(os.getenv("VARIANTS_CACHE_TTL", "1800"))    # 30 min
DIRECT_URL_CACHE_TTL: int = int(os.getenv("DIRECT_URL_CACHE_TTL", "3600"))  # 1 hour (TorBox URLs expire ~1 h)
JOB_TTL: int = int(os.getenv("JOB_TTL", "7200"))                           # 2 hours

# TorBox polling strategy
TORBOX_POLL_MAX_SECONDS: int = int(os.getenv("TORBOX_POLL_MAX_SECONDS", "180"))   # 3 min total
TORBOX_POLL_FAST_SECONDS: int = int(os.getenv("TORBOX_POLL_FAST_SECONDS", "30"))  # fast phase
TORBOX_POLL_FAST_INTERVAL: int = int(os.getenv("TORBOX_POLL_FAST_INTERVAL", "1")) # secs (was 2)
TORBOX_POLL_SLOW_INTERVAL: int = int(os.getenv("TORBOX_POLL_SLOW_INTERVAL", "5")) # secs

# Log level
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

# Jackett integration (optional)
JACKETT_URL: str = os.getenv("JACKETT_URL", "")
JACKETT_API_KEY: str = os.getenv("JACKETT_API_KEY", "")

# Torrentio base URL — override if the default public instance is inaccessible
# Example: TORRENTIO_BASE=https://torrentio.strem.fun
TORRENTIO_BASE: str = os.getenv("TORRENTIO_BASE", "https://torrentio.strem.fun").rstrip("/")

# DemoProvider — set to "1" only in development / testing; off in production
ENABLE_DEMO_PROVIDER: bool = os.getenv("ENABLE_DEMO_PROVIDER", "0") == "1"

# Minimum number of TorBox-native cached results to treat as a sufficient
# fast-path hit (skip Jackett/Torrentio for popular titles).
TORBOX_SEARCH_MIN_RESULTS: int = int(os.getenv("TORBOX_SEARCH_MIN_RESULTS", "3"))

# === SCRAPINGBEE CONFIG ===
# API key — set SCRAPINGBEE_API_KEY in .env (never hardcode here)
SCRAPINGBEE_API_KEY: str = os.getenv("SCRAPINGBEE_API_KEY", "")
# Set USE_SCRAPINGBEE=0 to fall back to the legacy cloudscraper path for Zetflix
USE_SCRAPINGBEE: bool = os.getenv("USE_SCRAPINGBEE", "1") == "1"
SCRAPINGBEE_RENDER_JS: bool = os.getenv("SCRAPINGBEE_RENDER_JS", "1") == "1"
SCRAPINGBEE_PREMIUM_PROXY: bool = os.getenv("SCRAPINGBEE_PREMIUM_PROXY", "1") == "1"
SCRAPINGBEE_COUNTRY: str = os.getenv("SCRAPINGBEE_COUNTRY", "ru")  # важно для русских сайтов
