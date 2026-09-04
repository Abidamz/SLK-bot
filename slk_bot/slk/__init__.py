"""SLK model engine — Structure, Liquidity, Key Levels.

Architecture (from the user's source-material research):

  Layer 1 — ABC storyline (expectation): higher-timeframe environment and
  phase (M/W/D/H4), origin key level (A-shaped, V-shaped, Open-Close, tested,
  flipped), imbalance/FVG context, internal + external liquidity map, draw on
  liquidity and the nearest external target.

  Layer 2 — XYZ execution (entry): MAP → TOUCH → SWEEP → SHIFT → RETEST →
  ALERT (or INVALID / EXPIRED), evaluated on a lower entry timeframe against
  the armed storyline. Confirmation-entry mode only.

Everything here is pure functions/data — no I/O — so every rule stays
unit-testable and auditable.
"""
from .engine import PARAM_VERSION, scan_entry
from .storyline import build_storyline, storyline_series
from .types import Alert, Event, KeyLevel, LiquidityPool, Setup, Storyline, Swing

__all__ = [
    "PARAM_VERSION",
    "scan_entry",
    "build_storyline",
    "storyline_series",
    "Alert",
    "Event",
    "KeyLevel",
    "LiquidityPool",
    "Setup",
    "Storyline",
    "Swing",
]
