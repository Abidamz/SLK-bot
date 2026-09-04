"""SLK model detection.

Default interpretation of the SLK model (ICT/SMC style):

    1. LIQUIDITY SWEEP — price wicks beyond a confirmed swing point
       (takes out the liquidity resting there) but closes back inside.
    2. MARKET STRUCTURE SHIFT (CHoCH) — within ``mss_window`` candles the
       price then CLOSES beyond the opposite internal structure point
       (the pullback low for shorts / pullback high for longs).
    3. ENTRY — on the close of the MSS candle. Stop goes beyond the sweep
       extreme (+ ATR buffer). TP is a fixed R multiple (default 2R) or the
       opposing liquidity pool, per config.
    4. SESSION FILTER — only setups whose trigger candle closes inside a
       configured killzone (default: London 07:00-10:00 / NewYork 12:00-15:00
       UTC) produce alerts.

If your SLK rules differ, this module is the single place to change — the
rest of the bot (data, notifications, tracking) is strategy-agnostic.

Only *fresh* triggers are returned: the MSS candle must be one of the last
``fresh_window + 1`` closed candles, so scans stay idempotent and the bot
never re-alerts an old event.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, time as dtime, timezone

from ..config import StrategyConfig
from ..models import Candle, Direction, Signal

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Swing:
    index: int
    price: float
    time: datetime
    kind: str  # "high" | "low"


def find_swings(
    candles: list[Candle], left: int = 2, right: int = 2
) -> tuple[list[Swing], list[Swing]]:
    """Fractal swing points. A swing only exists once ``right`` bars follow it,
    so using the returned points is always safe from look-ahead bias."""
    highs: list[Swing] = []
    lows: list[Swing] = []
    n = len(candles)
    for i in range(left, n - right):
        c = candles[i]
        if all(c.high > candles[i - k].high for k in range(1, left + 1)) and all(
            c.high >= candles[i + k].high for k in range(1, right + 1)
        ):
            highs.append(Swing(i, c.high, c.time, "high"))
        if all(c.low < candles[i - k].low for k in range(1, left + 1)) and all(
            c.low <= candles[i + k].low for k in range(1, right + 1)
        ):
            lows.append(Swing(i, c.low, c.time, "low"))
    return highs, lows


def atr(candles: list[Candle], period: int = 14) -> float:
    """Simple-mean Average True Range over the tail of the series."""
    if len(candles) < 2:
        return 0.0
    trs = []
    for i in range(1, len(candles)):
        h, lo, pc = candles[i].high, candles[i].low, candles[i - 1].close
        trs.append(max(h - lo, abs(h - pc), abs(lo - pc)))
    trs = trs[-period:]
    return sum(trs) / len(trs) if trs else 0.0


def _parse_hhmm(s: str) -> dtime:
    hh, mm = str(s).split(":")
    return dtime(int(hh), int(mm))


def session_for(dt: datetime, killzones: list) -> str | None:
    """Name of the killzone containing ``dt`` (UTC), or None. End-exclusive;
    windows crossing midnight are supported."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    tod = dt.time()
    for name, start, end in killzones:
        s, e = _parse_hhmm(start), _parse_hhmm(end)
        if s <= e:
            if s <= tod < e:
                return str(name)
        else:  # overnight window, e.g. 22:00-02:00
            if tod >= s or tod < e:
                return str(name)
    return None


def detect_signals(
    candles: list[Candle],
    cfg: StrategyConfig,
    pair: str,
    timeframe: str,
    fresh_window: int = 0,
    enforce_killzone: bool = True,
) -> list[Signal]:
    """Detect fresh SLK setups. ``fresh_window=0`` inspects only the last
    closed candle; larger values also inspect the preceding N candles
    (useful for manual backfill scans)."""
    min_needed = cfg.swing_left + cfg.swing_right + 4
    if len(candles) < min_needed:
        return []
    t_last = len(candles) - 1
    out: list[Signal] = []
    for t in range(max(0, t_last - fresh_window), t_last + 1):
        out.extend(
            _detect_at(candles, t, cfg, pair, timeframe, enforce_killzone)
        )
    return out


def _detect_at(
    candles: list[Candle],
    t: int,
    cfg: StrategyConfig,
    pair: str,
    timeframe: str,
    enforce_killzone: bool,
) -> list[Signal]:
    """Run detection as if candle ``t`` were the freshest closed candle.
    Data after ``t`` is never touched — live and backtest stay consistent."""
    visible = candles[: t + 1]
    atr_val = atr(visible, cfg.atr_period)
    highs, lows = find_swings(visible, cfg.swing_left, cfg.swing_right)
    window_start = max(0, t - cfg.lookback)

    out = []
    for direction in (Direction.SHORT, Direction.LONG):
        sig = _detect_direction(
            visible,
            t,
            cfg,
            highs,
            lows,
            atr_val,
            window_start,
            direction,
            pair,
            timeframe,
            enforce_killzone,
        )
        if sig is not None:
            out.append(sig)
    return out


def _detect_direction(
    candles: list[Candle],
    t: int,
    cfg: StrategyConfig,
    highs: list[Swing],
    lows: list[Swing],
    atr_val: float,
    window_start: int,
    direction: Direction,
    pair: str,
    timeframe: str,
    enforce_killzone: bool,
) -> Signal | None:
    is_short = direction is Direction.SHORT
    sweep_swings = highs if is_short else lows   # liquidity pool being raided
    ref_swings = lows if is_short else highs     # structure that must break

    # --- 1. most recent liquidity sweep near the trigger -----------------
    best: tuple[int, Swing] | None = None
    lo = max(window_start, t - cfg.sweep_window)
    for s in range(lo, t + 1):
        c = candles[s]
        swept = [
            sw
            for sw in sweep_swings
            if window_start <= sw.index < s
            and (
                (c.high > sw.price and c.close < sw.price)
                if is_short
                else (c.low < sw.price and c.close > sw.price)
            )
        ]
        if swept:
            # if several levels got swept by one candle, remember the extreme one
            pick = (
                max(swept, key=lambda w: w.price)
                if is_short
                else min(swept, key=lambda w: w.price)
            )
            best = (s, pick)  # ascending loop -> latest sweep wins
    if best is None:
        return None
    s, swept_swing = best

    # --- 2. internal structure reference (pullback before the sweep) -----
    ref = None
    for rw in ref_swings:
        if swept_swing.index < rw.index <= s:
            ref = rw  # keep the last one in range
    if ref is not None:
        ref_price = ref.price
    elif s > swept_swing.index:
        # fallback: extreme of the move into the sweep
        seg = candles[swept_swing.index + 1 : s + 1]
        ref_price = (
            min(c.low for c in seg) if is_short else max(c.high for c in seg)
        )
    else:
        return None
    # sanity: reference must sit inside the range, below/above the swept level
    if is_short and ref_price >= swept_swing.price:
        return None
    if not is_short and ref_price <= swept_swing.price:
        return None

    # --- 3. market structure shift: first close beyond the reference -----
    j = None
    for k in range(s, min(t, s + cfg.mss_window) + 1):
        c = candles[k]
        if (c.close < ref_price) if is_short else (c.close > ref_price):
            j = k
            break
    if j is None or j != t:
        return None  # no MSS yet, or it fired on an earlier candle already

    # --- 4. session filter ------------------------------------------------
    sess = session_for(candles[t].time, cfg.killzones)
    if enforce_killzone and cfg.use_killzones and sess is None:
        return None

    # --- 5. build entry / stop / target -----------------------------------
    seg = candles[s : t + 1]
    if is_short:
        stop = max(c.high for c in seg) + cfg.sl_buffer_atr * atr_val
        entry = candles[t].close
        risk = stop - entry
        tp_rr = entry - cfg.rr_target * risk
        pools = [w.price for w in lows if w.index < t and w.price < entry]
        tp_liq = max(pools) if pools else None
    else:
        stop = min(c.low for c in seg) - cfg.sl_buffer_atr * atr_val
        entry = candles[t].close
        risk = entry - stop
        tp_rr = entry + cfg.rr_target * risk
        pools = [w.price for w in highs if w.index < t and w.price > entry]
        tp_liq = min(pools) if pools else None

    if risk <= 0 or risk < cfg.min_risk_atr * atr_val:
        return None
    tp = tp_liq if (cfg.tp_mode == "liquidity" and tp_liq is not None) else tp_rr
    rr = abs(tp - entry) / risk
    if rr < cfg.min_tp_r:
        return None

    return Signal(
        pair=pair,
        timeframe=timeframe,
        direction=direction,
        entry=entry,
        stop_loss=stop,
        take_profit=tp,
        signal_time=candles[t].time,
        session=sess,
        sweep_level=swept_swing.price,
        sweep_time=candles[s].time,
        rr=round(rr, 2),
        atr=atr_val,
    )
