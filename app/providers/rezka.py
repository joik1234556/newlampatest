"""Rezka online provider — wraps app/scraper/rezka.py."""
from __future__ import annotations

from app.scraper import rezka as _rezka_scraper
from app.providers.online_base import OnlineProviderBase


class RezkaProvider(OnlineProviderBase):
    name = "rezka"
    _source_label = "HDRezka"
    _scraper_module = _rezka_scraper
