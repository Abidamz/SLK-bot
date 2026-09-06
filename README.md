# SLK-bot

A forex/indices **alert bot** for the **SLK model — Structure, Liquidity, Key
levels**. It watches markets around the clock, and when price completes your
SLK confirmation sequence it pushes an alert to **Telegram and Discord** —
then tracks every alert to target/stop so you can review the model's hit rate.

```
MT 1D (context) ┐
H4 (map)        ┼─▶ ABC storyline ──▶ armed key level
H1/30m (entry) ─┴─▶ XYZ execution:  MAP → TOUCH → SWEEP → SHIFT → RETEST
                                                          │           │
                                            INVALID/EXPIRED        ALERT ─▶ Telegram + Discord
                                                                            │ (SQLite journal,
                                                                          TP/SL/expiry tracking,
                                                                            🧪 paper mode first)
```

**Status: paper-alert scanner.** Deliberately no trade execution. Rules are
engineering defaults distilled from research into your source material
(see [`docs/SLK_MODEL_SPEC.md`](docs/SLK_MODEL_SPEC.md)) — they are not
creator-issued and no profitability is claimed. Your own chart examples remain
the authority; if a rule here disagrees with how *you* trade SLK, say so and
the engine gets adjusted — every rule is one small pure function.

## The model as implemented

**Layer 1 — ABC storyline (expectation)** — rebuilt point-in-time at every
closed H4, from real candles only:

- H4 **environment** (bullish / bearish / consolidation) from confirmed
  pivot structure, plus **phase** (expansion / pullback / reversal) from the
  most recent BOS, plus **M/W/D/H4 alignment**.
- **Origin key level** on the entry side of price: A-shaped / V-shaped
  line-chart extrema and Open-Close decision-candle zones — with touch counts,
  **flip detection** (decisive close through = flipped, not deleted), and
  **FVG/imbalance overlap** prioritised.
- **Liquidity map**: external pools (prior day/week/month highs+lows, HTF
  swings) and internal pools (H4 structural swings, single-candle "decision"
  pools). **Draw on liquidity** = nearest external pool in the storyline
  direction. Storyline dies if an H4 **close** breaks opposing structure.

**Layer 2 — XYZ execution (confirmation entry)** — replayed statelessly on
every closed entry-timeframe candle; every transition is logged:

| State | Meaning |
|---|---|
| `MAP` | origin level armed on the correct side of price |
| `TOUCH` | price enters the zone |
| `SWEEP` | counter-side internal liquidity swept inside the zone (wick beyond a resting pool, close back inside) |
| `SHIFT` | entry-TF **BOS** — close beyond the pullback structure; invalidation level freezes at the sweep extreme |
| `RETEST` | price returns to the origin zone after leaving it → **ALERT** |
| `INVALID` | close beyond sweep extreme / key level, or HTF story flip |
| `EXPIRED` | stage deadline hit (touch/sweep/BOS/retest windows) |

**Alert card** carries entry (retest close), stop (sweep extreme + ATR
buffer), **TP1 = nearest internal liquidity**, **TP2 = nearest external
target** (deeper targets flagged anticipatory), the full storyline snapshot,
the sweep→BOS→retest path, whether opposing liquidity still stands, the setup
id, and the explicit invalidation price.

**Tracking**: every alert persists to `data/signals.db` (dedupe by setup id →
the bot *cannot* double-alert, even across restarts), resolves to
**TP_HIT / SL_HIT / EXPIRED** (close-based stops by default — the model's
preferred invalidation style), and `python -m slk_bot stats` summarizes win
rate / average R / per-pair results. `python -m slk_bot events` shows the raw
state-machine audit trail.

## Quick start

```bash
git clone <this repo> && cd SLK-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp config.example.yaml config.yaml   # pairs, timeframes, strategy tuning
cp .env.example .env                 # tokens (see below)
```

Market data works with **zero API keys** (yfinance fallback). Twelve Data is
used automatically when you set `TWELVEDATA_API_KEY`.

```bash
python -m pytest tests/ -q        # 38 tests, incl. a full offline pipeline test
python -m slk_bot test-notify     # delivers a ✅ test message
python -m slk_bot scan-once       # one full scan pass right now
python -m slk_bot run             # ← the actual bot (Ctrl-C to stop)
python -m slk_bot stats           # performance summary ·  --send pushes it
python -m slk_bot events          # recent MAP/TOUCH/SWEEP/... transitions
```

**Paper mode first** (the research's recommendation): with `mode: paper`
(default) every alert is tagged `🧪 PAPER`; review them against your charts,
tune `config.yaml`, and flip to `mode: live` only when the rules earn it. Set
`paper_notify: false` to keep paper alerts log-only.

## Connecting Telegram

1. Message **@BotFather** → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.
2. Send any message to your bot, open
   `https://api.telegram.org/bot<TOKEN>/getUpdates`, copy the `"chat":{"id":...}`
   value into `TELEGRAM_CHAT_ID`.
3. `python -m slk_bot test-notify` should deliver ✅.
   (Channel/group: add the bot as admin and use the `-100…` id.)

## Connecting Discord

1. Channel → **Edit Channel → Integrations → Webhooks → New Webhook** → copy URL.
2. Paste into `DISCORD_WEBHOOK_URL`, then `python -m slk_bot test-notify`.

## Market data

| Provider | Cost | Latency | Notes |
|---|---|---|---|
| **Twelve Data** (recommended) | free key: 8 req/min, 800/day | real-time-ish | `EURUSD`→`EUR/USD`, `XAUUSD`→`XAU/USD` automatically |
| **yfinance** (default) | free, no key | delayed ~minutes | `EURUSD=X` etc.; `XAUUSD` falls back to `GC=F` |

The bot fetches 1h (resampled to 4h) + entry TFs at every cycle and the daily
context once per UTC day — roughly **3 credits/pair/hour** on a 30m/1h stack,
~450/day for 6 pairs: inside the free tier. Adding 15m execution roughly
doubles that — trim `pairs:` or upgrade the plan accordingly. Another broker
feed (OANDA, Polygon, …) plugs in as one `DataProvider` subclass in
`slk_bot/data/` — that is also where a real **spread check** would hook in
(none of the current feeds expose spreads).

All volatility-sensitive thresholds are **ATR-normalized per symbol and
timeframe** from live data — the research explicitly warns against universal
pip/ATR constants across forex and indices, and this codebase follows that.

## Running 24/7

Any always-on box works — small VPS, Raspberry Pi, NAS. Example systemd unit
(`/etc/systemd/system/slk-bot.service`):

```ini
[Unit]
Description=SLK alert bot
After=network-online.target

[Service]
WorkingDirectory=/opt/SLK-bot
ExecStart=/opt/SLK-bot/.venv/bin/python -m slk_bot run
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now slk-bot`, watch with `journalctl -u slk-bot -f`.

## Project layout

```
slk_bot/
├── config.py              # YAML + env configuration
├── models.py              # Candle / Direction / price helpers
├── data/                  # yfinance + Twelve Data providers, closed-candle hygiene
├── slk/                   # ← THE SLK MODEL LIVES HERE
│   ├── features.py        #   pivots, environment, phase, BOS, liquidity pools,
│   │                      #   A/V/OC key levels + flips, FVGs, resampling
│   ├── storyline.py       #   Layer 1: ABC storyline (point-in-time snapshots)
│   └── engine.py          #   Layer 2: XYZ state machine (MAP→…→RETEST→ALERT)
├── notify/                # Telegram + Discord
├── tracking/tracker.py    # SQLite: alerts (full context), event audit log, outcomes
├── bot.py                 # orchestration, cooldowns, outcome tracking, loop
└── __main__.py            # CLI: run / scan-once / stats / events / test-notify
tests/                     # 38 tests — synthetic fixtures verify LOGIC only
docs/SLK_MODEL_SPEC.md     # research → rules specification + provenance
```

---

*Research and engineering tooling, not financial advice. No backtest or
performance statistics are fabricated or claimed anywhere in this project —
paper alerts exist precisely so you can validate the rules yourself first.*
