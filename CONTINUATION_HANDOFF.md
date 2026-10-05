# SLK-BOT — CONTINUATION HANDOFF

**Authoritative operator guide, updated 2026-10-05 (UTC).** Use this file as the working source of truth for future sessions. If another repo document conflicts with it, follow this file and the owner's latest explicit instruction. Do not infer permission to change a standing rule from a code comment or old document.

## 1. Project identity and production status

The product is the **SLK Model (Structure · Liquidity · Key Levels)**. It is a paper-only trading-signal and research system. The production scanner is the Cloudflare Worker `slk-alert-worker`; its public health endpoint is <https://slk-alert-worker.abidogundamilola.workers.dev/health>.

- **Execution:** `MODE=paper`, `PAPER_NOTIFY=true`. Signals are research alerts only. The MT5 bridge exists in the repository but must stay inactive; there is no live execution.
- **Delivered journal baseline (2026-10-05):** 8 Telegram-delivered signals, 62.5% win rate, +11.52R. The public journal is based on delivered signals, not every scanned or suppressed setup.
- **Engine Pulse baseline:** `/api/engine-pulse` is public and working. The 24-hour snapshot was about 131 target-floor rejections and zero confirmations; that scarcity motivated the shadow ledger and tuning tasks. These counts change with time.
- **Shadow ledger:** migration `0006_shadow_ledger.sql` and its indexes are already present in production D1 (owner-applied). The Worker code is fail-safe if the table is missing. Once this branch's deployment is confirmed, shadow capture/resolution will be active. Shadow rows are research-only and are not trading signals.
- **Current session branch:** `arena/01a10d5e-slk-bot`. Push only to this branch in this session. The production lineage is `arena/01a0b153-slk-bot`. `main` is stale and hands-off.

## 2. Architecture and data flow

### Worker (`worker/`)

- `worker/src/index.ts` is the Cloudflare entrypoint: one-minute cron, round-robin pair scanning, outcome resolution, scheduled digests, and HTTP routes.
- `worker/src/config.ts` parses configuration and strategy defaults.
- `worker/src/engine.ts` implements the stateless lifecycle: `MAP → TOUCH → SWEEP → SHIFT → RETEST → CONFIRMED`, plus `INVALID`/`EXPIRED`. Deterministic identities and D1 idempotency prevent duplicate signals.
- `worker/src/provider.ts` handles OANDA, Twelve Data, Dukascopy, and Deriv routing/failover. The configured Deriv relay is `https://slk-bot.vercel.app`. Add a symbol only after verifying its provider mapping and instrument name in this file; do not introduce a prohibited feed or fallback.
- `worker/src/store.ts` contains D1 and in-memory stores. SQL migrations are `worker/migrations/0001` through `0006`.
- `worker/src/notify.ts` owns Telegram delivery, recaps, and the FREE-only weekly Engine Discipline digest. `worker/src/outcomes.ts` resolves paper outcomes and break-even handling.
- `worker/src/mt5.ts` contains a hard-gated bridge client. It is inert in paper mode; do not activate it.

### Markets and current timeframes

The Wrangler watchlist contains **23 canonical pairs**:

`EURUSD, GBPUSD, USDJPY, AUDJPY, GBPJPY, XAUUSD, NAS100, US30, GER40, JAPAN225, V75, V100, V50, V25, V10, V75_1S, V100_1S, V50_1S, V25_1S, V10_1S, USDCAD, NZDUSD, EURJPY`.

- Institutional/Forex, metals, and index assets use `ENTRY_TFS=15m,30m,1h`.
- Deriv synthetics use `SYNTH_ENTRY_TFS=30m,1h` (the code fallback when unset is `1h`).
- The new FX instruments resolve through OANDA as `USDCAD → USD_CAD`, `NZDUSD → NZD_USD`, and `EURJPY → EUR_JPY`. They are explicitly in `PROVIDER_MAP`; provider fallbacks remain in `provider.ts`.
- Synthetics data routes through Deriv/its relay. Keep synthetic watch and confirmation content out of the Forex FREE channel.

### Storage, dashboard, relay, and API boundaries

- **Cloudflare D1:** durable alerts/events, KV-backed runtime settings, scan diagnostics, and the separate `slk_shadow_trades` research table. `0006_shadow_ledger.sql` is additive and independently indexed.
- **Dashboard:** `dashboard/` is deployed to Cloudflare Pages project `slk-radar`; Worker fallback HTML is in `worker/src/dashboard_html.ts`. Public journal/stats/recaps/Monte Carlo use the delivered-signal ledger only. Audit pages and admin operations require the admin key. Recap cards retain the “paper simulation — research only” disclaimer.
- **Relay:** Vercel project at `https://slk-bot.vercel.app` relays Deriv data; `api/` and `deriv-relay/` contain relay code.
- **Public checks:** `/health` returns non-secret runtime config/status; `/api/engine-pulse` is public. `/api/shadow-ledger` is owner/admin-key authenticated. `/alerts`, `/stats`, and admin/audit routes are protected as implemented.
- Unknown `/api/*` routes are caught by the API auth guard and may return `401 {"error":"unauthorized"}`. A 401 is **not** evidence that a route exists. Verify deployments with `/health`, `/api/engine-pulse`, or observable behavior—never by probing a guessed protected path.

### Shadow-ledger invariants

The shadow ledger captures only qualifying `TARGET_FLOOR` counterfactuals in `[2.0R, 2.5R)` and `NO_RETEST` BOS-close approximations. Dedupe uses setup identity; unresolved shadows expire under the 120-bar resolution horizon. Capture, persistence, reads, and outcome resolution fail safely and never gate a real/paper entry. The digest is separately flag-controlled and targets explicit FREE-channel IDs only.

Shadow data must never be copied into or used to calculate alerts, events, `/stats`, `/alerts`, ordinary performance recaps, the public journal, or Monte Carlo. `/api/shadow-ledger` is the only intended shadow-row read surface and is authenticated. Tests in `worker/test/shadow_ledger.test.ts` and `worker/test/store.test.ts` protect isolation and missing-table no-op behavior.

## 3. Deploy model — read before changing anything

Every push to an `arena/**` branch triggers `.github/workflows/deploy.yml`: the test job runs first, and only if it passes does the deploy job publish the Worker and Pages dashboard. **Pushing is deploying.** Every push must therefore be a complete, validated, production-ready state; do not push a knowingly broken intermediate change.

The deploy workflow on this branch must remain **exactly** the inherited auto-deploy workflow from `arena/01a0b153-slk-bot`:

- Triggers on push to `arena/**` and `main`, plus `workflow_dispatch`.
- Installs with `npm ci --prefix worker`.
- Runs tests, typecheck, and `node --check dashboard/app.js` in the test job.
- The deploy job has `needs: test`; no opt-in gating, approval gate, or workflow-dispatch-only deployment condition.
- Do not edit the workflow to disable or delay the required arena auto-deploy. In particular, keep the inherited Pages command as-is.

Never push to `main`. Do not merge PRs on GitHub or ask the owner to merge one. This session is fixed to `arena/01a10d5e-slk-bot`; do not switch branches or push elsewhere. The `Workers Builds` preview check is known to fail benignly. Cloudflare native Git integration may also duplicate a deployment from the production lineage branch; that duplicate is expected.

### Required local validation before every push

Run the entire suite, not only tests related to the changed file:

```sh
npm test -- --run
npm run typecheck
node --check dashboard/app.js
(cd worker && npx wrangler deploy --dry-run)
```

Also run any migration-specific test added or changed in the task, and inspect `git diff --check`, `git status`, and the deploy workflow diff. Confirm `MODE=paper`, `PAPER_NOTIFY=true`, `MIN_TP_R=2.5`, and `MIN_RISK_ATR=0.8` remain intact before pushing.

### Required post-push verification

1. Wait for the GitHub Actions deploy workflow to finish (typically about three minutes); confirm the test job passed and deploy ran.
2. Fetch the live health endpoint with a fresh cache-busting query every time, for example:
   ```sh
   curl -fsS "https://slk-alert-worker.abidogundamilola.workers.dev/health?v=$(date +%s)"
   ```
3. Confirm the returned config/status reflects the deployment and report the live JSON as proof. The current health response includes mode, pairs, entry timeframes, synthetic timeframes, retest depth, risk/target floors, paper notification, and digest status.

## 4. Environment and tuning reference

Effective current values below reflect `worker/wrangler.jsonc` plus code defaults. “Operator-safe” is a conservative operating guardrail; where noted, the parser may accept a wider syntactic range. Change Wrangler variables only with a deliberate owner-approved experiment and the validation/deploy process above.

| Variable | Current effective value | Purpose | Safe range / standing limit |
|---|---:|---|---|
| `MODE` | `paper` | Selects paper vs live mode. | **`paper` only.** Never switch to `live` without explicit owner instruction. |
| `PAPER_NOTIFY` | `true` | Allows paper alerts to be delivered to Telegram. | **`true` only** for production paper operation. |
| `PAIRS` | 23 pairs listed above | Canonical scan watchlist. | Only source-resolvable pairs with tested provider/instrument routing; preserve CPU-aware batching. |
| `ENTRY_TFS` | `15m,30m,1h` | Entry timeframes for non-Deriv markets. | Supported labels; production lower bound is 15m. Do not enable sub-15m entries casually. |
| `SYNTH_ENTRY_TFS` | `30m,1h` | Primary entry timeframes for Deriv synthetics. | Supported non-daily labels; production is 30m and 1h. Code fallback is 1h. |
| `RETEST_DEPTH_PCT` | `100` | `100` uses the pre-existing ATR-tolerant retest predicate exactly. `<100` requires that percentage of actual penetration into the FVG (e.g. `50` is halfway). | Parser accepts `0–100`; invalid values fail closed to 100. Leave at 100 unless deliberately evaluating a partial-retest experiment. |
| `MIN_TP_R` | `2.5` | Minimum TP1 reward:risk gate. | **Locked at 2.5.** Review only after 2–3 weeks of shadow evidence and explicit owner decision. |
| `MIN_RISK_ATR` | `0.8` | Minimum stop-risk width relative to ATR. | **Locked at 0.8.** |
| `MIN_STOP_PIPS` | `10` | Instrument-aware minimum stop-distance floor. | Keep at least 10 for the current production profile; `0` disables the floor in code and is not an ordinary tuning value. |
| `SL_BUFFER_ATR` | `0.25` | ATR buffer beyond the invalidation level for stop placement. | Positive only; conservative operator range `0.10–0.50`. |
| `TRAILING_BE_ENABLED` | unset; code default `true` | Enables paper breakeven handling. | Keep enabled. |
| `TRAILING_BE_TRIGGER_R` | unset; code default `1.5` | Favorable excursion that arms the pending break-even instruction. | Keep at **1.50R**; preserve explicit BE notification, including pending BE order. |
| `PAIR_BATCH_SIZE` | `1` | Pairs scanned per cron batch; keeps Worker CPU bounded. | `1` is the production-safe value. Increase only with measured CPU/subrequest validation. |
| `ENGINE_DIGEST` | `true` | Enables the weekly Engine Discipline digest. | Boolean; `true` sends only to configured FREE channels. `false` disables it. Never route it to VIP. |
| `WATCH_NOTIFY` | `true` | Enables early WATCH radar/bias messaging. | Boolean; FREE-only behavior and channel separation must remain intact. |
| `VIP_WATCH_NOTIFY` | `false` | Controls VIP watch messages. | Keep `false`: VIP gets confirmed entries and final outcomes only. |
| `CHART_SNAPSHOTS` | `true` | Enables visual Telegram chart snapshots. | Boolean; preserve authentic candlesticks and green/red RR boxes. |
| `FILTER_HTF_CONFLICT` | `true` | Enables HTF conflict filtering. | Boolean; keep enabled unless owner approves a tested change. |
| `FILTER_HTF_CONFLICT_DERIV_ONLY` | `true` | Limits the hard HTF conflict gate to Deriv synthetics. | Keep `true` for current channel/model behavior. |
| `MT5_ENABLED` | unset; effectively inactive | Explicit second gate for the MT5 bridge. | Keep unset or `false`; never enable in this paper-only system. |
| `MT5_WEBHOOK_URL` | unset | MT5 bridge destination. | Keep unset; do not configure for production paper mode. |
| `MT5_HMAC_SECRET` | unset | Signs MT5 bridge requests. | Keep unset; never request or expose its value. |
| `MT5_RISK_USD` | unset | Optional bridge payload sizing input. | Keep unset; no execution sizing in paper mode. |
| `PROVIDER_MAP` | OANDA for EURUSD, GBPUSD, USDJPY, AUDJPY, GBPJPY, XAUUSD, NAS100, US30, GER40, JAPAN225, USDCAD, NZDUSD, EURJPY | Explicit per-symbol provider routing. | Only source-supported routes; validate instrument names and failovers. Do not add Yahoo Finance. |
| `SYMBOL_MAP` | Index-symbol overrides in Wrangler | Canonical-to-upstream symbol overrides. | Valid provider symbols only; do not use as a reason to add an unsupported provider. |
| `DERIV_APP_ID` | code default `1089` | Deriv application ID. | Keep the verified app ID unless the owner changes the relay/app registration. |
| `DERIV_PROXY_URL` | `https://slk-bot.vercel.app` | Deriv relay URL. | Keep the verified HTTPS relay; test before changing. |
| Digest schedule (code-controlled) | Friday 21:05 UTC, weekly | Engine Discipline timing is code-controlled, not an environment variable. | Do not add a VIP or primary-chat fallback. |
| Shadow resolution expiry | 120 bars, code-controlled | Caps the counterfactual measurement window. | Keep at 120 bars unless the owner explicitly revises the research design. |

### Credentials and bindings (values are never documented here)

`DB` is the D1 binding. Provider and delivery credentials are managed through Cloudflare secrets and/or the existing owner-controlled KV settings: `TWELVEDATA_API_KEY`, `OANDA_API_KEY`/`OANDA_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, Telegram channel/DM IDs, `DISCORD_WEBHOOK_URL`, `ADMIN_KEY`, `DASHBOARD_READ_KEY`, `WHOP_WEBHOOK_SECRET`, provider/signal webhook secrets, chart image API key, and any relay-specific secret. Do not paste their values in chat, write them to docs, print them to logs, or commit them. If an operation requires a secret, use the already configured Cloudflare/GitHub integration or ask the owner to perform it in the appropriate secret manager; never ask for the value in chat.

MT5 variables (`MT5_ENABLED`, `MT5_WEBHOOK_URL`, `MT5_HMAC_SECRET`, `MT5_RISK_USD`) must stay unset/disabled. The bridge requires live mode, an explicit enable flag, URL, and secret; paper mode must remain an unconditional no-op.

## 5. Pull-request history and handling

Status checked with GitHub on 2026-10-05. PR state is context only; do not use GitHub PR actions unless the owner explicitly asks and the standing restrictions permit it.

| PR | Title / scope | State and handling |
|---|---|---|
| #2 | Production Worker feature set through #11, including Live Desk and OANDA metals | Merged into production lineage. |
| #3 | Hide suppressed signals from public journal/stats/recaps/Monte Carlo; admin delete | Still open on GitHub, although the relevant delivered-signal behavior was incorporated through the production lineage. **Do not merge, edit, or reopen it; owner handles it.** |
| #4 | Land delivered-signal visibility change on production branch | Merged. |
| #5 | Clarify Monte Carlo stress test | Merged. |
| #6 | Admin/audit route protection and dashboard admin-key handling | Merged. |
| #7 | Engine Pulse, replay hygiene, setup identity stability, marketing polish | Merged. |
| #8 | Observation-only shadow ledger and weekly Engine Discipline digest | Remains open on GitHub. Its code is being shipped by this session branch; **do not merge, edit, or reopen the GitHub PR. The owner closes it unmerged.** |

PR titles/status do not override the working-tree source. Never make a GitHub change to #3 or #8 on the owner's behalf.

## 6. Standing rules — do not violate without explicit owner instruction

1. **Paper mode forever until owner says otherwise:** `MODE=paper`, `PAPER_NOTIFY=true`; MT5/live execution stays disabled.
2. **`MIN_TP_R` stays 2.5.** Shadow data gathers evidence first; revisit only after 2–3 weeks of observations and an owner decision.
3. **`MIN_RISK_ATR` stays 0.8.**
4. Branding is **SLK Model (Structure · Liquidity · Key Levels)**. Do not use other market-model labels.
5. The public journal shows only Telegram-delivered signals. Audit views are admin-key-gated. Recap cards keep the “paper simulation — research only” disclaimer.
6. VIP receives strictly confirmed entries and final outcomes. Digests, teasers, CTAs, WATCH radar, and bias cards are FREE-channel-only. No synthetics watch/confirmation content in the Forex FREE channel.
7. Never print, log, commit, or request secrets. Never ask the owner to paste secrets into chat.
8. No Yahoo Finance. Do not add it to code, configuration, docs, provider selection, or fallback chains.
9. Preserve breakeven handling: explicit BE notification, including the pending BE order at +1.50R favorable excursion.
10. Preserve authentic candlestick chart visuals with green/red RR boxes (TradingView style).
11. Do not merge, modify, or reopen PRs #3 and #8 on GitHub; the owner closes them manually.
12. `main` is hands-off entirely.

## 7. Open items and owner self-serve paths

### Open items

- After this branch's deployment, the owner should run the shadow proof-of-life query about one day later. Expected result may initially be empty; the code safely no-ops until qualifying counterfactuals occur.
- Collect 2–3 weeks of shadow observations before considering any floor discussion. Do not change `MIN_TP_R` or `MIN_RISK_ATR` automatically.
- Confirm the weekly Engine Discipline digest reaches only the configured FREE institutional and FREE synthetics channels on its next scheduled Friday run. It should skip cleanly if persisted scan diagnostics are unavailable.
- Keep `RETEST_DEPTH_PCT=100` as the production default. Any partial-depth value is an explicit experiment; compare its effect without changing target, risk, stop, execution, or delivery gates.
- The owner may request later bot updates in this same session. For every update: inspect standing rules, validate the full suite, push only this branch, wait for deployment, and provide fresh live `/health` or relevant endpoint JSON.

### Self-serve

- **Config tweak without a session:** GitHub web-edit `worker/wrangler.jsonc` on `arena/01a0b153-slk-bot`, commit; that branch auto-deploys.
- **Data queries/fixes:** use the Cloudflare D1 console.
- **Shadow proof-of-life query (run about one day after deployment):**
  ```sql
  SELECT reject_reason, COUNT(*) AS n
  FROM slk_shadow_trades
  GROUP BY reject_reason;
  ```

---

## Deployment record

Add the pushed commit hash, successful GitHub Actions result, deployment verification timestamp, and fresh live `/health` JSON here after each substantial production session. Never include secrets in the record.
