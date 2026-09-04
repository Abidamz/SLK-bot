"""End-to-end pipeline test: fetch -> detect -> dedupe -> alert -> track
outcome, all with a fake provider and a fake notification channel (no
network, no real Telegram/Discord)."""
from datetime import timedelta

from slk_bot.bot import SLKBot
from slk_bot.config import Config
from slk_bot.data.base import DataProvider
from slk_bot.notify.manager import NotifierManager

from test_strategy import BASE, SHORT_SCENARIO, mk_candles

# candles that rain down to the TP (85) without creating a new setup
AFTERMATH = [
    (102.0, 102.2, 96.0, 96.5),
    (96.5, 97.0, 90.0, 90.5),
    (90.5, 91.0, 84.0, 84.5),  # tags TP at 85
]


class FakeProvider(DataProvider):
    name = "fake"

    def __init__(self):
        self.feed = {}

    def set_feed(self, pair, tf, candles):
        self.feed[(pair, tf)] = candles

    def fetch_candles(self, pair, timeframe, limit=300):
        return list(self.feed.get((pair, timeframe), []))


class FakeChannel:
    name = "fake"

    def __init__(self):
        self.sent = []

    def send_message(self, text, color=None):
        self.sent.append((text, color))


def make_bot(tmp_path) -> tuple[SLKBot, FakeProvider, FakeChannel]:
    cfg = Config()
    cfg.pairs = ["EURUSD"]
    cfg.timeframes = {"15m": 900}
    cfg.provider = "yfinance"            # replaced below with the fake
    cfg.strategy.swing_left = 1
    cfg.strategy.swing_right = 1
    cfg.strategy.sl_buffer_atr = 0.0
    cfg.strategy.min_risk_atr = 0.0
    cfg.strategy.min_tp_r = 0.0
    cfg.strategy.use_killzones = False
    cfg.tracking.db_path = str(tmp_path / "signals.db")

    bot = SLKBot(cfg)
    provider = FakeProvider()
    channel = FakeChannel()
    bot.provider = provider
    bot.notifier = NotifierManager([channel])
    return bot, provider, channel


def test_full_pipeline(tmp_path):
    bot, provider, channel = make_bot(tmp_path)
    scenario = mk_candles(SHORT_SCENARIO)
    provider.set_feed("EURUSD", "15m", scenario)

    # 1. first scan: one SHORT signal, one notification
    emitted = bot.scan_once()
    assert len(emitted) == 1
    sig = emitted[0]
    assert sig.direction.value == "SHORT"
    assert len(channel.sent) == 1
    text, _color = channel.sent[0]
    assert "SLK SIGNAL — EURUSD" in text
    assert "SHORT" in text
    assert "TP HIT" not in text

    # 2. rescanning the same data must not re-alert (dedupe)
    assert bot.scan_once() == []
    assert len(channel.sent) == 1

    # 3. price reaches TP on later candles -> outcome recorded + notified
    extra_start = len(scenario)
    later = scenario + [
        mk_candles(AFTERMATH)[i] for i in range(len(AFTERMATH))
    ]
    # re-stamp aftermath candles right after the scenario
    later = scenario + [
        c.__class__(
            time=BASE + timedelta(minutes=15 * (extra_start + i)),
            open=c.open, high=c.high, low=c.low, close=c.close,
        )
        for i, c in enumerate(later[extra_start:])
    ]
    provider.set_feed("EURUSD", "15m", later)
    emitted = bot.scan_once()
    assert emitted == []                      # no *new* setups

    stats = bot.tracker.stats()
    assert stats["total"] == 1
    assert stats["open"] == 0
    assert stats["tp"] == 1
    assert stats["win_rate"] == 1.0

    assert len(channel.sent) == 2             # signal + outcome notifications
    assert "TP HIT" in channel.sent[1][0]
    assert "+2.00R" in channel.sent[1][0]
