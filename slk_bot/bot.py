"""SLKBot — orchestrates data, the SLK engine, notifications and tracking.

Per scan cycle:
    1. fetch context (D1, cached per UTC day) and map-source (1h → resampled
       H4) candles once per pair;
    2. build point-in-time storyline snapshots (ABC layer);
    3. for each due entry timeframe, replay the trailing candles through the
       XYZ state machine, persist every transition, and deliver fresh alerts
       (subject to dedupe, cooldown, session and paper-mode gates);
    4. resolve open alerts against the newest candles (TP/SL/expiry).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from .config import Config, TF_SECONDS
from .data import build_provider, drop_incomplete
from .models import Direction
from .notify import NotifierManager
from .slk import scan_entry, storyline_series
from .slk.features import resample_candles
from .slk.types import Alert
from .tracking import Tracker, evaluate_signal

log = logging.getLogger("slk_bot")

MAP_SECONDS = TF_SECONDS["4h"]


class SLKBot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.provider = build_provider(cfg)
        self.notifier = NotifierManager.from_config(cfg)
        self.tracker = Tracker(cfg.tracking.db_path)
        self._candle_cache: dict[tuple[str, str], list] = {}
        self._daily_fetch_date: dict[str, str] = {}  # pair -> UTC date string

    # ------------------------------------------------------------------
    def scan_once(
        self,
        pairs: list[str] | None = None,
        timeframes: set[str] | None = None,
        ignore_session: bool = False,
        alert: bool = True,
    ) -> list[Alert]:
        """One full scan pass. Returns alerts newly recorded this pass."""
        cfg = self.cfg
        emitted: list[Alert] = []
        entry_tfs = {
            tf: s for tf, s in cfg.entry_timeframes.items()
            if timeframes is None or tf in timeframes
        }
        if not entry_tfs:
            return emitted

        for pair in pairs or cfg.pairs:
            d1 = self._get(pair, cfg.context_timeframe)
            h_src = self._get(pair, cfg.map_source_timeframe)
            if not d1 or not h_src:
                continue
            h4 = drop_incomplete(
                resample_candles(h_src, MAP_SECONDS), MAP_SECONDS
            )
            if len(d1) < 25 or len(h4) < 30:
                log.debug("%s: insufficient HTF data (%d d1, %d h4) — skipped",
                          pair, len(d1), len(h4))
                continue
            snaps = storyline_series(d1, h4, cfg.strategy)
            if not snaps:
                continue

            for tf, secs in entry_tfs.items():
                if tf == cfg.map_timeframe:
                    candles = h4
                elif tf == cfg.map_source_timeframe:
                    candles = h_src
                else:
                    candles = self._get(pair, tf)
                    if candles is None:
                        continue
                if len(candles) < 40:
                    log.debug("%s %s: only %d candles — skipped",
                              pair, tf, len(candles))
                    continue

                strat = cfg.strategy
                if ignore_session:
                    strat = type(strat)(**{**vars(strat), "sessions_allowlist": []})
                alerts, events = scan_entry(
                    pair=pair, entry_tf=tf, tf_seconds=secs, candles=candles,
                    snaps=snaps, cfg=strat, mode=cfg.mode,
                )
                for ev in events:
                    fresh = self.tracker.add_event(ev)
                    if fresh:
                        log.info("event %-7s %s %s %s — %s",
                                 ev.state, pair, tf, ev.setup_id, ev.reason)
                for a in alerts:
                    if not self.tracker.add_alert(a, provider=self.provider.name):
                        continue  # duplicate setup — already alerted
                    emitted.append(a)
                    self._deliver(a, alert)
                self._update_outcomes(pair, tf, candles)
        return emitted

    # ------------------------------------------------------------------
    def _deliver(self, a: Alert, alert_allowed: bool) -> None:
        """Cooldown + boot + paper-mode gates, then notify."""
        last = self.tracker.last_alert_time(
            a.pair, a.direction.value, exclude_setup_id=a.setup_id
        )
        if (
            last is not None
            and a.alert_status != "SUPPRESSED"
            and a.candle_close_time - last
            < timedelta(minutes=self.cfg.strategy.cooldown_minutes)
        ):
            a = self._suppress(a, f"cooldown ({self.cfg.strategy.cooldown_minutes}m)")

        if a.alert_status == "SUPPRESSED":
            log.info("SUPPRESSED %s %s %s — %s",
                     a.direction.value, a.pair, a.entry_tf, a.suppress_reason)
            return
        if not alert_allowed:
            log.info("boot gate — signal logged without alert: %s %s %s",
                     a.direction.value, a.pair, a.entry_tf)
            return
        if self.cfg.mode == "paper" and not self.cfg.paper_notify:
            log.info("paper mode (paper_notify=false) — logged only: %s %s",
                     a.direction.value, a.pair)
            return
        log.info("ALERT %s", a.setup_id)
        self.notifier.notify_alert(a)

    def _suppress(self, a: Alert, reason: str) -> Alert:
        self.tracker.update_alert_status(a.setup_id, "SUPPRESSED", reason)
        a.alert_status, a.suppress_reason = "SUPPRESSED", reason
        return a

    # ------------------------------------------------------------------
    def _get(self, pair: str, label: str) -> list | None:
        """Fetch closed candles for (pair, timeframe label), with a per-UTC-day
        cache for the daily context feed."""
        secs = TF_SECONDS[label]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if label == "1d" and self._daily_fetch_date.get(pair) == today:
            return self._candle_cache.get((pair, label))
        try:
            candles = self.provider.fetch_candles(pair, label, self.cfg.candles_limit)
        except Exception as exc:
            log.warning("fetch failed %s %s: %s", pair, label, exc)
            return None
        candles = drop_incomplete(candles, secs)
        self._candle_cache[(pair, label)] = candles
        if label == "1d":
            self._daily_fetch_date[pair] = today
        return candles

    # ------------------------------------------------------------------
    def _update_outcomes(self, pair: str, tf: str, candles) -> None:
        for rec in self.tracker.open_alerts(pair, tf):
            entry_time = datetime.fromisoformat(rec["candle_close_time"])
            after = [c for c in candles if c.time >= entry_time]
            if not after:
                continue
            outcome = evaluate_signal(
                Direction(rec["direction"]),
                rec["entry"],
                rec["stop_loss"],
                rec["tp_internal"],
                after,
                expire_after=self.cfg.tracking.expire_candles,
                sl_on_close=self.cfg.tracking.sl_on_close,
            )
            if outcome is None:
                continue
            self.tracker.record_outcome(rec["setup_id"], outcome)
            log.info("OUTCOME %s %s %s -> %s (%+.2fR)", pair, tf,
                     rec["direction"], outcome.status.value, outcome.r_multiple)
            if self.cfg.tracking.notify_outcomes:
                self.notifier.notify_outcome(rec, outcome)

    # ------------------------------------------------------------------
    def run(self) -> None:
        """Main loop: wake just after candle closes, scan timeframes that
        actually closed (plus the map/context feeds)."""
        cfg = self.cfg
        log.info(
            "SLK bot starting — mode=%s provider=%s pairs=%s entry_tfs=%s "
            "map=%s(%s) ctx=%s db=%s",
            cfg.mode, self.provider.name, ",".join(cfg.pairs),
            ",".join(cfg.entry_timeframes), cfg.map_timeframe,
            cfg.map_source_timeframe, cfg.context_timeframe, cfg.tracking.db_path,
        )
        if cfg.notify.send_startup:
            self.notifier.broadcast(
                f"🤖 SLK bot online ({'🧪 PAPER mode' if cfg.mode == 'paper' else 'live mode'})\n"
                f"Provider   : {self.provider.name}\n"
                f"Pairs      : {', '.join(cfg.pairs)}\n"
                f"Entry TFs  : {', '.join(cfg.entry_timeframes)}\n"
                f"Map/context: {cfg.map_timeframe} / {cfg.context_timeframe}"
            )

        tfs = dict(cfg.entry_timeframes)
        # the map-source feed is refreshed on its own schedule too
        tfs.setdefault(cfg.map_source_timeframe, TF_SECONDS[cfg.map_source_timeframe])

        last_boundary = {tf: 0 for tf in tfs}
        first_cycle = True
        while True:
            now = time.time()
            next_close = min((int(now // s) + 1) * s for s in tfs.values())
            time.sleep(max(next_close + cfg.scan_delay_seconds - now, 5))

            try:
                now2 = time.time()
                due = set()
                for tf, secs in cfg.entry_timeframes.items():
                    boundary = int((now2 - cfg.scan_delay_seconds) // secs) * secs
                    if boundary > last_boundary.get(tf, 0):
                        last_boundary[tf] = boundary
                        due.add(tf)
                if not due:
                    continue
                log.info("scan cycle — entry TFs due: %s", ", ".join(sorted(due)))
                self.scan_once(
                    timeframes=due,
                    alert=cfg.alert_on_boot or not first_cycle,
                )
                first_cycle = False
            except KeyboardInterrupt:
                raise
            except Exception:
                log.exception("scan cycle failed — continuing")
                time.sleep(30)
