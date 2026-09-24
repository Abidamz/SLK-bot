# SLK Radar — Complete Continuation Handoff & Architecture Summary

**Updated:** 2026-09-24 (UTC)  
**Repository:** `Abidamz/SLK-bot` (GitHub: https://github.com/Abidamz/SLK-bot)  
**Active Production Branch:** `arena/01a0b153-slk-bot`  
**Latest Synced Commit:** `f6e049e` (`feat(dashboard): add 24/7 Synthetics market segment switcher, banner, and trade badging`)

---

## 1. Quick Links & Live Deployments

- **Public Proof Journal & Dashboard:** `https://slk-radar.pages.dev`
- **Subscriber Terms & Risk Disclaimer:** `https://slk-radar.pages.dev/terms`
- **Whop Storefront (VIP Membership):** `https://whop.com/slk-radar/slk-radar-vip-signals`
- **Cloudflare Worker API (Backend):** `https://slk-alert-worker.abidogundamilola.workers.dev`
  - Health: `GET /health`
  - Stats: `GET /stats`
  - Public Ledger: `GET /alerts`
  - Scan Logs: `GET /scan-log`
- **Telegram Channels:**
  - **VIP Institutional Channel:** Managed via `TELEGRAM_CHAT_ID`
  - **24/7 Synthetics Channel:** `SLK HUB | 24/7 SYNTHETICS` (ID: `-1004426439958`, `https://t.me/+sBrVmW1u8osyM2Q0`)
  - **Free Community Hub:** Managed via `TELEGRAM_FREE_CHAT_ID`
  - **Personal VIP Push DM:** Managed via `TELEGRAM_DM_CHAT_ID`

---

## 2. Active Production Safety & Configuration

```text
MODE=paper
WATCH_NOTIFY=true
PAPER_NOTIFY=true
PAIR_BATCH_SIZE=1             (Sequential 1-minute staggered scanning to prevent 10ms CPU kills)
MIN_RISK_ATR=0.8
MIN_TP_R=2.5                  (Strict 2.5R - 4R asymmetric reward floor)
SL_BUFFER_ATR=0.25            (Gold & Index wick padding)
MT5/live broker execution: disabled (Research & paper alert mode only)
```

### Active Markets (11 High-Beta Assets)
- **Indices:** `NAS100`, `US30`, `GER40`, `JAPAN225`
- **Metals:** `XAUUSD` (Gold)
- **Forex:** `EURUSD`, `GBPUSD`, `USDJPY`, `AUDJPY`, `GBPJPY`
- **Synthetics (24/7):** `V75` (Volatility 75 Index via Deriv WebSocket provider)
- **Timeframes:** `15m` (resampled), `30m`, `1h`

---

## 3. Real Live Track Record (as of 2026-09-24)

- **Total Recorded Setups:** 20
- **Decided Outcomes:** 14 trades (10 Take Profit ✅ · 4 Stop Loss 🛑)
- **Decided Win Rate:** **71.4%**
- **Cumulative Net Return:** **+17.37R**
- **Max Drawdown:** -3.20R
- **Top Performer:** Gold (`XAUUSD`) 6 wins / 0 losses (**+11.38R** net)

---

## 4. Key System Architecture & Files

| Path | Purpose |
| :--- | :--- |
| `worker/src/index.ts` | Worker router (`/health`, `/alerts`, `/stats`, `/scan-log`, cron handler) |
| `worker/src/engine.ts` | SLK confirmation state machine (`MAP` $\to$ `TOUCH` $\to$ `SWEEP` $\to$ `SHIFT` $\to$ `RETEST`) |
| `worker/src/shadow.ts` | Behavior-neutral shadow directional bias classifier (`A_GRADE`, `B_GRADE`, `HTF_CONFLICT`) |
| `worker/src/notify.ts` | Priority-tiered Telegram dispatcher (loud pinned entries + silent watch cards + private DM push) |
| `worker/src/provider.ts` | Market data provider with automatic failover (Twelve Data $\to$ Yahoo Finance $\to$ Dukascopy) |
| `worker/src/store.ts` | SQLite / Cloudflare D1 persistence ledger |
| `dashboard/index.html` | Public track record UI with cache buster `?v=8` |
| `dashboard/app.js` | Dashboard client logic with dynamic exact R-multiple calculation |
| `dashboard/terms.html` | High-risk investment disclaimer and Terms of Service for Whop compliance |
| `dashboard/SLK_Radar_Terms_of_Service.pdf` | Printable legal PDF for subscriber onboarding |
| `MARKETING_PLAYBOOK.md` | Full marketing funnels, video scripts, Twitter threads, and launch strategy |

---

## 5. Standard Deployment Commands

When deploying from the repository root:

```bash
# 1. Run local tests & validation
npm test -- --run
npm run typecheck
node --check dashboard/app.js

# 2. Deploy Worker (Backend API)
npm run deploy:worker
# (or: cd worker && npx wrangler deploy)

# 3. Deploy Pages (Frontend Dashboard to Production)
npm run deploy:pages
# (or: npx wrangler pages deploy dashboard --project-name=slk-radar --branch=main)
```

---

## 6. How to Continue Elsewhere

If continuing in a new Arena session, Chrome tab, or local environment:
1. Ensure your git branch is set to `arena/01a0b153-slk-bot`.
2. Run `git pull origin arena/01a0b153-slk-bot` to stay synced with commit `d4e5dcd`.
3. Reference `CONTINUATION_HANDOFF.md` for technical development and `MARKETING_PLAYBOOK.md` for subscriber acquisition and Whop launch copy.
