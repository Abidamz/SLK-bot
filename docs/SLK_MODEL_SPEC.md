# SLK Model Specification (working document)

Distilled from the research handoff (`SLK_CONTINUATION_SUMMARY_LATEST`, Manus
project `slk-price-action-research`, checkpoint 44f99d8c). That research
catalogued the user's Plain Fx SLK playlist (10 lessons), the 4TH MAN
MENTORSHIP playlist (19 lessons), seven individual videos, the MyTradingLand
thread, and the JhayFx top-down note. Four video pages were blocked by an
automated-traffic challenge, so their contents were reviewed via AI-assisted
analysis rather than verbatim transcript — **this limitation stands**.

> **SLK = Structure, Liquidity, Key Levels.** The recurring architecture is
> **"Expectation / ABC storyline first, then Execution / XYZ entry"** — the
> entry is never evaluated until the storyline conditions have passed.

## Layer 1 — ABC expectation / storyline

1. Higher-timeframe environment: **bullish / bearish / consolidation**
   (from HH/HL vs LL/LH pivot sequences; structure stays in every decision).
2. Phase: **expansion/continuation** vs **reversal/pullback**. BOS validates
   storyline direction.
3. Monthly/Weekly/Daily directional alignment; **H4 is the key intraday
   vantage point**; execution refines on H1/M30 (M15 optional; **M1/M3/M5
   disabled by default**).
4. **Origin key level**: A-shaped, V-shaped, or Open-Close (decision candle)
   types; A/V identified with line-chart (close) logic, OC needs full OHLC.
   Levels may **flip** after a decisive close through them — a violated level
   becomes a flipped level rather than being deleted. Historical/tested levels
   count for confluence.
5. **Imbalance / IPA / FVG** zones; high-priority key levels commonly overlap
   an imbalance. The market rebalances old imbalances while attacking liquidity.
6. **Draw on liquidity**, nearest external target, intermediate zones, and
   opposing liquidity. External liquidity = prior day/week/month highs/lows;
   internal = structural or single-candle pools.
7. Cancel the storyline if an HTF **close** invalidates the expected move.

## Layer 2 — XYZ execution (confirmation entry, the only default mode)

    MAP      origin level armed on the correct side of price
    TOUCH    price enters the zone
    SWEEP    counter-side internal liquidity swept inside the zone
             (opposing liquidity must remain standing for reversals)
    SHIFT    entry-timeframe BOS through the pullback structure
    RETEST   return to the V-level / origin  →  ALERT
    INVALID  close beyond sweep extreme / key-level boundary / HTF story flip
    EXPIRED  a stage timed out

- **Entry**: at the retest candle close (finalized OHLC only — the scanner
  never evaluates a forming candle).
- **Stop**: beyond the sweep extreme (+ per-symbol ATR buffer).
- **Targets**: internal liquidity first, then the **nearest external
  liquidity**; anything beyond the nearest external level is *anticipatory*.
- **Invalidation is close-based by default**, per the research.
- **Direct key-level entry** (no sweep/BOS/retest) may exist but stays
  disabled by default.

## Engineering defaults (NOT creator-issued rules)

| Parameter | Default |
|---|---|
| Context | 1D bias with W/M alignment, H4 map |
| Execution | H1 or M30 (M15 optional; sub-M15 off) |
| Entry mode | confirmation only |
| Alerts | paper mode first, one alert per symbol/direction/setup-ID, cooldown |
| Volatility normalization | per-symbol/per-timeframe ATR — **no universal pip or ATR constants across instruments** |

## What the bot persists per alert (auditable record)

provider, canonicalSymbol, map/entry timeframe, candleCloseTime, environment,
phase, htfAlignment, originKeyLevel (+type/bounds/tested/flipped),
imbalanceContext, internal/external liquidity maps, drawOnLiquidity,
nearestExternalTarget, intermediateZones, opposingLiquidityStanding,
cycleStage, entryMode, sweepTime, bosTime, returnTime, invalidation
level+reason, parameterVersion (currently `slk-r2.0`), setupId, alertStatus —
plus a full per-setup **event log** of every state transition.

## Explicitly out of scope (for now)

- No trade execution; no profitability or accuracy has been established.
- No fabricated candles, backtests, hit rates, or testimonials. Synthetic
  fixtures in `tests/` verify the state machine only.
- Spread / data-quality gates are stubbed (providers used don't expose
  spreads) — wire them where marked when a broker feed is added.

## Open user decisions (from the handoff)

Exact instrument list (incl. indices + broker symbol names) · final data
provider & rate limits · preferred timeframe hierarchy confirmation ·
session timezone & DST handling · paper-review period length · whether
direct-entry / QM / Range-Circle / MSNR / engineered-liquidity rules should
ever be enabled.

## References

- Plain Fx SLK playlist — https://www.youtube.com/playlist?list=PLjbd_lkDytnQ656fQVd93-7TLCwX_FN04
- 4TH MAN MENTORSHIP FULL — https://www.youtube.com/playlist?list=PLluTOcq9uKInvlN00dKr1fcnVrOoa13FU
- SLK Strategy thread — https://www.mytradingland.com/thread/slk-strategy-c24584/1
- Top-Down Analysis Using SLK (JhayFx) — https://jhayfx.substack.com/p/top-down-analysis-using-slk-strategy
- X: @The_4thMan, @Kelvinking_
