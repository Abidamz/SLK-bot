-- Additive, nullable diagnostics columns. Old rows mean "no annotation",
-- not zero confluence.
--
-- Purpose (diagnostics only — nothing here is ever read by an alert gate,
-- dedupe check, notification decision, or outcome rule):
--   h4_confluence_grade  — H4 vantage confluence grade for the scan
--                          (H4_PLUG_AND_PLAY / H4_KL_IN_FVG / H4_FVG_ONLY /
--                           H4_BREAKOUT_BARE)
--   h4_confluence_tags   — JSON array of confluence tags (grade, key-level
--                          kind H4_KL_A/H4_KL_V/H4_KL_OC/H4_KL_DECISION,
--                          breakout direction, OBSERVATION_ONLY provisional
--                          marker) plus the row's UTC+1 session bucket tag
--   session_bucket       — UTC+1 session bucket of the triggering candle's
--                          open time: S00_04 S04_08 S08_12 S12_16 S16_20 S20_24
--
-- Apply before deploying the tags-aware Worker. Old Worker inserts remain
-- compatible, including when rolling back the code deployment.

ALTER TABLE slk_alerts ADD COLUMN h4_confluence_grade TEXT;
ALTER TABLE slk_alerts ADD COLUMN h4_confluence_tags TEXT;
ALTER TABLE slk_alerts ADD COLUMN session_bucket TEXT;

ALTER TABLE slk_shadow_trades ADD COLUMN h4_confluence_grade TEXT;
ALTER TABLE slk_shadow_trades ADD COLUMN h4_confluence_tags TEXT;
ALTER TABLE slk_shadow_trades ADD COLUMN session_bucket TEXT;

ALTER TABLE slk_shadow_experiments ADD COLUMN h4_confluence_grade TEXT;
ALTER TABLE slk_shadow_experiments ADD COLUMN h4_confluence_tags TEXT;
ALTER TABLE slk_shadow_experiments ADD COLUMN session_bucket TEXT;

CREATE INDEX IF NOT EXISTS idx_slk_shadow_bucket
  ON slk_shadow_trades (session_bucket, reject_reason);
CREATE INDEX IF NOT EXISTS idx_slk_shadow_experiments_bucket
  ON slk_shadow_experiments (session_bucket, variant);
