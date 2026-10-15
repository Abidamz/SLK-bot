# Outcome Override Policy — feed truth vs broker truth

_Decided 2026-10-15, owner-delegated. Incident: NAS100 15m SHORT
(`NAS100:15m:SHORT:DECISION:29725.000000:2026-10-14T20:00:00.000Z`)._

## The incident

Subscribers' brokers filled TP1 at 29426.8 during the 2026-10-15 decline.
The engine's own feed printed a near-miss (low above the target), the
trailing breakeven armed at +1.5R, and the first reversal candle crossing
entry resolved the row BE_HIT at 0.00R. No bug: `evaluateSignal` is
touch-based on the candles it is given, and it was given a feed that never
printed the touch. The paper ledger and subscriber reality diverged at a
touch that landed within a handful of points.

## The policy

1. **The automatic resolver keeps single-feed truth.** No touch tolerance
   and no second feed inside the outcome path. Tolerance-shaped fills are
   how phantom edge gets manufactured, and one dispute does not justify
   signal-path surgery.
2. **Manual override is the sanctioned bridge, never the default.**
   `POST /admin/set-outcome` (admin-gated) validates the terminal status,
   recomputes R from the row's own entry/stop unless overridden, writes the
   outcome, and inserts a `MANUAL OUTCOME OVERRIDE` note into the scan log
   with the owner's reason. `notify=true` replays the Telegram outcome
   message. Every use is therefore visible in the audit trail.
3. **Measure every dispute.** `GET /admin/candles?pair=&tf=&limit=` returns
   the exact candles the resolver saw, plus the provider name. Record the
   gap size (points and fraction of stop distance) for each dispute.
4. **Revisit second-feed confirmation with data, not vibes.** If overrides
   recur (working threshold: three or more) or the measured gaps prove
   systematic versus stop distance, implement independent-feed confirmation
   at resolution time and re-gate it against the standing 0.30R gross bar.
5. **Overrides change the live ledger and say so.** The ledger is now
   engine-resolved rows plus owner-corrected rows; stats computed from it
   inherit that mix. Corrections are recorded here and in the scan log so
   no future analysis mistakes them for engine output.

## The first override

- Setup: `NAS100:15m:SHORT:DECISION:29725.000000:2026-10-14T20:00:00.000Z`
- Was: BE_HIT, exit 29714.2, 0.00R. Now: TP_HIT, exit 29426.8, +3.00R.
- Exit time 2026-10-15T14:30:00Z was read off the subscriber chart at ±1
  candle. The previous BE exit time shows the reversal candle opened
  14:30Z, so the broker touch sits in the 14:15Z candle; the 15-minute
  refinement was deliberately not re-applied because no downstream
  consumer reads exit time at that granularity and re-running would replay
  the Telegram message. The reason string declares the uncertainty.
- Ledger effect: live book +13.58R → +16.58R, one additional win in the
  tp/(tp+sl) ratio.

## Tooling shipped alongside

- `GET /admin/repair-outcomes` (dry-run default) re-resolves stuck-OPEN
  rows against up to 1000 bars of history; `notify=true` replays missed
  outcome messages.
- `GET /admin/candles` read-only feed audit.
- Loud warns on every formerly silent skip in the realtime resolver:
  no candles at/after entry, unusable target, empty or stale feed.
