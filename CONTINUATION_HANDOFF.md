# SLK-bot Continuation Handoff

Updated: 2026-09-17 (UTC)

## Repository and branch

- Repository: `Abidamz/SLK-bot` — https://github.com/Abidamz/SLK-bot
- Arena session branch: `arena/01a0b153-slk-bot`. Do not switch branches.
- Starting commit: `d4927f0a9b7ecfe195d28b6f31f8a747fa1a6375`
  (`Add behavior-neutral scan lifecycle and rejection diagnostics`).

## Production safety — active settings

```text
MODE=paper
WATCH_NOTIFY=true
PAPER_NOTIFY=true
MIN_RISK_ATR=0.8
MIN_TP_R=2.5
SL_BUFFER_ATR=0.25
PAIR_BATCH_SIZE=2
MT5/live broker execution disabled
```

The tracked Worker config runs paper execution mode safely within Cloudflare Free CPU limits (~2ms per tick via `PAIR_BATCH_SIZE=2`).
Stops are evaluated touch-based (`slOnClose: false`), eliminating false TP_HIT reports when wicks hit stops.
Stops feature institutional floors (`minStopDistance`: 25 pts GER40, 30 pts US30, 25 pts NAS100, 50 pts JAPAN225, $2.50 Gold, 10 pips forex).
The 15m entry timeframe is resampled from base feed without extra network calls.
Watchlist: `EURUSD,GBPUSD,USDJPY,AUDJPY,GBPJPY,XAUUSD,NAS100,US30,GER40,JAPAN225`.
Never expose or commit secrets. Synthetic tests use fake keys only.

## Implemented: Video-Aligned Directional Bias Shadow Classification

- `worker/src/shadow.ts`: typed directional bias diagnostic components:
  1. **Weekly liquidity context**: Weekly candle aggregation (Monday-Sunday UTC calendar bounds), weekly high/low sweeps, opposing liquidity standing checks, primary opposing-liquidity targets.
  2. **Daily context**: Daily body-to-body breakouts (bullish, bearish, neutral/inside), daily liquidity sweep + structure break detection, incomplete/missing daily context flags.
  3. **4H vantage-point direction**: 4H structural direction (bullish, bearish, neutral), swing break/breakout status.
  4. **1H execution-context alignment**: 1H directional bias, agreement evaluation with 4H structural direction.
  5. **Lower-timeframe entry quality**: Sweep verification, BOS / structure shift verification, FVG (fair value gap) detection between sweep and retest, FVG rebalance verification (entry candle wick/body filling into the imbalance), retest verification.
  6. **Classification categories**:
     - `A_GRADE`: Aligned 4H vantage and 1H execution context, consistent daily/weekly context, full entry quality (sweep, BOS, FVG rebalance, retest).
     - `B_GRADE`: Aligned HTF context but missing FVG rebalance or secondary context imperfection.
     - `HTF_CONFLICT`: 1H execution context conflicts with 4H vantage direction, or daily/weekly direction actively opposes the setup.
     - `OBSERVATION_ONLY`: Missing HTF context, neutral execution context, or incomplete/failed entry confirmation sequence.
- **Engine integration** (`worker/src/engine.ts`):
  - `buildAlert` evaluates directional bias diagnostics on confirmation entries and attaches `shadowClassification` and `directionalBias` to the generated alert object.
  - Returns `shadowDiagnostics` array in `scanEntry` output.
  - Zero disruption to alert decisions, deduplication, notifications, outcomes, or risk evaluation.
- **Orchestration & Structured Logging** (`worker/src/index.ts`):
  - Emits structured `slk.shadow.classification` JSON logs for confirmed entries containing weekly, daily, 4H, 1H, and entry-quality diagnostic snapshots.
- **Deterministic Test Suite** (`worker/test/shadow.test.ts`):
  - Aligned 1H/4H bearish setup diagnosed as `A_GRADE`.
  - Aligned 1H/4H bullish setup diagnosed as `A_GRADE`.
  - 1H/4H conflict diagnosed as `HTF_CONFLICT`.
  - Neutral 1H diagnosed as `OBSERVATION_ONLY`.
  - Missing weekly or daily context diagnosed as `OBSERVATION_ONLY`.
  - Valid sweep plus FVG rebalance diagnosed as `A_GRADE`.
  - Sweep without rebalance diagnosed as `B_GRADE`.
  - 1H entry timeframe role evaluation (4H structural, 1H execution confirmation).
  - Existing alert output unchanged (exact baseline parity preserving identical alert IDs, R:R, stops, entries, and event replay determinism).

## Validation

- Full Worker vitest suite: **95 tests passed** (all 8 test files).
- Worker `npm run typecheck`: clean pass (`tsc --noEmit`).
- Dashboard check: `node --check dashboard/app.js` passed.
- Replay determinism and alert parity verified across all setups.

## Deployment status and next steps

**NOT deployed.** Ready for review on branch `arena/01a0b153-slk-bot`.
Validation commands:
```bash
npm test -- --run
npm run typecheck
node --check dashboard/app.js
```
