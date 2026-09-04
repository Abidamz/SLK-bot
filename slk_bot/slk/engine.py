"""Layer 2 — XYZ execution engine (confirmation-entry mode).

Replays the trailing ``setup_window`` of entry-timeframe candles against
point-in-time storyline snapshots and walks each direction through:

    MAP      an armed origin key level on the correct side of price
    TOUCH    price trades into the origin zone
    SWEEP    counter-side internal liquidity is swept inside the zone
             (wick beyond a resting swing pool, close back inside)
    SHIFT    entry-timeframe BOS: close beyond the pullback structure
    RETEST   return to the V-level/origin zone  → ALERT
    INVALID  close beyond the sweep extreme / key level / HTF story flip
    EXPIRED  a stage timed out

Confirmation-entry mode is the only mode (direct key-level entries stay
disabled, per the research). Every transition is emitted as an auditable
Event; alerts carry the full persistence record. The engine is stateless
across scans — idempotency comes from event/alerts dedupe keys in the DB.
"""
from __future__ import annotations

import hashlib
import logging
from bisect import bisect_right
from datetime import timedelta

from ..models import Candle, Direction
from . import features as F
from .storyline import MAP_TF_SECONDS
from .types import Alert, Event, Storyline, Setup

log = logging.getLogger(__name__)

PARAM_VERSION = "slk-r2.0"


def _setup_id(pair: str, entry_tf: str, d: Direction, level, story_asof) -> str:
    raw = (
        f"{pair}|{entry_tf}|{d.value}|{level.kind}|{level.origin_price:.6f}|"
        f"{level.origin_time.isoformat()}|{story_asof.isoformat()}"
    )
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def scan_entry(
    *,
    pair: str,
    entry_tf: str,
    tf_seconds: int,
    candles: list[Candle],
    snaps: list[tuple, list],
    cfg,
    mode: str = "paper",
) -> tuple[list[Alert], list[Event]]:
    """Replay entry candles and return (alerts, events). ``snaps`` is the
    output of ``storyline_series`` — [(h4_open_time, Storyline)]."""
    alerts: list[Alert] = []
    events: list[Event] = []
    min_bars = cfg.pivot_left + cfg.pivot_right + 6
    if len(candles) < min_bars:
        return alerts, events

    # snapshot validity starts when that H4 candle has closed
    valid_from = sorted(t + timedelta(seconds=MAP_TF_SECONDS) for t, _ in snaps)
    story_by_key = {t + timedelta(seconds=MAP_TF_SECONDS): s for t, s in snaps}

    def story_at(close_time) -> Storyline | None:
        i = bisect_right(valid_from, close_time) - 1
        return story_by_key[valid_from[i]] if i >= 0 else None

    atr_e = F.atr(candles, cfg.atr_period)
    highs, lows = F.find_swings(candles, cfg.pivot_left, cfg.pivot_right)
    conf = cfg.pivot_right  # a pool is only usable once confirmed
    start = max(0, len(candles) - cfg.setup_window)
    active: dict[Direction, Setup | None] = {Direction.LONG: None, Direction.SHORT: None}

    def emit(s: Setup, state: str, c: Candle, reason: str, price=None) -> None:
        events.append(Event(s.setup_id, pair, state, c.time, reason, price))
        log.info("%-7s %s %s %s — %s", state, pair, entry_tf, s.setup_id, reason)

    def kill(s: Setup, state: str, c: Candle, reason: str) -> None:
        emit(s, state, c, reason, c.close)
        active[s.direction] = None

    for i in range(start, len(candles)):
        c = candles[i]
        close_time = c.time + timedelta(seconds=tf_seconds)
        story = story_at(close_time)

        for d in (Direction.SHORT, Direction.LONG):
            is_short = d is Direction.SHORT
            s = active[d]

            # ---- arming (MAP) ------------------------------------------
            if s is None and story and story.valid and story.direction is d and story.origin:
                lv = story.origin
                on_side = c.close < lv.zone_lo if is_short else c.close > lv.zone_hi
                if on_side:
                    sid = _setup_id(pair, entry_tf, d, lv, story.asof)
                    s = Setup(
                        setup_id=sid, direction=d, level=lv,
                        map_index=i, map_time=c.time,
                        environment=story.environment, phase=story.phase,
                        htf_alignment=story.htf_alignment,
                        draw_on_liquidity=story.draw_on_liquidity,
                        nearest_external_target=story.nearest_external_target,
                        internal_pools=list(story.internal_pools),
                        external_pools=list(story.external_pools),
                        imbalances=list(story.imbalances),
                    )
                    active[d] = s
                    emit(s, "MAP", c,
                         f"{lv.kind}-level {lv.origin_price:g} armed "
                         f"({story.environment}/{story.phase})",
                         lv.origin_price)
            if s is None:
                continue

            z = s.level

            # ---- HTF story flip ----------------------------------------
            if story is not None and story.valid and story.direction is not d:
                kill(s, "INVALID", c, "HTF storyline invalidation")
                continue

            broke_level = (
                c.close > z.zone_hi + cfg.flip_margin_atr * atr_e
                if is_short
                else c.close < z.zone_lo - cfg.flip_margin_atr * atr_e
            )

            # ---- MAP → TOUCH -------------------------------------------
            if s.state == "MAP":
                if broke_level:
                    kill(s, "INVALID", c, "close beyond key level (level may flip)")
                    continue
                touched = c.high >= z.zone_lo if is_short else c.low <= z.zone_hi
                if touched:
                    s.state = "TOUCH"
                    s.touch_index, s.touch_time = i, c.time
                    emit(s, "TOUCH", c, "price entered the origin zone", c.close)
                elif i - s.map_index > cfg.touch_window:
                    kill(s, "EXPIRED", c, "level not reached in time")
                    continue

            # ---- TOUCH → SWEEP -----------------------------------------
            if s.state == "TOUCH":
                if broke_level:
                    kill(s, "INVALID", c, "close beyond key level without a sweep")
                    continue
                pools = highs if is_short else lows
                swept = [
                    sw for sw in pools
                    if sw.index <= s.touch_index and sw.index + conf <= i
                    and (
                        (c.high > sw.price and c.close < sw.price)
                        if is_short
                        else (c.low < sw.price and c.close > sw.price)
                    )
                    and (c.high >= z.zone_lo if is_short else c.low <= z.zone_hi)
                ]
                if swept:
                    pick = max(swept, key=lambda w: w.price) if is_short else min(
                        swept, key=lambda w: w.price
                    )
                    s.swept_pool_index, s.swept_pool_price = pick.index, pick.price
                    s.sweep_index, s.sweep_time = i, c.time
                    s.extreme = c.high if is_short else c.low
                    refs = [
                        rw for rw in (lows if is_short else highs)
                        if pick.index < rw.index <= i and rw.index + conf <= i
                    ]
                    if refs:
                        s.ref_price = refs[-1].price
                    else:
                        seg = candles[s.touch_index : i + 1]
                        s.ref_price = (
                            min(x.low for x in seg) if is_short
                            else max(x.high for x in seg)
                        )
                    s.state = "SHIFT"
                    emit(s, "SWEEP", c,
                         f"swept {'buyside' if is_short else 'sellside'} internal "
                         f"liquidity @ {pick.price:g}", pick.price)
                elif i - s.touch_index > cfg.sweep_window:
                    kill(s, "EXPIRED", c, "no liquidity sweep after the touch")
                    continue

            # ---- SWEEP → SHIFT (BOS) -----------------------------------
            if s.state == "SHIFT":
                if i > s.sweep_index:
                    prev = candles[i - 1]
                    s.extreme = (
                        max(s.extreme, prev.high) if is_short
                        else min(s.extreme, prev.low)
                    )
                violated = c.close > s.extreme if is_short else c.close < s.extreme
                if violated:
                    kill(s, "INVALID", c, "close beyond sweep extreme")
                    continue
                bos = c.close < s.ref_price if is_short else c.close > s.ref_price
                if bos:
                    s.inv_level = (
                        max(s.extreme, c.high) if is_short
                        else min(s.extreme, c.low)
                    )
                    s.bos_index, s.bos_time = i, c.time
                    s.state = "RETEST"
                    emit(s, "SHIFT", c,
                         f"BOS through pullback structure {s.ref_price:g}", c.close)
                elif i - s.sweep_index > cfg.bos_window:
                    kill(s, "EXPIRED", c, "no BOS after the sweep")
                    continue

            # ---- SHIFT → RETEST → ALERT --------------------------------
            if s.state == "RETEST":
                violated = (
                    c.close > s.inv_level if is_short else c.close < s.inv_level
                )
                if violated:
                    kill(s, "INVALID", c, "close beyond invalidation level")
                    continue
                if i > s.bos_index:  # retest must be a candle after the BOS
                    left = c.close < z.zone_lo if is_short else c.close > z.zone_hi
                    if left:
                        s.left_zone = True
                    tol = cfg.retest_tolerance_atr * atr_e
                    returns = (
                        c.high >= z.zone_lo - tol if is_short
                        else c.low <= z.zone_hi + tol
                    )
                    if s.left_zone and returns:
                        # opposing liquidity must remain standing for a
                        # reversal-style setup: the draw pool must be
                        # untouched since the setup was armed
                        if s.draw_on_liquidity is not None:
                            seg = candles[s.map_index : i + 1]
                            standing = (
                                all(x.low > s.draw_on_liquidity for x in seg)
                                if is_short
                                else all(x.high < s.draw_on_liquidity for x in seg)
                            )
                        else:
                            standing = False
                        alert = _build_alert(
                            pair=pair, entry_tf=entry_tf,
                            close_time=close_time, c=c, s=s,
                            is_short=is_short, atr_e=atr_e, cfg=cfg, mode=mode,
                            standing=standing,
                        )
                        if alert is not None:
                            emit(s, "RETEST", c,
                                 f"return to origin zone → confirmation entry "
                                 f"@ {c.close:g}", c.close)
                            alerts.append(alert)
                        active[d] = None
                        continue
                if i - s.bos_index > cfg.retest_window:
                    kill(s, "EXPIRED", c, "no retest of the origin zone")
                    continue

    return alerts, events


def _build_alert(
    *,
    pair, entry_tf, close_time, c, s: Setup, is_short, atr_e, cfg, mode, standing
) -> Alert | None:
    entry = c.close
    buf = cfg.sl_buffer_atr * atr_e
    sl = s.inv_level + buf if is_short else s.inv_level - buf
    risk = (sl - entry) if is_short else (entry - sl)
    if risk <= 0 or risk < cfg.min_risk_atr * atr_e:
        return None

    # targets: internal liquidity first, then the nearest external target
    side = "sellside" if is_short else "buyside"
    inner = [
        p.price for p in s.internal_pools
        if p.side == side and ((p.price < entry) if is_short else (p.price > entry))
    ]
    tp1 = (max(inner) if is_short else min(inner)) if inner else None
    tp2 = s.nearest_external_target
    if tp1 == tp2:
        tp2 = None
    if tp1 is None:
        tp1, tp2 = tp2, None
    if tp1 is None:
        return None
    rr1 = abs(tp1 - entry) / risk
    if rr1 < cfg.min_tp_r and tp2 is not None:
        # internal target too close to be useful — target the external draw
        tp1, tp2 = tp2, None
        rr1 = abs(tp1 - entry) / risk
    if rr1 < cfg.min_tp_r:
        return None

    sess = None
    if cfg.sessions_allowlist:
        sess = F.session_for(close_time, cfg.sessions_allowlist)
    status = "PAPER" if mode == "paper" else "SENT"
    suppress_reason = None
    if cfg.sessions_allowlist and sess is None:
        status, suppress_reason = "SUPPRESSED", "outside session allowlist"

    lo = min(entry, tp1)
    hi = max(entry, tp1)
    intermediate = [
        imb.as_dict() for imb in s.imbalances
        if not (imb.hi < lo or imb.lo > hi)
    ]

    return Alert(
        setup_id=s.setup_id, pair=pair, entry_tf=entry_tf, map_tf=cfg.map_tf_label,
        direction=s.direction, entry=entry, stop_loss=sl,
        tp_internal=tp1, tp_external=tp2, candle_close_time=close_time,
        environment=s.environment, phase=s.phase, htf_alignment=s.htf_alignment,
        origin_key_level=s.level.origin_price,
        key_level_type=s.level.kind,
        key_level_bounds=(s.level.zone_lo, s.level.zone_hi),
        key_level_tested=s.level.touches > 0,
        key_level_flipped=s.level.flipped,
        imbalance_context=[imb.as_dict() for imb in s.imbalances],
        internal_liquidity=[p.as_dict() for p in s.internal_pools],
        external_liquidity=[p.as_dict() for p in s.external_pools],
        draw_on_liquidity=s.draw_on_liquidity,
        nearest_external_target=s.nearest_external_target,
        intermediate_zones=intermediate,
        opposing_liquidity_standing=standing,
        sweep_time=s.sweep_time, bos_time=s.bos_time, return_time=c.time,
        invalidation_level=s.inv_level,
        parameter_version=PARAM_VERSION,
        alert_status=status, suppress_reason=suppress_reason,
        session=sess, atr_entry=atr_e, rr_internal=round(rr1, 2),
    )
