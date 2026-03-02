"""VideoCDN online provider — wraps app/scraper/videocdn.py."""
from __future__ import annotations

from app.scraper import videocdn as _videocdn_scraper
from app.providers.online_base import OnlineProviderBase


class VideoCDNProvider(OnlineProviderBase):
    name = "videocdn"
    _source_label = "VideoCDN"
    _scraper_module = _videocdn_scraper
