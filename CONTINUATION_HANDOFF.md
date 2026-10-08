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

- Captures `TARGET_FLOOR` counterfactuals (every live floor rejection that still has a measurable opposing draw, stored with the R available to that draw — see "Target-floor shadow" below) and `NO_RETEST` counterfactuals.
- Uses setup identity for deduplication, resolves with the same candle rules, and expires unresolved observations after 120 bars.
- `GET /api/shadow-ledger` is owner/admin-key protected. It aggregates only the separate shadow table.
- Shadow rows never appear in Telegram alerts, public events, `/stats`, `/alerts`, recaps, or Monte Carlo. Keep this strict isolation when changing code.

- **View modes (2026-10-08).** The Pages dashboard has two views, toggled in the header and remembered in `localStorage` (`slkViewMode`): **Public Overview** (default) and **Operator Terminal**. `dashboard/styles.css` (and the matching rules inside `worker/src/dashboard_html.ts`) hides `.operator-only` unless `body.operator-mode` is set, and hides `.marketing-only` when it is. The owner-key-gated **21-Day Scan & Delivery Audit** card now carries `operator-only`, so it no longer appears in the public view — switch to **Operator Terminal** to use it. That card exists only in the Pages build (`dashboard/index.html` + `dashboard/app.js`); the worker-hosted single-file dashboard never had it. `worker/test/dashboard_markup.test.ts` pins the class, both copies of the visibility rules, the toggle buttons, and the card's wiring.

### The 2026-10-06 signal drought: root cause and revert

- **Symptom.** No alert row stored since 2026-09-30. Retest candidates ran 165–234/day from Oct 1 to Oct 6, then **0 on Oct 7 and Oct 8** — across 660 active scans on Oct 7, the most of any day. MAP/TOUCH/SWEEP/SHIFT all kept firing, so the pipeline was alive; the chain died specifically at SHIFT → RETEST.
- **Cause (dated, named).** Commit `573e363` (previous session, **2026-10-06 14:29Z**) changed `RETEST_DEPTH_PCT` **100 → 60**. The feature itself landed earlier the same week (`dc53bfa` "add partial retest control", `fd3782b` "align retest depth with FVG penetration") but with the flag at 100, so the legacy path was still used.
- **Mechanism.** In `engine.ts` the retest check has two paths:
  ```ts
  let returns = isShort ? c.h >= z.zoneLo - tol : c.l <= z.zoneHi + tol;   // 100 = legacy
  if (retestDepthPct < 100) {
    const partialThreshold = fvgRetestThreshold(cur, isShort, retestDepthPct);
    returns = partialThreshold !== null && (...);                          // 1–99 = FVG path
  }
  ```
  `fvgRetestThreshold()` looks for a **direction-matched imbalance overlapping the origin key-level zone** (`story.imbalances`, i.e. H4 FVGs). It returns `null` when there is none — and the FVG path treats `null` as **"no retest is possible"**, not merely unlikely. So at 60, a setup with no qualifying H4 FVG can never produce a retest at *any* depth.
- **Why the timing fits.** Oct 6's 219 candidates fit the pre-14:45Z window (~15/hr, vs Oct 5's ~10/hr); the rest of Oct 6, all of Oct 7 and Oct 8 produced zero. A market-regime explanation would not produce a step function that lands on a config deploy.
- **Corroboration.** The 41 `NO_RETEST` research rows — setups that expired waiting for a retest — resolved **35W–3L, +15.24R**. The setups were fine; the retest gate was refusing entries.
- **Fix (2026-10-08).** `RETEST_DEPTH_PCT` reverted to **100**, restoring the legacy origin-zone check. `deploy_config.test.ts` now pins `"RETEST_DEPTH_PCT":"100"` with a comment explaining the failure mode, and `engine.test.ts` adds a regression test proving the same setup produces 0 alerts at 60 and 1 alert at 100.
- **Standing warning.** Do not set 1–99 again without first reading `diagnostics.replay.retestNoFvg` / `retestWithFvg` (below). If `retestNoFvg` dominates, FVG semantics will zero out retests regardless of the depth chosen.
- **New counters (read-only).** `ReplayDiagnostics` gained `retestNoFvg` / `retestWithFvg`, incremented once per setup as it enters RETEST. `fvgRetestThreshold` returns null based only on whether the FVG exists — depth only scales the returned threshold — so the probe is depth-independent and keeps reporting even now that the deployed value is 100. Surfaced per-day by `/api/scan-audit` (`retestNoFvg`, `retestWithFvg`). Nothing reads them for gating, delivery, or outcome decisions.
- **Also relevant.** During the "healthy" period, Oct 6 produced 16 retest transitions but **15 were dropped as stale** — the discovery-latency bug fixed by the cadence work. Both problems had to be understood: cadence was fixed first, and this revert removes the second.
- **Live verification (2026-10-08, `cf43d0a`, deployed ~00:47Z).** `/health` reports `retestDepthPct: 100`. In the ~30 minutes after the revert (Oct 8 byDay row, 00:00–01:17Z): **retest candidates 0 → 20**, **retest transitions 0 → 2**, `targetRejects` 16, `riskRejects` 2 — the funnel is flowing again after a full day of zeros across 660 active scans. `/api/recent-events` shows live RETEST rows carrying the legacy reason string (`return to origin zone → confirmation entry @ …`), which is the depth-100 path speaking. The counters report **retestNoFvg 13 vs retestWithFvg 15** on the same window — so roughly **46% of setups entering RETEST have no usable imbalance at all**, which is the direct confirmation of the mechanism: at any depth 1–99 about half of all setups could never retest, regardless of the number chosen.
- **Reading the first confirmations.** The two RETEST events found immediately after the revert had `candleTime` on Oct 6–7 and were correctly dropped as stale (`staleConfirmationSkips: 2`, no stored alert row yet). That is expected: the revert un-blocked detection, so the first scan of each pair replayed candle history and surfaced retests that had been invisible for a day — they are genuinely too old to act on now. Fresh retests discovered from here on are found within the ~11.5-minute revisit and should store normally. No retest has yet been found that is both fresh and inside the 2.5R/risk gates; that is the next thing to watch.

### Suppressed alerts: where the other 20 went

- `slk_alerts` holds 28 rows, but `/stats`, the journal, recaps and Monte Carlo show only 8. The 20 missing rows are `alert_status = 'SUPPRESSED'` and are deliberately excluded by the `includeSuppressed` filter in `store.ts`. Fetch `/alerts?includeSuppressed=true` with the owner key to see them.
- **They are the better half of the book.** Delivered PAPER: 8 rows, 5 TP / 3 SL, **+11.515R**. Suppressed: 20 rows, **+21.264R**. Combined: 28 rows, **+32.779R** over 2026-08-25 → 2026-09-30.
- **Suppression reasons**, from `deliver()` in `index.ts` (~994–1036) and `engine.ts` (~739). Five exist; **only two can actually fire on the current watchlist** (verified 2026-10-08 by reading each gate, not inferred):
  1. `cooldown (240m)` — **live.** Same pair and direction inside `cooldownMinutes` (default **240**).
  2. `first scan boot gate — record-only` — **live, but one-shot.** `deliverAllowed()` returns `!isFirstScan || opts.force`, and `isFirstScan` is per **pair+timeframe** (`last_scan:${pair}:${tf}` unset). It can only suppress each pair+TF's very first scan, so it cannot explain 20 rows spread across 5 weeks.
  3. `HTF conflict: …` — **cannot fire on the stored book.** `FILTER_HTF_CONFLICT_DERIV_ONLY=true` restricts it to `isDerivPair()`, and `DERIV_SYNTHETIC_PAIRS` (`config.ts` ~264) is *only* volatility indices (V10–V100, `R_*`, `1HZ*`). The 28 stored rows are XAUUSD / GER40 / JAPAN225 / US30 / USDZAR / AUDJPY / GBPUSD / EURUSD — **not one is a Deriv synthetic.** The gate looks configured-on but is inert on institutional pairs.
  4. `paper mode, notifications disabled` — **cannot fire.** `PAPER_NOTIFY: "true"` is set in `wrangler.jsonc`.
  5. `outside session allowlist` — **cannot fire.** Requires `cfg.sessionsAllowlist.length`, which is `[]`.
- **The cooldown is therefore the dominant cause on institutional pairs — now proven, not assumed.** With reasons 3–5 unreachable and reason 2 one-shot per pair+TF, the cooldown is the only gate that can explain the bulk of the 20 suppressed rows. (This corrects the earlier version of this line, which reached the same conclusion by elimination without checking `isDerivPair`'s actual membership or `PAPER_NOTIFY`.)
- **The cooldown is timeframe-blind — this is the real defect.** `lastAlertTime(pair, direction, excludeSetupId)` (`store.ts` ~608 D1, ~1449 MemStore) filters on `canonical_symbol` and `direction` **only**; there is no `entry_timeframe` term in either implementation. With `ENTRY_TFS = "15m,30m,1h"`, three independent timeframes on the same pair compete for a single 4-hour window: **a delivered 30m XAUUSD SHORT blocks a later 1h XAUUSD SHORT**, even though they are separate setups with separate theses. The gate is roughly 3× more restrictive than "per-pair+direction" suggests.
- **`suppress_reason` is now exposed on `/alerts`** (commit `106d2c3`) — it was stored in D1 and aggregated by the scan-audit rollup, but the endpoint's row mapping omitted it. Read-only, and no gate consults it. This lets the reasons be counted directly instead of derived: `/alerts?includeSuppressed=true&limit=60&key=…` and group on `suppressReason`.
- **Still to do:** the per-row split of the 20 suppressed rows between `cooldown (240m)` and `first scan boot gate` has **not** been measured — outbound access to `*.workers.dev` was down when this was written, so the instrumented endpoint could not be read. The taxonomy above is proven from source; the *counts* are not. Expect the cooldown to take the large majority.

### Cooldown is now timeframe-scoped (fixed 2026-10-08, commit 976161c)

- `lastAlertTime(pair, direction, excludeSetupId, timeframe?)` takes an optional timeframe and filters on `entry_timeframe` when given. `deliver()` passes `alert.entryTf`, so a signal now only blocks repeats on the **same pair, direction and entry timeframe**.
- **`COOLDOWN_SCOPE`** (`wrangler.jsonc`, `config.ts`) controls this: `pair_direction_tf` (default, the fix) or `pair_direction` (legacy). It is a **config flag — switching takes a deploy**, not a hot kill switch.
- `cooldownMinutes` is **unchanged at 240**.
- The suppress reason records which scope applied — `cooldown (240m, 30m)` against the legacy `cooldown (240m)` — so the two stay separable in the audit rollup and on `/alerts`.
- Expect **alert volume to rise**, since a 30m signal no longer silences the 1h and 15m signals on the same pair. Watch the VIP/free channels for the first few days.
- Tests: `worker/test/cooldown_scope.test.ts` (5 cases: default scope, 1h-not-blocked, same-TF repeat still blocked, legacy scope, outside-the-window in both scopes) plus a store-level timeframe-scoping case.

### HTF conflict gate: inert on institutional pairs — now measurable

- **Observed live 2026-10-08:** a USDCAD 15m SHORT was delivered carrying `Bias Grade: ⚠️ HTF_CONFLICT` (1H bullish vs 4H bearish). `applyHtfConflictGate()` exists to suppress exactly this, but `FILTER_HTF_CONFLICT_DERIV_ONLY=true` scopes it to `isDerivPair()`, which matches **only the ten volatility indices**. Verified directly:
  ```
  USDCAD / EURUSD / XAUUSD / JAPAN225  isDerivPair: false  -> gate inert
  V75                                  isDerivPair: true   -> CAN suppress
  ```
  So `FILTER_HTF_CONFLICT: "true"` currently means *"true for the 10 synthetics, silently off for the other 13 pairs"*. No decision has been made on widening it.
- **Nuance worth keeping in view before widening it:** the spec (`docs/SLK_MODEL_SPEC.md`, Layer 1 §3) says *"H4 is the key intraday vantage point; execution refines on H1/M30"*. In that USDCAD alert **4H was bearish and the trade was SHORT — H4 agreed with the direction**; only the 1H refinement timeframe disagreed. By the spec's own hierarchy the trade was aligned with the stated key vantage. Whether that counts as a violation is the owner's call.
- **Measurement path (commit `3a60390`):** `slk_alerts.shadow_classification` (migration 0009, nullable, indexed on `status`), returned by `/alerts` as `shadowClassification`. Diagnostics only — no gate, dedupe, notification or outcome rule reads it. Null means "not recorded", not "no conflict".
  - To decide: group stored alerts by `shadowClassification` and compare net R and win rate for HTF_CONFLICT against ALIGNED. Only rows written after 2026-10-08 carry the value, so this needs time to accumulate.
- **Not a violation — FVG Rebalance ❌.** Spec Layer 2 requires `MAP → TOUCH → SWEEP → SHIFT → RETEST`; FVG appears in Layer 1 as *context*, not an execution requirement. In code, `RETEST_DEPTH_PCT=100` makes the check `if (retestDepthPct < 100)` skip FVG penetration entirely, falling back to the legacy ATR-tolerant origin-zone test. The ❌ is reported context, like `Opposing liq. standing ✅`.
  - **Do not lower `RETEST_DEPTH_PCT` casually.** At 60 it previously took retest candidates from ~220/day to **zero within hours**, because `fvgRetestThreshold()` returns null whenever no direction-matched FVG overlaps the origin zone, making a retest impossible.
- **Reading a setup ID:** the trailing ISO timestamp is the **origin key level's birth time** (`buildSetupId()` uses `level.originTime`), *not* the signal time. `USDCAD:15m:SHORT:DECISION:1.425050:2026-10-06T08:00:00.000Z` means the decision candle closed on 10-06 and price retested that same level on 10-08 — which is why the level price still matches the current market. The signal time is `candleCloseTime`, and the freshness gate is `TF_SECONDS × 2.5` (37.5 min for 15m), so a genuinely stale confirmation would have been skipped.

### Coverage gap: 23 pairs configured, 7 have ever produced a setup

- All 28 stored rows come from XAUUSD, GER40, JAPAN225, US30, AUDJPY, GBPUSD, EURUSD (USDZAR also appears but is no longer in `PAIRS`). **16 of the 23 configured pairs have never produced a single stored alert**: all ten synthetics (V75/V100/V50/V25/V10 + five `1s` variants), NAS100, USDJPY, GBPJPY, and the three recently added forex pairs (USDCAD, NZDUSD, EURJPY — likely innocent, no history yet).
- **Static causes ruled out** (verified in source, 2026-10-08): `providerForPair()` routes synthetics to Deriv and everything else correctly; all ten synthetics have entries in `DERIV_SYMBOLS`; NAS100/USDJPY/GBPJPY have OANDA and Dukascopy symbol mappings; `entryTfAppliesToPair()` and the `SYNTH_ENTRY_TFS` handling are sound. There is **no routing or symbol-map bug**.
- The open question is therefore runtime-only, and splits three ways: **not scanned** (scheduler/batching), **scanned but no candles** (feed or OANDA instrument availability — note `PROVIDER_MAP` sends every silent institutional pair to OANDA), or **candles but no setups** (model reality, which would mean the 10R target needs levers other than coverage).
- **This is the uncapped lever.** The cooldown fix is capped at ~+4.25R/week; coverage is not. Answer it with `GET /api/scan-audit?days=31` and read `scan.byPairTimeframe` — pairs absent from it were never scanned.
- Also fixed while here: `wrangler.jsonc` had a **duplicated `FILTER_HTF_CONFLICT_DERIV_ONLY` key** (both `"true"`, so no behaviour change).

### `notification_preferences.cooldown_minutes` was advertised but inert

- The preference was stored in D1 and **returned by `/api/notification-preferences`**, implying a working 30-minute per-channel throttle. **No delivery gate has ever read it**, there is no setter endpoint, and the dashboard does not consume it.
- Removed from the API response (commit `1eaecfc`) rather than left to mislead, especially with alert volume about to rise. The DB column stays — dropping it is a schema change with no upside. Wiring it into delivery as a real throttle remains an option, but that is a behaviour change nobody has asked for.
- The only cooldown that gates anything is `cfg.strategy.cooldownMinutes`.
- **Why it matters:** the suppressed cluster is dominated by repeat same-direction setups during a strong move — e.g. XAUUSD SHORT on 2026-09-23/24 produced four setups, all ~3R winners, three of them suppressed by the cooldown. The cooldown is suppressing precisely the conditions in which the model performs best.
- **Not changed.** This is a live behaviour change and the owner's call, recorded here so the next session starts from the evidence rather than rediscovering it.

### Weekly R target: 10R per week

- Observed 2026-08-25 → 2026-09-30 (~5 weeks), 28 setups at ~1.17R average:
  delivered **2.30R/week** · suppressed **4.25R/week** · combined **6.56R/week**.
- A 10R/week target therefore needs roughly **8.5 setups/week at the same average**, against **5.6 observed** — about a **1.5× shortfall**.
- Cooldown lever: worth ~**+4.25R/week** if those setups are delivered. **Partially pulled as of 2026-10-08** — the cooldown is now scoped to the setup's own entry timeframe (`COOLDOWN_SCOPE=pair_direction_tf`), so cross-timeframe blocks are gone. Same-timeframe repeats are still blocked, so this is not the full +4.25R; the realized figure has to be measured, not assumed.
- **But un-suppressing alone cannot reach 10R — treat 6.56R/week as a hard ceiling.** Suppression happens at *delivery*, not at *detection*, so the 28 rows are every setup the engine found. Removing suppression entirely converts 2.30R/wk delivered into 6.56R/wk combined — a 2.85× improvement and by far the largest available lever, but still ~34% short of 10R. Hitting 10R needs the cooldown fix **and** more signal: ~8.5 setups/week against 5.6 observed, i.e. wider coverage or a higher average R. Do not present a cooldown change as sufficient on its own.
- Caveats: 5 weeks and 28 setups is a small sample, and two delivered trades produced 92% of the delivered R. The suppressed set is larger and far less concentrated, so it is the more reliable of the two samples for planning.

### Cloudflare plan: Workers Paid, not Free

- The account is on **Workers Paid ($5/mo)**. `/admin/system-health` used to report `"Free Tier Optimized (Sub-millisecond CPU)"` with Free-tier ceilings (10ms CPU, 100,000 writes/day, 500MB, 50 subrequests). **Those were hardcoded strings, not measurements** — they were read as fact and produced a headroom estimate wrong by ~3 orders of magnitude.
- Correct ceilings: **30,000ms CPU per invocation** (cron triggers under a 1h interval included), **10,000 subrequests**, **10M requests/month**, D1 **50M row-writes/month** and **5GB** storage. Actual usage is ~0.005% of CPU, ~0.18% of subrequests, ~0.44% of requests. **The bill stays $5/month.**
- Two honesty fixes: no per-tick CPU figure is asserted at all (Cloudflare does not expose a Worker's own CPU time to the running Worker), and storage is now reported as real row counts rather than an invented "~2MB".
- `worker/test/plan_limits.test.ts` fails if any Free-tier limit string or an invented ms-per-tick figure reappears.
- **Real constraint is wall-clock, not quota:** a tick must finish inside the 1-minute cron. At batch size 2 ticks take 4–14s, so scanning more markets per tick is possible but has little payoff — the tightest freshness window is 37.5 min and the current per-pair revisit is ~11.5 min.

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

### Target-floor shadow ("R available to the next opposing draw", diagnostics only)

- Every live rejection of the 2.5R target floor writes one row to the isolated shadow ledger (`reject_reason = 'TARGET_FLOOR'`) recording the **nearest valid opposing draw** and the **R available to it**: `hypothetical_tp1` is that draw and `hypothetical_rr = |entry − tp1| / risk` is the raw distance — never the floor and never a promoted/capped substitute. `risk` is the same stop the live gate measured (post `minStopPips` adjustment).
- The capture calls the selector with **no RR floor** (`minTpR: 0`), so the ledger sees every rejection with a measurable draw rather than only the old `[2.0R, 2.5R)` near misses. A reject whose only draw sits at 1.2R is now stored with `rr = 1.2` — exactly the evidence a future floor decision needs. A rejection with *no* valid draw at all has no R to record and is skipped; it stays visible in the `targetRejects` audit counter. (One row per rejection; a retest rejection ends the chain, so `TARGET_FLOOR` and `NO_RETEST` rows can never collide on `setup_id`.)
- Rows resolve with the same 120-bar paper rules as the other shadow rows (TP/SL touch first, trailing BE deliberately disabled for shadow resolution, expiry R from the last close) and are surfaced row-by-row by `GET /api/shadow-ledger` (`hypotheticalRr`). **Reading guidance:** band the `TARGET_FLOOR` rows by `hypothetical_rr` before drawing conclusions — the blended aggregate mixes a 1.2R draw with a 2.4R draw.
- **Hard boundary:** research row only. It never creates an alert, event, or notification, never touches Telegram routing, and no gate, dedupe check, delivery path, or outcome rule reads it. `MIN_TP_R` remains 2.5.
- **Production status (2026-10-07, `c240f0b`, deployed 17:08:25Z):** the widened capture is live. Its first row can only appear at the next target-floor rejection — none has occurred in the current retest drought, so the ledger still holds the 1 legacy `[2.0R, 2.5R)` `TARGET_FLOOR` row (+2.372R, `TP_HIT`) alongside 41 `NO_RETEST` rows (35W–3L, +15.2373R, 38 resolved). Rows are tagged with H4 confluence grade/tags and the UTC+1 session bucket, and the resolver keeps them isolated as before.

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

### Scan throughput (cadence) — measured 2026-10-07

- **Symptom:** every cron tick took 43–63 s of the 60 s budget while scanning a *single* market, so effective ticks landed every 2–4 minutes and the 23-pair sweep took 64–94 minutes per pair — far outside the 15m freshness window (37.5 min). That is why the 15m funnel row shows stale drops.
- **Cause:** shadow/experiment outcome resolution fetched once per open `(pair, timeframe)` group, sequentially, on every tick, regardless of which pair was being scanned. The research ledger accumulates rows (34 experiment rows / 20 open on 2026-10-07), so the fan-out — and the tick cost — grew over time. Live/paper alerts were never the problem (0 open at diagnosis).
- **Fix (no strategy, gate, threshold, pair, or timeframe change):**
  - `SHADOW_RESOLVE_FETCH_CONCURRENCY = 3` — the rotating slice is fetched with 3 workers instead of one-at-a-time.
  - **Rotation:** each tick resolves a deterministic slice of open shadow groups (`shadowResolutionWindow`, ordered by pair then timeframe; cursor in KV `shadow_resolve_cursor`). The slice adapts to the open set — `ceil(groups / 6)`, floor 5, cap 12 — so no amount of research-row growth can blow up a tick. Every group is re-checked roughly every `ceil(groups / slice)` ticks.
  - **Live/paper alert resolution is deliberately NOT rotated**: every open live trade is still checked on every tick, so user-visible outcome latency is unchanged.
  - Rotating the shadow ledger is outcome-neutral: resolvers replay candles in order and stop at the first TP/SL touch, so a delayed check records the same exit price/time as a prompt one.
- **Instrumentation:** every scan row now carries `timing` (`liveResolveMs`, `shadowResolveMs`, `pairScanMs`, `shadowGroups`, `shadowChecked`, `httpCalls`, `scheduleMs`, `storeCalls`, `storeMs`) and `/api/engine-pulse` aggregates it as `timing` (avg/max per phase, avg groups checked, avg/max HTTP calls). Both dashboards render it under the funnel line (`#enginePulseTiming`). `/admin/system-health` now reports the **measured** HTTP fan-out from the latest tick instead of the static "1 to 3 fetch calls per tick" claim, which was several times too low.
- **Boundary:** timings and rotation state are observability and scheduling only. Nothing here gates, suppresses, delays, or reorders a scan, an alert, a delivery, or an outcome decision, and no threshold changed.
- **Cadence decision (2026-10-07, this push): `PAIR_BATCH_SIZE` raised 1 → 2.** `/api/engine-pulse` shows the tick cost is now comfortably low (5–15 s against the 60 s budget), so each tick scans two markets (~15–30 s measured estimate) and the per-pair revisit time roughly halves (~23 min → ~12 min). Scheduling only — pair selection order, the freshness gate, the target floor, risk gates, and Telegram routing are untouched. The institutional ⇄ Deriv interleave at batch 2 is covered by `scheduled.test.ts`; the deployed value is pinned by `deploy_config.test.ts`, which also pins `MODE=paper`, `MIN_TP_R=2.5`, `MIN_RISK_ATR=0.8`, `RETEST_DEPTH_PCT=60` and the every-minute cron so none of them can drift silently in `wrangler.jsonc`.
- **Live verification (2026-10-07, `15b0c33`, deployed 17:08:25Z):** `/admin/system-health` reports `batchSize: 2` and recent scan rows carry **two pairs each** — V50_1S+US30 22,222 ms, V100_1S+NAS100 20,057 ms, V75_1S+XAUUSD 18,575 ms, V10+GBPJPY 16,429 ms (plus a 1-pair tail row at 11,540 ms), all `note: "ok"` with no errors. Two-pair ticks land **16–22 s** against the 60 s budget (~2.7× headroom) and the sweep advances two markets per minute, so the per-pair revisit is now **~11.5 min** (was ~23 min). The latest tick reports 13 HTTP subrequests (limit 50) and unchanged fixed costs (`avgScheduleMs 973`, `avgShadowResolveMs 3,526`, `avgLiveResolveMs 241`). Pulse snapshot: 468 scans / 465 active, chains TOUCH 60 / SWEEP 55 / SHIFT 22 / RETEST 0, rejections all 0 (see the retest drought below).
- **Deploy-pipeline gotcha (2026-10-07):** one push-triggered run (`37655445702`, `c240f0b`) was created with **only the test job** (green) and marked failed — the deploy job never appeared, and the workflow blob was byte-identical (`ec77c5f9…`) to the run that deployed `974cf97` minutes earlier, so it was a GitHub-side anomaly, not a repo problem. From this environment `gh run rerun` returns 500/"cannot be rerun" and `gh workflow run` returns 403 `Resource not accessible by integration` (the integration token has no `actions:write`), so a run that drops its jobs cannot be re-triggered manually — **push again** (even an empty commit) and the next run carries the deploy. `15b0c33`'s run did include both jobs and deployed normally.
- **Follow-up (2026-10-07, second pass):** the rotation landed and cut ticks from ~46 s to ~34 s (idle ticks: 5.4 s), but the per-phase timings showed only ~9 s of that tick was accounted for by scanning and resolution. The rest was the **scheduler**: working out which markets are due cost up to ~140 sequential `slk_kv` reads per tick (one per pair per timeframe, twice over, plus one per key for the boundaries). Fixed by `Store.getKvByPrefix`, which fetches a whole key prefix in one indexed range query; the scheduler now primes a per-tick `last_scan:`/`last_boundary:` snapshot with **two** reads and every write is write-through so reads inside the same tick still see what the store holds. Measured in tests: **34 store round-trips per tick, versus ~160 before**, with zero individual scheduler KV reads. `instrumentStore` counts store calls and their wall time so the next regression is visible immediately rather than inferred.
- Averages are per-field honest: rows written before the scheduler/store counters existed are excluded from *those* averages (not counted as zeros), so the dashboard shows the real value as soon as one new row lands.
- **Live verification (2026-10-07, `974cf97`, deployed 16:14:16Z):** tick cost fell from 31–41 s (Slice 2) and 43–63 s (pre-Slice-2) to **5–15 s** — three-timeframe ticks 11–15 s, single-timeframe ticks 7–8 s. `/api/engine-pulse` reports `avgScheduleMs 1,003` (max 1,259) against the ~23.5 s previously unaccounted, and **37–77 store round-trips per tick** (was ~160), each ~100–250 ms — D1 round-trip latency is now the dominant term, so any further headroom is store calls, not scheduling. Scan rows now land in **every** cron minute (16:18–16:26Z all present); before this deploy Oct 6 produced 320 rows / 1,440 min and Oct 7 352 rows / 814 min. A direct `/admin/trigger-scan` probe shows `scheduleMs 358`, `storeCalls 37`, `storeMs 3,577`, `pairScanMs 2,111`. Pages (`app.js?v=974cf97`) and both dashboard copies carry the extended timing line.
- **Recording cross-check for the empty funnel:** a manually triggered scan returns `replay: {MAP 3, TOUCH 2, SWEEP 2, INVALID 2, EXPIRED 1, retestCandidates 0}` — the counters are written and Oct 7's zero is a real zero. Shadow `NO_RETEST` captures are still being created (newest `createdUtc` 16:21:42Z). The empty confirmation funnel therefore reflects "no setup has returned to its zone today", not a recording gap.

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

Post-release proof recorded for `a1c91f0` (confirmation funnel): `/health` → `mode: paper`, `retestDepthPct: 60`, `watchNotify/biasNotify: true`, 23 pairs; `/api/engine-pulse` → `confirmations: []` with `lastScanTs` advancing (expected until the first post-deploy confirmation); accepted on the Pages dashboard too. The dashboard proof below must run against the Pages production host with a fresh query parameter:

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
   All 19 pre-Oct-1 "stale confirmation" rows in `slk_alerts` were discovered 9 hours to 9.8 days late (net +22.26R of pure hindsight). The only genuinely real-time suppression in the ledger is V75_1S (2026-09-30, HTF-conflict gate, 14-minute latency), which would have lost −1R. **Do not loosen `MIN_TP_R`, `MIN_RISK_ATR`, or the freshness window on the strength of those rows.** Recommended next step (diagnostics only, no gating change): record the discovery age of every confirmation and the "R available to the next opposing draw" for each target-floor rejection, so the next decision can tell "no fresh opportunity exists" apart from "the threshold is too tight". **Delivered and live (2026-10-07): the confirmation funnel (discovery age, freshness, near-miss and stale counts per entry timeframe, on `/api/engine-pulse` + both dashboards — see "Confirmation funnel" above), scan throughput (`a1c91f0`, `60b373d`, `974cf97`; ticks now 5–15 s with the scheduler at ~1 s — see "Scan throughput" above), and the target-floor shadow (every floor rejection now records the nearest opposing draw and the R available to it — widened capture shipped by this push, see "Target-floor shadow" above).**
2. **Migration 0008 is applied by the owner (2026-10-07, ~13:35 UTC)** — no action left. Tag columns exist in production D1 and tagged rows are being written (see the tagging section). If `0007_shadow_experiments.sql` is still unapplied, apply it too (`npx wrangler d1 migrations apply slk-alert-db --remote`); missing-table behavior safely no-ops and retries its schema probe every five minutes.
3. Collect roughly 2–3 weeks of shadow observations before considering any `MIN_TP_R` decision. Keep the floor at `2.5` until the owner explicitly decides. The `TARGET_FLOOR` rows are now banded by `hypothetical_rr` (see "Target-floor shadow" above), so the eventual decision can compare "what a 2.0R / 1.5R floor would have taken" against the delivered-alert baseline instead of guessing from the aggregate.
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
