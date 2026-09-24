# SLK Radar VIP — Telegram Welcome & Trade Execution Guide

> **Instructions for Channel Admins:**  
> Copy and paste this message into your **VIP Telegram Channel**, pin it to the top (`Pin Message`), and set it as the automated welcome message sent by `@whop_bot` when new members join.

---

```text
👑 WELCOME TO SLK RADAR VIP EXECUTION DESK 👑

Welcome to the institutional trading room. 

SLK Radar operates on pure algorithmic orderflow mechanics — the proprietary SLK Model (Structure · Liquidity · Key Levels). Our cloud engine monitors 10 high-volatility markets 24/7, filtering out 90% of retail chop and delivering ONLY high-probability, asymmetric setups.

Please read this execution protocol carefully before placing your first trade.

──────────────────────────────────────────────
📌 1. THE GOLDEN RISK RULES (PROP FIRM COMPLIANT)
──────────────────────────────────────────────
Every signal we issue enforces a strict minimum 1:2.5R to 1:4.0R reward asymmetry. Because of this math, you DO NOT need an 80% win rate to compound capital.

• Recommended Risk: 0.5% to 1.0% of your account per trade.
  - Passing FTMO / Prop Firms: Risk 0.5% per trade.
  - Personal Accounts: Risk 0.5% – 1.0% per trade.
• Never risk more than 1.0% on any single setup.
• Never revenge trade or manually alter the pre-calculated Stop Loss.

──────────────────────────────────────────────
🚨 2. HOW TO READ TRADE ALERTS
──────────────────────────────────────────────
When a confirmed setup fires, you will receive an alert formatted like this:

🚨 [ACTION REQUIRED] ENTRY SIGNAL
PAIR: XAUUSD (Gold)
TIMEFRAME: 30m
DIRECTION: SHORT 🔴
ENTRY: 4331.370
STOP LOSS: 4344.364 (13.0 pips / pts)
TP1 TARGET: 4297.933 (+2.57R)
TP2 (RUNNER): 4260.000 (External Liquidity)
BIAS GRADE: A_GRADE (Aligned 4H/1H Vantage)

How to execute:
1. Open your MT4/MT5/cTrader or Broker App immediately.
2. Calculate your lot size based on the Stop Loss distance (never guess).
3. Place your entry (Market execution if within 3-5 pips of Entry, or Limit Order at Entry Price).
4. Set your Stop Loss and TP1 exactly as stated.

──────────────────────────────────────────────
🎯 3. TRADE MANAGEMENT PROTOCOL (LOCK + RUNNER)
──────────────────────────────────────────────
To protect capital and maximize high-RR trend days, follow our 3-step exit model:

1. When Price Hits TP1 (+2.5R to +3.0R):
   ✅ Secure 70% to 80% of your position size.
   ✅ Move Stop Loss to Entry Price (BREAKEVEN). The trade is now 100% risk-free!

2. Managing the Runner (TP2):
   🚀 Let the remaining 20% to 30% position run toward TP2.
   🚀 Trail your stop behind subsequent 15m/1H swing highs/lows.

3. If Invalidation Occurs Before Entry:
   ⚠️ If price breaks the invalidation level before tapping entry, DO NOT ENTER. The setup is expired.

──────────────────────────────────────────────
🧭 4. WATCH & DIRECTIONAL BIAS ALERTS
──────────────────────────────────────────────
Throughout the day, you will also see background WATCH cards:
• These are heads-up notifications showing that higher-timeframe liquidity has been swept and an origin zone is armed.
• WATCH alerts are NOT triggers to enter market orders yet.
• They prepare you for the confirmed entry signal that follows!

──────────────────────────────────────────────
📊 5. TRANSPARENCY & VERIFIED TRACK RECORD
──────────────────────────────────────────────
Unlike retail signal channels that hide losses, every alert, stop loss, and target hit is permanently logged in real time on our public ledger:

🌐 Live Performance Journal: https://slk-radar.pages.dev
📜 Terms of Service & Disclaimer: https://slk-radar.pages.dev/terms
👑 Manage Subscription / Whop: https://whop.com/hub

Turn on notifications for this channel and PIN this chat to the top of your Telegram.

Let the algorithm do the heavy lifting. Trade with edge.
```

---

## Channel Welcome Setup in Whop Bot

When configuring `@whop_bot` inside your private VIP Telegram:

1. Add `@whop_bot` as an **Administrator** in your Telegram Channel with permission to invite users.
2. In your Whop Dashboard under **Products $\to$ SLK Radar VIP $\to$ Experience $\to$ Telegram**:
   - Enable **"Direct Message Welcome"** or **"Send Welcome Message upon joining"**.
   - Paste the block above into the automated welcome sequence.
3. Keep this message permanently pinned to the chat header so members can refer back to the lot sizing and breakeven rules at any time.
