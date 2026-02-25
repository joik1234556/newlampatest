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

# Request timeout for mirrors (seconds)
MIRROR_TIMEOUT: int = 10

# Rate-limit: requests per minute per IP
RATE_LIMIT: str = "60/minute"

# Cache TTL settings (seconds)
VARIANTS_CACHE_TTL: int = int(os.getenv("VARIANTS_CACHE_TTL", "1800"))   # 30 min
DIRECT_URL_CACHE_TTL: int = int(os.getenv("DIRECT_URL_CACHE_TTL", "7200"))  # 2 hours

# Easy-Mod stream polling
STREAM_POLL_INTERVAL: int = int(os.getenv("STREAM_POLL_INTERVAL", "5"))   # seconds
STREAM_POLL_TIMEOUT: int  = int(os.getenv("STREAM_POLL_TIMEOUT", "240"))  # seconds (4 min)

# Log level
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
