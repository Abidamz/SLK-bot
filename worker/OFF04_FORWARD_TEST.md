# OFF-04 forward test (alert-only)

## Candidate and safety boundary

- Variant: `baseline_all_signals` (all sessions).
- Trigger: `post_formation_m15_zone_retest`.
- Target: fixed 3R.
- Universe: JAPAN225, NAS100, EURUSD, XAUUSD, NETHERLANDS25, AUDJPY, AUDUSD.
- Feed: OANDA midpoint H1/M15 candles, matching the OFF-04 research source.
- Alerts are labeled **PAPER / NO ORDER**. The forward module does not call the production signal gate, create production alert/event rows, notify subscriber destinations, or call an execution adapter.
- Results are stored only in `slk_off04_forward_trades`; review them through the authenticated `GET /api/off04-forward-ledger` endpoint.

The signal logic follows the OFF-04 baseline: UTC-aligned complete H1-to-H4 aggregation; first observed completed-M15 touch of an available H4 FVG; same-direction, narrower M15 FVG available within four hours of that observed H4 touch; then the first post-formation M15-zone overlap within four hours. Session filters are not applied. Timestamp-gap FVGs are retained as in the research definition. The forward ledger records the first observed touch but does not claim complete M15 coverage through it, so a provider gap can make that observation differ from a proven first-ever touch. The R03 reference uses the next M15 open, the latest confirmed unique 2-left/2-right M15 swing strictly beyond entry, and a 3R target. Completed M15 OHLC resolves outcomes stop-first on same-bar ambiguity; a stop gap is filled at the worse open and a target gap receives no improvement.

## Forward-only start and freshness guards

The first enabled scan seeds the latest OANDA candles and confirmed swing pivots but intentionally does **not** backfill existing H4 zones or historical M15 signals. The first signals can only come from H4 FVGs formed after that seed. Subsequent candle polling is bounded; a long data interruption causes a fresh baseline instead of replaying stale signals.

A Telegram alert is sent only when the signal is no more than two minutes old, the exact next M15-open candle is available, and a valid confirmed swing stop exists. If any condition fails, the signal is skipped rather than sent late or with a fabricated level. Stop selection uses the up-to-5,000 completed M15 candles returned by OANDA at baseline plus pivots observed during the forward run; if no qualifying stop exists in that observed history, the candidate is skipped.

## Enable only after a dedicated test channel is ready

The module is default-off. On the Cloudflare Worker environment, configure:

1. `OFF04_FORWARD_ENABLED=true` as a Worker variable.
2. `OFF04_FORWARD_TEST_CHAT_ID` as a Worker secret containing **only the dedicated test channel's numeric `-100...` Telegram chat ID**. Do not put the ID in source control or chat.
3. Confirm the bot is a member/admin of that test channel. The code rejects a target that matches any existing numeric Telegram recipient from Worker variables or D1 settings; it also fails closed if an existing recipient is a nonnumeric alias that cannot be compared safely. It never falls back to a subscriber/private-chat setting.
4. Confirm the OANDA token and D1 binding are present. Before enabling the test, use the manual **Apply D1 Migrations** GitHub Actions workflow to inspect pending migrations. Apply only after confirming the full pending list is expected; that workflow applies all pending migrations, including `0011_off04_forward_test.sql`.

Keep the feature disabled until the deployment snapshot and target channel have been verified. A Telegram delivery failure is recorded separately on the forward-test row as `FAILED`; no subscriber channel is used as a retry destination.
