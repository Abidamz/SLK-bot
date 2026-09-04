"""Configuration loading: YAML file + environment variable overrides.

Env vars (see .env.example):
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DISCORD_WEBHOOK_URL,
    TWELVEDATA_API_KEY, SLK_CONFIG
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

# timeframe label -> seconds per candle
TF_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
}

DEFAULT_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "XAUUSD"]

# Default ICT-style killzones in UTC: London open and New York open.
DEFAULT_KILLZONES = [["London", "07:00", "10:00"], ["NewYork", "12:00", "15:00"]]


@dataclass
class StrategyConfig:
    """Tunables for the SLK model detection.

    NOTE: these implement the default interpretation of the SLK model
    (liquidity sweep -> market structure shift -> entry). Adjust here or in
    config.yaml to match your exact rules.
    """

    swing_left: int = 2          # bars left of a swing point
    swing_right: int = 2         # bars right of a swing point (confirmation lag)
    lookback: int = 120          # candles analysed per scan
    sweep_window: int = 10       # sweep must be within this many candles of trigger
    mss_window: int = 12         # MSS must happen within this many candles of the sweep
    atr_period: int = 14
    sl_buffer_atr: float = 0.10  # stop placed this many ATRs beyond the sweep extreme
    min_risk_atr: float = 0.20   # skip setups whose stop distance is < this * ATR
    tp_mode: str = "rr"          # "rr" (fixed R multiple) | "liquidity" (opposing swing)
    rr_target: float = 2.0       # R multiple target (and liquidity-mode fallback)
    min_tp_r: float = 1.0        # skip setups whose TP is closer than this many R
    use_killzones: bool = True
    # [name, start, end] in UTC, end exclusive; overnight windows allowed
    killzones: list = field(default_factory=lambda: [list(k) for k in DEFAULT_KILLZONES])


@dataclass
class TrackingConfig:
    db_path: str = "data/signals.db"
    expire_candles: int = 96     # candles after entry before an open signal expires
    notify_outcomes: bool = True


@dataclass
class NotifyConfig:
    send_startup: bool = True


@dataclass
class Config:
    pairs: list[str] = field(default_factory=lambda: list(DEFAULT_PAIRS))
    timeframes: dict[str, int] = field(default_factory=lambda: {"15m": 900, "1h": 3600})
    provider: str = "auto"       # auto | yfinance | twelvedata
    candles_limit: int = 300
    poll_seconds: int = 30       # idle sleep while waiting for next candle close
    scan_delay_seconds: int = 10  # extra wait after a candle close before fetching
    alert_on_boot: bool = False  # alert on setups already formed when the bot starts
    symbol_map: dict[str, str] = field(default_factory=dict)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    tracking: TrackingConfig = field(default_factory=TrackingConfig)
    notify: NotifyConfig = field(default_factory=NotifyConfig)
    telegram_token: str | None = None
    telegram_chat_id: str | None = None
    discord_webhook_url: str | None = None
    twelvedata_api_key: str | None = None


def _sub(cls, data: Any):
    """Build a dataclass from a YAML sub-dict, ignoring unknown keys."""
    if not isinstance(data, dict):
        return cls()
    valid = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in data.items() if k in valid})


def load_config(path: str | None = None) -> Config:
    load_dotenv()
    cfg_path = path or os.environ.get("SLK_CONFIG", "config.yaml")
    raw: dict[str, Any] = {}
    p = Path(cfg_path)
    if p.exists():
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    else:
        import logging

        logging.getLogger(__name__).warning(
            "config file %s not found — using defaults + environment", cfg_path
        )

    cfg = Config()

    if raw.get("pairs"):
        cfg.pairs = [str(x).upper().replace("/", "") for x in raw["pairs"]]

    if raw.get("timeframes"):
        tfs: dict[str, int] = {}
        for label in raw["timeframes"]:
            label = str(label)
            if label not in TF_SECONDS:
                raise ValueError(
                    f"unsupported timeframe {label!r}; allowed: {sorted(TF_SECONDS)}"
                )
            tfs[label] = TF_SECONDS[label]
        cfg.timeframes = tfs

    for attr in (
        "provider",
        "candles_limit",
        "poll_seconds",
        "scan_delay_seconds",
        "alert_on_boot",
        "symbol_map",
    ):
        if attr in raw:
            setattr(cfg, attr, raw[attr])

    cfg.strategy = _sub(StrategyConfig, raw.get("strategy"))
    cfg.tracking = _sub(TrackingConfig, raw.get("tracking"))
    cfg.notify = _sub(NotifyConfig, raw.get("notify"))

    # secrets / connection settings: env wins, then YAML
    cfg.telegram_token = os.environ.get("TELEGRAM_BOT_TOKEN") or raw.get("telegram_token")
    cfg.telegram_chat_id = os.environ.get("TELEGRAM_CHAT_ID") or raw.get("telegram_chat_id")
    cfg.discord_webhook_url = os.environ.get("DISCORD_WEBHOOK_URL") or raw.get(
        "discord_webhook_url"
    )
    cfg.twelvedata_api_key = os.environ.get("TWELVEDATA_API_KEY") or raw.get(
        "twelvedata_api_key"
    )

    if cfg.provider == "auto":
        cfg.provider = "twelvedata" if cfg.twelvedata_api_key else "yfinance"

    return cfg
