"""Market-data provider interface."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..models import Candle


class DataProvider:
    """Fetches OHLC candles for a pair/timeframe, oldest first, times in UTC."""

    name = "base"

    def fetch_candles(self, pair: str, timeframe: str, limit: int = 300) -> list[Candle]:
        raise NotImplementedError


def drop_incomplete(
    candles: list[Candle], timeframe_seconds: int, now: datetime | None = None
) -> list[Candle]:
    """Drop the trailing in-progress candle so detection only sees closed bars."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return [
        c for c in candles if c.time + timedelta(seconds=timeframe_seconds) <= now
    ]
