"""Unit tests for the signal journal / outcome tracking."""
from datetime import datetime, timedelta, timezone

from slk_bot.models import Candle, Direction, Signal, SignalStatus
from slk_bot.tracking import Tracker, evaluate_signal, format_stats

BASE = datetime(2024, 1, 1, tzinfo=timezone.utc)


def mk_candle(i, o, h, l, c):
    return Candle(BASE + timedelta(hours=i), float(o), float(h), float(l), float(c))


def mk_signal(pair="EURUSD", direction=Direction.SHORT, entry=102.0, sl=110.5, tp=85.0):
    return Signal(
        pair=pair,
        timeframe="15m",
        direction=direction,
        entry=entry,
        stop_loss=sl,
        take_profit=tp,
        signal_time=BASE,
        session="London",
        sweep_level=110.0,
        sweep_time=BASE,
        rr=2.0,
    )


class TestTracker:
    def test_dedupe(self, tmp_path):
        t = Tracker(str(tmp_path / "s.db"))
        assert t.add_signal(mk_signal()) is True
        assert t.add_signal(mk_signal()) is False  # same pair/tf/dir/time
        opens = t.open_signals()
        assert len(opens) == 1
        assert opens[0]["status"] == "OPEN"

    def test_record_outcome_and_stats(self, tmp_path):
        t = Tracker(str(tmp_path / "s.db"))
        t.add_signal(mk_signal())
        rec = t.open_signals()[0]
        candles = [mk_candle(1, 100, 103, 84, 86)]  # tags 85 TP
        oc = evaluate_signal(
            Direction.SHORT,
            rec["entry"],
            rec["stop_loss"],
            rec["take_profit"],
            candles,
            expire_after=96,
        )
        assert oc is not None and oc.status is SignalStatus.TP_HIT
        t.record_outcome(rec["id"], oc)
        s = t.stats()
        assert s["total"] == 1 and s["tp"] == 1 and s["open"] == 0
        assert s["win_rate"] == 1.0
        assert "EURUSD" in format_stats(s)


class TestEvaluate:
    def test_tp_hit_long(self):
        candles = [mk_candle(1, 100, 112, 99, 110)]
        oc = evaluate_signal(Direction.LONG, 100, 95, 110, candles)
        assert oc.status is SignalStatus.TP_HIT
        assert oc.exit_price == 110
        assert oc.r_multiple == 2.0

    def test_sl_wins_same_candle(self):
        # one candle tags both TP and SL -> conservative: SL
        candles = [mk_candle(1, 100, 115, 90, 105)]
        oc = evaluate_signal(Direction.LONG, 100, 95, 110, candles)
        assert oc.status is SignalStatus.SL_HIT
        assert oc.r_multiple == -1.0

    def test_still_open(self):
        candles = [mk_candle(1, 100, 105, 98, 103)]
        assert evaluate_signal(Direction.LONG, 100, 95, 110, candles) is None

    def test_expiry(self):
        candles = [mk_candle(i, 100, 105, 98, 101) for i in range(1, 6)]
        oc = evaluate_signal(Direction.LONG, 100, 95, 110, candles, expire_after=5)
        assert oc.status is SignalStatus.EXPIRED
        assert oc.exit_price == 101
        assert oc.r_multiple == 0.2  # (101-100)/5

    def test_short_direction(self):
        candles = [mk_candle(1, 102, 104, 84, 86)]
        oc = evaluate_signal(Direction.SHORT, 102, 110.5, 85, candles)
        assert oc.status is SignalStatus.TP_HIT
        assert oc.r_multiple == 2.0
