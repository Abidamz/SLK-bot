# SLK Alert Worker (Cloudflare-native)

Cloudflare Worker port of the SLK price-action alert bot. It runs the full
ABC-storyline → XYZ-execution state machine on a 1-minute Cron Trigger,
confirms signals on **closed candles only**, and delivers paper alerts to
Telegram and Discord. State lives in D1. **Research tool — it never places
trades and never will.**

## Architecture

```
Twelve Data (REST) ──► Cron */1 * * * * ──► scanAll()
                                                │  per pair × entry TF
                                                ▼
                              D1 (slk_alerts / slk_events / slk_kv / slk_scan_log)
                                                │  deterministic setupId,
                                                │  INSERT OR IGNORE dedupe
                                                ▼
                            Telegram Bot API  +  Discord incoming webhook
                          (outbound only — no inbound webhooks required)
```

- **Engine** (`src/features.ts`, `src/storyline.ts`, `src/engine.ts`,
  `src/outcomes.ts`): dependency-free port of the Python v2 engine
  (`slk_bot/slk/`). Same state machine: `MAP → TOUCH → SWEEP → SHIFT →
  RETEST`, close-based invalidation, V-level flips, internal-then-external
  targets, per-pair ATR-derived tolerances (no universal pip constants).
- **Providers** (`src/provider.ts`): Twelve Data `time_series` REST for
  forex/metals; for index CFDs the default is the **Dukascopy public feed**
  (`jetta.dukascopy.com` — keyless, realtime broker quotes from the Swiss
  bank; `US30→USA30.IDX-USD`, `GER40→DEU.IDX-EUR`, `JAPAN225→JPN.IDX-JPY`),
  with **OANDA practice v3 REST** taking precedence when `OANDA_API_TOKEN`
  exists and **Yahoo Finance** (unofficial) as last resort. Routing is
  automatic by canonical name; override per pair via the `PROVIDER_MAP` JSON
  var. The Dukascopy wire format is columnar cumulative deltas over
  UTC-bucketed files (minute→day files, hour→month files, day→year files);
  closed files are immutable and cached in `slk_kv`, so a steady-state tick
  costs ~2 requests per index pair. Gap periods are decoded as gaps — no
  fabricated flat candles. (Yahoo alerted fine in tests, but its free index
  feed lags broker quotes by minutes — keep it as escape hatch only, e.g.
  `PROVIDER_MAP={"US30":"yahoo"}`.)
- **Data quality** (`validateAndClose`):
  1d context feed is cached in `slk_kv` per UTC day (rate-limit friendly);
  1h is resampled to the 4h map feed; entry timeframes are fetched directly.
  All feeds pass data-quality gates: ascending + finite + coherent OHLC,
  freshness (≤3×TF open-age; ≤48h for d1), minimum history, and the
  trailing **unfinished candle is dropped** (final-candle gate).
- **Scheduling** (`src/index.ts`): each cron tick scans only TFs whose
  candle boundary crossed since the last tick (`slk_kv:last_boundary:{tf}`),
  so the 1-minute cron does exactly one evaluation per candle close.
  `POST /scan-now` (admin) forces a scan.
- **Persistence** (`src/store.ts`): `Store` interface → `D1Store` in
  production / `MemStore` in tests. Dedupe is structural: `UNIQUE(setup_id)`
  on alerts + `UNIQUE(setup_id, state, candle_time)` on events, both via
  `INSERT OR IGNORE`. The alert row is written **before** any notification,
  so a worker retry can never double-send.
- **Boot gate**: the first-ever scan per pair+TF records transitions but
- **Watch heads-ups** (`WATCH_NOTIFY=true` in `wrangler.jsonc` vars): an
  optional 👀 message when a setup TOUCHes its zone, SWEEPs liquidity, or
  SHIFTs structure — hours before the confirmed retest close would alert.
  Same dedupe (UNIQUE events) and boot gate as entry alerts; default off.
  delivers nothing (mirrors the Python `alert_on_boot=false`).

## Setup IDs

`{provider}:{pair}:{entryTf}:{direction}:{keyKind}:{originPrice}:{originTimeISO}`

e.g. `twelvedata:EURUSD:30m:SHORT:V:104.200000:2024-03-02T00:00:00.000Z`

Readable and deterministic: the same chart history always yields the same
ID, and re-scans/replays/restarts collide harmlessly in D1. (Deviation from
the Manus Cloudflare summary, which sketched a sweep-close-anchored ID; the
arm-time origin anchor is used because it is known at MAP time, before the
sweep exists.)

## Deploy

Prereqs: Cloudflare account, `node ≥ 20`, a Telegram bot token + chat id, a
Discord incoming webhook URL, a Twelve Data API key.

```bash
cd worker
npm install                 # installs wrangler too

# 1. authenticate
npx wrangler login

# 2. create the database and put its id into wrangler.jsonc
npx wrangler d1 create slk-alert-db
#    → copy the printed database_id into wrangler.jsonc
#      (d1_databases[0].database_id, replacing REPLACE_WITH_YOUR_D1_ID)

# 3. apply the schema
npx wrangler d1 migrations apply slk-alert-db --remote

# 4. set secrets (never commit these; they live only in the Worker's
#    secret store)
npx wrangler secret put TWELVEDATA_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID     # e.g. @userinfobot
npx wrangler secret put DISCORD_WEBHOOK_URL  # channel → integrations → webhooks
npx wrangler secret put ADMIN_KEY            # any long random string

# 5. deploy
npx wrangler deploy
```

## Configure

Plain vars in `wrangler.jsonc` (safe to edit + commit):

| var | default | meaning |
| --- | --- | --- |
| `PAIRS` | `EURUSD,GBPUSD,XAUUSD` | canonical pairs (canonical/symbol mapping via `SYMBOL_MAP` JSON var if your provider wants `EUR/USD`-style symbols) |
| `ENTRY_TFS` | `30m,1h` | entry timeframes scanned (`loadConfig` drops `1d` entries and warns on <15m) |
| `MODE` | `paper` | `paper` first; `live` only changes the alert badge |
| `PAPER_NOTIFY` | `true` | paper alerts still send notifications (that's the point) |
| `SYMBOL_MAP` | unset | optional JSON like `{"EURUSD":"EUR/USD"}` |

## Endpoints

| route | auth | purpose |
| --- | --- | --- |
| `GET /health` | open | liveness + config echo (no secrets) |
| `GET /alerts?limit=50` | `Authorization: Bearer $ADMIN_KEY` | recent alerts from D1 |
| `GET /stats` | admin key | outcome summary (TP/SL/expiry counts + mean R) |
| `POST /test-notify` | admin key | sends one message per configured channel |
| `POST /scan-now` | admin key | force a scan cycle immediately |
| `POST /provider-webhook` | HMAC if `PROVIDER_WEBHOOK_SECRET` set | scaffold for a future signed provider push (501 otherwise) |

## Validation runbook (do this before trusting notifications)

All of these except the first are covered by `npm test` (see
`test/scheduled.test.ts`); the local-dev commands exercise them against the
real Worker runtime:

1. `npx wrangler dev` then `curl http://localhost:8787/health` → 200 JSON.
2. `curl -X POST -H "Authorization: Bearer $ADMIN_KEY" http://localhost:8787/test-notify`
   → one message lands in Telegram and one in Discord.
3. Trigger a local cron tick:
   `curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"` → check logs.
4. Re-run the same tick with unchanged market data → **no duplicate**
   message (D1 dedupe), alert count does not grow.
5. A candle that hasn't closed yet must produce no alert (final-candle gate —
   covered by the "unfinished confirmation candle" test).
6. Provider outage → error in logs + `slk_scan_log` row, zero alerts, no
   partial state (`provider outage` test).
7. Restart the dev process and scan again → scan-state survives in D1
   (`last_boundary:*`, open alerts) — no replay spam.
8. Deterministic replay: same fixture data yields the same setup IDs
   (`engine.test.ts` "deterministic across replays").

Paper metrics on `/stats` are computed from alert outcomes for research
context. They are **not** audited performance; per the model spec, hit rates
are never fabricated.

## Tests

```bash
npm test         # vitest: engine parity, features, store, e2e cron cycle
npm run typecheck
```

25 tests covering: engine parity with the Python fixture bank
(SHORT/LONG full state machine, invalidation, determinism), feature
building blocks, store dedupe/cooldown/outcomes, and four end-to-end
cron-cycle scenarios (boot gate, delivery + replay dedupe, unfinished-candle
gate, provider-outage safe failure).

## Operations card (live deployment)

Production instance — deployed 2026-09-05:

- **Worker:** https://slk-alert-worker.abidogundamilola.workers.dev
- **D1:** `slk-alert-db` (`48ad2f08-d27d-4491-ad6c-13ad741b9ae3`, WEUR)
- **Cron:** `*/1 * * * *` (UTC) · **Channels:** Telegram → "Trade jounal" channel
  (Discord activates when `DISCORD_WEBHOOK_URL` is set via `wrangler secret put`)

Routine:

```bash
# liveness (open)
curl https://slk-alert-worker.abidogundamilola.workers.dev/health

# alert history / paper stats (Bearer ADMIN_KEY)
curl -H "Authorization: Bearer $ADMIN_KEY" https://slk-alert-worker.abidogundamilola.workers.dev/alerts
curl -H "Authorization: Bearer $ADMIN_KEY" https://slk-alert-worker.abidogundamilola.workers.dev/stats

# live logs and a manual channel test
npx wrangler tail
curl -X POST -H "Authorization: Bearer $ADMIN_KEY" https://slk-alert-worker.abidogundamilola.workers.dev/test-notify
```

Changes:

- **Rotate any credential:** `npx wrangler secret put <NAME>` (needs the env vars
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, or `wrangler login`).
  Dashboard alternative: Workers & Pages → slk-alert-worker → Settings →
  Variables and Secrets.
- **Pause scanning:** set `"crons": []` in `wrangler.jsonc` and
  `npx wrangler deploy`; re-add to resume.
- **Change pairs/timeframes:** edit `PAIRS` / `ENTRY_TFS` in `wrangler.jsonc`,
  then `npx wrangler deploy`. The worker fetches ONE feed per pair (smallest
  entry TF) and derives 1h/4h by resampling, so each pair costs ~1 Twelve
  Data credit per scan boundary — free tier (8/min) fits ~7 pairs.

## Notes & limitations

- Cron granularity is 1 minute with UTC semantics; "real-time" means
  *alerted right after the confirmation candle closes*, not intrabar.
- M1/M3/M5 are intentionally not scanned by default; enable by setting
  `ENTRY_TFS` — `loadConfig` accepts them but logs a warning.
- Cron changes take a few minutes to propagate after `wrangler deploy`.
- The static research dashboard stays a separate, secret-free frontend; only
  this Worker ever sees API keys or channel credentials.
