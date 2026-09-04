"""Yahoo Finance market data (via yfinance). No API key required.

Good default for getting started and for replay/testing. FX rates can be
slightly delayed vs a broker feed; use Twelve Data or a broker API for
low-latency production alerting.
"""
from __future__ import annotations

import logging

from ..models import Candle
from .base import DataProvider

log = logging.getLogger(__name__)

# timeframe label -> (yfinance interval, max history period)
YF_INTERVALS = {
    "5m": ("5m", "7d"),
    "15m": ("15m", "30d"),
    "30m": ("30m", "30d"),
    "1h": ("1h", "60d"),
    "1d": ("1d", "5y"),
}
# timeframes built by resampling a finer interval
YF_RESAMPLE = {
    "45m": ("30m", "45min"),
    "2h": ("1h", "2h"),
    "3h": ("1h", "3h"),
    "4h": ("1h", "4h"),
}


class YFinanceProvider(DataProvider):
    name = "yfinance"

    def __init__(self, symbol_map: dict[str, str] | None = None):
        # explicit overrides, e.g. {"XAUUSD": "GC=F"}
        self.symbol_map = symbol_map or {}

    def ticker_for(self, pair: str) -> str:
        return self.symbol_map.get(pair, f"{pair}=X")

    def fetch_candles(self, pair: str, timeframe: str, limit: int = 300) -> list[Candle]:
        import pandas as pd
        import yfinance as yf

        resample = None
        if timeframe in YF_INTERVALS:
            interval, period = YF_INTERVALS[timeframe]
        elif timeframe in YF_RESAMPLE:
            base, resample = YF_RESAMPLE[timeframe]
            interval, period = YF_INTERVALS[base]
        else:
            raise ValueError(f"yfinance: unsupported timeframe {timeframe!r}")

        tickers = [self.ticker_for(pair)]
        # graceful fallback for gold spot if Yahoo lacks it
        if pair.upper().startswith("XAU") and pair not in self.symbol_map:
            tickers.append("GC=F")

        df = None
        for ticker in tickers:
            df = yf.download(
                ticker,
                period=period,
                interval=interval,
                progress=False,
                auto_adjust=False,
            )
            if df is not None and not df.empty:
                break
            log.debug("yfinance: no data for %s (%s)", pair, ticker)
        if df is None or df.empty:
            log.warning("yfinance: empty data for %s %s", pair, timeframe)
            return []

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        idx = df.index
        df.index = idx.tz_localize("UTC") if idx.tz is None else idx.tz_convert("UTC")

        if resample:
            df = (
                df.resample(resample, origin="epoch")
                .agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"})
                .dropna()
            )

        candles: list[Candle] = []
        for ts, row in df.tail(limit).iterrows():
            try:
                candles.append(
                    Candle(
                        time=ts.to_pydatetime(),
                        open=float(row["Open"]),
                        high=float(row["High"]),
                        low=float(row["Low"]),
                        close=float(row["Close"]),
                    )
                )
            except (TypeError, ValueError):
                continue  # skip NaN rows
        return candles
