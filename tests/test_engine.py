"""State-machine tests for the SLK XYZ execution engine.

Synthetic fixtures only — these verify the MAP→TOUCH→SWEEP→SHIFT→RETEST
transition logic, invalidation, and alert field population. They are NOT
backtests and say nothing about profitability.
"""
from datetime import timedelta

import pytest

from slk_bot.config import StrategyConfig
from slk_bot.models import Direction
from slk_bot.slk.engine import PARAM_VERSION, scan_entry
from slk_bot.slk.types import KeyLevel, LiquidityPool, Storyline

from helpers import BASE, mk_candles

# 30m entry candles. Structure:
#   bar4   swing high 104.55 = resting buyside internal liquidity
#   bar7   swing low 104.03  = pullback structure (BOS reference)
#   bar10  wick 105.10 into the origin zone [104.95, 105.05], closes back
#          under 104.55 -> TOUCH + SWEEP (short side)
#   bar11  close 103.90 < 104.03 -> SHIFT (BOS)
#   bar14  high 105.00 back in zone after price left -> RETEST -> ALERT
SHORT_ROWS = [
    (103.80, 103.86, 103.74, 103.82),
    (103.82, 103.92, 103.78, 103.90),
    (103.90, 104.04, 103.86, 104.00),
    (104.00, 104.15, 103.95, 104.10),
    (104.10, 104.55, 104.05, 104.50),
    (104.50, 104.52, 104.25, 104.30),
    (104.30, 104.33, 104.10, 104.15),
    (104.15, 104.20, 104.03, 104.06),
    (104.06, 104.30, 104.06, 104.25),
    (104.25, 104.40, 104.20, 104.35),
    (104.35, 105.10, 104.30, 104.50),  # 10 touch+sweep
    (104.50, 104.62, 103.85, 103.90),  # 11 BOS
    (103.90, 103.95, 103.55, 103.60),  # 12
    (103.60, 103.75, 103.50, 103.55),  # 13
    (103.55, 105.00, 103.50, 104.90),  # 14 retest -> alert @ 104.90
]

# Mirror image for a long: zone [97.95, 98.05] below price, pool 97.45,
# ref 98.50, sweep bar10 (low 96.90), BOS bar11 (close 98.60), retest bar14.
LONG_ROWS = [
    (100.20, 100.26, 100.14, 100.18),
    (100.18, 100.22, 100.08, 100.10),
    (100.10, 100.14, 99.96, 100.00),
    (100.00, 100.06, 99.85, 99.90),
    (99.90, 99.95, 97.45, 97.50),
    (97.50, 97.75, 97.48, 97.70),
    (97.70, 97.90, 97.67, 97.85),
    (97.85, 98.50, 97.80, 98.45),
    (98.45, 98.47, 98.15, 98.20),
    (98.20, 98.30, 98.10, 98.25),
    (98.25, 98.30, 96.90, 97.55),   # 10 touch+sweep
    (97.55, 98.70, 98.45, 98.60),   # 11 BOS (fully above zone)
    (98.60, 98.75, 98.40, 98.55),   # 12
    (98.55, 98.60, 98.30, 98.45),   # 13
    (98.45, 98.52, 97.80, 98.10),   # 14 retest -> alert @ 98.10
]


def make_story(direction, zone, origin_price, pools, target, kind="A"):
    lv = KeyLevel(
        kind=kind, origin_price=origin_price, zone_lo=zone[0], zone_hi=zone[1],
        origin_time=BASE, origin_index=5, touches=2, fvg_overlap=True,
    )
    return Storyline(
        asof=BASE, valid=True, direction=direction,
        environment="bearish" if direction is Direction.SHORT else "bullish",
        phase="pullback", htf_alignment="M:? W:↓ D:↓ H4:↓",
        origin=lv, draw_on_liquidity=target, nearest_external_target=target,
        internal_pools=pools, external_pools=[], imbalances=[],
        map_close=104.0 if direction is Direction.SHORT else 100.0,
    )


SHORT_STORY = make_story(
    Direction.SHORT, (104.95, 105.05), 105.00,
    pools=[
        LiquidityPool(104.00, "sellside", "structural", BASE),
        LiquidityPool(103.50, "sellside", "single-candle", BASE),
        LiquidityPool(105.80, "buyside", "structural", BASE),
    ],
    target=101.00,
)
LONG_STORY = make_story(
    Direction.LONG, (97.75, 98.05), 98.00,
    pools=[
        LiquidityPool(100.00, "buyside", "structural", BASE),
        LiquidityPool(100.50, "buyside", "single-candle", BASE),
    ],
    target=103.00,
)


def snaps_for(story):
    # snapshot valid from 4h before the first entry candle
    return [(BASE - timedelta(hours=8), story)]


@pytest.fixture
def cfg():
    return StrategyConfig()


class TestShortPath:
    def test_full_confirmation_entry(self, cfg):
        candles = mk_candles(SHORT_ROWS, step_minutes=30)
        alerts, events = scan_entry(
            pair="EURUSD", entry_tf="30m", tf_seconds=1800, candles=candles,
            snaps=snaps_for(SHORT_STORY), cfg=cfg,
        )
        assert len(alerts) == 1
        a = alerts[0]
        assert a.direction is Direction.SHORT
        assert a.entry == 104.90                       # retest candle close
        assert a.invalidation_level == 105.10          # sweep extreme
        assert a.stop_loss > 105.10                    # extreme + ATR buffer
        assert a.tp_internal == 104.00                 # nearest sellside internal pool
        assert a.tp_external == 101.00                 # external draw target
        assert a.sweep_time == candles[10].time
        assert a.bos_time == candles[11].time
        assert a.return_time == candles[14].time
        assert a.key_level_type == "A"
        assert a.key_level_bounds == (104.95, 105.05)
        assert a.key_level_tested is True
        assert a.environment == "bearish" and a.phase == "pullback"
        assert a.opposing_liquidity_standing is True
        assert a.entry_mode == "confirmation"
        assert a.parameter_version == PARAM_VERSION
        assert a.risk == pytest.approx(abs(104.90 - a.stop_loss))

        states = [e.state for e in events]
        assert states == ["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]
        assert all(e.setup_id == a.setup_id for e in events)

    def test_deterministic_replay(self, cfg):
        candles = mk_candles(SHORT_ROWS, step_minutes=30)
        a1, e1 = scan_entry(pair="EURUSD", entry_tf="30m", tf_seconds=1800,
                            candles=candles, snaps=snaps_for(SHORT_STORY), cfg=cfg)
        a2, e2 = scan_entry(pair="EURUSD", entry_tf="30m", tf_seconds=1800,
                            candles=candles, snaps=snaps_for(SHORT_STORY), cfg=cfg)
        assert [x.setup_id for x in a1] == [x.setup_id for x in a2]
        assert [(e.setup_id, e.state, e.candle_time) for e in e1] == [
            (e.setup_id, e.state, e.candle_time) for e in e2
        ]


class TestLongPath:
    def test_long_mirror(self, cfg):
        candles = mk_candles(LONG_ROWS, step_minutes=30)
        alerts, events = scan_entry(
            pair="GBPUSD", entry_tf="30m", tf_seconds=1800, candles=candles,
            snaps=snaps_for(LONG_STORY), cfg=cfg,
        )
        assert len(alerts) == 1
        a = alerts[0]
        assert a.direction is Direction.LONG
        assert a.entry == 98.10
        assert a.invalidation_level == 96.90
        assert a.stop_loss < 96.90
        assert a.tp_internal == 100.00
        assert a.tp_external == 103.00
        assert [e.state for e in events] == ["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]


class TestFailurePaths:
    def test_invalidation_on_close_beyond_sweep_extreme(self, cfg):
        rows = SHORT_ROWS[:12] + [
            (103.90, 105.60, 103.85, 105.30),  # closes beyond 105.10 extreme
        ]
        candles = mk_candles(rows, step_minutes=30)
        alerts, events = scan_entry(
            pair="EURUSD", entry_tf="30m", tf_seconds=1800, candles=candles,
            snaps=snaps_for(SHORT_STORY), cfg=cfg,
        )
        assert alerts == []
        assert events[-1].state == "INVALID"
        assert "invalidation level" in events[-1].reason

    def test_no_storyline_no_setup(self, cfg):
        candles = mk_candles(SHORT_ROWS, step_minutes=30)
        alerts, events = scan_entry(
            pair="EURUSD", entry_tf="30m", tf_seconds=1800, candles=candles,
            snaps=[], cfg=cfg,
        )
        assert alerts == [] and events == []

    def test_invalid_storyline_arms_nothing(self, cfg):
        dead = Storyline(asof=BASE, valid=False, reason="no directional H4 environment")
        candles = mk_candles(SHORT_ROWS, step_minutes=30)
        alerts, events = scan_entry(
            pair="EURUSD", entry_tf="30m", tf_seconds=1800, candles=candles,
            snaps=snaps_for(dead), cfg=cfg,
        )
        assert alerts == [] and events == []

    def test_no_retest_expires(self, cfg):
        rows = SHORT_ROWS[:12] + [
            (103.90, 104.00, 103.40, 103.50),   # drifts down, never returns
            (103.50, 103.60, 103.30, 103.40),
            (103.40, 103.50, 103.10, 103.20),
        ]
        cfg.retest_window = 2                     # expire quickly
        candles = mk_candles(rows, step_minutes=30)
        alerts, events = scan_entry(
            pair="EURUSD", entry_tf="30m", tf_seconds=1800, candles=candles,
            snaps=snaps_for(SHORT_STORY), cfg=cfg,
        )
        assert alerts == []
        assert events[-1].state == "EXPIRED"

    def test_session_allowlist_suppresses_alert(self, cfg):
        cfg.sessions_allowlist = [["Nowhere", "01:00", "02:00"]]  # UTC, bar14 ends 07:30
        candles = mk_candles(SHORT_ROWS, step_minutes=30)
        alerts, _ = scan_entry(
            pair="EURUSD", entry_tf="30m", tf_seconds=1800, candles=candles,
            snaps=snaps_for(SHORT_STORY), cfg=cfg,
        )
        assert len(alerts) == 1
        assert alerts[0].alert_status == "SUPPRESSED"
        assert alerts[0].suppress_reason == "outside session allowlist"
