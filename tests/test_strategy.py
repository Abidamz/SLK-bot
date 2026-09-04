"""Unit tests for the SLK model detection engine."""
from datetime import datetime, timedelta, timezone

import pytest

from slk_bot.config import StrategyConfig
from slk_bot.models import Candle, Direction
from slk_bot.strategy.slk import atr, detect_signals, find_swings, session_for
from slk_bot.data.base import drop_incomplete

BASE = datetime(2024, 1, 1, tzinfo=timezone.utc)


def mk_candles(rows, step_minutes=15):
    """rows: list of (open, high, low, close); candles stamped `step` apart."""
    return [
        Candle(
            time=BASE + timedelta(minutes=step_minutes * i),
            open=float(o),
            high=float(h),
            low=float(l),
            close=float(c),
        )
        for i, (o, h, l, c) in enumerate(rows)
    ]


@pytest.fixture
def cfg():
    return StrategyConfig(
        swing_left=1,
        swing_right=1,
        lookback=120,
        sweep_window=10,
        mss_window=12,
        sl_buffer_atr=0.0,
        min_risk_atr=0.0,
        min_tp_r=0.0,
        tp_mode="rr",
        rr_target=2.0,
        use_killzones=False,
    )


# A classic short setup:
#   idx4 prints a swing high at 110, price pulls back to a swing low (103, idx6),
#   idx9 sweeps the 110 liquidity (high 110.5) and closes back below,
#   idx11 closes under the 103 structure low -> market structure shift -> SHORT.
SHORT_SCENARIO = [
    (100.0, 101.0, 99.5, 100.2),
    (100.2, 103.0, 100.0, 102.8),
    (102.8, 106.0, 102.5, 105.5),
    (105.5, 108.0, 105.0, 107.5),
    (107.5, 110.0, 107.0, 108.0),  # idx4  swing high 110
    (108.0, 108.5, 105.5, 106.0),
    (106.0, 106.5, 103.0, 103.5),  # idx6  swing low 103
    (103.5, 105.0, 103.2, 104.5),
    (104.5, 108.0, 104.0, 107.5),
    (107.5, 110.5, 107.0, 108.2),  # idx9  SWEEP of 110
    (108.2, 108.4, 104.5, 104.8),
    (104.8, 105.0, 101.5, 102.0),  # idx11 MSS: close < 103  -> SHORT
]

# Mirror image for a long setup.
LONG_SCENARIO = [
    (100.0, 100.5, 99.0, 99.8),
    (99.8, 100.0, 97.0, 97.2),
    (97.2, 97.5, 94.0, 94.3),
    (94.3, 94.8, 92.0, 92.4),
    (92.4, 93.0, 90.0, 91.2),  # idx4  swing low 90
    (91.2, 92.5, 91.5, 92.2),
    (92.2, 96.0, 92.0, 95.8),  # idx6  swing high 96
    (95.8, 95.9, 94.5, 95.0),
    (95.0, 95.2, 91.5, 92.0),
    (92.0, 92.3, 89.5, 90.5),  # idx9  SWEEP of 90
    (90.5, 93.0, 90.0, 92.8),
    (92.8, 97.0, 92.5, 96.5),  # idx11 MSS: close > 96   -> LONG
]


class TestSwings:
    def test_swing_points(self):
        candles = mk_candles(SHORT_SCENARIO)
        highs, lows = find_swings(candles, left=1, right=1)
        assert [(s.index, s.price) for s in highs] == [(4, 110.0), (9, 110.5)]
        assert [(s.index, s.price) for s in lows] == [(6, 103.0)]

    def test_no_lookahead(self):
        # with right=1 the last candle can never be confirmed as a swing
        candles = mk_candles(SHORT_SCENARIO)
        highs, lows = find_swings(candles, 1, 1)
        assert highs[-1].index <= len(candles) - 2
        assert lows[-1].index <= len(candles) - 2


class TestShortSignal:
    def test_full_sequence(self, cfg):
        candles = mk_candles(SHORT_SCENARIO)
        sigs = detect_signals(candles, cfg, "EURUSD", "15m")
        assert len(sigs) == 1
        sig = sigs[0]
        assert sig.direction is Direction.SHORT
        assert sig.pair == "EURUSD"
        assert sig.entry == 102.0                      # close of the MSS candle
        assert sig.stop_loss == 110.5                  # sweep extreme
        assert sig.take_profit == pytest.approx(85.0)  # 2R target
        assert sig.risk == pytest.approx(8.5)
        assert sig.rr == pytest.approx(2.0)
        assert sig.sweep_level == 110.0                # the raided swing high
        assert sig.sweep_time == candles[9].time       # sweep candle time
        assert sig.signal_time == candles[11].time

    def test_no_mss_no_signal(self, cfg):
        rows = [r for r in SHORT_SCENARIO]
        rows[11] = (104.8, 105.0, 103.5, 104.0)  # closes above 103 -> no shift
        sigs = detect_signals(mk_candles(rows), cfg, "EURUSD", "15m")
        assert sigs == []

    def test_no_sweep_no_signal(self, cfg):
        rows = [r for r in SHORT_SCENARIO]
        rows[9] = (107.5, 109.5, 107.0, 108.2)  # never takes out 110
        rows[11] = (104.8, 105.0, 100.0, 101.0)  # even with a break of 103
        sigs = detect_signals(mk_candles(rows), cfg, "EURUSD", "15m")
        assert sigs == []

    def test_stale_event_not_returned_without_fresh_window(self, cfg):
        # MSS happened one candle ago: fresh_window=0 must stay silent …
        candles = mk_candles(SHORT_SCENARIO + [(102.0, 103.0, 101.0, 102.5)])
        assert detect_signals(candles, cfg, "EURUSD", "15m") == []
        # … and fresh_window=1 must find it (backfill mode)
        sigs = detect_signals(candles, cfg, "EURUSD", "15m", fresh_window=1)
        assert len(sigs) == 1 and sigs[0].signal_time == candles[11].time

    def test_killzone_blocks_signal(self, cfg):
        cfg.use_killzones = True
        candles = mk_candles(SHORT_SCENARIO)  # BASE = 00:00 UTC -> outside zones
        assert detect_signals(candles, cfg, "EURUSD", "15m") == []


class TestLongSignal:
    def test_full_sequence(self, cfg):
        candles = mk_candles(LONG_SCENARIO)
        sigs = detect_signals(candles, cfg, "EURUSD", "15m")
        assert len(sigs) == 1
        sig = sigs[0]
        assert sig.direction is Direction.LONG
        assert sig.entry == 96.5
        assert sig.stop_loss == 89.5                       # sweep extreme
        assert sig.take_profit == pytest.approx(110.5)     # 2R
        assert sig.sweep_level == 90.0                     # the raided swing low
        assert sig.sweep_time == candles[9].time


class TestHelpers:
    def test_atr(self):
        candles = mk_candles([(100, 104, 99, 102)] * 20)
        assert atr(candles, 14) == pytest.approx(5.0)

    def test_session_windows(self):
        zones = [["London", "07:00", "10:00"], ["NewYork", "12:00", "15:00"]]
        at = lambda hh, mm: datetime(2024, 1, 1, hh, mm, tzinfo=timezone.utc)
        assert session_for(at(8, 30), zones) == "London"
        assert session_for(at(7, 0), zones) == "London"     # start inclusive
        assert session_for(at(10, 0), zones) is None        # end exclusive
        assert session_for(at(12, 30), zones) == "NewYork"
        assert session_for(at(5, 0), zones) is None

    def test_overnight_window(self):
        zones = [["Asia", "22:00", "02:00"]]
        at = lambda hh, mm: datetime(2024, 1, 1, hh, mm, tzinfo=timezone.utc)
        assert session_for(at(23, 15), zones) == "Asia"
        assert session_for(at(0, 45), zones) == "Asia"
        assert session_for(at(12, 0), zones) is None

    def test_drop_incomplete(self):
        now = datetime.now(timezone.utc)
        c1 = Candle(now - timedelta(seconds=1800), 1, 2, 0.5, 1.5)  # closed
        c2 = Candle(now - timedelta(seconds=5), 1, 2, 0.5, 1.5)     # in progress
        kept = drop_incomplete([c1, c2], 900, now=now)
        assert kept == [c1]
