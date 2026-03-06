"""Kodik online provider — wraps app/scraper/kodik.py."""
from __future__ import annotations

from app.scraper import kodik as _kodik_scraper
from app.providers.online_base import OnlineProviderBase


class KodikProvider(OnlineProviderBase):
    name = "kodik"
    _source_label = "Kodik"
    _scraper_module = _kodik_scraper
