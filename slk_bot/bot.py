"""SLKBot — orchestrates data, strategy, notifications and tracking."""
from __future__ import annotations

import logging
import time
from datetime import datetime

from .config import Config
from .data import build_provider, drop_incomplete
from .models import Direction, Signal
from .notify import NotifierManager
from .strategy import detect_signals
from .tracking import Tracker, evaluate_signal

log = logging.getLogger("slk_bot")


class SLKBot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.provider = build_provider(cfg)
        self.notifier = NotifierManager.from_config(cfg)
        self.tracker = Tracker(cfg.tracking.db_path)

    # ------------------------------------------------------------------
    def scan_once(
        self,
        pairs: list[str] | None = None,
        timeframes: set[str] | None = None,
        fresh_window: int = 0,
        enforce_killzone: bool = True,
        alert: bool = True,
    ) -> list[Signal]:
        """One scan pass. Returns the signals that were newly recorded."""
        emitted: list[Signal] = []
        for pair in pairs or self.cfg.pairs:
            for tf, secs in self.cfg.timeframes.items():
                if timeframes and tf not in timeframes:
                    continue
                candles = self._fetch(pair, tf, secs)
                if not candles:
                    continue
                sigs = detect_signals(
                    candles,
                    self.cfg.strategy,
                    pair,
                    tf,
                    fresh_window=fresh_window,
                    enforce_killzone=enforce_killzone,
                )
                for sig in sigs:
                    if self.tracker.add_signal(sig):
                        emitted.append(sig)
                        log.info("SIGNAL  %s", sig)
                        if alert:
                            self.notifier.notify_signal(sig)
                    else:
                        log.debug("duplicate suppressed: %s", sig.dedupe_key)
                self._update_outcomes(pair, tf, candles)
        return emitted

    def _fetch(self, pair: str, tf: str, secs: int):
        try:
            candles = self.provider.fetch_candles(pair, tf, self.cfg.candles_limit)
        except Exception as exc:
            log.warning("fetch failed %s %s: %s", pair, tf, exc)
            return []
        candles = drop_incomplete(candles, secs)
        if len(candles) < 10:  # sanity floor; the strategy enforces its own minimum
            log.debug("%s %s: only %d closed candles, skipped", pair, tf, len(candles))
            return []
        return candles

    def _update_outcomes(self, pair: str, tf: str, candles) -> None:
        for rec in self.tracker.open_signals(pair, tf):
            sig_time = datetime.fromisoformat(rec["signal_time"])
            after = [c for c in candles if c.time > sig_time]
            if not after:
                continue
            outcome = evaluate_signal(
                Direction(rec["direction"]),
                rec["entry"],
                rec["stop_loss"],
                rec["take_profit"],
                after,
                expire_after=self.cfg.tracking.expire_candles,
            )
            if outcome is None:
                continue
            self.tracker.record_outcome(rec["id"], outcome)
            log.info(
                "OUTCOME %s %s %s -> %s (%+.2fR)",
                pair,
                tf,
                rec["direction"],
                outcome.status.value,
                outcome.r_multiple,
            )
            if self.cfg.tracking.notify_outcomes:
                self.notifier.notify_outcome(rec, outcome)

    # ------------------------------------------------------------------
    def run(self) -> None:
        """Main loop: wake up just after each candle close and scan the
        timeframes that closed."""
        cfg = self.cfg
        log.info(
            "SLK bot starting — provider=%s pairs=%s timeframes=%s db=%s",
            self.provider.name,
            ",".join(cfg.pairs),
            ",".join(cfg.timeframes),
            cfg.tracking.db_path,
        )
        if cfg.notify.send_startup:
            self.notifier.broadcast(
                "🤖 SLK bot online\n"
                f"Provider  : {self.provider.name}\n"
                f"Pairs     : {', '.join(cfg.pairs)}\n"
                f"Timeframes: {', '.join(cfg.timeframes)}"
            )

        last_boundary = {tf: 0 for tf in cfg.timeframes}
        first_cycle = True
        while True:
            now = time.time()
            next_close = min(
                (int(now // secs) + 1) * secs for secs in cfg.timeframes.values()
            )
            wake_at = next_close + cfg.scan_delay_seconds
            time.sleep(max(wake_at - now, 5))

            try:
                now2 = time.time()
                due = set()
                for tf, secs in cfg.timeframes.items():
                    boundary = int((now2 - cfg.scan_delay_seconds) // secs) * secs
                    if boundary > last_boundary[tf]:
                        last_boundary[tf] = boundary
                        due.add(tf)
                if not due:
                    continue
                log.info("scanning timeframes: %s", ", ".join(sorted(due)))
                alert = cfg.alert_on_boot or not first_cycle
                first_cycle = False
                self.scan_once(timeframes=due, alert=alert)
            except KeyboardInterrupt:
                raise
            except Exception:
                log.exception("scan cycle failed — continuing")
                time.sleep(30)
