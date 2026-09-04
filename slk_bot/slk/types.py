"""Typed records for the SLK model engine."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ..models import Direction


@dataclass(frozen=True)
class Swing:
    index: int
    price: float
    time: datetime
    kind: str  # "high" | "low"


@dataclass
class LiquidityPool:
    price: float
    side: str  # "buyside" | "sellside"
    kind: str  # PDH/PDL/PWH/PWL/PMH/PML/external-swing/structural/single-candle
    source_time: datetime

    def as_dict(self) -> dict:
        return {
            "price": self.price,
            "side": self.side,
            "kind": self.kind,
            "time": self.source_time.isoformat(),
        }


@dataclass
class Imbalance:
    """Fair value gap / imbalanced price action zone."""

    lo: float
    hi: float
    direction: str  # "bullish" | "bearish"
    time: datetime

    def as_dict(self) -> dict:
        return {"lo": self.lo, "hi": self.hi, "direction": self.direction}


@dataclass
class KeyLevel:
    """An origin key level. kind: "A" (A-shaped top), "V" (V-shaped bottom),
    "OC" (open-close / decision-candle zone)."""

    kind: str
    origin_price: float
    zone_lo: float
    zone_hi: float
    origin_time: datetime
    origin_index: int
    touches: int = 0
    flipped: bool = False       # price closed decisively through it at some point
    fvg_overlap: bool = False   # overlaps an unmitigated imbalance zone


@dataclass
class Storyline:
    """Layer-1 (ABC) snapshot, built from HTF candles as of ``asof``."""

    asof: datetime
    valid: bool
    reason: str = ""
    direction: Direction | None = None
    environment: str = "consolidation"  # bullish | bearish | consolidation
    phase: str = "range"                # expansion | pullback | reversal | range
    htf_alignment: str = ""
    origin: KeyLevel | None = None
    draw_on_liquidity: float | None = None
    nearest_external_target: float | None = None
    internal_pools: list[LiquidityPool] = field(default_factory=list)
    external_pools: list[LiquidityPool] = field(default_factory=list)
    imbalances: list[Imbalance] = field(default_factory=list)
    map_close: float = 0.0


@dataclass
class Setup:
    """Mutable Layer-2 (XYZ) execution state during replay. Lives only for the
    duration of one scan — the engine is stateless across scans; persistence
    and idempotency come from the events table and the alerts dedupe key."""

    setup_id: str
    direction: Direction
    level: KeyLevel
    state: str = "MAP"  # MAP → TOUCH → SWEEP/SHIFT → RETEST → ALERT | INVALID | EXPIRED
    map_index: int = 0
    map_time: datetime | None = None
    touch_index: int = 0
    touch_time: datetime | None = None
    swept_pool_index: int = -1
    swept_pool_price: float = 0.0
    sweep_index: int = 0
    sweep_time: datetime | None = None
    extreme: float = 0.0        # running sweep extreme (invalidation anchor)
    ref_price: float = 0.0      # pullback structure that BOS must break
    bos_index: int = 0
    bos_time: datetime | None = None
    inv_level: float = 0.0      # frozen invalidation level after BOS
    left_zone: bool = False     # price departed the zone after BOS (real retest)
    # storyline snapshot captured when armed
    environment: str = ""
    phase: str = ""
    htf_alignment: str = ""
    draw_on_liquidity: float | None = None
    nearest_external_target: float | None = None
    internal_pools: list[LiquidityPool] = field(default_factory=list)
    external_pools: list[LiquidityPool] = field(default_factory=list)
    imbalances: list[Imbalance] = field(default_factory=list)


@dataclass
class Alert:
    """A fired SLK confirmation-entry alert (persisted to the alerts table)."""

    setup_id: str
    pair: str
    entry_tf: str
    map_tf: str
    direction: Direction
    entry: float
    stop_loss: float
    tp_internal: float
    tp_external: float | None
    candle_close_time: datetime
    environment: str
    phase: str
    htf_alignment: str
    origin_key_level: float
    key_level_type: str
    key_level_bounds: tuple[float, float]
    key_level_tested: bool
    key_level_flipped: bool
    imbalance_context: list
    internal_liquidity: list
    external_liquidity: list
    draw_on_liquidity: float | None
    nearest_external_target: float | None
    intermediate_zones: list
    opposing_liquidity_standing: bool
    sweep_time: datetime
    bos_time: datetime
    return_time: datetime
    invalidation_level: float
    invalidation_reason: str | None = None
    parameter_version: str = ""
    alert_status: str = "PAPER"          # PAPER | SENT | SUPPRESSED
    suppress_reason: str | None = None
    session: str | None = None
    atr_entry: float = 0.0
    rr_internal: float | None = None
    cycle_stage: str = "entry_alert"
    entry_mode: str = "confirmation"

    @property
    def risk(self) -> float:
        return abs(self.entry - self.stop_loss)


@dataclass(frozen=True)
class Event:
    """An auditable state-machine transition."""

    setup_id: str
    pair: str
    state: str  # MAP/TOUCH/SWEEP/SHIFT/RETEST/INVALID/EXPIRED
    candle_time: datetime
    reason: str
    price: float | None = None
