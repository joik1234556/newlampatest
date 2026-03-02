"""Kinogo online provider — wraps app/scraper/kinogo.py."""
from __future__ import annotations

from app.scraper import kinogo as _kinogo_scraper
from app.providers.online_base import OnlineProviderBase


class KinogoProvider(OnlineProviderBase):
    name = "kinogo"
    _source_label = "Kinogo"
    _scraper_module = _kinogo_scraper
