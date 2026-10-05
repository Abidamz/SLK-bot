-- Additive, research-only variants for Breakout continuation and 50% FVG retest.
-- This ledger is isolated from alerts, events, recaps, stats, and Monte Carlo.
CREATE TABLE IF NOT EXISTS slk_shadow_experiments (
  experiment_id          TEXT PRIMARY KEY,
  source_setup_id        TEXT NOT NULL,
  variant                TEXT NOT NULL CHECK (variant IN ('BREAKOUT_CONTINUATION', 'FVG_RETEST_50')),
  canonical_symbol       TEXT NOT NULL,
  entry_timeframe        TEXT NOT NULL,
  direction              TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  hypothetical_entry     REAL NOT NULL,
  hypothetical_stop_loss REAL NOT NULL,
  hypothetical_target    REAL NOT NULL,
  hypothetical_rr        REAL NOT NULL,
  created_utc            TEXT NOT NULL,
  candle_close_time      TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'TP_HIT', 'SL_HIT', 'EXPIRED')),
  exit_time              TEXT,
  exit_price             REAL,
  r_multiple             REAL
);

CREATE INDEX IF NOT EXISTS idx_slk_shadow_experiments_status_pair_tf
  ON slk_shadow_experiments (status, canonical_symbol, entry_timeframe);
CREATE INDEX IF NOT EXISTS idx_slk_shadow_experiments_variant_close
  ON slk_shadow_experiments (variant, candle_close_time);
