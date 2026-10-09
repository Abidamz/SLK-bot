"""Layer 1 — ABC storyline (expectation).

Built from the context timeframe (daily → weekly/monthly aggregates) and the
map timeframe (H4). A storyline is *valid* only when there is a directional
H4 environment, an opposing structure that has NOT been broken by a close,
an origin key level within reach of price, and a draw on liquidity to trade
towards.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..models import Candle, Direction
from . import features as F
from .types import Storyline

MAP_TF_SECONDS = 14400  # H4


def build_storyline(d1: list[Candle], h4: list[Candle], cfg) -> Storyline:
    """Build the storyline as-of the last candle of each input (callers slice
    inputs to avoid look-ahead when replaying)."""
    asof = h4[-1].time if h4 else datetime.now(timezone.utc)
    if len(h4) < 20:
        return Storyline(asof=asof, valid=False, reason="insufficient H4 data")
    if len(d1) < 10:
        return Storyline(asof=asof, valid=False, reason="insufficient daily data")

    env = F.environment(h4, cfg.pivot_left, cfg.pivot_right, cfg.min_swings_env)
    ph = F.phase(h4, env, cfg.phase_lookback, cfg.pivot_left, cfg.pivot_right)
    align = F.htf_alignment(d1, env, cfg.pivot_left, cfg.pivot_right)
    close = h4[-1].close

    story = Storyline(
        asof=asof, valid=False, environment=env, phase=ph,
        htf_alignment=align, map_close=close,
    )

    if env == "bullish":
        direction = Direction.LONG
    elif env == "bearish":
        direction = Direction.SHORT
    else:
        story.reason = "no directional H4 environment (consolidation)"
        return story
    story.direction = direction

    # HTF invalidation: a close through the opposing structure kills the story
    inv = F.structure_invalidation_level(h4, direction, cfg.pivot_left, cfg.pivot_right)
    if inv is not None:
        if direction is Direction.SHORT and close > inv:
            story.reason = f"H4 close {close:g} broke opposing structure {inv:g}"
            return story
        if direction is Direction.LONG and close < inv:
            story.reason = f"H4 close {close:g} broke opposing structure {inv:g}"
            return story

    atr_map = F.atr(h4, cfg.atr_period)
    ext = F.external_pools(d1, cfg.pivot_left, cfg.pivot_right)
    intp = F.internal_pools(h4, atr_map, cfg.decision_atr_mult,
                            cfg.pivot_left, cfg.pivot_right)
    imb = F.fvg_zones(h4, cfg.fvg_lookback)
    levels = F.key_levels(h4, cfg)
    F.mark_fvg_overlap(levels, imb)

    origin = F.select_origin(levels, close, atr_map, direction, cfg)
    if origin is None:
        story.reason = "no origin key level within reach of price"
        return story

    # draw on liquidity: nearest external pool in the environment direction
    if direction is Direction.SHORT:
        below = [p for p in ext if p.side == "sellside" and p.price < close]
        draw = max(below, key=lambda p: p.price) if below else None
    else:
        above = [p for p in ext if p.side == "buyside" and p.price > close]
        draw = min(above, key=lambda p: p.price) if above else None
    if draw is None:
        story.reason = "no external draw on liquidity in storyline direction"
        return story

    story.valid = True
    story.reason = "ok"
    story.origin = origin
    story.draw_on_liquidity = draw.price
    story.nearest_external_target = draw.price
    story.internal_pools = intp
    story.external_pools = ext
    story.imbalances = imb
    return story


def storyline_series(
    d1: list[Candle],
    h4: list[Candle],
    cfg,
    max_snapshots: int = 90,
) -> list[tuple[datetime, Storyline]]:
    """Storyline snapshots at each recent closed H4 candle, each built only
    from data closed at that moment (point-in-time correct for replay)."""
    n = len(h4)
    start = max(20, n - max_snapshots)
    snaps: list[tuple[datetime, Storyline]] = []
    day = timedelta(seconds=86400)
    for j in range(start, n):
        h4_close = h4[j].time + timedelta(seconds=MAP_TF_SECONDS)
        d_slice = [d for d in d1 if d.time + day <= h4_close]
        if len(d_slice) < 10:
            continue
        story = build_storyline(d_slice, h4[: j + 1], cfg)
        snaps.append((h4[j].time, story))
    return snaps
