# SLK-bot

A forex **notification bot** for the **SLK model**. It watches FX pairs around
the clock, detects SLK-model setups on candle close, and pushes alerts to
**Telegram and Discord** — then tracks every signal to its TP/SL outcome so you
can see the model's hit rate.

```
EURUSD 15m  ─┐                                                      
GBPUSD 15m  ─┤   ┌────────────┐   sweep -> MSS -> entry   ┌───────────┐
USDJPY  1h  ─┼──▶│  SLK engine │ ────────────────────────▶ │ Telegram  │
XAUUSD  1h  ─┤   └────────────┘                            ├───────────┤
              │        │ signals persisted + tracked       │ Discord   │
   yfinance / │        ▼                                    └───────────┘
  Twelve Data │   SQLite (data/signals.db)  ──▶  python -m slk_bot stats
```

## The SLK setup it detects

The engine in [`slk_bot/strategy/slk.py`](slk_bot/strategy/slk.py) implements
the ICT/SMC-style interpretation of the model:

1. **Liquidity sweep** — price wicks beyond a confirmed swing high/low
   (raiding the stops resting there) but *closes back inside*.
2. **Market structure shift (CHoCH)** — within `mss_window` candles, price
   *closes* beyond the internal structure point (pullback low for shorts /
   pullback high for longs).
3. **Entry** at the MSS candle close. **Stop** beyond the sweep extreme
   (plus a small ATR buffer). **Target** at `rr_target` × risk (default 2R),
   or the opposing liquidity pool with `tp_mode: liquidity`.
4. **Killzone filter** — alerts only fire when the trigger candle closes
   inside a configured session window (default: London 07:00–10:00 and
   New York 12:00–15:00 UTC).

> **Your rules may differ.** `slk.py` is deliberately small and self-contained
> (the rest of the bot — data, alerts, tracking — is strategy-agnostic).
> Adjust the numbers in `config.yaml`, or ask for the detection code to be
> changed to match your exact SLK criteria.

## Quick start

```bash
git clone <this repo> && cd SLK-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp config.example.yaml config.yaml   # pairs, timeframes, strategy tuning
cp .env.example .env                 # tokens (see below)
```

Notify plumbing works out of the box with **zero API keys** for market data
(yfinance fallback). For production data, set `TWELVEDATA_API_KEY`.

Test the whole pipeline without waiting for a live setup:

```bash
python -m pytest tests/ -q                        # 20 unit/integration tests
python -m slk_bot test-notify                     # sends a test message
python -m slk_bot scan-once --ignore-session --fresh-window 6
python -m slk_bot run                             # ← the actual bot (Ctrl-C to stop)
python -m slk_bot stats                           # performance summary
python -m slk_bot stats --send                    # push stats to Telegram/Discord
```

## Connecting Telegram

1. In Telegram, message **@BotFather** → `/newbot` → copy the bot token into
   `TELEGRAM_BOT_TOKEN`.
2. Send **any message** to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the
   `"chat": {"id": ...}` value into `TELEGRAM_CHAT_ID`.
3. `python -m slk_bot test-notify` should deliver a ✅ message.

(For a channel/group: add the bot as admin and use the channel id, e.g.
`-100xxxxxxxxxx`.)

## Connecting Discord

1. Server channel → **Edit Channel → Integrations → Webhooks → New Webhook** →
   Copy Webhook URL.
2. Paste it into `DISCORD_WEBHOOK_URL`, then `python -m slk_bot test-notify`.

## Market data

| Provider    | Cost | Latency | Notes |
|-------------|------|---------|-------|
| **Twelve Data** (recommended) | free key, 8 req/min, 800/day | real-time-ish | set `TWELVEDATA_API_KEY`; symbols map automatically (`EURUSD`→`EUR/USD`, `XAUUSD`→`XAU/USD`) |
| **yfinance** (default) | free, no key | delayed ~minutes | Yahoo tickers `EURUSD=X` etc.; `XAUUSD` falls back to `GC=F` if needed |

With 6 pairs on 15m+1h the bot makes ~30 requests/hour (scheduled at candle
close), comfortably inside the Twelve Data free tier.

A different forex/CFD source (OANDA, Polygon, your broker, …) plugs in by
subclassing `DataProvider` in `slk_bot/data/` — one method.

## How signals are tracked

Every alert is stored in `data/signals.db` with a unique key
(pair + timeframe + direction + trigger candle), so the bot never sends the
same setup twice, even across restarts. While a signal is open, each scan
checks the newest candles against its SL/TP:

- **TP HIT** / **SL HIT** — resolved, and (optionally) a follow-up message is
  sent with the R-multiple result. If one candle touches both, SL wins
  (conservative).
- **EXPIRED** — after `expire_candles` bars with no resolution (default 96 =
  24h of 15m), closed at market.

`python -m slk_bot stats` reports per-pair counts, win rate (TP vs SL) and
average R.

## Running 24/7

Any always-on box works — a $5 VPS, a Raspberry Pi, a NAS. Example systemd
unit (`/etc/systemd/system/slk-bot.service`):

```ini
[Unit]
Description=SLK forex notification bot
After=network-online.target

[Service]
WorkingDirectory=/opt/SLK-bot
ExecStart=/opt/SLK-bot/.venv/bin/python -m slk_bot run
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then: `sudo systemctl enable --now slk-bot` and watch with
`journalctl -u slk-bot -f`.

## Config reference

See [`config.example.yaml`](config.example.yaml) — every option is commented.
Secrets belong in `.env` (never committed); both `config.yaml` and `.env` are
git-ignored.

## Project layout

```
slk_bot/
├── config.py            # YAML + env configuration
├── models.py            # Candle / Signal / Direction types
├── data/                # yfinance + Twelve Data providers
├── strategy/slk.py      # ← THE SLK MODEL LIVES HERE
├── notify/              # Telegram + Discord channels
├── tracking/tracker.py  # SQLite journal + TP/SL outcome engine
├── bot.py               # orchestration / main loop
└── __main__.py          # CLI: run / scan-once / stats / test-notify
tests/                   # 20 tests, incl. a full no-network pipeline test
```

---

*This bot sends notifications only; it does not execute trades. Nothing here
is financial advice — past signal performance does not guarantee future
results.*
