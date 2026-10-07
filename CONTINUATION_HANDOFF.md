# SLK Model — Definitive Project Handoff

**Updated:** 2026-10-07 (UTC)
**Repository:** `Abidamz/SLK-bot`
**This session's branch:** `arena/0e17c27a-slk-bot`
**Production lineage:** `arena/08df9077-slk-bot`
**Production Worker:** `https://slk-alert-worker.abidogundamilola.workers.dev`
**Production dashboard:** `https://slk-radar.pages.dev`
**Deriv relay:** `https://slk-bot.vercel.app`

This is the source of truth for future sessions. The current owner-provided brief and this file override stale descriptions elsewhere in the repository.

## 1. Mission and current operating state

The product is the **SLK Model (Structure · Liquidity · Key Levels)**. It is a paper-simulation trading-signal and research system—not an order-execution service.

- **Mode is paper only:** `MODE=paper`, `PAPER_NOTIFY=true`; MT5/live execution stays disabled.
- A Cloudflare Worker scans on a one-minute cron. It currently watches 23 configured markets on `15m,30m,1h`; Deriv synthetics use `30m,1h` as their primary entry timeframes.
- The confirmation lifecycle is `MAP → TOUCH → SWEEP → SHIFT → RETEST → CONFIRMED`, with invalidation/expiry paths. The minimum target floor is `MIN_TP_R=2.5`; the minimum risk-width gate is `MIN_RISK_ATR=0.8`.
- Production baseline supplied on 2026-10-05: the delivered ledger had 8 signals, 62.5% win rate, and +11.52R. Treat that as a small paper sample, not a performance promise.
- Dashboard pages are on Cloudflare Pages project `slk-radar`. The Vercel relay supplies Deriv synthetic candles.
- The shadow ledger is a separate, observation-only dataset. It must not change live/paper entries or leak into user-facing trading surfaces.

## 2. Architecture and data boundaries

### Runtime path

1. `worker/src/index.ts` runs the cron scan, applies round-robin pair batching, resolves open outcomes, and dispatches notifications.
2. `worker/src/provider.ts` uses Twelve Data for general FX/metals routing, the configured OANDA map for covered instruments, Dukascopy as the supported index fallback, and Deriv for synthetics. Provider overrides are restricted to `twelvedata`, `oanda`, `dukascopy`, and `deriv`; unrecognized values use canonical routing. The added Forex instruments resolve as `USDCAD → USD_CAD`, `NZDUSD → NZD_USD`, and `EURJPY → EUR_JPY`. Deriv candles come through `https://slk-bot.vercel.app`; the relay exposes `/candles`, `/health`, and `/probe`.
3. `worker/src/features.ts` and `worker/src/storyline.ts` build the point-in-time structure, key-level, liquidity, and imbalance context. `worker/src/engine.ts` evaluates the confirmation sequence. Risk, target, freshness, and delivery gates are applied before an alert is delivered.
4. Cloudflare D1 stores alerts, events, scan diagnostics, channel-level notification audit results, the isolated shadow ledger, and a separate shadow-experiment ledger. SQL migrations are in `worker/migrations/` (`0001`–`0008`). The owner already applied `0006_shadow_ledger.sql` in production; the experiment code safely no-ops until `0007_shadow_experiments.sql` is applied and retries the missing-table check every five minutes. Migration `0008_diagnostics_tags.sql` adds the nullable diagnostics columns (H4 confluence grade/tags + UTC+1 session bucket); until it is applied the Worker still writes alerts and ledger rows unchanged and simply omits the annotation, re-probing every five minutes.
5. Telegram delivery is tier-separated. VIP channels receive confirmed entries and final outcomes only. Free channels may receive teaser cards, weekly recaps, and the Engine Discipline digest. Pre-entry watch cards (`WATCH_NOTIFY`) and bias-context cards (`BIAS_NOTIFY`) are separate opt-ins and are currently disabled to prevent noisy, misleading posts. Synthetic content is never sent to the Forex free channel.
6. The public journal shows only signals actually delivered to Telegram. Audit/admin views are protected. Recap cards retain the explicit **“paper simulation — research only”** disclaimer.

### Important code locations

- `worker/src/config.ts` — env parsing and strategy defaults.
- `worker/src/provider.ts` — provider resolution and candle validation.
- `worker/src/features.ts`, `worker/src/storyline.ts` — market structure and storyline.
- `worker/src/engine.ts` — state machine, target/risk gates, optional FVG-depth retest threshold.
- `worker/src/store.ts` — D1/MemStore behavior, delivered ledger, scan logs, private audit aggregates, shadow ledgers.
- `worker/src/diagnostics.ts` — replay counters, pair/timeframe funnel data, scan-audit summaries, and the 24-hour Engine Pulse.
- `worker/src/shadow.ts` — directional-bias classification (separate from shadow-trade measurement).
- `worker/src/notify.ts` — Telegram formatting, channel routing, recaps and digest.
- `worker/src/mt5.ts` — gated bridge client; production paper configuration does not dispatch orders.
- `worker/src/index.ts` — Worker endpoints and scheduled orchestration, including the isolated shadow-experiment pass.
- `worker/migrations/0006_shadow_ledger.sql` — separate floor/retest research table and indexes.
- `worker/src/h4_context.ts` — diagnostics-only H4 vantage confluence tags and the UTC+1 session buckets. Never consulted by any alert gate, dedupe check, delivery decision, or outcome rule.
- `worker/migrations/0007_shadow_experiments.sql` — separate Breakout/FVG experiment table and indexes.
- `worker/migrations/0008_diagnostics_tags.sql` — additive nullable `h4_confluence_grade`, `h4_confluence_tags`, `session_bucket` columns plus session-bucket indexes.
- `dashboard/` — Pages dashboard and public journal.
- `api/` — Vercel relay endpoints; `deriv-relay/` contains its standalone relay implementation.

### Shadow-ledger contract

- Captures only `TARGET_FLOOR` counterfactuals in `[2.0R, 2.5R)` and `NO_RETEST` counterfactuals.
- Uses setup identity for deduplication, resolves with the same candle rules, and expires unresolved observations after 120 bars.
- `GET /api/shadow-ledger` is owner/admin-key protected. It aggregates only the separate shadow table.
- Shadow rows never appear in Telegram alerts, public events, `/stats`, `/alerts`, recaps, or Monte Carlo. Keep this strict isolation when changing code.

### Private scan and delivery audit

- `GET /api/scan-audit?days=21` is owner/admin-key protected; valid windows are 1–31 days. The Pages dashboard exposes it under **Market Health → 21-Day Scan & Delivery Audit** and prompts for the existing owner key.
- The report returns scan/error totals, keyword-based error categories, pair/timeframe replay funnel counts, and normalized channel API results for confirmed entries/final outcomes. Error categories are not confirmed root causes or unique incidents. It does not return raw provider errors, message contents, chat IDs, alerts, or shadow rows.
- Funnel values are replay counts, not unique setup counts. Stored alert rows are not proof of notification delivery. Delivery status means the channel API accepted/rejected the request, not that a person saw it.
- Durable delivery-result tracking covers confirmed entries/final outcomes only; it does not audit WATCH/Bias sends, so it cannot reconstruct prior Free pre-entry-card volume. Tracking of confirmed-entry/outcome API results starts with this release; past outcomes cannot be reconstructed. The report shows the first tracked timestamp for context, but writes are best-effort: missing rows do not prove that a message was not sent.

### Confirmation freshness gate and the alert ledger

- A replayed confirmation is written live only when its candle close is at most `2.5 × entry-timeframe` old (`alertEventFresh`, `worker/src/index.ts`). Older ones are counted (`staleConfirmationSkips`) and dropped **without a row**.
- Releases up to 2026-09-30 instead stored those late confirmations as `slk_alerts` rows with `suppressReason = "stale confirmation — record-only"`. That string no longer exists in the source, so **no new row will ever carry it**, and the ledger is no longer inflated by catch-up backfills.
- Read this before judging inflow: "no new alert rows and no new suppressed rows" is expected behaviour under the current release, not a malfunction. Judge engine activity from `/api/engine-pulse` chains and the scan-audit daily counters, not from `slk_alerts` row volume.
- Live gate counters live in `slk_scan_log.diagnostics_json.recorded.*` (`confirmedAlerts`, `staleConfirmationSkips`, `duplicateConfirmationSkips`, `riskRejectReasons`) and are surfaced by `/api/scan-audit` and `/api/engine-pulse`.

### Confirmation funnel (discovery latency, diagnostics only)

- Every confirmation attempt that reaches the live freshness gate is now bucketed per entry timeframe in `slk_scan_log.diagnostics_json.recorded.confirmations`, one entry per timeframe: `built`, `fresh`, `stale`, `inserted`, `duplicate`, `nearMiss`, `ageSumSec`, `ageMaxSec`, `freshAgeSumSec`. **Discovery age** is `now − alert candle close`; the freshness window used for the near-miss classification is the same `2.5 × timeframe` the gate itself applies.
- Stage identities hold by construction: `built = fresh + stale` and `fresh = inserted + duplicate`. A **near miss** is a stale drop that was still inside twice the freshness window — i.e. the kind of miss that a faster scan cadence could realistically rescue. That is the number to read when the question is "are we losing alerts to timing rather than to strategy".
- `/api/engine-pulse` exposes it as `confirmations: [{ timeframe, built, fresh, stale, inserted, duplicate, nearMiss, avgAgeSec, maxAgeSec, avgFreshAgeSec }]` (sorted by timeframe; `maxAgeSec` is the largest per-scan maximum in the window, never a sum). Both dashboard copies render it under the rejection line (`#enginePulseFunnel`): `<tf>: N reached the live gate, N inside the freshness window, N stored, N dropped stale (avg discovery X, N near-miss)`.
- **Hard boundary:** these counters are written *after* the freshness/dedupe decision and are never read back by any gate, strategy, delivery path, or outcome rule. Old rows that predate the field contribute nothing and cannot break the aggregator; malformed or missing values are ignored per key. `MODE`, `MIN_TP_R`, `MIN_RISK_ATR`, `RETEST_DEPTH_PCT`, the pair list, the timeframes, and channel routing are untouched.

### Separate shadow experiments (research only)

- `BREAKOUT_CONTINUATION` is aligned to one exact sequence: **recent H4 structural breakout → liquidity sweep on the entry timeframe after that breakout → price rebalances into the breakout's H4 FVG (plug-and-play zone preferred, i.e. a key level of any kind sitting inside the FVG) → continuation entry recorded at the zone touch, in the breakout direction.** The stop is the pullback leg's own extreme (sweep extreme and everything after it), not the far edge of the H4 FVG; the target is the mapped external target in the breakout direction, with a transparent 2.5R benchmark only when every mapped pool has already been crossed. It is evaluated on the latest closed entry candle of a live scan only (no historical backfill), keeps the existing stop/risk checks, is deterministic on (breakout, rebalance zone) so replays cannot mint duplicates, and has not yet been validated against historical outcomes.
- `FVG_RETEST_50` is a separate replay limited to paper-mode 30m scans whose configured retest depth remains at the legacy `100`. It tests midpoint FVG penetration, then records only latest-close, non-suppressed candidates. It does not change the normal 100% retest rule, alerts, target floor, or risk gates.
- Both variants write only to `slk_shadow_experiments`; the 50% replay suppresses normal transition events and does not deliver its returned alerts. The table can safely be absent until migration `0007_shadow_experiments.sql` is applied.
- `GET /api/shadow-experiments` is owner/admin-key protected. These rows must remain absent from Telegram, public events/journal, `/stats`, `/alerts`, recaps, and Monte Carlo.
- Both experiment variants record the diagnostics annotation described below (H4 confluence tags + UTC+1 session bucket) so the ledgers can be sliced by confluence grade and by session without changing any gate.

### Diagnostics-only tagging (H4 vantage confluence + session buckets)

- Every setup row (`slk_alerts`), shadow-ledger row (`slk_shadow_trades`) and experiment row (`slk_shadow_experiments`) carries `h4_confluence_grade`, `h4_confluence_tags` (JSON array) and `session_bucket`. Engine transition rows in `slk_events` are deliberately not extended.
- **H4 vantage confluence** is computed once per market per scan from the closed H4 feed (`buildH4VantageConfluence`): the most recent H4 structural breakout and its direction, whether that breakout created an H4 FVG, and whether an H4 key level of **any** kind (A, V, OC, DECISION) sits inside/overlapping that FVG. Grades, highest first:
  - `H4_PLUG_AND_PLAY` — key level with `fvgOverlap=true` inside the breakout's FVG;
  - `H4_KL_IN_FVG` — key level overlapping the breakout FVG zone (kind tag `H4_KL_A` / `H4_KL_V` / `H4_KL_OC` / `H4_KL_DECISION`);
  - `H4_FVG_ONLY` — breakout FVG with no key level inside;
  - `H4_BREAKOUT_BARE` — breakout with no FVG; `H4_NO_BREAKOUT` is the tag (and grade `null`) when no recent H4 breakout exists.
  Direction tags (`H4_BREAKOUT_BULLISH` / `H4_BREAKOUT_BEARISH`) always accompany a grade. When the daily read is neutral or incomplete the H4 breakout direction is additionally recorded as a provisional bias input tagged `OBSERVATION_ONLY` (plus `H4_PROVISIONAL_BIAS_LONG` / `H4_PROVISIONAL_BIAS_SHORT`) — grading/diagnostics only.
- **Session buckets** are the UTC+1 bucket of the triggering candle's OPEN time: `S00_04`, `S04_08`, `S08_12`, `S12_16`, `S16_20`, `S20_24`. The bucket is stored in its own column and appended to the tag array. The overnight thesis (00:00–08:00 UTC+1 = `S00_04` + `S04_08`) can now be tested directly on the ledgers.
- **Hard boundary:** no tag, grade, bucket, or provisional bias is ever read by an alert gate, dedupe check, cooldown, notification decision, delivery path, or outcome rule. `MODE`, `MIN_TP_R`, `MIN_RISK_ATR`, `RETEST_DEPTH_PCT`, the pair list, the timeframes, and channel routing are untouched.
- **Production status (2026-10-07):** migration `0008_diagnostics_tags.sql` is applied in production D1. Tagged rows are being written — the first fully tagged shadow-experiment rows appear between 13:32 and 14:03 UTC (e.g. `USDJPY 15m LONG` → `H4_PLUG_AND_PLAY` / `H4_KL_DECISION` / `S12_16`). Rows created before the migration keep `null` tags. No alert row has been written since the migration, so alert-level tag writes are not yet observed in production; that path is covered by tests.

### Live Desk tape (Event Tape correctness)

- `/api/recent-events` accepts an optional `tail=1`: it returns the NEWEST `limit` rows in ascending order with `cursor = max event id`. Numeric `since` paging is byte-for-byte unchanged (backward compatible).
- Both dashboard copies (`dashboard/app.js` and the embedded `worker/src/dashboard_html.ts`) bootstrap the tape with `tail=1&limit=12`, adopt the tail cursor, and only ever stream FORWARD via `since=cursor`. Stored September history can no longer replay as if it were live, and the chime/flash fires only for genuinely new events arriving after the initial render.
- Timestamps render as `HH:MM UTC` for today's events and `MM-DD HH:MM UTC` for anything older, so a stale event can never look live.

- The Engine Discipline weekly digest is controlled by `ENGINE_DIGEST` and goes to explicit FREE-channel IDs only; it has no VIP fallback.

## 3. Deployment model — read before any edit or push

**Pushing any `arena/**` branch triggers production deployment. A push is a release; it is not a staging preview.** GitHub Actions runs the gates and, if green, deploys the Worker and dashboard.

### Required workflow invariants

- `.github/workflows/deploy.yml` must keep: push triggers for `arena/**` and `main`; tests gating deployment; a deploy job that is not opt-in gated. Its current content is the production-lineage workflow **plus one deliberate addition** — the `Stamp Dashboard Asset Versions` step described below. Do not replace the workflow with workflow-dispatch-only logic, and do not remove the stamping step.
- Session work stays on `arena/0e17c27a-slk-bot`. Push only with `git push origin arena/0e17c27a-slk-bot`. Never switch branches for this session.
- Do **not** merge PRs or ask the owner to merge. Pushing this branch is what deploys. Do not push to or deploy `main`; it is stale and hands-off.
- Before each push, run the full local validation suite below. Do not push partially validated work.
- After each push, wait for the GitHub Actions run to finish successfully and allow about three minutes for propagation. Then request `/health` with a fresh random query parameter and report the returned JSON. `/api/engine-pulse` or an observed behavior change can also verify a release. An unauthorized response from an unknown `/api/*` route does **not** prove that route exists.
- A failing “Workers Builds” preview check is known benign noise. Cloudflare's native Git integration also duplicates deploys only for the production lineage branch; neither is a reason to change the required workflow.

### Dashboard (Cloudflare Pages) deploy path — fragile, read this

The `slk-radar` Pages project is **git-integrated**, and Cloudflare classifies an upload as a production deploy **only when the branch label on the upload equals the project's Production branch setting**. CI uploads with `--branch=main`, so the project's **Production branch setting must stay `main`**. Those two values are one setting expressed in two places; change either one alone and the custom domain silently keeps serving an old build with no error surfaced anywhere.

- This is exactly what happened between early September and 2026-10-07: the setting held `arena/3ff9b8eb-slk-bot`, an abandoned session branch, so every dashboard upload landed as a preview while `slk-radar.pages.dev` kept serving a stale build. The Worker dashboard kept updating (it ships inside the Worker), which made the Pages copy look merely "cached".
- **Symptom to recognise:** `…workers.dev/dashboard` shows current data while `slk-radar.pages.dev` shows old data, and `main.slk-radar.pages.dev` serves a **newer** build than the production hostname.
- Pages serves static assets with a browser cache window of roughly four hours that `_headers` cannot override. The `Stamp Dashboard Asset Versions` step rewrites `app.js?v=…` and `styles.css?v=…` in `dashboard/index.html` to the commit SHA before upload, so every release gets a fresh cache key. Keep that step, and keep the `?v=` query strings in the HTML.
- **After each push, check:** the Live Desk tape on `https://slk-radar.pages.dev/` shows today's UTC timestamps, and `https://slk-radar.pages.dev/app.js` contains the string `tail=1`.

### Full local validation suite

From the repository root, after dependencies are installed with `npm ci --prefix worker`:

```bash
npm test -- --run
npm run typecheck
node --check dashboard/app.js
```

Then from `worker/`:

```bash
npx wrangler deploy --dry-run
```

The same test, typecheck, and dashboard syntax gates run in GitHub Actions. The Wrangler dry run is an additional local release check.

### Post-push proof

```bash
curl -fsS "https://slk-alert-worker.abidogundamilola.workers.dev/health?v=$(date +%s)"
```

Always use a fresh query parameter. Never use a 401 from an unknown API route as deploy proof.

Dashboard proof (Pages production host, also use a fresh query parameter):

```bash
curl -fsS "https://slk-radar.pages.dev/app.js?v=$(date +%s)" | grep -c "tail=1"
```

Expect a non-zero count. A zero means the upload landed as a preview — re-read the Pages deploy-path section above.

## 4. Production environment and tuning reference

These are effective production values as of 2026-10-06, following the notification-routing safeguards in this release. `worker/wrangler.jsonc` is the source for non-secret Worker variables; `worker/src/config.ts` supplies code defaults. “Safe range” is an operational recommendation, not permission to override a standing rule.

| Variable | Effective value | Purpose | Safe range / standing constraint |
|---|---|---|---|
| `MODE` | `paper` | Worker operating mode. | **Paper only.** Do not set to `live`. |
| `PAPER_NOTIFY` | `true` | Allows paper-simulation alerts to be delivered. | Keep `true`. |
| `PAIRS` | `EURUSD,GBPUSD,USDJPY,AUDJPY,GBPJPY,XAUUSD,NAS100,US30,GER40,JAPAN225,V75,V100,V50,V25,V10,V75_1S,V100_1S,V50_1S,V25_1S,V10_1S,USDCAD,NZDUSD,EURJPY` | Canonical watchlist (23 markets). | Only add symbols with a verified provider route and supported instrument mapping. Monitor scan capacity when widening. |
| `ENTRY_TFS` | `15m,30m,1h` | Institutional entry timeframes. | Production-safe set is `15m`, `30m`, `1h`; finer intervals raise CPU/provider load. |
| `SYNTH_ENTRY_TFS` | `30m,1h` | Primary entry timeframes for Deriv synthetics. | Must be valid entry intervals; current set is `30m,1h`. |
| `RETEST_DEPTH_PCT` | `100` | Below `100`, minimum penetration into the latest direction-matched, unmitigated FVG overlapping the origin. | Accepted range `1–100`. `100` is a compatibility sentinel and remains byte-identical to the legacy ATR-tolerant boundary check. Values `1–99` are literal percentages of the full FVG width (`50` requires the FVG midpoint). If there is no overlapping direction-matched FVG, values below `100` cannot qualify a retest. Downstream target-floor, risk, and stop gates remain unchanged. |
| `MIN_TP_R` | `2.5` | Minimum target reward:risk. | **Locked at 2.5.** Revisit only after 2–3 weeks of shadow evidence and an explicit owner decision. |
| `MIN_RISK_ATR` | `0.8` | Minimum stop width normalized to entry-timeframe ATR. | **Locked at 0.8.** |
| `MIN_STOP_PIPS` | `10` | Asset-aware minimum stop-distance floor. | Keep at least `10`; any increase requires a paper test. |
| `SL_BUFFER_ATR` | `0.25` | ATR padding beyond the structural invalidation point. | Positive; practical tuning band `0.1–0.5`. Current value is `0.25`. |
| `PAIR_BATCH_SIZE` | `1` | Number of pairs handled per cron tick; balances capacity and scan freshness. | Keep `1` unless CPU/coverage evidence supports `2`; do not raise casually. |
| `FILTER_HTF_CONFLICT` | `true` | Enables higher-timeframe conflict filtering. | Boolean. Test any change in paper mode first. |
| `FILTER_HTF_CONFLICT_DERIV_ONLY` | `true` | Applies the hard conflict gate to Deriv synthetics. | Keep `true` unless the owner explicitly requests a measured paper experiment. |
| `WATCH_NOTIFY` | `false` | Enables one pre-entry SHIFT card per setup when true. | Keep `false` until signal funnel review is complete; if enabled, one card at SHIFT only, clearly marked not an entry. |
| `BIAS_NOTIFY` | `false` | Enables higher-timeframe context cards, independent of watch cards. | Keep `false`; context cards are not entry alerts. |
| `VIP_WATCH_NOTIFY` | `false` | VIP watch-message override. | Keep `false`; VIP receives confirmed entries and final outcomes only. |
| `ENGINE_DIGEST` | `true` | Enables the weekly Engine Discipline research digest. | Boolean; FREE channels only, never VIP. |
| `CHART_SNAPSHOTS` | `true` | Enables Telegram chart snapshots. | Boolean; keep enabled in normal operation. Do not regress authentic candlesticks or green/red RR-box visuals. |
| `TRAILING_BE_ENABLED` | `true` (code default; not overridden in Wrangler) | Enables breakeven protection handling. | Keep enabled. Preserve the explicit BE notice, including pending BE order, at `+1.50R`. |
| `TRAILING_BE_TRIGGER_R` | `1.5` (code default; not overridden in Wrangler) | Favorable excursion that arms breakeven handling. | **Keep exactly `1.50R`.** |
| `PROVIDER_MAP` | OANDA for `EURUSD,GBPUSD,USDJPY,AUDJPY,GBPJPY,USDCAD,NZDUSD,EURJPY,XAUUSD,US30,GER40,JAPAN225,NAS100` | Explicit routing for configured institutional instruments. | Only use source-supported mappings. New Forex symbols must resolve to real instruments in `worker/src/provider.ts`; do not add an unapproved provider. |
| `SYMBOL_MAP` | unset (`{}` in code) | Optional provider-specific symbol overrides; current production routes use canonical instrument mappings. | Leave unset unless a selected supported provider requires a tested canonical mapping. |
| `DERIV_PROXY_URL` | `https://slk-bot.vercel.app` | Candle relay for Deriv synthetic symbols. | Keep on the production HTTPS relay unless a replacement has passed relay and candle-validation tests. |
| `DERIV_APP_ID` | `1089` (code default) | Deriv application identifier when no override is present. | Keep the verified configured ID. |
| `MT5_ENABLED` | unset/false in paper deployment | Hard gate for the optional MT5 bridge. | Keep unset or `false`; paper mode must never dispatch live orders. |

### Alert-funnel and notification-source review (live snapshot)

Fresh public probes on `2026-10-06` showed `/health` at `12:24:33.413Z` with `mode=paper`, `watchNotify=false`, `biasNotify=false`, `vipWatchNotify=false`, `paperNotify=true`, and `mt5BridgeActive=false`. These flags mean the current Worker should not generate its automatic pre-entry WATCH/Bias cards. If a Free-channel card arrived after that time, its source cannot be attributed from this repo's public telemetry alone; a timestamp/message sample (not a secret) would be needed. The Worker has a WATCH path that sends only a latest-stage `SHIFT` context card and a separate BIAS path that can send repeatedly when enabled; both are gated off in the observed live configuration. Python `slk_bot` has no WATCH/Bias notification path and only broadcasts alert/outcome/startup/stats/test messages to its single configured Telegram destination; the repo documents it as an optional self-hosted systemd process, not the Cloudflare Worker runtime.

Public `/api/engine-pulse` at `2026-10-06T12:24:33.267Z` reported 457 scans, 390 active scans, 23 markets covered, 171 recorded MAP-event rows, lifecycle event rows `{TOUCH:116, SWEEP:104, SHIFT:59, RETEST:1}`, and zero alert rows inserted. Replay rejection attempts were `{nonPositiveRisk:0, belowMinRiskAtr:4, aboveMaxStopAtr:79, targetFloor:227}`. These are not unique setup counts or Telegram-delivery totals. The single recorded RETEST event is emitted only after `buildAlert()` passes the risk/target gates; its absence from inserted alert rows is downstream of that event and can be a freshness skip, duplicate insert, or insert error. The exact blocker was not exposed by the public pulse. The owner-key-only 21-Day Scan & Delivery Audit reports stale/duplicate skips, stored alert status/reasons, and channel API results; run it locally in the Pages dashboard without sharing the key. Its delivery rows are best-effort and API results are not proof a person saw a message.

Channel policy is intentional: complete confirmed entry cards go to VIP, not Free. Free's zero entry-card count alone is therefore expected; however this Worker also recorded zero new alert rows in the sampled 24-hour pulse. WATCH/Bias cards are informational, explicitly marked **NOT AN ENTRY**, and must not be presented as confirmations. The public Engine Pulse now labels persisted event rows and inserted alert rows accurately, avoids claiming that zero entries proves good selectivity, and explains that rejection figures are replay attempts.

### Secret and credential handling

Secrets are configured outside Git (Cloudflare secrets/D1 as appropriate). Values are deliberately not recorded here. Relevant names include `OANDA_API_TOKEN` (legacy `OANDA_API_KEY` is also read), `TWELVEDATA_API_KEY`, Telegram bot/channel credentials, `DISCORD_WEBHOOK_URL`, `ADMIN_KEY`, `DASHBOARD_READ_KEY`, `WHOP_WEBHOOK_SECRET`, `CHART_IMG_API_KEY`, `SIGNAL_API_KEY`, `SIGNAL_SIGNING_SECRET`, and `PROVIDER_WEBHOOK_SECRET`. MT5 bridge URL/HMAC settings must remain inert in paper mode. Never print, log, commit, or ask the owner to paste secret values.

## 5. Public/private surfaces and channel policy

- Public read surfaces include `/health`, `/api/engine-pulse`, `/api/recent-events` (optional `tail=1` live-edge bootstrap), and the public journal. The public journal is restricted to Telegram-delivered signals.
- `/api/shadow-ledger`, `/api/shadow-experiments`, `/api/scan-audit`, and administrative actions require the owner/admin key. Keep audit views protected. Treat public endpoint behavior as defined in `worker/src/index.ts`; do not infer route existence from a generic 401.
- `VIP Institutional`: confirmed entries plus final outcomes only.
- `VIP Synthetics`: confirmed synthetic entries plus final outcomes only.
- `Forex Free`: allowed TP1 teasers (pair/timeframe/+R only), weekly digest/recap, and upgrade CTAs; optional pre-entry watch/context cards are currently disabled; **no synthetic content**.
- `Synthetics Free`: synthetic teasers, weekly digest/recap, and upgrade CTAs; optional watch/context cards are currently disabled.
- Recaps stay clearly labelled paper simulation/research only. Shadow-ledger candidates are never alerts or event-tape rows.

## 6. Pull request history (#2–#8)

| PR | State on 2026-10-05 | Summary |
|---|---|---|
| #2 | Merged | Production Worker feature set through the OANDA metals and Live Desk work. |
| #3 | Open | Delivered-signal journal/admin change. The shipped visibility behavior was landed through #4. Do not merge, edit, or reopen this PR; owner handles it. |
| #4 | Merged | Shipped delivered-signal visibility and related journal/admin controls to the production lineage. |
| #5 | Merged | Clarified the Monte Carlo stress-test research/disclaimer presentation. |
| #6 | Merged | Hardened admin/audit authorization and dashboard admin-key handling. |
| #7 | Merged | Engine Pulse, replay hygiene, stable setup identity, and combined polish. |
| #8 | Open | Observation-only shadow ledger, weekly free-channel digest, and legacy-schema hardening. Its code is absorbed by the merge commit on this session branch and is shipped by pushing this branch; **the owner closes PR #8 unmerged**. Do not modify or reopen it. |

Do not use GitHub PR merges as a deployment step. PR #3 and PR #8 are owner-managed and must not be merged, modified, or reopened by an agent.

## 7. Standing rules — never violate without explicit owner instruction

1. Paper mode forever until the owner explicitly says otherwise: `MODE=paper`, `PAPER_NOTIFY=true`, MT5/live execution disabled.
2. `MIN_TP_R` stays `2.5`. Shadow data is evidence gathering before any floor decision, due after 2–3 weeks of observations.
3. `MIN_RISK_ATR` stays `0.8`.
4. Brand only as **SLK Model (Structure · Liquidity · Key Levels)**. Do not label it with unrelated trading-system brands.
5. Public journal/dashboard shows only signals actually delivered to Telegram; audit views stay admin-key-gated. Recap cards retain the paper simulation/research-only disclaimer.
6. VIP receives confirmed entries and final outcomes only. Digests, teasers, and upgrade CTAs are FREE-channel only. No synthetic material goes to the Forex free channel.
7. Never print, log, or commit secrets. Never ask the owner to paste secrets into chat.
8. Use only provider routes explicitly supported in `worker/src/provider.ts`; do not add an unapproved provider, route, fallback, or market-data source.
9. Preserve explicit breakeven notification—including the pending BE order—at `+1.50R` favorable excursion.
10. Preserve authentic candlesticks with green/red risk-reward boxes in the TradingView style.
11. Do not merge, modify, or reopen PRs #3 and #8. The owner closes them manually.
12. The `main` branch is hands-off entirely.

## 8. Open items and owner follow-up

1. **Signal flow — diagnosed 2026-10-07.** No live alert row has been written since 2026-09-30 17:14 UTC, but the engine is not idle: it still reaches TOUCH/SWEEP/SHIFT (17 SHIFTs in the 24 h to 14:48 UTC) and replay finds retest candidates most days (165 on Oct 4, 234 on Oct 5, 219 on Oct 6, 0 on Oct 7). Inflow is blocked by three stacked filters, largest first:
   - **2.5R target floor** — 56–74 % of retest candidates die here (Oct 4: 93/165, Oct 5: 141/234, Oct 6: 163/219). The next opposing liquidity draw is usually closer than 2.5R.
   - **Risk gates** — a further 18–44 % die on `stop < 0.8×ATR` or `stop > 3.5×ATR` (Oct 6: 40/219).
   - **Confirmation freshness** — every confirmation discovered on Oct 6 (15) was already older than `2.5 × tf` and was skipped as stale; none was recorded.
   All 19 pre-Oct-1 "stale confirmation" rows in `slk_alerts` were discovered 9 hours to 9.8 days late (net +22.26R of pure hindsight). The only genuinely real-time suppression in the ledger is V75_1S (2026-09-30, HTF-conflict gate, 14-minute latency), which would have lost −1R. **Do not loosen `MIN_TP_R`, `MIN_RISK_ATR`, or the freshness window on the strength of those rows.** Recommended next step (diagnostics only, no gating change): record the discovery age of every confirmation and the "R available to the next opposing draw" for each target-floor rejection, so the next decision can tell "no fresh opportunity exists" apart from "the threshold is too tight". **Half done (built, awaiting push approval): the confirmation funnel now records discovery age, freshness, near-miss and stale counts per entry timeframe and surfaces them on `/api/engine-pulse` + both dashboards — see "Confirmation funnel" above. Still open: the target-floor shadow (R available to the next opposing draw), and scan throughput (per-pair cadence measured at 64–94 min against a 15m window of 37.5 min).**
2. **Migration 0008 is applied by the owner (2026-10-07, ~13:35 UTC)** — no action left. Tag columns exist in production D1 and tagged rows are being written (see the tagging section). If `0007_shadow_experiments.sql` is still unapplied, apply it too (`npx wrangler d1 migrations apply slk-alert-db --remote`); missing-table behavior safely no-ops and retries its schema probe every five minutes.
3. Collect roughly 2–3 weeks of shadow observations before considering any `MIN_TP_R` decision. Keep the floor at `2.5` until the owner explicitly decides.
4. The owner closes PR #8 unmerged. Do not take action on PR #3 or #8 in GitHub.
5. Later bot changes belong in this same session branch and must use the complete validation → push → Actions → live-proof cycle above.

## 9. Owner self-serve paths

- **Config tweak without a session:** GitHub web-edit `worker/wrangler.jsonc` on the production lineage branch, commit → auto-deploys.
- **Stale Pages dashboard:** Cloudflare Dashboard → Workers & Pages → `slk-radar` → Settings → Builds & deployments → confirm **Production branch** is `main`, matching the `--branch` value in `.github/workflows/deploy.yml`.
- **Automatic 21-day audit after release:** open the Pages dashboard → **Market Health** → **Run 21-Day Audit**. It asks for the existing owner key and displays aggregate results only.
- **D1 queries/fixes or manual audit fallback:** Cloudflare Dashboard → Storage & Databases → D1 → `slk-alert-db` → Console.
- **Read-only 21-day signal-drought audit** (UTC window 2026-09-14 through 2026-10-05; run the query, then return the result for diagnosis):

```sql
SELECT
  COUNT(*) AS scan_rows,
  MIN(ts) AS first_scan_utc,
  MAX(ts) AS last_scan_utc,
  SUM(CASE WHEN TRIM(COALESCE(pairs, '')) NOT IN ('', '[]', 'null') THEN 1 ELSE 0 END) AS active_scan_rows,
  SUM(CASE WHEN TRIM(COALESCE(errors, '')) NOT IN ('', '[]', 'null') THEN 1 ELSE 0 END) AS scan_error_rows,
  SUM(COALESCE(alerts, 0)) AS alert_rows_written,
  SUM(COALESCE(events, 0)) AS event_rows_written,
  SUM(CASE WHEN diagnostics_json IS NOT NULL AND json_valid(diagnostics_json) = 1 THEN 1 ELSE 0 END) AS diagnostic_rows
FROM slk_scan_log
WHERE ts >= '2026-09-14T22:17:38.540Z'
  AND ts <= '2026-10-05T22:17:38.540Z';
```

- **Shadow proof-of-life query** (run about one day after the shadow-ledger code is deployed):

```sql
SELECT reject_reason, COUNT(*) AS n
FROM slk_shadow_trades
GROUP BY reject_reason;
```

- **Diagnostics-tag slice** (after `0008_diagnostics_tags.sql` is applied; empty `session_bucket` on old rows means "not annotated", not zero):

```sql
SELECT variant, session_bucket, h4_confluence_grade, COUNT(*) AS n,
       SUM(CASE WHEN status <> 'OPEN' THEN 1 ELSE 0 END) AS resolved,
       ROUND(SUM(CASE WHEN status <> 'OPEN' THEN COALESCE(r_multiple, 0) ELSE 0 END), 2) AS net_r
FROM slk_shadow_experiments
GROUP BY variant, session_bucket, h4_confluence_grade
ORDER BY variant, session_bucket, h4_confluence_grade;

SELECT session_bucket, h4_confluence_grade, COUNT(*) AS signals
FROM slk_alerts
GROUP BY session_bucket, h4_confluence_grade;
```

## 10. Useful release commands and endpoints

```bash
# install the exact Worker lockfile dependencies
npm ci --prefix worker

# required pre-push validation (run all four every time)
npm test -- --run
npm run typecheck
node --check dashboard/app.js
(cd worker && npx wrangler deploy --dry-run)

# the only push target for this session
git push origin arena/0e17c27a-slk-bot

# owner-side migration (not required for the code to run — tags resume automatically)
(cd worker && npx wrangler d1 migrations apply slk-alert-db --remote)
```

- Fresh health check: `https://slk-alert-worker.abidogundamilola.workers.dev/health?v=<random>`
- Public engine pulse: `https://slk-alert-worker.abidogundamilola.workers.dev/api/engine-pulse`
- Live-edge event tape bootstrap: `https://slk-alert-worker.abidogundamilola.workers.dev/api/recent-events?tail=1&limit=5&cb=<random>`
- Shadow aggregates (owner key required): `https://slk-alert-worker.abidogundamilola.workers.dev/api/shadow-ledger`
- Shadow-experiment aggregates (owner key required): `https://slk-alert-worker.abidogundamilola.workers.dev/api/shadow-experiments`
- Scan/error/funnel/delivery audit (owner key required): `https://slk-alert-worker.abidogundamilola.workers.dev/api/scan-audit?days=21`
- Deriv relay: `https://slk-bot.vercel.app/health` and `/candles`
- Public dashboard/journal: `https://slk-radar.pages.dev`
