"""Offline SQLite compatibility checks for the Worker's additive D1 schema."""
import json
import sqlite3
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "worker" / "migrations"


def test_scan_diagnostics_migration_preserves_history_and_old_worker_inserts():
    with sqlite3.connect(":memory:") as db:
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name < "0004":
                db.executescript(migration.read_text())
        db.execute("INSERT INTO slk_scan_log (ts, alerts, events, note) VALUES ('old', 1, 5, 'ok')")
        db.executescript((MIGRATIONS / "0004_scan_diagnostics.sql").read_text())
        # Null means unavailable, never fabricated zero counts for old scans.
        assert db.execute(
            "SELECT ts, alerts, events, note, diagnostics_json FROM slk_scan_log"
        ).fetchone() == ("old", 1, 5, "ok", None)
        # Rollback to the old Worker requires no schema rollback.
        db.execute("INSERT INTO slk_scan_log (ts, note) VALUES ('rollback', 'partial')")
        assert db.execute(
            "SELECT diagnostics_json FROM slk_scan_log WHERE ts='rollback'"
        ).fetchone() == (None,)
        payload = {"version": 1, "replay": {"MAP": 2, "riskRejects": 1}, "recorded": {"confirmedAlerts": 0}}
        db.execute(
            "INSERT INTO slk_scan_log (ts, note, diagnostics_json) VALUES (?, ?, ?)",
            ("new", "ok", json.dumps(payload)),
        )
        assert db.execute(
            "SELECT json_extract(diagnostics_json, '$.replay.riskRejects') FROM slk_scan_log WHERE ts='new'"
        ).fetchone() == (1,)
