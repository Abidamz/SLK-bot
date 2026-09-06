"""End-to-end pipeline test through SLKBot (no network, no real channels).

The provider is fake and the storyline series is stubbed, so this verifies
the plumbing: multi-TF fetch plan -> engine replay -> dedupe/cooldown ->
paper notification -> event log -> TP outcome -> stats.

Synthetic fixtures only — logic verification, not performance evidence.
"""
from datetime import timedelta

from slk_bot.bot import SLKBot
from slk_bot.config import Config
from slk_bot.data.base import DataProvider
from slk_bot.notify.manager import NotifierManager

from helpers import BASE, mk_candles, mk_from_closes
from test_engine import SHORT_ROWS, SHORT_STORY, snaps_for


class FakeProvider(DataProvider):
    name = "fake"

    def __init__(self):
        self.feed = {}

    def set_feed(self, pair, label, candles):
        self.feed[(pair, label)] = candles

    def fetch_candles(self, pair, timeframe, limit=400):
        return list(self.feed.get((pair, timeframe), []))


class FakeChannel:
    name = "fake"

    def __init__(self):
        self.sent = []

    def send_message(self, text, color=None):
        self.sent.append((text, color))


def entry_feed():
    """26 quiet candles followed by the engineered setup (the bot requires a
    minimum history depth of 40 closed candles per feed)."""
    pad = mk_from_closes(
        [103.60 + 0.01 * i for i in range(26)], step_minutes=30, wick=0.03
    )
    rows = mk_candles(
        SHORT_ROWS, step_minutes=30, base=BASE + timedelta(minutes=30 * 26)
    )
    return pad + rows


def make_bot(tmp_path, monkeypatch):
    cfg = Config()
    cfg.pairs = ["EURUSD"]
    cfg.entry_timeframes = {"30m": 1800}
    cfg.mode = "paper"
    cfg.paper_notify = True
    cfg.provider = "yfinance"          # replaced with the fake below
    cfg.strategy.sessions_allowlist = []
    cfg.tracking.db_path = str(tmp_path / "signals.db")

    bot = SLKBot(cfg)
    provider = FakeProvider()
    channel = FakeChannel()
    bot.provider = provider
    bot.notifier = NotifierManager([channel])

    # context/map feeds: enough candles to pass the guards; the storyline
    # itself is stubbed (storyline features are tested separately)
    provider.set_feed("EURUSD", "1d", mk_from_closes(
        [110 - i * 0.3 for i in range(40)], step_minutes=1440, base=BASE))
    provider.set_feed("EURUSD", "1h", mk_from_closes(
        [100 + (i % 7) * 0.1 for i in range(140)], step_minutes=60, base=BASE))
    provider.set_feed("EURUSD", "30m", entry_feed())

    monkeypatch.setattr(
        "slk_bot.bot.storyline_series",
        lambda d1, h4, strategy: snaps_for(SHORT_STORY),
    )
    return bot, provider, channel


def test_full_pipeline(tmp_path, monkeypatch):
    bot, provider, channel = make_bot(tmp_path, monkeypatch)

    # 1. first scan: one paper SHORT alert + its transition events
    emitted = bot.scan_once()
    assert len(emitted) == 1
    a = emitted[0]
    assert a.direction.value == "SHORT"
    assert a.alert_status == "PAPER"
    assert len(channel.sent) == 1
    text, _ = channel.sent[0]
    assert "PAPER" in text and "SLK SHORT — EURUSD" in text
    assert "bearish" in text and "pullback" in text

    rows = bot.tracker.recent_events(50)
    states = [r["state"] for r in reversed(rows)]
    assert states == ["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]

    # 2. rescanning the same data is a no-op (dedupe + idempotent events)
    assert bot.scan_once() == []
    assert len(channel.sent) == 1
    assert len(bot.tracker.recent_events(50)) == 5

    # 3. price reaches the internal TP on a later candle -> outcome + notify
    base_feed = entry_feed()
    n = len(base_feed)
    aftermath = base_feed + mk_candles(
        [(104.90, 104.95, 103.90, 104.00)],   # tags TP1 at 104.00
        step_minutes=30,
        base=BASE + timedelta(minutes=30 * n),
    )
    provider.set_feed("EURUSD", "30m", aftermath)
    emitted = bot.scan_once()
    assert emitted == []                        # no NEW setups
    assert len(channel.sent) == 2
    assert "TP HIT" in channel.sent[1][0]

    stats = bot.tracker.stats()
    assert stats["total"] == 1 and stats["tp"] == 1 and stats["open"] == 0
    assert stats["win_rate"] == 1.0
    assert stats["setups_tracked"] == 1
