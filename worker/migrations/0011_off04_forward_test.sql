-- OFF-04 live forward-test observations are alert-only and isolated from the
-- production alert/event tables and existing shadow ledgers. No execution or
-- public-statistics code reads this table.
CREATE TABLE IF NOT EXISTS slk_off04_forward_trades (
  setup_id                       TEXT PRIMARY KEY,
  variant                        TEXT NOT NULL CHECK (variant = 'baseline_all_signals'),
  trigger_policy                 TEXT NOT NULL CHECK (trigger_policy = 'post_formation_m15_zone_retest'),
  canonical_symbol               TEXT NOT NULL CHECK (canonical_symbol IN (
    'JAPAN225', 'NAS100', 'EURUSD', 'XAUUSD', 'NETHERLANDS25', 'AUDJPY', 'AUDUSD'
  )),
  entry_timeframe                TEXT NOT NULL CHECK (entry_timeframe = '15m'),
  direction                      TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  hypothetical_entry             REAL NOT NULL,
  hypothetical_stop_loss         REAL NOT NULL,
  hypothetical_target            REAL NOT NULL,
  initial_risk                   REAL NOT NULL CHECK (initial_risk > 0),
  target_r                       REAL NOT NULL CHECK (target_r = 3),
  h4_fvg_available_at_ms         INTEGER NOT NULL,
  h4_first_touch_available_at_ms INTEGER NOT NULL,
  m15_fvg_available_at_ms        INTEGER NOT NULL,
  trigger_available_at_ms        INTEGER NOT NULL,
  entry_time_ms                  INTEGER NOT NULL,
  created_utc                    TEXT NOT NULL,
  status                         TEXT NOT NULL DEFAULT 'OPEN'
                                   CHECK (status IN ('OPEN', 'TP_HIT', 'SL_HIT', 'DATA_GAP_CENSORED')),
  exit_time_ms                   INTEGER,
  exit_price                     REAL,
  r_multiple                     REAL,
  telegram_status                TEXT NOT NULL DEFAULT 'PENDING'
                                   CHECK (telegram_status IN ('PENDING', 'SENT', 'FAILED')),
  telegram_sent_utc              TEXT,
  delivery_error                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_slk_off04_forward_open_pair
  ON slk_off04_forward_trades (status, canonical_symbol, entry_time_ms);
CREATE INDEX IF NOT EXISTS idx_slk_off04_forward_created
  ON slk_off04_forward_trades (created_utc DESC);
