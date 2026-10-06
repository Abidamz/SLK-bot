"""Market-data providers."""
from __future__ import annotations

from ..config import Config
from .base import DataProvider, drop_incomplete
from .twelvedata import TwelveDataProvider

__all__ = [
    "DataProvider",
    "drop_incomplete",
    "TwelveDataProvider",
    "build_provider",
]


def build_provider(cfg: Config) -> DataProvider:
    if cfg.provider == "twelvedata":
        return TwelveDataProvider(cfg.twelvedata_api_key, cfg.symbol_map)
    raise ValueError(f"unknown data provider: {cfg.provider!r}")
