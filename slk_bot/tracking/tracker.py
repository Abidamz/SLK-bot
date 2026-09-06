"""SQLite-backed journal: SLK alerts + a full auditable event log.

- ``slk_alerts``  — one row per fired alert, keyed by ``setup_id`` (unique →
  duplicate alerts are impossible even across restarts), carrying the whole
  storyline/execution context for later review.
- ``slk_events``  — every state-machine transition (MAP/TOUCH/SWEEP/SHIFT/
  RETEST/INVALID/EXPIRED), idempotent on (setup_id, state, candle_time).

Open alerts are re-evaluated on every scan against the latest entry-TF
candles and resolved to TP_HIT / SL_HIT / EXPIRED.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import Path

from ..models import Candle, Direction, SignalStatus
from ..slk.types import Alert, Event

log = logging.getLogger(__name__)

Outcome = namedtuple("Outcome", "status exit_price exit_time r_multiple")

SCHEMA = """
CREATE TABLE IF NOT EXISTS slk_alerts (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    setup_id                    TEXT UNIQUE NOT NULL,
    provider                    TEXT,
    canonical_symbol            TEXT NOT NULL,
    map_timeframe               TEXT,
    entry_timeframe             TEXT NOT NULL,
    candle_close_time           TEXT NOT NULL,
    direction                   TEXT NOT NULL,
    environment                 TEXT,
    phase                       TEXT,
    htf_alignment               TEXT,
    origin_key_level            REAL,
    key_level_type              TEXT,
    key_level_bounds            TEXT,
    key_level_tested            INTEGER,
    key_level_flipped           INTEGER,
    imbalance_context           TEXT,
    internal_liquidity          TEXT,
    external_liquidity          TEXT,
    draw_on_liquidity           REAL,
    nearest_external_target     REAL,
    intermediate_zones          TEXT,
    opposing_liquidity_standing INTEGER,
    cycle_stage                 TEXT,
    entry_mode                  TEXT,
    entry                       REAL NOT NULL,
    stop_loss                   REAL NOT NULL,
    tp_internal                 REAL,
    tp_external                 REAL,
    sweep_time                  TEXT,
    bos_time                    TEXT,
    return_time                 TEXT,
    invalidation_level          REAL,
    invalidation_reason         TEXT,
    parameter_version           TEXT,
    setup_ref                   TEXT,
    alert_status                TEXT NOT NULL,
    suppress_reason             TEXT,
    status                      TEXT NOT NULL DEFAULT 'OPEN',
    exit_price                  REAL,
    exit_time                   TEXT,
    r_multiple                  REAL,
    created_utc                 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_status ON slk_alerts(status, canonical_symbol);

CREATE TABLE IF NOT EXISTS slk_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    setup_id    TEXT NOT NULL,
    pair        TEXT NOT NULL,
    state       TEXT NOT NULL,
    candle_time TEXT NOT NULL,
    reason      TEXT,
    price       REAL,
    created_utc TEXT NOT NULL,
    UNIQUE(setup_id, state, candle_time)
);
CREATE INDEX IF NOT EXISTS idx_events_setup ON slk_events(setup_id);
"""


class Tracker:
    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # -- writing ------------------------------------------------------
    def add_alert(self, a: Alert, provider: str) -> bool:
        """Insert an alert. Returns False if the setup was already recorded."""
        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO slk_alerts (
                        setup_id, provider, canonical_symbol, map_timeframe,
                        entry_timeframe, candle_close_time, direction,
                        environment, phase, htf_alignment, origin_key_level,
                        key_level_type, key_level_bounds, key_level_tested,
                        key_level_flipped, imbalance_context, internal_liquidity,
                        external_liquidity, draw_on_liquidity,
                        nearest_external_target, intermediate_zones,
                        opposing_liquidity_standing, cycle_stage, entry_mode,
                        entry, stop_loss, tp_internal, tp_external,
                        sweep_time, bos_time, return_time, invalidation_level,
                        invalidation_reason, parameter_version, setup_ref,
                        alert_status, suppress_reason, created_utc
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                              ?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        a.setup_id, provider, a.pair, a.map_tf, a.entry_tf,
                        a.candle_close_time.isoformat(), a.direction.value,
                        a.environment, a.phase, a.htf_alignment,
                        a.origin_key_level, a.key_level_type,
                        json.dumps(list(a.key_level_bounds)),
                        int(a.key_level_tested), int(a.key_level_flipped),
                        json.dumps(a.imbalance_context),
                        json.dumps(a.internal_liquidity),
                        json.dumps(a.external_liquidity),
                        a.draw_on_liquidity, a.nearest_external_target,
                        json.dumps(a.intermediate_zones),
                        int(a.opposing_liquidity_standing),
                        a.cycle_stage, a.entry_mode,
                        a.entry, a.stop_loss, a.tp_internal, a.tp_external,
                        a.sweep_time.isoformat() if a.sweep_time else None,
                        a.bos_time.isoformat() if a.bos_time else None,
                        a.return_time.isoformat() if a.return_time else None,
                        a.invalidation_level, a.invalidation_reason,
                        a.parameter_version, a.setup_id,
                        a.alert_status, a.suppress_reason,
                        datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    ),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def update_alert_status(self, setup_id: str, status: str, reason: str | None = None) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE slk_alerts SET alert_status=?, suppress_reason=? WHERE setup_id=?",
                (status, reason, setup_id),
            )

    def add_event(self, ev: Event) -> bool:
        """Log a state transition; idempotent per (setup, state, candle)."""
        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO slk_events
                       (setup_id, pair, state, candle_time, reason, price, created_utc)
                       VALUES (?,?,?,?,?,?,?)""",
                    (
                        ev.setup_id, ev.pair, ev.state, ev.candle_time.isoformat(),
                        ev.reason, ev.price,
                        datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    ),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def record_outcome(self, setup_id: str, outcome: Outcome) -> None:
        with self._conn() as conn:
            conn.execute(
                """UPDATE slk_alerts
                   SET status=?, exit_price=?, exit_time=?, r_multiple=?
                   WHERE setup_id=? AND status='OPEN'""",
                (
                    outcome.status.value, outcome.exit_price,
                    outcome.exit_time.isoformat(), outcome.r_multiple, setup_id,
                ),
            )

    # -- reading ------------------------------------------------------
    def open_alerts(self, pair: str | None = None, entry_tf: str | None = None) -> list[dict]:
        sql = "SELECT * FROM slk_alerts WHERE status='OPEN'"
        params: list = []
        if pair:
            sql += " AND canonical_symbol=?"
            params.append(pair)
        if entry_tf:
            sql += " AND entry_timeframe=?"
            params.append(entry_tf)
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(sql, params)]

    def last_alert_time(
        self, pair: str, direction: str, exclude_setup_id: str | None = None
    ) -> datetime | None:
        """Close time of the most recent *delivered* alert, used for cooldown."""
        sql = """SELECT candle_close_time FROM slk_alerts
                 WHERE canonical_symbol=? AND direction=?
                   AND alert_status IN ('PAPER','SENT')"""
        params: list = [pair, direction]
        if exclude_setup_id:
            sql += " AND setup_id != ?"
            params.append(exclude_setup_id)
        sql += " ORDER BY candle_close_time DESC LIMIT 1"
        with self._conn() as conn:
            row = conn.execute(sql, params).fetchone()
        return datetime.fromisoformat(row["candle_close_time"]) if row else None

    def recent_events(self, limit: int = 20) -> list[dict]:
        with self._conn() as conn:
            return [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM slk_events ORDER BY id DESC LIMIT ?", (limit,)
                )
            ]

    def stats(self) -> dict:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) n FROM slk_alerts GROUP BY status"
            ).fetchall()
            counts = {r["status"]: r["n"] for r in rows}
            tp = counts.get(SignalStatus.TP_HIT.value, 0)
            sl = counts.get(SignalStatus.SL_HIT.value, 0)
            closed = tp + sl
            avg_r = conn.execute(
                "SELECT AVG(r_multiple) a FROM slk_alerts WHERE status NOT IN ('OPEN')"
            ).fetchone()["a"]
            by_pair = conn.execute(
                """SELECT canonical_symbol pair, COUNT(*) total,
                          SUM(status='TP_HIT') tp, SUM(status='SL_HIT') sl
                   FROM slk_alerts GROUP BY canonical_symbol ORDER BY total DESC"""
            ).fetchall()
            setups = conn.execute(
                "SELECT COUNT(DISTINCT setup_id) n FROM slk_events WHERE state='MAP'"
            ).fetchone()["n"]
            suppressed = conn.execute(
                "SELECT COUNT(*) n FROM slk_alerts WHERE alert_status='SUPPRESSED'"
            ).fetchone()["n"]
            last = conn.execute(
                """SELECT canonical_symbol pair, entry_timeframe timeframe,
                          direction, candle_close_time signal_time, status
                   FROM slk_alerts ORDER BY id DESC LIMIT 1"""
            ).fetchone()
        return {
            "total": sum(counts.values()),
            "open": counts.get(SignalStatus.OPEN.value, 0),
            "tp": tp,
            "sl": sl,
            "expired": counts.get(SignalStatus.EXPIRED.value, 0),
            "win_rate": (tp / closed) if closed else None,
            "avg_r": avg_r,
            "setups_tracked": setups,
            "suppressed": suppressed,
            "by_pair": [dict(r) for r in by_pair],
            "last": dict(last) if last else None,
        }


def evaluate_signal(
    direction: Direction,
    entry: float,
    stop: float,
    tp: float,
    candles_after: list[Candle],
    expire_after: int = 120,
    sl_on_close: bool = True,
) -> Outcome | None:
    """Resolve an OPEN alert against candles that opened strictly after the
    entry candle. Conservative: if one candle resolves both, SL wins. Stops
    are close-based by default (the model prefers close-based invalidation);
    targets are touch-based."""
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    sign = 1.0 if direction is Direction.LONG else -1.0

    def r_multiple(price: float) -> float:
        return sign * (price - entry) / risk

    window = candles_after[: expire_after or None]
    for c in window:
        if direction is Direction.LONG:
            sl_hit = c.close < stop if sl_on_close else c.low <= stop
            tp_hit = c.high >= tp
        else:
            sl_hit = c.close > stop if sl_on_close else c.high >= stop
            tp_hit = c.low <= tp
        if sl_hit:
            return Outcome(SignalStatus.SL_HIT, stop, c.time, -1.0)
        if tp_hit:
            return Outcome(SignalStatus.TP_HIT, tp, c.time, r_multiple(tp))

    if expire_after and len(candles_after) >= expire_after and window:
        last = window[-1]
        return Outcome(
            SignalStatus.EXPIRED, last.close, last.time, r_multiple(last.close)
        )
    return None


def format_stats(s: dict) -> str:
    lines = ["📊 SLK BOT PERFORMANCE", ""]
    lines.append(
        f"Alerts : {s['total']} total · {s['open']} open · {s['tp']} TP · "
        f"{s['sl']} SL · {s['expired']} expired"
    )
    lines.append(
        f"Setups : {s['setups_tracked']} armed (MAP) · {s['suppressed']} alerts suppressed"
    )
    if s["win_rate"] is not None:
        lines.append(f"Win rate: {s['win_rate']:.0%}  (TP vs SL, expired excluded)")
    else:
        lines.append("Win rate: n/a (no closed alerts yet)")
    if s["avg_r"] is not None:
        lines.append(f"Avg R   : {s['avg_r']:+.2f}R per closed alert")
    if s["by_pair"]:
        lines.append("")
        lines.append("By pair:")
        for r in s["by_pair"]:
            lines.append(
                f"  {r['pair']:<8} {r['total']:>3} alerts · {r['tp']} TP / {r['sl']} SL"
            )
    if s["last"]:
        l = s["last"]
        lines.append("")
        lines.append(
            f"Last alert: {l['direction']} {l['pair']} {l['timeframe']} "
            f"({l['status']}) @ {str(l['signal_time'])[:16]} UTC"
        )
    return "\n".join(lines)
