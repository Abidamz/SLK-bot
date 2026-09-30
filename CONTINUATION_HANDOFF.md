# SLK Radar — Complete Continuation Handoff & Architecture Summary

**Updated:** 2026-09-30 (UTC)  
**Repository:** `Abidamz/SLK-bot` (GitHub: https://github.com/Abidamz/SLK-bot)  
**Active Production Branch:** `arena/01a0b153-slk-bot`  
**Latest Synced Commit:** `b8e2b08` (`fix(provider): map GER40/DE40 to official OANDA instrument DE30_EUR`)

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
  - Latency: 240–350ms per edge request.
  - Multi-tier institutional failover: OANDA $\leftrightarrow$ Swiss Bank Dukascopy $\leftrightarrow$ Twelve Data / Yahoo.
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
PAIR_BATCH_SIZE=2             (Optimized throughput: 2 pairs per minute, interleaved oldest-first scanning)
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
| `worker/src/provider.ts` | Market data provider with automatic failover (Twelve Data $\to$ Dukascopy $\to$ Yahoo $\to$ Deriv Relay) |
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
