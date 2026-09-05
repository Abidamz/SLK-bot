-- SLK alert worker — initial D1 schema.
-- Mirrors the Python bot's v2 slk_alerts/slk_events schema (same 37-field
-- setup record) plus a small kv table (scan-state checkpoints) and a scan
-- audit log. Dedupe lives in the constraints: UNIQUE(setup_id) on alerts and
-- UNIQUE(setup_id, state, candle_time) on events, both written with
-- INSERT OR IGNORE — so Worker retries and overlapping rescans are safe.

CREATE TABLE IF NOT EXISTS slk_alerts (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  setup_id                    TEXT NOT NULL UNIQUE,
  provider                    TEXT,
  canonical_symbol            TEXT,
  map_timeframe               TEXT,
  entry_timeframe             TEXT,
  candle_close_time           TEXT,
  direction                   TEXT,
  environment                 TEXT,
  phase                       TEXT,
  htf_alignment               TEXT,
  origin_key_level            REAL,
  key_level_type              TEXT,
  key_level_bounds            TEXT,    -- JSON [lo, hi]
  key_level_tested            INTEGER,
  key_level_flipped           INTEGER,
  imbalance_context           TEXT,    -- JSON
  internal_liquidity          TEXT,    -- JSON pools
  external_liquidity          TEXT,    -- JSON pools
  draw_on_liquidity           REAL,
  nearest_external_target     REAL,
  intermediate_zones          TEXT,    -- JSON
  opposing_liquidity_standing INTEGER,
  cycle_stage                 TEXT,
  entry_mode                  TEXT,
  entry                       REAL,
  stop_loss                   REAL,
  tp_internal                 REAL,
  tp_external                 REAL,
  sweep_time                  TEXT,
  bos_time                    TEXT,
  return_time                 TEXT,
  invalidation_level          REAL,
  invalidation_reason         TEXT,
  parameter_version           TEXT,
  setup_ref                   TEXT,
  alert_status                TEXT,    -- PAPER | LIVE | SUPPRESSED
  suppress_reason             TEXT,
  status                      TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | TP_HIT | SL_HIT | EXPIRED
  exit_price                  REAL,
  exit_time                   INTEGER,
  r_multiple                  REAL,
  created_utc                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_slk_alerts_status ON slk_alerts (status, canonical_symbol, entry_timeframe);
CREATE INDEX IF NOT EXISTS idx_slk_alerts_pair_dir ON slk_alerts (canonical_symbol, direction, candle_close_time);

CREATE TABLE IF NOT EXISTS slk_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  setup_id     TEXT NOT NULL,
  pair         TEXT,
  state        TEXT NOT NULL,  -- MAP | TOUCH | SWEEP | SHIFT | RETEST | KILLED
  candle_time  TEXT,
  reason       TEXT,
  price        REAL,
  created_utc  TEXT,
  UNIQUE (setup_id, state, candle_time)
);
CREATE INDEX IF NOT EXISTS idx_slk_events_setup ON slk_events (setup_id);

CREATE TABLE IF NOT EXISTS slk_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slk_scan_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  timeframes  TEXT,   -- JSON array of scanned timeframes
  pairs       TEXT,   -- JSON array of scanned pairs
  alerts      INTEGER,
  events      INTEGER,
  errors      TEXT,   -- JSON array
  duration_ms INTEGER,
  note        TEXT    -- ok | partial
);
