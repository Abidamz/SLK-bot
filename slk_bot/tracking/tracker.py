"""SQLite-backed signal journal with TP/SL outcome tracking.

Every alert is written to a local DB with a unique dedupe key (so repeated
scans never double-alert). While a signal is OPEN the bot re-evaluates it on
each scan against the latest candles and marks it TP_HIT / SL_HIT / EXPIRED.
"""
from __future__ import annotations

import logging
import sqlite3
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import Path

from ..models import Candle, Direction, Signal, SignalStatus

log = logging.getLogger(__name__)

Outcome = namedtuple("Outcome", "status exit_price exit_time r_multiple")

SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key   TEXT UNIQUE NOT NULL,
    pair         TEXT NOT NULL,
    timeframe    TEXT NOT NULL,
    direction    TEXT NOT NULL,
    entry        REAL NOT NULL,
    stop_loss    REAL NOT NULL,
    take_profit  REAL NOT NULL,
    signal_time  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'OPEN',
    exit_price   REAL,
    exit_time    TEXT,
    r_multiple   REAL,
    session      TEXT,
    sweep_level  REAL,
    sweep_time   TEXT,
    rr_planned   REAL,
    created_utc  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_pair ON signals(status, pair, timeframe);
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
    def add_signal(self, sig: Signal) -> bool:
        """Insert a signal. Returns False if it was already recorded."""
        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO signals
                       (dedupe_key, pair, timeframe, direction, entry, stop_loss,
                        take_profit, signal_time, session, sweep_level,
                        sweep_time, rr_planned, created_utc)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        sig.dedupe_key,
                        sig.pair,
                        sig.timeframe,
                        sig.direction.value,
                        sig.entry,
                        sig.stop_loss,
                        sig.take_profit,
                        sig.signal_time.isoformat(),
                        sig.session,
                        sig.sweep_level,
                        sig.sweep_time.isoformat() if sig.sweep_time else None,
                        sig.rr,
                        datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    ),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def record_outcome(self, signal_id: int, outcome: Outcome) -> None:
        with self._conn() as conn:
            conn.execute(
                """UPDATE signals
                   SET status=?, exit_price=?, exit_time=?, r_multiple=?
                   WHERE id=? AND status='OPEN'""",
                (
                    outcome.status.value,
                    outcome.exit_price,
                    outcome.exit_time.isoformat(),
                    outcome.r_multiple,
                    signal_id,
                ),
            )

    # -- reading ------------------------------------------------------
    def open_signals(self, pair: str | None = None, timeframe: str | None = None) -> list[dict]:
        sql = "SELECT * FROM signals WHERE status='OPEN'"
        params: list = []
        if pair:
            sql += " AND pair=?"
            params.append(pair)
        if timeframe:
            sql += " AND timeframe=?"
            params.append(timeframe)
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(sql, params)]

    def stats(self) -> dict:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) n FROM signals GROUP BY status"
            ).fetchall()
            counts = {r["status"]: r["n"] for r in rows}
            total = sum(counts.values())
            tp = counts.get(SignalStatus.TP_HIT.value, 0)
            sl = counts.get(SignalStatus.SL_HIT.value, 0)
            closed = tp + sl
            avg_r = conn.execute(
                "SELECT AVG(r_multiple) a FROM signals WHERE status != 'OPEN'"
            ).fetchone()["a"]
            by_pair = conn.execute(
                """SELECT pair,
                          COUNT(*) total,
                          SUM(status='TP_HIT') tp,
                          SUM(status='SL_HIT') sl
                   FROM signals GROUP BY pair ORDER BY total DESC"""
            ).fetchall()
            last = conn.execute(
                "SELECT pair, timeframe, direction, signal_time, status "
                "FROM signals ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return {
            "total": total,
            "open": counts.get(SignalStatus.OPEN.value, 0),
            "tp": tp,
            "sl": sl,
            "expired": counts.get(SignalStatus.EXPIRED.value, 0),
            "win_rate": (tp / closed) if closed else None,
            "avg_r": avg_r,
            "by_pair": [dict(r) for r in by_pair],
            "last": dict(last) if last else None,
        }


def evaluate_signal(
    direction: Direction,
    entry: float,
    stop: float,
    tp: float,
    candles_after: list[Candle],
    expire_after: int = 96,
) -> Outcome | None:
    """Resolve an OPEN signal against candles that opened strictly after the
    entry candle. Conservative: if one candle touches both SL and TP, SL wins.
    Returns None while the trade is still open."""
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    sign = 1.0 if direction is Direction.LONG else -1.0

    def r_multiple(price: float) -> float:
        return sign * (price - entry) / risk

    window = candles_after[: expire_after or None]
    for c in window:
        if direction is Direction.LONG:
            if c.low <= stop:
                return Outcome(SignalStatus.SL_HIT, stop, c.time, -1.0)
            if c.high >= tp:
                return Outcome(SignalStatus.TP_HIT, tp, c.time, r_multiple(tp))
        else:
            if c.high >= stop:
                return Outcome(SignalStatus.SL_HIT, stop, c.time, -1.0)
            if c.low <= tp:
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
        f"Signals: {s['total']} total · {s['open']} open · "
        f"{s['tp']} TP · {s['sl']} SL · {s['expired']} expired"
    )
    if s["win_rate"] is not None:
        lines.append(f"Win rate: {s['win_rate']:.0%}  (TP vs SL, expired excluded)")
    else:
        lines.append("Win rate: n/a (no closed signals yet)")
    if s["avg_r"] is not None:
        lines.append(f"Avg R   : {s['avg_r']:+.2f}R per closed signal")
    if s["by_pair"]:
        lines.append("")
        lines.append("By pair:")
        for r in s["by_pair"]:
            lines.append(
                f"  {r['pair']:<8} {r['total']:>3} signals · {r['tp']} TP / {r['sl']} SL"
            )
    if s["last"]:
        l = s["last"]
        lines.append("")
        lines.append(
            f"Last signal: {l['direction']} {l['pair']} {l['timeframe']} "
            f"({l['status']}) @ {l['signal_time'][:16]} UTC"
        )
    return "\n".join(lines)
