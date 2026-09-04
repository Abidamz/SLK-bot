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
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "45m": 2700,
    "1h": 3600,
    "2h": 7200,
    "3h": 10800,
    "4h": 14400,
    "1d": 86400,
}

DEFAULT_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "XAUUSD"]

# Timeframe hierarchy defaults (from the research: monthly/weekly/daily bias,
# H4 vantage point, H1 or M30 execution; M15 optional, sub-M15 off).
DEFAULT_ENTRY_TFS = ["1h", "30m"]
MAP_TF = "4h"                 # map / vantage timeframe (built from source)
MAP_SOURCE_TF = "1h"          # source candles resampled into the map TF
CONTEXT_TF = "1d"             # bias context (weekly/monthly derived from this)


@dataclass
class StrategyConfig:
    """Tunables for the SLK engine (structure / liquidity / key levels).

    All volatility-derived thresholds are ATR-normalized per symbol and per
    timeframe from live data — no universal pip/ATR constants are applied
    across instruments.
    """

    # structure
    pivot_left: int = 2
    pivot_right: int = 2
    min_swings_env: int = 2    # pivots per side required to call an environment
    phase_lookback: int = 20   # map-TF candles within which a BOS means "expansion"
    atr_period: int = 14

    # key levels
    av_len: int = 2                 # half-window for A/V line-chart extrema
    level_tolerance_atr: float = 0.25   # half-width of A/V level zones
    level_lookback: int = 120       # how far back (map candles) levels are built
    decision_atr_mult: float = 1.5  # wide-range candle => Open-Close level + single-candle liquidity
    flip_margin_atr: float = 0.50   # decisive close-through margin flips a level
    zone_max_distance_atr: float = 8.0  # origin must be within this of price
    fvg_lookback: int = 80          # imbalance zones considered (map candles)

    # execution state machine (in entry-TF candles)
    touch_window: int = 64     # MAP → TOUCH deadline
    sweep_window: int = 24     # TOUCH → SWEEP deadline
    bos_window: int = 24       # SWEEP → SHIFT deadline
    retest_window: int = 64    # SHIFT → RETEST deadline
    retest_tolerance_atr: float = 0.30
    setup_window: int = 240    # replay depth per scan

    # trade geometry
    sl_buffer_atr: float = 0.10   # stop buffer beyond sweep extreme (entry-TF ATR)
    min_risk_atr: float = 0.10
    min_tp_r: float = 0.8         # nearest target must be at least this many R

    # alert hygiene
    cooldown_minutes: int = 240   # per pair+direction
    sessions_allowlist: list = field(default_factory=list)  # [[name,"07:00","10:00"],...] UTC; empty = all

    # filled by load_config (label used in alert records)
    map_tf_label: str = MAP_TF


@dataclass
class TrackingConfig:
    db_path: str = "data/signals.db"
    expire_candles: int = 120    # entry-TF candles before an open alert expires
    sl_on_close: bool = True     # close-based stop (model prefers close-based invalidation)
    notify_outcomes: bool = True


@dataclass
class NotifyConfig:
    send_startup: bool = True


@dataclass
class Config:
    pairs: list[str] = field(default_factory=lambda: list(DEFAULT_PAIRS))
    entry_timeframes: dict[str, int] = field(
        default_factory=lambda: {t: TF_SECONDS[t] for t in DEFAULT_ENTRY_TFS}
    )
    map_timeframe: str = MAP_TF
    map_source_timeframe: str = MAP_SOURCE_TF
    context_timeframe: str = CONTEXT_TF
    mode: str = "paper"          # "paper" (validation) | "live" (plain alerts)
    paper_notify: bool = True    # push paper alerts too (tagged 🧪 PAPER)
    provider: str = "auto"       # auto | yfinance | twelvedata
    candles_limit: int = 400
    poll_seconds: int = 30
    scan_delay_seconds: int = 10
    alert_on_boot: bool = False  # deliver setups already formed at bot start
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

    if raw.get("entry_timeframes"):
        tfs: dict[str, int] = {}
        for label in raw["entry_timeframes"]:
            label = str(label)
            if label not in TF_SECONDS or label == "1d":
                raise ValueError(
                    f"unsupported entry timeframe {label!r}; "
                    f"allowed: {[k for k in TF_SECONDS if k != '1d']}"
                )
            tfs[label] = TF_SECONDS[label]
        if any(s < 900 for s in tfs.values()):
            import logging

            logging.getLogger(__name__).warning(
                "entry timeframes below 15m are enabled — the research "
                "recommends keeping M1/M3/M5 disabled"
            )
        cfg.entry_timeframes = tfs

    for attr in (
        "map_timeframe",
        "map_source_timeframe",
        "context_timeframe",
        "mode",
        "paper_notify",
        "provider",
        "candles_limit",
        "poll_seconds",
        "scan_delay_seconds",
        "alert_on_boot",
        "symbol_map",
    ):
        if attr in raw:
            setattr(cfg, attr, raw[attr])
    if cfg.mode not in ("paper", "live"):
        raise ValueError("mode must be 'paper' or 'live'")

    cfg.strategy = _sub(StrategyConfig, raw.get("strategy"))
    cfg.strategy.map_tf_label = cfg.map_timeframe
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
