-- Additive, nullable diagnostics column: the shadow directional-bias
-- classification of the confirmed entry (HTF_CONFLICT / ALIGNED / etc).
--
-- Purpose (diagnostics only — nothing here is read by any alert gate, dedupe
-- check, notification decision, or outcome rule):
--   shadow_classification — result of evaluateDirectionalBias() for this setup.
--                           It is already computed per alert, already logged as
--                           slk.shadow.classification, and already rendered in
--                           the Telegram badge — but until now it was never
--                           stored, so HTF_CONFLICT outcomes could not be
--                           measured against ALIGNED outcomes.
--
-- Why it matters: applyHtfConflictGate() can suppress HTF_CONFLICT entries, but
-- FILTER_HTF_CONFLICT_DERIV_ONLY=true scopes that gate to Deriv synthetics
-- only, so it is inert for every institutional pair. Deciding whether to widen
-- that gate needs data on whether HTF_CONFLICT setups actually win or lose.
-- This column supplies it.
--
-- NULL means "not recorded" (pre-migration rows), not "no conflict".
--
-- Apply before deploying the classification-aware Worker. Old Worker inserts
-- remain compatible, including when rolling back the code deployment.

ALTER TABLE slk_alerts ADD COLUMN shadow_classification TEXT;

CREATE INDEX IF NOT EXISTS idx_slk_alerts_shadow_class
  ON slk_alerts (shadow_classification, status);
