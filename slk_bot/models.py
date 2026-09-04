"""Core data types shared across the bot."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class Direction(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class SignalStatus(str, Enum):
    OPEN = "OPEN"
    TP_HIT = "TP_HIT"
    SL_HIT = "SL_HIT"
    EXPIRED = "EXPIRED"


@dataclass(frozen=True)
class Candle:
    """One OHLC candle. ``time`` is the candle OPEN time, tz-aware UTC."""

    time: datetime
    open: float
    high: float
    low: float
    close: float


@dataclass
class Signal:
    """A trade setup detected by the SLK model."""

    pair: str
    timeframe: str
    direction: Direction
    entry: float
    stop_loss: float
    take_profit: float
    signal_time: datetime  # open time of the trigger (MSS) candle
    session: str | None = None
    sweep_level: float | None = None
    sweep_time: datetime | None = None
    rr: float | None = None
    atr: float | None = None

    @property
    def risk(self) -> float:
        return abs(self.entry - self.stop_loss)

    @property
    def dedupe_key(self) -> str:
        """Unique identity of a signal: one alert per pair/tf/direction/candle."""
        return (
            f"{self.pair}:{self.timeframe}:{self.direction.value}:"
            f"{self.signal_time.isoformat()}"
        )

    def __str__(self) -> str:  # for logs
        return (
            f"{self.direction.value} {self.pair} {self.timeframe} "
            f"@ {self.entry} (SL {self.stop_loss} / TP {self.take_profit})"
        )


def pip_size(pair: str) -> float:
    """PIP size for a pair symbol like EURUSD / USDJPY / XAUUSD."""
    p = pair.upper().replace("/", "").replace("=X", "")
    if "JPY" in p:
        return 0.01
    if p.startswith(("XAU", "XAG")):
        return 0.1
    return 0.0001


def price_decimals(pair: str) -> int:
    ps = pip_size(pair)
    if ps == 0.01:
        return 3
    if ps == 0.1:
        return 2
    return 5


def fmt_price(pair: str, price: float) -> str:
    return f"{price:.{price_decimals(pair)}f}"


def fmt_pips(pair: str, distance: float) -> str:
    return f"{abs(distance) / pip_size(pair):.1f} pips"
