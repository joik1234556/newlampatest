"""
# === ZETFLIX SOURCE ===
Zetflix online provider — wraps app/scraper/zetflix.py.
"""
from __future__ import annotations

from app.scraper import zetflix as _zetflix_scraper
from app.providers.online_base import OnlineProviderBase


class ZetflixProvider(OnlineProviderBase):
    name = "zetflix"
    _source_label = "Zetflix"
    _scraper_module = _zetflix_scraper
