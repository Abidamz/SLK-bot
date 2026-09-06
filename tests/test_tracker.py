"""Unit tests for the v2 alert journal, event log and outcome engine.

Synthetic fixtures only — logic verification, not performance evidence.
"""
from datetime import datetime, timedelta, timezone

from slk_bot.models import Candle, Direction, SignalStatus
from slk_bot.slk.types import Alert, Event
from slk_bot.tracking import Tracker, evaluate_signal, format_stats

BASE = datetime(2024, 3, 4, tzinfo=timezone.utc)


def mk_candle(i, o, h, l, c):
    return Candle(BASE + timedelta(hours=i), float(o), float(h), float(l), float(c))


def mk_alert(setup_id="abc123def456", **over):
    args = dict(
        setup_id=setup_id, pair="EURUSD", entry_tf="1h", map_tf="4h",
        direction=Direction.SHORT, entry=104.90, stop_loss=105.15,
        tp_internal=104.00, tp_external=101.00, candle_close_time=BASE,
        environment="bearish", phase="pullback", htf_alignment="M:? W:↓ D:↓ H4:↓",
        origin_key_level=105.00, key_level_type="A",
        key_level_bounds=(104.95, 105.05), key_level_tested=True,
        key_level_flipped=False, imbalance_context=[{"lo": 104.96, "hi": 105.02}],
        internal_liquidity=[{"price": 104.0, "side": "sellside", "kind": "structural"}],
        external_liquidity=[{"price": 101.0, "side": "sellside", "kind": "PDL"}],
        draw_on_liquidity=101.00, nearest_external_target=101.00,
        intermediate_zones=[], opposing_liquidity_standing=True,
        sweep_time=BASE, bos_time=BASE, return_time=BASE,
        invalidation_level=105.10, parameter_version="slk-r2.0",
        alert_status="PAPER",
    )
    args.update(over)
    return Alert(**args)


class TestJournal:
    def test_add_and_dedupe(self, tmp_path):
        t = Tracker(str(tmp_path / "s.db"))
        assert t.add_alert(mk_alert(), provider="fake") is True
        assert t.add_alert(mk_alert(), provider="fake") is False  # same setup_id
        opens = t.open_alerts("EURUSD", "1h")
        assert len(opens) == 1 and opens[0]["status"] == "OPEN"
        assert opens[0]["origin_key_level"] == 105.00
        assert opens[0]["provider"] == "fake"

    def test_events_idempotent(self, tmp_path):
        t = Tracker(str(tmp_path / "s.db"))
        ev = Event("abc123def456", "EURUSD", "MAP", BASE, "armed", 105.0)
        assert t.add_event(ev) is True
        assert t.add_event(ev) is False  # replay-safe
        assert len(t.recent_events()) == 1

    def test_cooldown_source(self, tmp_path):
        t = Tracker(str(tmp_path / "s.db"))
        t.add_alert(mk_alert(), provider="fake")
        t.add_alert(mk_alert("zzz999", alert_status="SUPPRESSED"), provider="fake")
        last = t.last_alert_time("EURUSD", "SHORT")
        assert last == BASE  # suppressed rows don't drive the cooldown
        assert t.last_alert_time("EURUSD", "LONG") is None

    def test_outcome_and_stats(self, tmp_path):
        t = Tracker(str(tmp_path / "s.db"))
        t.add_alert(mk_alert(), provider="fake")
        candles = [mk_candle(1, 104.9, 104.9, 103.9, 104.0)]  # tags TP 104.00
        oc = evaluate_signal(Direction.SHORT, 104.90, 105.15, 104.00, candles)
        t.record_outcome("abc123def456", oc)
        s = t.stats()
        assert s["tp"] == 1 and s["win_rate"] == 1.0
        assert s["setups_tracked"] == 0  # no events logged in this test
        assert "EURUSD" in format_stats(s)


class TestEvaluate:
    def test_tp_hit_long(self):
        candles = [mk_candle(1, 100, 112, 99, 110)]
        oc = evaluate_signal(Direction.LONG, 100, 95, 110, candles)
        assert oc.status is SignalStatus.TP_HIT and oc.r_multiple == 2.0

    def test_sl_wins_same_candle(self):
        # one candle closes beyond the stop AND wicks the TP -> SL wins
        candles = [mk_candle(1, 100, 106, 88, 107)]
        oc = evaluate_signal(Direction.SHORT, 100, 105, 90, candles)
        assert oc.status is SignalStatus.SL_HIT and oc.r_multiple == -1.0

    def test_close_based_stop_ignores_wicks(self):
        # wick pokes the stop but the close survives -> still open
        candles = [mk_candle(1, 104.5, 105.4, 104.2, 104.6)]
        assert evaluate_signal(Direction.SHORT, 104.9, 105.15, 104.0, candles,
                               sl_on_close=True) is None
        # ... but wick-based mode would stop it out
        oc = evaluate_signal(Direction.SHORT, 104.9, 105.15, 104.0, candles,
                             sl_on_close=False)
        assert oc.status is SignalStatus.SL_HIT

    def test_still_open_and_expiry(self):
        candles = [mk_candle(i, 104.5, 104.8, 104.2, 104.6) for i in range(1, 5)]
        assert evaluate_signal(Direction.SHORT, 104.9, 105.15, 104.0, candles,
                               expire_after=10) is None
        oc = evaluate_signal(Direction.SHORT, 104.9, 105.15, 104.0, candles,
                             expire_after=4)
        assert oc.status is SignalStatus.EXPIRED
        assert oc.exit_price == 104.6
