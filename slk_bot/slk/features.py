"""Feature extraction for the SLK model. Pure functions, no I/O.

Structure:      pivot detection, environment (bullish/bearish/consolidation),
                phase (expansion/pullback/reversal), BOS events, HTF
                invalidation levels.
Liquidity:      external pools (prior day/week/month highs+lows, HTF swings),
                internal pools (map-TF structural swings + single-candle
                "decision candle" liquidity).
Key levels:     A-shaped / V-shaped line-chart extrema and Open-Close
                decision-candle zones, with touch counts, flip detection and
                FVG overlap flags.
Misc:           ATR, resampling, calendar aggregation, session windows.
"""
from __future__ import annotations

from datetime import datetime, time as dtime, timedelta, timezone

from ..models import Candle, Direction
from .types import Imbalance, KeyLevel, LiquidityPool, Swing

# ---------------------------------------------------------------- indicators


def atr(candles: list[Candle], period: int = 14) -> float:
    """Simple-mean Average True Range over the tail of the series.
    Computed per symbol/timeframe from real data — never a universal constant."""
    if len(candles) < 2:
        return 0.0
    trs = []
    for i in range(1, len(candles)):
        h, lo, pc = candles[i].high, candles[i].low, candles[i - 1].close
        trs.append(max(h - lo, abs(h - pc), abs(lo - pc)))
    trs = trs[-period:]
    return sum(trs) / len(trs) if trs else 0.0


def session_for(dt: datetime, windows: list) -> str | None:
    """Name of the session window containing ``dt`` (UTC), or None.
    Window = [name, "HH:MM", "HH:MM"], end-exclusive, overnight allowed."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    tod = dt.time()
    for name, start, end in windows:
        s, e = _parse_hhmm(start), _parse_hhmm(end)
        if s <= e:
            if s <= tod < e:
                return str(name)
        elif tod >= s or tod < e:
            return str(name)
    return None


def _parse_hhmm(s) -> dtime:
    hh, mm = str(s).split(":")
    return dtime(int(hh), int(mm))


# ------------------------------------------------------------------ structure


def find_swings(
    candles: list[Candle], left: int = 2, right: int = 2
) -> tuple[list[Swing], list[Swing]]:
    """Fractal pivots; a pivot is only confirmed once ``right`` bars follow it,
    so consuming code never looks ahead."""
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


def environment(
    candles: list[Candle], left: int = 2, right: int = 2, min_swings: int = 2
) -> str:
    """Market environment from the last two confirmed pivots each side."""
    highs, lows = find_swings(candles, left, right)
    if len(highs) < min_swings or len(lows) < min_swings:
        return "consolidation"
    hh = highs[-1].price > highs[-2].price
    hl = lows[-1].price > lows[-2].price
    lh = highs[-1].price < highs[-2].price
    ll = lows[-1].price < lows[-2].price
    if hh and hl:
        return "bullish"
    if lh and ll:
        return "bearish"
    return "consolidation"


def structure_invalidation_level(
    candles: list[Candle], direction: Direction, left: int = 2, right: int = 2
) -> float | None:
    """The opposing structural point: a CLOSE beyond it kills the storyline.
    For a bearish storyline that is the last confirmed swing high, and
    vice versa."""
    highs, lows = find_swings(candles, left, right)
    if direction is Direction.SHORT:
        return highs[-1].price if highs else None
    return lows[-1].price if lows else None


def bos_event(
    candles: list[Candle], left: int = 2, right: int = 2
) -> tuple[int, str, float] | None:
    """Most recent break of structure: (candle index, "up"|"down", level).
    A level only counts once (the first candle that closes through it)."""
    highs, lows = find_swings(candles, left, right)
    crossed: set = set()
    events: list[tuple[int, str, float]] = []
    for i, c in enumerate(candles):
        for sw in highs:
            if (
                sw.index < i
                and ("H", sw.index) not in crossed
                and c.close > sw.price
                and candles[i - 1].close <= sw.price
            ):
                crossed.add(("H", sw.index))
                events.append((i, "up", sw.price))
        for sw in lows:
            if (
                sw.index < i
                and ("L", sw.index) not in crossed
                and c.close < sw.price
                and candles[i - 1].close >= sw.price
            ):
                crossed.add(("L", sw.index))
                events.append((i, "down", sw.price))
    return events[-1] if events else None


def phase(
    candles: list[Candle], env: str, lookback: int, left: int = 2, right: int = 2
) -> str:
    """expansion (recent BOS with the environment) | pullback (stale BOS) |
    reversal (last BOS against the environment) | range."""
    if env not in ("bullish", "bearish"):
        return "range"
    ev = bos_event(candles, left, right)
    if ev is None:
        return "range"
    i, direction, _level = ev
    same_dir = (direction == "up" and env == "bullish") or (
        direction == "down" and env == "bearish"
    )
    if same_dir:
        return "expansion" if (len(candles) - 1 - i) <= lookback else "pullback"
    return "reversal"


# ---------------------------------------------------------------- resampling


def resample_candles(candles: list[Candle], seconds: int) -> list[Candle]:
    """Generic epoch-anchored resampling (e.g. 1h -> 4h)."""
    buckets: dict[int, list] = {}
    for c in candles:
        b = int(c.time.timestamp()) // seconds
        if b in buckets:
            row = buckets[b]
            row[1] = max(row[1], c.high)
            row[2] = min(row[2], c.low)
            row[3] = c.close
        else:
            buckets[b] = [c.open, c.high, c.low, c.close]
    return [
        Candle(
            time=datetime.fromtimestamp(b * seconds, tz=timezone.utc),
            open=o, high=h, low=l, close=cl,
        )
        for b, (o, h, l, cl) in sorted(buckets.items())
    ]


def resample_calendar(daily: list[Candle], period: str) -> list[Candle]:
    """Aggregate daily candles into calendar weeks ("W", ISO) or months ("M")."""
    groups: dict[tuple, list[Candle]] = {}
    for c in daily:
        d = c.time.date()
        key = (d.isocalendar().year, d.isocalendar().week) if period == "W" else (d.year, d.month)
        groups.setdefault(key, []).append(c)
    out = []
    for _, cs in groups.items():
        out.append(
            Candle(
                time=cs[0].time,
                open=cs[0].open,
                high=max(x.high for x in cs),
                low=min(x.low for x in cs),
                close=cs[-1].close,
            )
        )
    return out


_ARROWS = {"bullish": "↑", "bearish": "↓", "consolidation": "↔", "n/a": "?"}


def htf_alignment(d1: list[Candle], h4_env: str, left: int = 2, right: int = 2) -> str:
    """Monthly/Weekly/Daily/H4 directional alignment string."""
    d_env = environment(d1, left, right)
    w = resample_calendar(d1, "W")
    w_env = environment(w, left=1, right=1) if len(w) >= 7 else "n/a"
    m = resample_calendar(d1, "M")
    m_env = environment(m, left=1, right=1) if len(m) >= 7 else "n/a"
    return (
        f"M:{_ARROWS.get(m_env, '?')} W:{_ARROWS.get(w_env, '?')} "
        f"D:{_ARROWS.get(d_env, '?')} H4:{_ARROWS.get(h4_env, '?')}"
    )


# ----------------------------------------------------------------- liquidity


def external_pools(
    daily: list[Candle], left: int = 2, right: int = 2, swing_count: int = 4
) -> list[LiquidityPool]:
    """External liquidity: prior day / week / month highs+lows plus the most
    recent daily structural swings."""
    pools: list[LiquidityPool] = []
    if daily:
        d = daily[-1]
        pools.append(LiquidityPool(d.high, "buyside", "PDH", d.time))
        pools.append(LiquidityPool(d.low, "sellside", "PDL", d.time))
    weeks = resample_calendar(daily, "W")
    if len(weeks) >= 2:  # weeks[-1] may be the still-running current week
        w = weeks[-2]
        pools.append(LiquidityPool(w.high, "buyside", "PWH", w.time))
        pools.append(LiquidityPool(w.low, "sellside", "PWL", w.time))
    months = resample_calendar(daily, "M")
    if len(months) >= 2:
        m = months[-2]
        pools.append(LiquidityPool(m.high, "buyside", "PMH", m.time))
        pools.append(LiquidityPool(m.low, "sellside", "PML", m.time))
    highs, lows = find_swings(daily, left, right)
    for sw in highs[-swing_count:]:
        pools.append(LiquidityPool(sw.price, "buyside", "external-swing", sw.time))
    for sw in lows[-swing_count:]:
        pools.append(LiquidityPool(sw.price, "sellside", "external-swing", sw.time))
    return pools


def internal_pools(
    candles: list[Candle],
    atr_val: float,
    decision_atr_mult: float = 1.5,
    left: int = 2,
    right: int = 2,
) -> list[LiquidityPool]:
    """Internal liquidity on the map timeframe: confirmed structural swings,
    plus single-candle liquidity from decision (wide-range) candles."""
    pools: list[LiquidityPool] = []
    highs, lows = find_swings(candles, left, right)
    for sw in highs:
        pools.append(LiquidityPool(sw.price, "buyside", "structural", sw.time))
    for sw in lows:
        pools.append(LiquidityPool(sw.price, "sellside", "structural", sw.time))
    if atr_val > 0:
        for c in candles:
            if c.high - c.low >= decision_atr_mult * atr_val:
                pools.append(LiquidityPool(c.high, "buyside", "single-candle", c.time))
                pools.append(LiquidityPool(c.low, "sellside", "single-candle", c.time))
    return pools


# ---------------------------------------------------------------- key levels


def fvg_zones(candles: list[Candle], lookback: int) -> list[Imbalance]:
    """Unmitigated 3-candle fair value gaps near the current price."""
    n = len(candles)
    out: list[Imbalance] = []
    for i in range(max(1, n - 1 - lookback), n - 1):
        a, b, c = candles[i - 1], candles[i], candles[i + 1]
        if c.low > a.high:
            lo, hi, direction = a.high, c.low, "bullish"
        elif c.high < a.low:
            lo, hi, direction = c.high, a.low, "bearish"
        else:
            continue
        mitigated = False
        for j in range(i + 2, n):
            if direction == "bullish" and candles[j].low <= lo:
                mitigated = True
                break
            if direction == "bearish" and candles[j].high >= hi:
                mitigated = True
                break
        if not mitigated:
            out.append(Imbalance(lo=lo, hi=hi, direction=direction, time=b.time))
    return out


def key_levels(candles: list[Candle], cfg) -> list[KeyLevel]:
    """A/V line-chart extrema and Open-Close decision zones, with touch and
    flip accounting. Line-chart logic uses closes; OC levels need full OHLC."""
    n = len(candles)
    atr_val = atr(candles, cfg.atr_period)
    tol = cfg.level_tolerance_atr * atr_val
    v = cfg.av_len
    lookback = cfg.level_lookback
    closes = [c.close for c in candles]
    levels: list[KeyLevel] = []

    for i in range(max(v, n - lookback), n - v):
        if all(closes[i] > closes[i - k] for k in range(1, v + 1)) and all(
            closes[i] >= closes[i + k] for k in range(1, v + 1)
        ):
            levels.append(
                KeyLevel("A", closes[i], closes[i] - tol, closes[i] + tol,
                         candles[i].time, i)
            )
        if all(closes[i] < closes[i - k] for k in range(1, v + 1)) and all(
            closes[i] <= closes[i + k] for k in range(1, v + 1)
        ):
            levels.append(
                KeyLevel("V", closes[i], closes[i] - tol, closes[i] + tol,
                         candles[i].time, i)
            )

    for i in range(max(1, n - lookback), n):
        c = candles[i]
        if atr_val > 0 and (c.high - c.low) >= cfg.decision_atr_mult * atr_val:
            levels.append(
                KeyLevel("OC", c.close, min(c.open, c.close), max(c.open, c.close),
                         c.time, i)
            )

    # touches and flips — only bars after the level's own origin
    for lv in levels:
        for j in range(lv.origin_index + 1, n):
            c = candles[j]
            broke_up = c.close > lv.zone_hi + cfg.flip_margin_atr * atr_val
            broke_dn = c.close < lv.zone_lo - cfg.flip_margin_atr * atr_val
            if broke_up or broke_dn:
                lv.flipped = True
            elif c.high >= lv.zone_lo and c.low <= lv.zone_hi:
                lv.touches += 1
    return levels


def mark_fvg_overlap(levels: list[KeyLevel], imbalances: list[Imbalance]) -> None:
    for lv in levels:
        lv.fvg_overlap = any(
            not (imb.hi < lv.zone_lo or imb.lo > lv.zone_hi) for imb in imbalances
        )


def select_origin(
    levels: list[KeyLevel],
    price: float,
    atr_val: float,
    direction: Direction,
    cfg,
) -> KeyLevel | None:
    """Pick the origin key level on the entry side of price.

    Shorts need a level above price (sell into premium), longs below price.
    Ranking favours FVG overlap (high-priority levels per the research),
    multiple touches, flipped levels, and proximity."""
    if atr_val <= 0:
        return None
    best: tuple[float, KeyLevel] | None = None
    for lv in levels:
        if direction is Direction.SHORT:
            if price >= lv.zone_hi:
                continue
            dist = lv.zone_lo - price
        else:
            if price <= lv.zone_lo:
                continue
            dist = price - lv.zone_hi
        dist_atr = dist / atr_val
        if dist_atr > cfg.zone_max_distance_atr:
            continue
        score = (
            (2.0 if lv.fvg_overlap else 0.0)
            + 0.5 * min(lv.touches, 3)
            + (0.25 if lv.flipped else 0.0)
            + 1.0 / (1.0 + dist_atr)
        )
        if best is None or score > best[0]:
            best = (score, lv)
    return best[1] if best else None
