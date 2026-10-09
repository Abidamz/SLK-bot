-- Additive, nullable diagnostics column: whether a pending limit placed at
-- the entry price would actually have filled.
--
-- Purpose (diagnostics only — nothing here is read by any alert gate, dedupe
-- check, notification decision, or outcome rule, and it never changes a
-- recorded R):
--   fill_confirmed — 1 when price traded back through the entry price after
--                    the alert, 0 when the setup resolved without ever
--                    touching entry, NULL when not recorded (pre-migration
--                    rows, or unresolved setups).
--
-- Why it matters: the entry price is the retest candle's CLOSE, and every
-- alert tells subscribers to place a pending limit there (see the EXECUTION
-- line in formatAlert). A limit only fills if price trades back through that
-- level. When the move goes immediately in our favour it never fills — so no
-- trade ever happened for a subscriber who followed the alert, yet the ledger
-- currently records the full win, because evaluateSignal() assumes a fill on
-- every setup.
--
-- That is a one-directional bias: losers always fill (price must trade
-- through entry to reach the stop), while the cleanest winners — the ones
-- that run without looking back — never do. Every R figure quoted so far is
-- therefore the R of a hypothetical fill, not the R of acting on the
-- notification, and the real number is worse by whatever share of winners
-- never retraced.
--
-- This column makes that measurable. It does not change any recorded outcome.
--
-- Apply before deploying the fill-aware Worker. Old Worker inserts remain
-- compatible, including when rolling back the code deployment.

ALTER TABLE slk_alerts ADD COLUMN fill_confirmed INTEGER;

CREATE INDEX IF NOT EXISTS idx_slk_alerts_fill_confirmed
  ON slk_alerts (fill_confirmed, status);
