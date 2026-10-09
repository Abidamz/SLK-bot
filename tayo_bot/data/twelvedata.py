"""Twelve Data market data provider (recommended for production).

Free tier: 800 API credits/day, 8 credits/minute — comfortable for a handful
of pairs on 30m/1h when scanning on candle close (the daily context feed is
cached per UTC day). Get a key at https://twelvedata.com/ and set
TWELVEDATA_API_KEY.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import requests

from ..models import Candle
from .base import DataProvider

log = logging.getLogger(__name__)

TD_INTERVALS = {
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "45m": "45min",
    "1h": "1h",
    "2h": "2h",
    # "3h" is not offered by Twelve Data — build it locally by resampling 1h
    "4h": "4h",
    "1d": "1day",
}


class TwelveDataProvider(DataProvider):
    name = "twelvedata"
    BASE_URL = "https://api.twelvedata.com/time_series"

    def __init__(self, api_key: str, symbol_map: dict[str, str] | None = None):
        if not api_key:
            raise ValueError("TwelveDataProvider requires an API key")
        self.api_key = api_key
        self.symbol_map = symbol_map or {}

    def symbol_for(self, pair: str) -> str:
        if pair in self.symbol_map:
            return self.symbol_map[pair]
        if len(pair) == 6:  # EURUSD -> EUR/USD, XAUUSD -> XAU/USD
            return f"{pair[:3]}/{pair[3:]}"
        return pair

    def fetch_candles(self, pair: str, timeframe: str, limit: int = 300) -> list[Candle]:
        interval = TD_INTERVALS.get(timeframe)
        if interval is None:
            raise ValueError(f"twelvedata: unsupported timeframe {timeframe!r}")
        params = {
            "symbol": self.symbol_for(pair),
            "interval": interval,
            "outputsize": min(limit, 5000),
            "apikey": self.api_key,
            "order": "ASC",
            "timezone": "UTC",
            "format": "JSON",
        }
        resp = requests.get(self.BASE_URL, params=params, timeout=20)
        data = resp.json()
        if "values" not in data:
            raise RuntimeError(
                f"Twelve Data error for {params['symbol']} {interval}: "
                f"{data.get('message') or data}"
            )
        candles: list[Candle] = []
        for row in data["values"]:
            ts = datetime.fromisoformat(row["datetime"]).replace(tzinfo=timezone.utc)
            candles.append(
                Candle(
                    time=ts,
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                )
            )
        return candles
