"""Shared test helpers.

All candles here are SYNTHETIC fixtures used to verify state-machine and
feature-extraction logic. They are not market data and must never be used
for, or presented as, backtest/performance evidence.
"""
from datetime import datetime, timedelta, timezone

from slk_bot.models import Candle

BASE = datetime(2024, 3, 4, tzinfo=timezone.utc)  # a Monday, epoch-aligned


def mk_candles(rows, step_minutes=30, base=BASE):
    """rows: iterable of (open, high, low, close)."""
    return [
        Candle(
            time=base + timedelta(minutes=step_minutes * i),
            open=float(o),
            high=float(h),
            low=float(l),
            close=float(c),
        )
        for i, (o, h, l, c) in enumerate(rows)
    ]


def mk_from_closes(closes, step_minutes=240, base=BASE, wick=0.08):
    """Build candles from a close path; open = previous close,
    high/low = body extremes ± wick."""
    candles = []
    prev = closes[0]
    for i, c in enumerate(closes):
        o = prev
        candles.append(
            Candle(
                time=base + timedelta(minutes=step_minutes * i),
                open=float(o),
                high=float(max(o, c) + wick),
                low=float(min(o, c) - wick),
                close=float(c),
            )
        )
        prev = c
    return candles
