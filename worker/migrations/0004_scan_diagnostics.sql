-- Additive and nullable: old rows mean "diagnostics unavailable", not zero.
-- Apply before deploying the diagnostics-aware Worker. Old Worker inserts
-- remain compatible, including when rolling back the code deployment.
ALTER TABLE slk_scan_log ADD COLUMN diagnostics_json TEXT;
