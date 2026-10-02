-- Additive research-only ledger. It is deliberately separate from
-- slk_alerts/slk_events so public stats, alerts, recaps, and Monte Carlo never
-- include hypothetical near misses. setup_id is the deterministic setup
-- identity and makes repeated scan replays idempotent.
CREATE TABLE IF NOT EXISTS slk_shadow_trades (
  setup_id             TEXT PRIMARY KEY,
  canonical_symbol     TEXT NOT NULL,
  entry_timeframe      TEXT NOT NULL,
  direction            TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  hypothetical_entry   REAL NOT NULL,
  hypothetical_stop_loss REAL NOT NULL,
  hypothetical_tp1     REAL NOT NULL,
  hypothetical_rr      REAL NOT NULL,
  reject_reason        TEXT NOT NULL CHECK (reject_reason IN ('TARGET_FLOOR', 'NO_RETEST')),
  created_utc          TEXT NOT NULL,
  candle_close_time    TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'TP_HIT', 'SL_HIT', 'EXPIRED')),
  exit_time            TEXT,
  exit_price           REAL,
  r_multiple           REAL
);

CREATE INDEX IF NOT EXISTS idx_slk_shadow_status_pair_tf
  ON slk_shadow_trades (status, canonical_symbol, entry_timeframe);
CREATE INDEX IF NOT EXISTS idx_slk_shadow_created
  ON slk_shadow_trades (created_utc DESC);
