# SLK Model — Definitive Project Handoff

**Updated:** 2026-10-05 (UTC)
**Repository:** `Abidamz/SLK-bot`
**This session's branch:** `arena/3ff9b8eb-slk-bot`
**Production lineage:** `arena/01a0b153-slk-bot`
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
4. Cloudflare D1 stores alerts, events, scan diagnostics, channel-level notification audit results, the isolated shadow ledger, and a separate shadow-experiment ledger. SQL migrations are in `worker/migrations/` (`0001`–`0007`). The owner already applied `0006_shadow_ledger.sql` in production; the experiment code safely no-ops until `0007_shadow_experiments.sql` is applied and retries the missing-table check every five minutes.
5. Telegram delivery is tier-separated. VIP channels receive confirmed entries and final outcomes only. Free channels may receive watch radar, bias cards, teaser cards, weekly recaps, and the Engine Discipline digest. Synthetic content is never sent to the Forex free channel.
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
- `worker/migrations/0007_shadow_experiments.sql` — separate Breakout/FVG experiment table and indexes.
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
- Durable delivery-result tracking starts with this release; past Telegram/Discord outcomes cannot be reconstructed. The report shows the first tracked timestamp for context, but writes are best-effort: missing rows do not prove that a message was not sent.

### Separate shadow experiments (research only)

- `BREAKOUT_CONTINUATION` provisionally records only a fresh latest-closed-candle body break through a confirmed swing, aligned with the higher-timeframe storyline. It applies the current stop/risk checks and uses the nearest external storyline target; it has not yet been validated against historical outcomes.
- `FVG_RETEST_50` is a separate replay limited to paper-mode 30m scans whose configured retest depth remains at the legacy `100`. It tests midpoint FVG penetration, then records only latest-close, non-suppressed candidates. It does not change the normal 100% retest rule, alerts, target floor, or risk gates.
- Both variants write only to `slk_shadow_experiments`; the 50% replay suppresses normal transition events and does not deliver its returned alerts. The table can safely be absent until migration `0007_shadow_experiments.sql` is applied.
- `GET /api/shadow-experiments` is owner/admin-key protected. These rows must remain absent from Telegram, public events/journal, `/stats`, `/alerts`, recaps, and Monte Carlo.

- The Engine Discipline weekly digest is controlled by `ENGINE_DIGEST` and goes to explicit FREE-channel IDs only; it has no VIP fallback.

## 3. Deployment model — read before any edit or push

**Pushing any `arena/**` branch triggers production deployment. A push is a release; it is not a staging preview.** GitHub Actions runs the gates and, if green, deploys the Worker and dashboard.

### Required workflow invariants

- `.github/workflows/deploy.yml` must remain **exactly** the version inherited from `origin/arena/01a0b153-slk-bot`: push triggers include `arena/**` and `main`; tests gate deployment; the deploy job is not opt-in gated. Do not replace it with workflow-dispatch-only logic or otherwise alter it.
- Session work stays on `arena/3ff9b8eb-slk-bot`. Push only with `git push origin arena/3ff9b8eb-slk-bot`. Never switch branches for this session.
- Do **not** merge PRs or ask the owner to merge. Pushing this branch is what deploys. Do not push to or deploy `main`; it is stale and hands-off.
- Before each push, run the full local validation suite below. Do not push partially validated work.
- After each push, wait for the GitHub Actions run to finish successfully and allow about three minutes for propagation. Then request `/health` with a fresh random query parameter and report the returned JSON. `/api/engine-pulse` or an observed behavior change can also verify a release. An unauthorized response from an unknown `/api/*` route does **not** prove that route exists.
- A failing “Workers Builds” preview check is known benign noise. Cloudflare's native Git integration also duplicates deploys only for `arena/01a0b153-slk-bot`; neither is a reason to change the required workflow.

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

## 4. Production environment and tuning reference

These are effective production values on 2026-10-05, after the requested config widening. `worker/wrangler.jsonc` is the source for non-secret Worker variables; `worker/src/config.ts` supplies code defaults. “Safe range” is an operational recommendation, not permission to override a standing rule.

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
| `WATCH_NOTIFY` | `true` | Enables setup-forming watch radar. | Boolean; watch content remains FREE-channel only. |
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

### Secret and credential handling

Secrets are configured outside Git (Cloudflare secrets/D1 as appropriate). Values are deliberately not recorded here. Relevant names include `OANDA_API_TOKEN` (legacy `OANDA_API_KEY` is also read), `TWELVEDATA_API_KEY`, Telegram bot/channel credentials, `DISCORD_WEBHOOK_URL`, `ADMIN_KEY`, `DASHBOARD_READ_KEY`, `WHOP_WEBHOOK_SECRET`, `CHART_IMG_API_KEY`, `SIGNAL_API_KEY`, `SIGNAL_SIGNING_SECRET`, and `PROVIDER_WEBHOOK_SECRET`. MT5 bridge URL/HMAC settings must remain inert in paper mode. Never print, log, commit, or ask the owner to paste secret values.

## 5. Public/private surfaces and channel policy

- Public read surfaces include `/health`, `/api/engine-pulse`, `/api/recent-events`, and the public journal. The public journal is restricted to Telegram-delivered signals.
- `/api/shadow-ledger`, `/api/shadow-experiments`, `/api/scan-audit`, and administrative actions require the owner/admin key. Keep audit views protected. Treat public endpoint behavior as defined in `worker/src/index.ts`; do not infer route existence from a generic 401.
- `VIP Institutional`: confirmed entries plus final outcomes only.
- `VIP Synthetics`: confirmed synthetic entries plus final outcomes only.
- `Forex Free`: watch radar, bias cards, allowed TP1 teasers (pair/timeframe/+R only), weekly digest/recap, and upgrade CTAs; **no synthetic content**.
- `Synthetics Free`: synthetic watch/confirmation radar, allowed teasers, weekly digest/recap, and upgrade CTAs.
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

1. The three-week signal drought is not diagnosed yet. After this release, use the protected dashboard audit to retrieve historical scan/error/funnel totals; delivery results before the instrumentation release cannot be recovered.
2. Apply `worker/migrations/0007_shadow_experiments.sql` in production D1 so the separate Breakout/FVG experiment rows can be recorded. Missing-table behavior safely no-ops and retries its schema probe every five minutes.
3. Collect roughly 2–3 weeks of shadow observations before considering any `MIN_TP_R` decision. Keep the floor at `2.5` until the owner explicitly decides.
4. The owner closes PR #8 unmerged. Do not take action on PR #3 or #8 in GitHub.
5. Later bot changes belong in this same session branch and must use the complete validation → push → Actions → live-proof cycle above.

## 9. Owner self-serve paths

- **Config tweak without a session:** GitHub web-edit `worker/wrangler.jsonc` on `arena/01a0b153-slk-bot`, commit → auto-deploys.
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
git push origin arena/3ff9b8eb-slk-bot
```

- Fresh health check: `https://slk-alert-worker.abidogundamilola.workers.dev/health?v=<random>`
- Public engine pulse: `https://slk-alert-worker.abidogundamilola.workers.dev/api/engine-pulse`
- Shadow aggregates (owner key required): `https://slk-alert-worker.abidogundamilola.workers.dev/api/shadow-ledger`
- Shadow-experiment aggregates (owner key required): `https://slk-alert-worker.abidogundamilola.workers.dev/api/shadow-experiments`
- Scan/error/funnel/delivery audit (owner key required): `https://slk-alert-worker.abidogundamilola.workers.dev/api/scan-audit?days=21`
- Deriv relay: `https://slk-bot.vercel.app/health` and `/candles`
- Public dashboard/journal: `https://slk-radar.pages.dev`
