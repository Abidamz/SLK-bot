-- Add waitlist table for capturing cohort leads
CREATE TABLE IF NOT EXISTS slk_waitlist (
  email TEXT PRIMARY KEY,
  telegram TEXT,
  segment_interest TEXT,
  created_utc TEXT NOT NULL,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_slk_waitlist_created ON slk_waitlist(created_utc);
