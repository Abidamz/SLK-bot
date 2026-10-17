# DEO Edge VIP — Telegram Welcome & Trade Execution Guide

> **Instructions for Channel Admins:**  
> Copy and paste this message into your **VIP Telegram Channel**, pin it to the top (`Pin Message`), and set it as the automated welcome message sent by `@whop_bot` when new members join.
> **Account-name note:** This copy change does not rename the Telegram bot, channel, group, or public username. An account owner/admin must change those in Telegram; existing handles and links are intentionally preserved here.

---

```text
👑 WELCOME TO DEO EDGE VIP 👑

Welcome to the institutional trading room. 

DEO Edge uses the SLK method (Structure · Liquidity · Key Levels) for paper-research alerts. Production alerts cover all ten supported Deriv indices, but no orders are placed; Deriv's required 360-day historical replay remains unvalidated.

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
🚨 2. HOW TO READ TRADE ALERTS (VIP CLEAN FEED)
──────────────────────────────────────────────
Your VIP channel is a zero-noise, high-conviction execution feed. You will ONLY receive alerts when a confirmed entry candle closes:

All configured free Telegram channels also receive a short DEO Edge confirmed-signal notice, with its market family labeled. It omits entry, stop, target, and invalidation prices and is not an instruction to place an order; the full confirmed-entry card remains VIP-only.

🚨🚨🚨 [ACTION REQUIRED] — DEO EDGE CONFIRMED ENTRY
PAIR: XAUUSD (Gold)
TIMEFRAME: 30m
DIRECTION: SHORT 🔴
ENTRY: 4331.370
STOP LOSS: 4344.364 (13.0 pips / pts)
TP1 TARGET: 4297.933 (+2.57R)
TP2 (RUNNER): 4260.000 (External Liquidity)
BIAS GRADE: A_GRADE (Aligned 4H/1H Vantage)

How to execute:
1. Open your MT4/MT5/cTrader or Broker App immediately upon alert.
2. Calculate your lot size based on the Stop Loss distance (never guess).
3. Place your entry (Market execution if within 3-5 pips of Entry, or Limit Order at Entry Price).
4. Set your Stop Loss and TP1 exactly as stated.

──────────────────────────────────────────────
🎯 3. TRADE MANAGEMENT PROTOCOL (LOCK + RUNNER)
──────────────────────────────────────────────
To protect capital and maximize high-RR trend days, follow our 3-step exit model:

1. When Price Hits TP1 (+2.5R to +3.5R):
   ✅ Secure 70% to 80% of your position size.
   ✅ Move Stop Loss to Entry Price (BREAKEVEN). The trade is now 100% risk-free!

2. Managing the Runner (TP2):
   🚀 Let the remaining 20% to 30% position run toward TP2.
   🚀 Trail your stop behind subsequent swing highs/lows.

3. Invalidation Before Retest:
   ⚠️ If a candle closes beyond the stated invalidation level before reaching entry, the setup is expired. Do not enter.

──────────────────────────────────────────────
📊 4. TRANSPARENCY & VERIFIED TRACK RECORD
──────────────────────────────────────────────
Unlike retail signal channels that hide losses, every single alert, stop loss, and target hit is permanently logged in real time on our public ledger:

🌐 Live Audited Performance Journal: https://deoedge.pages.dev
📜 Terms of Service & Disclaimer: https://deoedge.pages.dev/terms
👑 Manage Subscription via Whop: https://whop.com/hub

Turn on notifications for this channel and PIN this chat to the top of your Telegram.

Let the algorithm do the heavy lifting. Trade with edge.
```

---

## Rename Telegram Display Names (one-time owner/admin task)

The updated message copy does not change Telegram account settings:

- **Bot display name:** In `@BotFather`, open `/mybots`, select the existing bot, choose **Edit Bot → Edit Name**, and set the display name to **DEO Edge**.
- **Channel/group title:** An owner or admin opens the channel/group information, chooses **Edit**, and updates its title to a DEO Edge name.
- **Usernames and links:** These remain unchanged. Only rename a public username if the owner chooses a new available handle, then update any links that point to it.

## Channel Welcome Setup in Whop Bot

When configuring `@whop_bot` inside your private VIP Telegram:

1. Add `@whop_bot` as an **Administrator** in your Telegram Channel with permission to invite users.
2. In your Whop Dashboard, open the DEO Edge membership product (the listing may still show its previous TAYO name) and choose **Experience $\to$ Telegram**:
   - Enable **"Direct Message Welcome"** or **"Send Welcome Message upon joining"**.
   - Paste the block above into the automated welcome sequence.
3. Keep this message permanently pinned to the chat header so members can refer back to the lot sizing and breakeven rules at any time.
