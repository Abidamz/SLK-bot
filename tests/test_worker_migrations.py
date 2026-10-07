"""Offline SQLite compatibility checks for the Worker's additive D1 schema."""
import json
import sqlite3
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "worker" / "migrations"


def test_shadow_ledger_migration_is_deduped_and_separate():
    with sqlite3.connect(":memory:") as db:
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            db.executescript(migration.read_text())
        sql = """INSERT OR IGNORE INTO slk_shadow_trades (
            setup_id, canonical_symbol, entry_timeframe, direction,
            hypothetical_entry, hypothetical_stop_loss, hypothetical_tp1,
            hypothetical_rr, reject_reason, created_utc, candle_close_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""
        row = (
            "shadow:EURUSD:30m:SHORT:A:105.0:test", "EURUSD", "30m", "SHORT",
            104.9, 105.2, 104.0, 3.0, "TARGET_FLOOR",
            "2026-09-30T12:00:00.000Z", "2026-09-30T11:30:00.000Z",
        )
        db.execute(sql, row)
        db.execute(sql, row)
        assert db.execute("SELECT COUNT(*) FROM slk_shadow_trades").fetchone() == (1,)
        assert db.execute(
            "SELECT status, exit_time, r_multiple FROM slk_shadow_trades"
        ).fetchone() == ("OPEN", None, None)
        db.execute(
            "UPDATE slk_shadow_trades SET status='TP_HIT', exit_time=?, exit_price=?, r_multiple=? WHERE setup_id=?",
            ("2026-09-30T12:30:00.000Z", 104.0, 3.0, row[0]),
        )
        assert db.execute(
            "SELECT status, r_multiple FROM slk_shadow_trades WHERE setup_id=?", (row[0],)
        ).fetchone() == ("TP_HIT", 3.0)
        # The research table is independent: inserting a shadow does not make
        # an alert or event visible to public ledgers.
        assert db.execute("SELECT COUNT(*) FROM slk_alerts").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM slk_events").fetchone() == (0,)


def test_shadow_experiments_migration_is_deduped_and_separate():
    with sqlite3.connect(":memory:") as db:
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            db.executescript(migration.read_text())
        insert = """INSERT OR IGNORE INTO slk_shadow_experiments (
            experiment_id, source_setup_id, variant, canonical_symbol,
            entry_timeframe, direction, hypothetical_entry,
            hypothetical_stop_loss, hypothetical_target, hypothetical_rr,
            created_utc, candle_close_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""
        row = (
            "FVG_RETEST_50:EURUSD:30m:SHORT:A:105:test",
            "EURUSD:30m:SHORT:A:105:test", "FVG_RETEST_50", "EURUSD",
            "30m", "SHORT", 104.9, 105.2, 104.0, 3.0,
            "2026-10-05T12:00:00.000Z", "2026-10-05T11:30:00.000Z",
        )
        db.execute(insert, row)
        db.execute(insert, row)
        assert db.execute("SELECT COUNT(*) FROM slk_shadow_experiments").fetchone() == (1,)
        assert db.execute(
            "SELECT variant, status, r_multiple FROM slk_shadow_experiments"
        ).fetchone() == ("FVG_RETEST_50", "OPEN", None)
        db.execute(
            "UPDATE slk_shadow_experiments SET status='TP_HIT', exit_time=?, exit_price=?, r_multiple=? WHERE experiment_id=?",
            ("2026-10-05T12:30:00.000Z", 104.0, 3.0, row[0]),
        )
        assert db.execute(
            "SELECT status, r_multiple FROM slk_shadow_experiments WHERE experiment_id=?", (row[0],)
        ).fetchone() == ("TP_HIT", 3.0)
        # Experimental observations stay outside all user-facing trade tables.
        assert db.execute("SELECT COUNT(*) FROM slk_alerts").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM slk_events").fetchone() == (0,)
        db.execute(insert, (
            "invalid", "setup", "OTHER", "EURUSD", "30m", "SHORT",
            104.9, 105.2, 104.0, 3.0,
            "2026-10-05T12:00:00.000Z", "2026-10-05T11:30:00.000Z",
        ))
        assert db.execute(
            "SELECT COUNT(*) FROM slk_shadow_experiments WHERE experiment_id='invalid'"
        ).fetchone() == (0,)


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


def test_diagnostics_tags_migration_is_additive_and_backward_compatible():
    """0008 adds nullable H4 confluence / session-bucket columns to the setup
    rows, the shadow ledger and the experiment ledger WITHOUT breaking inserts
    from the previous (tags-unaware) Worker."""
    with sqlite3.connect(":memory:") as db:
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name < "0008":
                db.executescript(migration.read_text())
        # Legacy rows (and the old Worker's inserts) keep working unchanged.
        db.execute(
            """INSERT INTO slk_alerts (setup_id, canonical_symbol, entry_timeframe, direction,
                   alert_status, status, candle_close_time, created_utc)
               VALUES ('legacy', 'EURUSD', '30m', 'SHORT', 'PAPER', 'OPEN',
                       '2026-09-05T06:00:00.000Z', '2026-09-05T06:00:00.000Z')"""
        )
        db.executescript((MIGRATIONS / "0008_diagnostics_tags.sql").read_text())
        assert db.execute(
            "SELECT h4_confluence_grade, h4_confluence_tags, session_bucket FROM slk_alerts WHERE setup_id='legacy'"
        ).fetchone() == (None, None, None)
        # Old-Worker inserts (the 38-column legacy statement) still succeed after the migration.
        db.execute(
            """INSERT INTO slk_alerts (setup_id, canonical_symbol, entry_timeframe, direction,
                   alert_status, status, candle_close_time, created_utc)
               VALUES ('rollback', 'EURUSD', '30m', 'LONG', 'PAPER', 'OPEN',
                       '2026-10-06T06:00:00.000Z', '2026-10-06T06:00:00.000Z')"""
        )
        # Tags-aware inserts record the diagnostics annotation.
        tags = json.dumps(["H4_PLUG_AND_PLAY", "H4_KL_OC", "H4_BREAKOUT_BEARISH", "S08_12"])
        db.execute(
            """INSERT INTO slk_alerts (setup_id, canonical_symbol, entry_timeframe, direction,
                   alert_status, status, candle_close_time, created_utc,
                   h4_confluence_grade, h4_confluence_tags, session_bucket)
               VALUES ('tagged', 'EURUSD', '30m', 'SHORT', 'PAPER', 'OPEN',
                       '2026-10-07T06:00:00.000Z', '2026-10-07T06:00:00.000Z',
                       'H4_PLUG_AND_PLAY', ?, 'S08_12')""",
            (tags,),
        )
        assert db.execute(
            "SELECT h4_confluence_grade, session_bucket FROM slk_alerts WHERE setup_id='tagged'"
        ).fetchone() == ("H4_PLUG_AND_PLAY", "S08_12")
        assert db.execute(
            "SELECT json_extract(h4_confluence_tags, '$[1]') FROM slk_alerts WHERE setup_id='tagged'"
        ).fetchone() == ("H4_KL_OC",)

        # The isolated research ledgers get the same additive annotation.
        db.execute(
            """INSERT INTO slk_shadow_trades (setup_id, canonical_symbol, entry_timeframe, direction,
                   hypothetical_entry, hypothetical_stop_loss, hypothetical_tp1, hypothetical_rr,
                   reject_reason, created_utc, candle_close_time, h4_confluence_grade,
                   h4_confluence_tags, session_bucket)
               VALUES ('shadow1', 'EURUSD', '30m', 'SHORT', 104.9, 105.2, 104.0, 3.0,
                       'TARGET_FLOOR', '2026-10-07T06:00:00.000Z', '2026-10-07T05:30:00.000Z',
                       'H4_KL_IN_FVG', ?, 'S04_08')""",
            (tags,),
        )
        db.execute(
            """INSERT INTO slk_shadow_experiments (experiment_id, source_setup_id, variant,
                   canonical_symbol, entry_timeframe, direction, hypothetical_entry,
                   hypothetical_stop_loss, hypothetical_target, hypothetical_rr, created_utc,
                   candle_close_time, h4_confluence_grade, h4_confluence_tags, session_bucket)
               VALUES ('exp1', 'setup1', 'BREAKOUT_CONTINUATION', 'EURUSD', '30m', 'LONG',
                       102.58, 102.28, 103.33, 2.5, '2026-10-07T06:00:00.000Z',
                       '2026-10-07T05:30:00.000Z', 'H4_PLUG_AND_PLAY', ?, 'S04_08')""",
            (tags,),
        )
        assert db.execute(
            "SELECT session_bucket FROM slk_shadow_trades WHERE setup_id='shadow1'"
        ).fetchone() == ("S04_08",)
        assert db.execute(
            "SELECT h4_confluence_grade FROM slk_shadow_experiments WHERE experiment_id='exp1'"
        ).fetchone() == ("H4_PLUG_AND_PLAY",)
        # Annotation must not leak observations into the user-facing tables.
        assert db.execute("SELECT COUNT(*) FROM slk_events").fetchone() == (0,)
