"""Unit tests for SLK feature extraction (structure, liquidity, key levels).

All fixtures are synthetic — they verify logic, never performance.
"""
from datetime import datetime, timedelta, timezone

import pytest

from slk_bot.config import StrategyConfig
from slk_bot.data.base import drop_incomplete
from slk_bot.models import Candle, Direction
from slk_bot.slk import features as F

from helpers import BASE, mk_candles, mk_from_closes


@pytest.fixture
def cfg():
    return StrategyConfig()


# ------------------------------------------------------------------ structure


class TestEnvironment:
    def test_bearish_ll_lh(self):
        # highs 108 -> 105.5, lows 106 -> 104 -> 101: lower highs + lower lows
        closes = [
            110, 109, 108, 107, 106,          # impulse 1 (low 106)
            106.5, 107, 107.5, 108,           # pullback (high 108)
            107, 106, 105, 104,               # impulse 2 (low 104)
            104.5, 105, 105.5,                # pullback (high 105.5)
            105, 104, 103, 102, 101,          # impulse 3 (low 101)
            101.8, 102.3, 102.1, 102.2,       # tail
        ]
        assert F.environment(mk_from_closes(closes)) == "bearish"

    def test_bullish_hh_hl(self):
        closes = [
            100, 101, 102, 103, 104,
            103.5, 103, 102.5, 102,
            103, 104, 105, 106,
            105.5, 105, 104.5,
            105, 106, 107, 108, 109,
        ]
        assert F.environment(mk_from_closes(closes)) == "bullish"

    def test_consolidation_when_mixed(self):
        closes = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101]
        assert F.environment(mk_from_closes(closes)) == "consolidation"

    def test_invalidation_level(self):
        closes = [
            110, 109, 108, 107, 106,
            106.5, 107, 107.5, 108,
            107, 106, 105, 104,
            104.5, 105, 105.5,
            105, 104, 103, 102, 101,
            101.8, 102.3, 102.1, 102.2,
        ]
        level = F.structure_invalidation_level(
            mk_from_closes(closes), Direction.SHORT
        )
        assert level is not None
        # most recent confirmed lower high of the path + symmetric wick
        assert level == pytest.approx(102.3 + 0.08)


class TestBosAndPhase:
    def test_bos_detects_first_close_through(self):
        rows = [
            (100, 101, 99, 100.5),
            (100.5, 103, 100, 102.5),   # swing high 103? needs rights
            (102.5, 102.8, 101.5, 102),
            (102, 102.5, 100.5, 101),
            (101, 102, 100, 101.5),
            (101.5, 103.5, 101, 103.2), # closes above the 103 pivot -> BOS up
        ]
        candles = mk_candles(rows, step_minutes=240)
        ev = F.bos_event(candles, left=1, right=1)
        assert ev is not None
        idx, direction, level = ev
        assert direction == "up"
        assert idx == 5
        assert level == 103.0

    def test_phase_expansion_vs_pullback(self):
        candles = mk_candles(
            [(100, 101, 99, 100.5), (100.5, 103, 100, 102.5),
             (102.5, 102.8, 101.5, 102), (102, 102.5, 100.5, 101),
             (101, 102, 100, 101.5), (101.5, 104, 101, 103.5)],
            step_minutes=240,
        )
        assert F.phase(candles, "bullish", lookback=3, left=1, right=1) == "expansion"
        assert F.phase(candles, "bearish", lookback=3, left=1, right=1) == "reversal"
        assert F.phase(candles, "consolidation", lookback=3, left=1, right=1) == "range"


# ---------------------------------------------------------------- resampling


class TestResample:
    def test_1h_to_4h_epoch_aligned(self):
        rows = [(100 + i, 101 + i, 99 + i, 100.5 + i) for i in range(8)]
        candles = mk_candles(rows, step_minutes=60, base=BASE)
        h4 = F.resample_candles(candles, 14400)
        assert len(h4) == 2
        assert h4[0].time == BASE
        assert h4[0].open == 100.0
        assert h4[0].high == 104.0
        assert h4[0].low == 99.0
        assert h4[0].close == 103.5

    def test_calendar_week_month(self):
        # 10 business days starting Monday 2024-03-04
        days = mk_candles(
            [(100 + i, 101 + i, 99 + i, 100 + i) for i in range(10)],
            step_minutes=1440,
            base=BASE,
        )
        weeks = F.resample_calendar(days, "W")
        months = F.resample_calendar(days, "M")
        assert len(weeks) == 2 and len(months) == 1
        assert weeks[0].high == 107.0 and weeks[1].close == 109.0


# ------------------------------------------------------------------ liquidity


class TestLiquidity:
    def test_external_pools_prior_day(self, cfg):
        days = mk_candles(
            [(100, 102, 99, 101), (101, 104, 100, 103), (103, 105, 102, 104)],
            step_minutes=1440,
        )
        pools = F.external_pools(days)
        pdh = [p for p in pools if p.kind == "PDH"][0]
        pdl = [p for p in pools if p.kind == "PDL"][0]
        assert pdh.price == 105.0 and pdl.price == 102.0
        assert pdh.side == "buyside" and pdl.side == "sellside"

    def test_internal_pools_single_candle(self):
        rows = [(100, 101, 99, 100.5)] * 10
        rows[5] = (100.5, 104, 100, 103.5)  # decision candle (range 4.0)
        candles = mk_candles(rows, step_minutes=240)
        pools = F.internal_pools(candles, atr_val=1.0, decision_atr_mult=1.5,
                                 left=1, right=1)
        singles = [p for p in pools if p.kind == "single-candle"]
        assert any(p.price == 104.0 and p.side == "buyside" for p in singles)
        assert any(p.price == 100.0 and p.side == "sellside" for p in singles)


# ------------------------------------------------------------------ key levels


class TestKeyLevels:
    def test_fvg_detection_and_mitigation(self):
        rows = [
            (100.0, 101.0, 99.5, 100.5),
            (100.5, 102.0, 100.0, 101.8),
            (101.8, 103.0, 101.5, 102.6),  # low 101.5 > candle0 high 101 -> FVG [101, 101.5]
            (102.6, 103.5, 102.0, 103.0),
            (103.0, 103.8, 102.5, 103.4),
        ]
        candles = mk_candles(rows, step_minutes=240)
        zones = F.fvg_zones(candles, lookback=20)
        assert len(zones) == 1
        assert zones[0].direction == "bullish"
        assert zones[0].lo == 101.0 and zones[0].hi == 101.5

        # a later candle trading fully through the zone mitigates it away
        rows_mit = rows + [(103.4, 104.0, 100.5, 101.0)]
        assert F.fvg_zones(mk_candles(rows_mit, step_minutes=240), 20) == []

    def test_a_top_level_detected(self, cfg):
        closes = [100, 101, 102, 103, 104, 103, 102, 101, 100, 99]
        candles = mk_from_closes(closes, step_minutes=240)
        levels = F.key_levels(candles, cfg)
        a_tops = [lv for lv in levels if lv.kind == "A"]
        assert any(lv.origin_price == 104.0 for lv in a_tops)

    def test_oc_level_on_decision_candle(self, cfg):
        rows = [(100 + i, 100.6 + i, 99.5 + i, 100.4 + i) for i in range(10)]
        rows[6] = (100.4, 105.0, 100.2, 104.6)  # wide-range decision candle
        candles = mk_candles(rows, step_minutes=240)
        levels = F.key_levels(candles, cfg)
        oc = [lv for lv in levels if lv.kind == "OC"]
        assert any(abs(lv.zone_lo - 100.4) < 1e-9 and abs(lv.zone_hi - 104.6) < 1e-9
                   for lv in oc)

    def test_flip_after_decisive_close_through(self, cfg):
        closes = [100, 101, 102, 103, 104, 103, 102, 103, 104, 105, 106]
        candles = mk_from_closes(closes, step_minutes=240)
        levels = F.key_levels(candles, cfg)
        a_top = [lv for lv in levels if lv.kind == "A" and lv.origin_price == 104.0][0]
        assert a_top.flipped is True


# ---------------------------------------------------------------------- misc


class TestMisc:
    def test_atr(self):
        candles = mk_candles([(100, 104, 99, 102)] * 20)
        assert F.atr(candles, 14) == pytest.approx(5.0)

    def test_session_windows(self):
        zones = [["London", "07:00", "10:00"], ["NewYork", "12:00", "15:00"]]
        at = lambda hh, mm: datetime(2024, 1, 1, hh, mm, tzinfo=timezone.utc)
        assert F.session_for(at(8, 30), zones) == "London"
        assert F.session_for(at(10, 0), zones) is None
        assert F.session_for(at(5, 0), zones) is None
        overnight = [["Asia", "22:00", "02:00"]]
        assert F.session_for(at(23, 15), overnight) == "Asia"
        assert F.session_for(at(0, 45), overnight) == "Asia"

    def test_drop_incomplete(self):
        now = datetime.now(timezone.utc)
        c1 = Candle(now - timedelta(seconds=1800), 1, 2, 0.5, 1.5)  # closed
        c2 = Candle(now - timedelta(seconds=5), 1, 2, 0.5, 1.5)     # in progress
        assert drop_incomplete([c1, c2], 900, now=now) == [c1]


# ------------------------------------------------------------------ storyline

from slk_bot.slk.storyline import build_storyline, storyline_series

# engineered H4: clean bearish structure — LHs 107.2 / 105.7, LLs 106 / 104.5,
# price currently 103.2; origin level should resolve above price
H4_CLOSES = [
    108, 107.5, 107, 106.5, 106,
    106.5, 107, 107.2,
    106.6, 106, 105.5, 105, 104.5,
    105, 105.5, 105.7,
    105.2, 104.8, 104.5, 104.2, 104.0, 103.8, 103.6, 103.4, 103.2,
]
D1_CLOSES = [110 - 0.3 * i for i in range(40)]  # steady daily decline


class TestStoryline:
    def test_valid_bearish_storyline(self, cfg):
        d1 = mk_from_closes(D1_CLOSES, step_minutes=1440, base=BASE)
        h4 = mk_from_closes(H4_CLOSES, step_minutes=240, base=BASE)
        s = build_storyline(d1, h4, cfg)
        assert s.valid, s.reason
        assert s.direction is Direction.SHORT
        assert s.environment == "bearish"
        assert s.phase == "expansion"      # fresh down-BOS within the lookback
        assert s.origin is not None
        assert s.origin.zone_lo > h4[-1].close          # shorts sell into premium
        assert s.draw_on_liquidity is not None
        assert s.draw_on_liquidity < h4[-1].close       # draw below current price
        assert "D:" in s.htf_alignment and "H4:" in s.htf_alignment

    def test_invalidated_by_close_through_opposing_structure(self, cfg):
        d1 = mk_from_closes(D1_CLOSES, step_minutes=1440, base=BASE)
        h4 = mk_from_closes(H4_CLOSES + [103.3, 104.0, 105.0, 105.9],
                            step_minutes=240, base=BASE)
        s = build_storyline(d1, h4, cfg)
        assert not s.valid
        assert "broke opposing structure" in s.reason

    def test_consolidating_market_has_no_storyline(self, cfg):
        d1 = mk_from_closes(D1_CLOSES, step_minutes=1440, base=BASE)
        flat = mk_from_closes([100, 101, 100, 101, 100, 101, 100, 101,
                               100, 101, 100, 101, 100, 101, 100, 101,
                               100, 101, 100, 101, 100, 101, 100, 101, 100],
                              step_minutes=240, base=BASE)
        s = build_storyline(d1, flat, cfg)
        assert not s.valid
        assert "consolidation" in s.reason

    def test_series_is_point_in_time(self, cfg):
        # daily history starts ~35 days before the H4 window begins
        d1 = mk_from_closes(D1_CLOSES, step_minutes=1440,
                            base=BASE - timedelta(days=33))
        h4 = mk_from_closes(H4_CLOSES, step_minutes=240, base=BASE)
        snaps = storyline_series(d1, h4, cfg)
        assert len(snaps) > 0
        times = [t for t, _ in snaps]
        assert times == sorted(times)
        # every snapshot only saw data closed at that moment
        assert snaps[-1][1].valid
        assert snaps[-1][0] == h4[-2].time or snaps[-1][0] == h4[-1].time
