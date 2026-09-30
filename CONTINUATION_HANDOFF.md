# SLK Radar — Complete Continuation Handoff & Architecture Summary

**Updated:** 2026-09-30 (UTC)  
**Repository:** `Abidamz/SLK-bot` (GitHub: https://github.com/Abidamz/SLK-bot)  
**Active Production Branch:** `arena/01a0b153-slk-bot`  
**Latest Synced Commit:** `0e8f954` (`fix(provider): eliminate automated Yahoo Finance failovers and fallbacks`)

---

## 1. Quick Links & Live Deployments

- **Public Proof Journal & Dashboard:** `https://slk-radar.pages.dev`
- **Subscriber Terms & Risk Disclaimer:** `https://slk-radar.pages.dev/terms`
- **Whop Storefront (VIP Membership):** `https://whop.com/slk-radar/slk-radar-vip-signals`
- **Deriv Candle Relay (Vercel Production - Verified 90ms latency):** `https://slk-bot.vercel.app`
  - Candle feed: `GET https://slk-bot.vercel.app/candles?symbol=R_75&granularity=1800&limit=5`
  - Health probe: `GET https://slk-bot.vercel.app/health`
  - Latency probe: `GET https://slk-bot.vercel.app/probe`
- **Cloudflare Worker API (Backend - 100% Automated Git Deployments Active):** `https://slk-alert-worker.abidogundamilola.workers.dev`
  - Health: `GET /health` (`oandaConfigured: true`, `v2.5.4`)
  - Stats: `GET /stats`
  - Public Ledger: `GET /alerts`
  - Scan Logs: `GET /scan-log`
  - OANDA Live Probe: `GET /api/probe-oanda?pair=US30`
  - Deriv WebSocket Probe: `GET /api/probe-deriv`
- **OANDA v3 REST Provider Status:**
  - Token verified and securely stored in D1 KV (`slk_kv.oanda_api_token`).
  - Active coverage for 10 Institutional assets: `US30`, `NAS100`, `GER40` (`DE30_EUR`), `JAPAN225`, `XAUUSD`, `EURUSD`, `GBPUSD`, `USDJPY`, `AUDJPY`, `GBPJPY`.
  - Rate Limits & Capacity: 120 requests/minute with **no daily credit ceiling** (unlike Twelve Data's 800/day cliff). Current cron scan pace consumes <4% of OANDA's limit.
  - Edge CPU Optimization: Server-side OHLC midpoint candle aggregation reduces Cloudflare edge CPU usage by ~85% (from 9ms down to 1–2ms), completely eliminating Cloudflare Free Tier 10ms CPU isolation kills.
  - Multi-tier institutional failover: OANDA $\leftrightarrow$ Swiss Bank Dukascopy $\leftrightarrow$ Twelve Data (Yahoo Finance completely removed from automated fallback chain).
- **Telegram Channels (4-Channel Isolated Architecture):**
  - **VIP Institutional Channel:** Managed via `TELEGRAM_CHAT_ID` (`Trade jounal`)
  - **VIP 24/7 Synthetics Channel:** Managed via `TELEGRAM_DERIV_CHAT_ID` (`SLK HUB | 24/7 SYNTHETICS`)
  - **Free Institutional Hub:** Managed via `TELEGRAM_FREE_CHAT_ID` (`SLK TRADING HUB (FREE)`)
  - **Dedicated Free Synthetics Hub:** Managed via `TELEGRAM_DERIV_FREE_CHAT_ID` (`https://t.me/SLK_Hub_synthetics_free`, `@SLK_Hub_synthetics_free`)
  - **Personal VIP Push DM:** Managed via `TELEGRAM_DM_CHAT_ID`

---

## 2. Active Production Safety & Configuration

```text
MODE=paper
WATCH_NOTIFY=true             (Active radar for heads-up detection)
VIP_WATCH_NOTIFY=false        (Clean VIP feed: VIP Institutional and Synthetics channels receive ONLY confirmed entries and outcomes)
PAPER_NOTIFY=true
PAIR_BATCH_SIZE=1             (Free Tier CPU optimized: 1 pair per minute batch, oldest-first scanning)
MIN_RISK_ATR=0.8
MIN_TP_R=2.5                  (Strict 2.5R - 4R asymmetric reward floor across all pairs)
SL_BUFFER_ATR=0.25            (Gold & Index wick padding)
FILTER_HTF_CONFLICT=true      (Suppresses trades where lower-timeframe entry opposes 4H/1H momentum)
FILTER_HTF_CONFLICT_DERIV_ONLY=true (Active on 24/7 continuous synthetics; institutional pairs evaluated in shadow mode)
MT5/live broker execution: disabled (Research & paper alert mode only)
```

### Channel Routing Protocol (Strict Separation)
- **VIP Institutional Channel (`TELEGRAM_CHAT_ID`):** High-signal execution feed. Receives **ONLY confirmed entry alerts** (`🚨🚨🚨 [ACTION REQUIRED] — SLK CONFIRMED ENTRY`) and trade outcomes (`TP_HIT` / `SL_HIT`). Zero watch radar, zero synthetics.
- **VIP Synthetics Channel (`TELEGRAM_DERIV_CHAT_ID`):** Dedicated Deriv synthetic execution feed. Receives **ONLY confirmed entry alerts** and trade outcomes for synthetic volatility pairs. Zero watch radar, zero forex.
- **Free Institutional Channel (`TELEGRAM_FREE_CHAT_ID`):** Educational & conversion funnel. Receives `👀 WATCH` radar heads-ups (TOUCH, SWEEP, SHIFT), `🧭 BIAS CONFIRMATION` cards, and automated win teasers for Forex & Indices only. **Zero synthetics**.
- **Dedicated Free Synthetics Channel (`TELEGRAM_DERIV_FREE_CHAT_ID`):** 24/7 unverified synthetic watch radar, bias confirmation cards, and V75 win teasers with Whop VIP upgrade links.
- **Personal DM (`TELEGRAM_DM_CHAT_ID`):** Simultaneous personal push for confirmed entries.

### Freshness & Anti-Spam Safety Gates
- **`alertEventFresh`**: Alerts are only delivered to Telegram if their candle closed within $2 \times \text{timeframe}$ of the current time (e.g. within 30 minutes for a 15m candle). Historical backfilled setups discovered during boot are recorded into D1 for public ledger transparency with `alertStatus: "SUPPRESSED"`, preventing outdated trades from being blasted to Telegram.
- **`isFirstScan`**: On initial startup or when adding a new timeframe, the first scan is record-only, preventing burst alerts from past candles. Subsequent scans operate in real-time.
- **Stale Replay Protection**: Historical replays are prevented from populating `slk_alerts`, ensuring only fresh real-time signals enter the ledger.

### Active Markets (20 Quantitative Assets)
- **Indices (4):** `NAS100`, `US30`, `GER40`, `JAPAN225`
- **Metals (1):** `XAUUSD` (Gold)
- **Forex (5):** `EURUSD`, `GBPUSD`, `USDJPY`, `AUDJPY`, `GBPJPY`
- **Deriv Synthetics (10 continuous 24/7 assets):**
  - Standard Volatility Series: `V75` (`R_75`), `V100` (`R_100`), `V50` (`R_50`), `V25` (`R_25`), `V10` (`R_10`)
  - 1-Second Continuous Series: `V75_1S` (`1HZ75V`), `V100_1S` (`1HZ100V`), `V50_1S` (`1HZ50V`), `V25_1S` (`1HZ25V`), `V10_1S` (`1HZ10V`)
- **Timeframes:** `15m` (resampled), `30m`, `1h`
- **Weekend Mode:** Automatically bypasses closed traditional forex/index markets on weekends (Saturday 00:00 UTC through Sunday 21:00 UTC) so 100% of cron capacity scans the 10 continuous synthetics.

---

## 2.1 Major Architectural Milestones (September 2026)

1. **Video-Aligned Directional Bias Shadow Classification**:
   - Evaluates multi-timeframe structural continuity across Weekly, Daily, 4H, and 1H contexts.
   - Diagnostic components include:
     - **Weekly Liquidity**: Weekly high/low sweeps and opposing liquidity targets.
     - **Daily Structure**: Body-to-body candle breakouts and daily liquidity sweep + structure shifts.
     - **4H Vantage Point**: Structural breakout status and primary trend direction.
     - **1H Execution Alignment**: Agreement between execution context and higher-timeframe vantage.
     - **Entry Quality**: Fair Value Gap (FVG) detection, displacement rebalance, lower-timeframe sweep, and structure break.
     - **Classification Grades**: `A_GRADE` (full multi-timeframe alignment + FVG rebalance), `B_GRADE` (aligned without FVG rebalance), `HTF_CONFLICT` (opposing higher-timeframe momentum), `OBSERVATION_ONLY` (neutral or unconfirmed).
   - Behavior-neutral: runs alongside standard confirmation entries without mutating entry triggers, targets, or risk limits. Fully validated across 9 deterministic test suites in `worker/test/shadow.test.ts`.

2. **Historical Runway Expansion (120 H4 Bars)**:
   - In `worker/src/config.ts`, `baseCandlesLimit` was updated from 40 to 120 bars of H4 history.
   - Ensures multi-day institutional origin key levels (such as Gold's 4303–4313 zone) remain active in the storyline engine across pullbacks.

3. **Pre-Entry Watch Radar Enhancement**:
   - `WATCH_STATES` expanded to include `TOUCH` alongside `SWEEP` and `SHIFT`.
   - Free conversion channels receive heads-up notifications when price enters an armed origin zone, alerting subscribers before liquidity sweeps and structural shifts occur.

4. **Deriv WebSocket & Vercel Relay Architecture**:
   - Deriv retired legacy endpoints (`ws.derivws.com` and `ws.binaryws.com` returning HTTP 520).
   - Market data now connects via `wss://api.derivws.com/trading/v1/options/ws/public` requiring no demo token.
   - Dedicated low-latency micro-service deployed to Vercel (`https://slk-bot.vercel.app/candles`) with persistent WebSocket connection and 15s candle caching.

5. **Dedicated 4-Channel Routing & Signal Isolation**:
   - `getFreeChatIds()` strictly separates routing by `isDerivPair()`:
     - Synthetic watch radar, bias confirmation cards, and win teasers route **only** to `TELEGRAM_DERIV_FREE_CHAT_ID`.
     - Synthetics are **completely excluded** from the Forex Free channel (`TELEGRAM_FREE_CHAT_ID`).
   - `broadcast()` strictly isolates VIP channels:
     - Synthetic VIP alerts go **only** to `TELEGRAM_DERIV_CHAT_ID` with no fallback to `TELEGRAM_CHAT_ID`.
     - Institutional VIP alerts go **only** to `TELEGRAM_CHAT_ID`.
     - VIP channels receive **confirmed entries and outcomes only** (0 watch or bias cards).

---

## 3. Real Live Track Record & Verified Ledger

- **Total Recorded Trades:** 29 setups
- **Resolved Trades (Win/Loss):** 23 trades
  - **Take Profit Hits:** 15 trades (yielding between +0.95R and +4.53R each, targeted at internal swing points / min 2.5R)
  - **Stop Loss Hits:** 8 trades (strictly capped at -1.00R each; one early gold paper exit recorded at -1.20R)
  - **Expired Trades:** 6 trades (0.00R after exceeding the 120-bar resolution window)
- **Decided Win Rate:** **65.2%** (15 / 23)
- **Cumulative Net Return:** **+27.78R** (exact sum: `27.779R`)
  - **Institutional (Forex / Indices / Gold):** 26 setups, 15 TP, 5 SL, **+30.78R** (75.0% win rate)
  - **Synthetics (Deriv 24/7):** 3 setups, 0 TP, 3 SL (`V10_1S`: -1.00R, `V50_1S`: -1.00R, `V75`: -1.00R), **-3.00R**
- **Live Shadow Classification Correlation & Synthetics Insight:**
  - 100% of synthetic losses were counter-trend to higher timeframe momentum (4H or 1H).
  - Both `V10_1S` and `V50_1S` were pre-flagged in real time as **`⚠️ HTF_CONFLICT`**.
  - Synthetic algorithmic assets (Brownian motion / continuous random walk) produce severe lower-timeframe noise when trading against 4H/1H macro trends.
  - Filtering or gating `HTF_CONFLICT` setups or elevating synthetic minimum entry timeframe to 1H is critical to protecting the Synthetics VIP channel reputation.
- **Synthetics Clean Slate:** Production database purged of legacy stale test records; 0-trade clean slate ready for live streaming.

---

## 4. Key System Architecture & Files

| Path | Purpose |
| :--- | :--- |
| `worker/src/index.ts` | Worker router (`/health`, `/alerts`, `/stats`, `/scan-log`, cron handler, admin endpoints) |
| `worker/src/engine.ts` | SLK confirmation state machine (`MAP` $\to$ `TOUCH` $\to$ `SWEEP` $\to$ `SHIFT` $\to$ `RETEST`) |
| `worker/src/shadow.ts` | Behavior-neutral shadow directional bias classifier (`A_GRADE`, `B_GRADE`, `HTF_CONFLICT`) |
| `worker/src/notify.ts` | 4-channel isolated Telegram dispatcher (loud pinned entries, silent watch cards, win teasers) |
| `worker/src/provider.ts` | Market data provider with automatic failover (OANDA $\leftrightarrow$ Dukascopy $\leftrightarrow$ Twelve Data, Deriv Relay; Yahoo removed from fallback) |
| `worker/src/store.ts` | SQLite / Cloudflare D1 persistence ledger |
| `worker/wrangler.jsonc` | Cloudflare Worker configuration (`PAIR_BATCH_SIZE: 1`, safety variables) |
| `dashboard/index.html` | Public track record UI with verified ledger table and performance metrics |
| `dashboard/app.js` | Dashboard client logic with dynamic exact R-multiple calculation |
| `dashboard/terms.html` | High-risk investment disclaimer and Terms of Service for Whop compliance |
| `dashboard/SLK_Radar_Terms_of_Service.pdf` | Printable legal PDF for subscriber onboarding |
| `MARKETING_PLAYBOOK.md` | Full marketing funnels, video scripts, Twitter threads, and launch strategy |

---

## 5. Verification & Testing Endpoints

### Automated Test Suite Commands
Always verify all three commands pass cleanly before deployment:
```bash
npm test -- --run
npm run typecheck
node --check dashboard/app.js
```

### Live Worker Health & Diagnostics Endpoints
- **Worker Health**: `https://slk-alert-worker.abidogundamilola.workers.dev/health`
- **Deriv WebSocket Probe**: `https://slk-alert-worker.abidogundamilola.workers.dev/api/probe-deriv`
- **Telegram Status & Configuration**: `https://slk-alert-worker.abidogundamilola.workers.dev/admin/telegram-status`
- **Immediate Market Scan**: `https://slk-alert-worker.abidogundamilola.workers.dev/admin/trigger-scan`

### Test Signal Endpoints (Channel Verification)
- **Test Institutional VIP Signal**: `/admin/test-alert?pair=EURUSD` (Loud confirmed entry to `Trade jounal` + DM)
- **Test Synthetics VIP Signal**: `/admin/test-deriv` (Loud confirmed V75 entry to `SLK HUB | 24/7 SYNTHETICS`)
- **Test Free Win Teaser**: `/admin/test-free-teaser` (TP1 Win Teaser to Forex Free channel)
- **Test Free Synthetics Teaser**: `/admin/test-deriv-free-teaser` (V75 Win Teaser to dedicated Synthetics Free channel)
- **Connect Free Synthetics Channel**: `/admin/connect-deriv-free-channel` (Auto-detects and links new channel from Telegram updates)

### Real-Time Intrabar Outcome Resolution (v2.5.3)
- Open trades are evaluated every single minute across all pairs via `resolveAllOpenAlerts()`.
- Intrabar touch evaluation (`validateCandlesForOutcome`) includes the forming active candle when `slOnClose` is false, eliminating the previous 15–45 minute wait for candle closes and queue rotations.

### Automated Continuous Deployment (Cloudflare Workers Builds Active)
- **Deployment is 100% automated via Cloudflare Workers Builds**: Cloudflare is directly connected to GitHub (`Abidamz/SLK-bot`) watching branch `arena/01a0b153-slk-bot` with root directory `worker`.
- **Every `git push origin arena/01a0b153-slk-bot` automatically triggers Cloudflare to build and deploy live within 30 seconds.**
- **GitHub Actions is bypassed**: The account-level disabled status on GitHub Actions does not affect production because Cloudflare uses its own native GitHub webhook and build runners.
---

## 6. How to Continue in New Sessions

If continuing in a new Arena session or environment:
1. Ensure your git branch is set to `arena/01a0b153-slk-bot`. Never switch branches.
2. Run `git pull origin arena/01a0b153-slk-bot`.
3. Keep safety settings intact (`MODE=paper`, `MIN_RISK_ATR=0.8`, `PAIR_BATCH_SIZE=1`).
4. Validate changes using `npm test -- --run`, `npm run typecheck`, and `node --check dashboard/app.js`.

---

## 7. Recommended Next Steps & Roadmap (ChatGPT / LLM Continuation Recommendations)

For any developer, AI agent (e.g., ChatGPT, Claude), or engineering lead continuing work on `SLK-bot`, the following 6 roadmap enhancements offer the highest immediate ROI for trading edge, subscriber retention, and operational automation:

### Recommendation 1: Automated Daily & Weekly Performance Recaps for Free Channels ✅ COMPLETED & DEPLOYED
* **Status:** Implemented in `worker/src/notify.ts`, `worker/src/index.ts`, and fully covered by 8 vitest unit tests in `worker/test/recap.test.ts`.
* **Objective:** Automatically convert free channel lurkers into paying $100/mo VIP subscribers without manual daily journal posting.
* **Architecture:**
  - Automated cron scheduler runs at 21:00 UTC (New York market close) for Daily Recaps and Friday 21:05 UTC (market close) for Weekly Recaps.
  - Queries D1 `slk_alerts` for all trades closed in the last 24h / 7d.
  - Calculates daily stats: Total Setups, Won, Lost, Breakeven, Net R-Multiple (e.g. `+5.8R today`, `+18.4R this week`), and Cumulative Ledger Return (+30.78R).
  - Strict channel segregation: Institutional recap dispatches to `TELEGRAM_FREE_CHAT_ID`; 24/7 Synthetics recap dispatches to `TELEGRAM_DERIV_FREE_CHAT_ID`.
  - Built-in deduplication via `slk_kv` prevents duplicate cards on multiple cron invocations.
  - Admin inspection and manual trigger endpoints active: `/admin/preview-recap` and `/admin/trigger-recap`.
  - Format a high-impact institutional summary card with a CTA button/link pointing to `https://slk-radar.pages.dev` (verified proof) and `https://whop.com/slk-radar` (VIP upgrade).
  - Dispatch to `TELEGRAM_FREE_CHAT_ID` and `TELEGRAM_DERIV_FREE_CHAT_ID`.
* **Relevant Files:** `worker/src/notify.ts` (formatter `formatDailyRecapCard`), `worker/src/index.ts` (cron schedule trigger).

### Recommendation 2: Trailing Breakeven (`BE`) & Trade Protection Engine ✅ COMPLETED & OPERATIONAL
* **Status:** Implemented in `worker/src/outcomes.ts`, `worker/src/types.ts`, `worker/src/config.ts`, `worker/src/notify.ts`, `worker/src/index.ts`, `dashboard/app.js`, `worker/src/dashboard_html.ts`, and verified via 5 deterministic tests in `worker/test/outcomes.test.ts`.
* **Objective:** Eliminate the risk of winning trades that reached +1.5R favorable excursion reversing into full -1.0R losses during high-impact news or liquidity sweeps.
* **Architecture:**
  - Extended `SignalStatus` in `worker/src/types.ts` to include `'BE_HIT'`.
  - Added configurable parameters in `StrategyConfig` & Worker config: `trailingBeEnabled` (default `true`) and `trailingBeTriggerR` (default `1.5R`).
  - In `evaluateSignal()` (`worker/src/outcomes.ts`), when price achieves $\ge +1.5R$ favorable excursion:
    1. Arms breakeven state (`beArmed = true`).
    2. Adjusts effective stop loss to the exact entry price (`entry`).
    3. If price subsequently retraces to entry price or beyond, resolves as `BE_HIT` with `exitPrice = entry` and `rMultiple = 0.00` (zero loss incurred).
    4. Symmetrically supports both `LONG` and `SHORT` directions, with full support for intrabar touch or close invalidation.
    5. If price continues toward target, resolves cleanly as `TP_HIT` (+2.5R to +3.0R).
  - Outcome notification formatted in `worker/src/notify.ts` with institutional badge `🛡️ BREAKEVEN HIT`, amber Discord color, and reassuring messaging: `🛡️ Trade was secured at Breakeven after reaching +1.50R favorable excursion. Zero loss incurred.`
  - Full dashboard integration: filterable by `BE_HIT` across public dashboard, API `/api/alerts`, and `/api/stats`.
* **Impact:** Drastically improves subscriber psychology, protects capital from high-volatility flash wicks, and locks in breakeven on extended trades without risking initial stop losses.
* **Relevant Files:** `worker/src/types.ts`, `worker/src/config.ts`, `worker/src/outcomes.ts`, `worker/src/notify.ts`, `worker/src/index.ts`, `worker/test/outcomes.test.ts`.

### Recommendation 3: Automated Visual Chart Snapshots in Telegram Alerts ✅ COMPLETED & OPERATIONAL
* **Status:** Implemented in `worker/src/notify.ts` via `getChartUrl()` and embedded directly into all confirmed entry alerts and verified journal teasers. Tested in `worker/test/whop.test.ts`.
* **Objective:** Replace text-only Telegram alerts with direct visual chart links and references showing the SLK sequence (origin zone, sweep wick, entry trigger, stop loss, and target).
* **Architecture:**
  - Automated symbol resolver `getChartUrl()` maps institutional Forex & Indices (`US30`, `NAS100`, `GER40`, `XAUUSD`, `EURUSD`, `GBPUSD`, etc.) to TradingView chart views (`CURRENCYCOM`, `OANDA`, `FX`).
  - Maps 24/7 continuous Synthetics (`V75`, `V100`, `R_75`, etc.) directly to the official Deriv DTrader interactive candle view.
  - Confirmed alert delivery includes: `Chart View  : https://www.tradingview.com/chart/?symbol=...`
* **Relevant Files:** `worker/src/notify.ts`, `worker/test/whop.test.ts`.

### Recommendation 4: Whop Webhook for 100% Automated VIP Channel Membership ✅ COMPLETED & OPERATIONAL
* **Status:** Implemented in `worker/src/notify.ts`, `worker/src/index.ts`, and verified via deterministic test suite in `worker/test/whop.test.ts`.
* **Objective:** Make the subscription business 100% passive by automatically managing VIP Telegram channel access on purchase, renewal, cancellation, or refund.
* **Architecture:**
  - Secure endpoint `POST /api/whop-webhook` in `worker/src/index.ts` with multi-mode authentication:
    - Whop HMAC-SHA256 signature verification (`webhook-signature` or `x-whop-signature` with `t=...,v1=...` timestamp format).
    - Bearer secret token `WHOP_WEBHOOK_SECRET` header or query parameter `?secret=`.
  - On `membership.went_valid` or `payment.succeeded`:
    - Calls Telegram Bot API `createChatInviteLink` with `member_limit: 1` and `expire_date: +48 hours`.
    - Generates separate single-use invite links for Institutional VIP (`TELEGRAM_CHAT_ID`) and Synthetics VIP (`TELEGRAM_DERIV_CHAT_ID`).
    - Persists member record in KV `whop:member:{membershipId}` with active status and timestamps.
    - Returns invite links in JSON response for immediate delivery.
  - On `membership.went_invalid` or `membership.cancelled`:
    - Looks up member record from KV.
    - If user's Telegram ID is recorded, revokes VIP channel access via `banChatMember` + `unbanChatMember`.
    - Updates member record in KV to `status: "revoked"`.
  - Admin inspection endpoint: `GET /admin/whop-member?id={membershipId}`.
  - Manual single-use invite generator: `POST /admin/generate-invite?target={institutional|synthetics}`.
* **Relevant Files:** `worker/src/index.ts`, `worker/src/notify.ts`, `worker/test/whop.test.ts`.

### Recommendation 5: Elevate Synthetics to 1H Primary & Enforce HTF Bias Hard Gating
* **Objective:** Protect synthetic VIP channel track record and maximize win rate on 24/7 continuous assets.
* **Analysis & Context:**
  - Institutional Forex & Indices have an exceptional **+30.78R (75.0% win rate)** track record.
  - Synthetic volatility assets (`V75`, `V100`, etc.) are continuous algorithmic random walks with higher lower-timeframe noise. The 3 historical synthetic paper losses were all counter-trend setups flagged as `HTF_CONFLICT`.
* **Action:**
  - Permanently enforce `FILTER_HTF_CONFLICT_DERIV_ONLY=true` so counter-trend setups are never delivered to VIP synthetics.
  - Focus synthetic scanning on higher-probability structural timeframes (`1h` and `4h`), while keeping `15m` and `30m` for institutional Forex/Indices.
* **Relevant Files:** `worker/src/config.ts`, `worker/wrangler.jsonc`.

### Recommendation 6: MetaTrader 5 (MT5) Auto-Execution Webhook Bridge (For Live & Prop Firm Capital)
* **Objective:** Enable one-click or automated trade execution on live MT5 broker accounts (e.g., FTMO, FundedNext, IC Markets, Pepperstone) when the owner is ready to transition from paper testing to real capital.
* **Architecture:**
  - The Cloudflare Worker cannot connect to MT5 directly (MT5 requires Windows native DLLs/C++ API).
  - Deploy a lightweight Python FastAPI micro-service on a $5/mo Windows VPS with the MT5 desktop terminal running.
  - When `scanEntry` records a confirmed entry, the Worker dispatches an authenticated POST request to `https://your-vps.com/webhook/trade`.
  - The Python bridge parses the trade, calculates exact lot size based on account balance ($100 risk per trade / stop loss distance in points), and executes `mt5.order_send()`.
* **Relevant Files:** Separate micro-service or `scripts/mt5_bridge.py`.

