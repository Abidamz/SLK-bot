# Separate Deriv CFD historical replay

This is a **research-only** path for the ten synthetic symbols already shown on the watchlist: `V75`, `V100`, `V50`, `V25`, `V10`, `V75_1S`, `V100_1S`, `V50_1S`, `V25_1S`, and `V10_1S`. It does not add Deriv to production pairs, change routing, or alter live behavior.

## Run it in the full-egress Codespace

The sandbox used for code changes cannot reach Deriv. Run the historical download from the project Codespace, where outbound access is available:

```sh
cd /workspaces/SLK-bot/worker
npm ci
npm run typecheck
npm test
npm run backtest:deriv -- 360
```

The 360-day scan uses the configured synthetic entry timeframes (`30m,1h` in the current production configuration). The final 120 days are held out; the first 240 days are the development period. Development trades that are still open or resolve at/after the boundary are purged, so their held-out price path cannot affect development results. The report shows per-symbol and combined development/holdout results without choosing pairs based on the holdout. Minute history includes an additional ten-day warm-up, and daily candles are loaded separately for higher-timeframe context. The script defaults to all ten symbols; an uppercase comma-separated Deriv pair list can be supplied before the day count to run a smaller diagnostic sample.

The downloader tries Deriv's public market-data WebSocket first, then the V3 history hosts, with and without the public endpoint's documented Origin. It uses bounded pages, exponential backoff, ordering/deduplication checks, and includes Cloudflare request IDs in handshake errors so endpoint failures can be diagnosed. It stops rather than silently emitting a zero-trade report if the requested minute or daily context is absent or too short. The report records expected/received bars and gaps for every downloaded timeframe. A candle-gap count is a data-quality warning, not proof that a market was untradeable.

## Costs and interpretation

Deriv's historical OHLC candles do not include a time-varying bid/ask spread. Without verified Deriv CFD quotes, read the gross replay as the price-only result—not as verified net performance. The report's normalized sensitivity table subtracts a set per-side spread as a fraction of each trade's initial stop distance (0%, 0.5%, 1%, 2.5%, or 5% per side). These are transparent scenarios, not claims about Deriv's actual spreads. Commission, financing/swap, slippage, and spread changes are not modeled.

If verified per-symbol quoted-spread values are available, set `BACKTEST_DERIV_SPREADS` in the Codespace environment using comma-separated `PAIR=priceUnits` entries before running. Such values produce a **fixed-spread estimate**, not historical spread-adjusted results. Any symbols without a supplied value are charged zero in that secondary table and explicitly marked as incomplete; do not call it net performance.

The replay applies the production pair-specific Deriv strategy (including the current 0.25 ATR stop buffer unless `SL_BUFFER_ATR` is supplied), keeps the production 240-minute delivery cooldown and cross-timeframe same-level dedupe on by default, and excludes unique `HTF_CONFLICT` alerts from the tradable Deriv book, matching the current Deriv delivery gate. The report shows how many were excluded. Entry levels, fills, and trade outcomes are still an offline OHLC replay, not a Deriv account execution record.

## Files

- `.backtest-cache/`: downloaded minute/daily candles for repeat runs.
- `backtest-report-YYYY-MM-DD-deriv.md`: per-symbol and combined replay, holdout analysis, candle coverage, gate counts, and cost caveats/sensitivity.

The cache and generated reports are local research artifacts and are not intended for Git.
