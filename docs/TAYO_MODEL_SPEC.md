# SLK Method Specification for DEO Edge (working document)

Distilled from the research handoff (`TAYO_CONTINUATION_SUMMARY_LATEST`, Manus
project `slk-price-action-research`, checkpoint 44f99d8c). That research
catalogued the user's Plain Fx TAYO playlist (10 lessons), the 4TH MAN
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
   vantage point**. **Execution is on the 2H** — one timeframe below the 4H
   breakout — per `VfABZXNFaNI`. This line previously read "execution refines
   on H1/M30 (M15 optional)", which contradicts the source; M1/M3/M5 stay
   disabled. Production `ENTRY_TFS` is still `15m,30m,1h`, three timeframes
   below where the methodology enters.
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

## The ABC chain, in full (`VfABZXNFaNI`)

**ABC is bias. XYZ is entries.** A is invariant across every route: *a break of
structure or a breakout* — "you want to see this break structure to validate the
direction of the market, it must be there."

At each timeframe, **A is what proves that timeframe is aligned with the one
above it.** The chain recurses: monthly A → B → C, drop to weekly, weekly A →
B → C, drop to daily, daily A → B → C, drop to 4H and look for entries.

**Three bias routes, and A never changes between them:**

1. **Key level** — B marks the key levels; C is price retracing to *one of
   those marked levels* and rejecting.
2. **Liquidity** — B is a prior-period low/high presented by the break. Price
   **attacks the liquidity and rejects without tapping a key level at all.**
   His words: "price is not going to tap a key level... it is simply going to
   attack liquidity." Justification: "price only seeks to do two things
   majorly — attack liquidity and balance imbalance."
3. **Liquidity and key level** — the sweep comes first and the lower timeframe
   shows **no confirmation, so you wait.** Price keeps running, taps a key
   level, rejects, and only then does the lower-timeframe break appear. "If
   weekly is not in alignment, you don't have any trade."

C is a rejection at **the specific level marked at B**, never at any level
within reach. This is the same defect the bias-gate experiment measured: with
~100 levels on the board, "is some level between this candle's low and its
close" is true by construction, which is why it fired on 100% of ticks.

**A tap that caused the higher-timeframe break does not count.** In the worked
example the 4H price action that produced the daily breakout is explicitly
discarded — "we don't count it because it was what led to the breakout." The
entry-relevant tap is one that happens *after* that breakout closed.

**Levels retire once broken through.** After a weekly breakout, the levels
below it "no longer have my attention."

**If it is not there, there is no trade.** "Even if the trade wants to leave,
no problem. Let it go." At 1–2 trades a week against our 12, the filter is far
too loose, not too tight.

**No session filter.** "I don't use time. I just trade pure price... especially
on **gold and JP225**" — the two instruments he names as cleanest. Both are in
`PAIRS` as of `c673c29`.

**The same model must produce the wins and the losses.** "If another entry model
is giving me my losses then I'm doing something wrong."

## Two entry models, both on the 2H

After the 4H breakout, drop one timeframe to the **2H** and confirm the 2H is
aligned with the 4H first.

**Type 1.** The 2H presents a **single-candle liquidity**. If it has not formed
yet, wait for it. Price then attacks that liquidity, attacks the key level, and
goes.

**Type 2.** The next 2H candle *should* sweep that pool and tap a key level, but
**closes beyond it without taking it out.** That 2H candle now **forms
single-candle liquidity on the 4H**, and the entry is taken there instead. The
pool migrates up a timeframe.

**Ambiguity rule.** With multiple candidate levels, "I use confirmation entry" —
if price sweeps the prior 2H low and the key level and rejects with
confirmation, take it without waiting for the return.

## What the code does not do yet

| Spec | Code | Gap |
|---|---|---|
| Bias chain monthly → weekly → daily → 4H | `storylineSeries(d1, h4)` at `index.ts:593` — daily and H4 only | **the top two links are absent from the live path** |
| Entries on the 2H | `ENTRY_TFS = "15m,30m,1h"` (`wrangler.jsonc:56`) | **wrong timeframe; `2h` is plumbed through `TF_SECONDS`/`TD_INTERVALS`/`OANDA_GRANULARITIES` but unused** |
| Three bias routes | `storyline.ts:49-50` hard-returns `"no origin key level within reach of price"` | **route 2, liquidity alone, cannot produce a trade at all** |
| Type 1 — 2H single-candle liquidity | `single-candle` pools exist (`features.ts:242-243`) but are built on the H4 map TF | building block exists, on the wrong timeframe |
| Type 2 — pool migrates up a timeframe | absent | not implemented |
| Levels retire when broken through | `keyLevelFlipped` at `engine.ts:778` never filters | not implemented |
| The tap that caused the break is excluded | absent | not implemented |

Neither `biasGate` nor `multiTfGate` is called from `index.ts`; production bias
is daily plus H4 and nothing else. That is why bolting the monthly/weekly gate
on as a *filter* could not work — the chain it was meant to sit on top of was
never there.

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

### Rule 4 — V-level stop/target research comparison

The bullets above remain the current baseline. A separate, default-off replay
arm tests the documented single-candle V-level plan without changing live
signals:

- Long: use the confirmed swept-pivot candle's low (plus the existing ATR
  buffer) as the stop and that candle's high as the target. Short: use its high
  plus the buffer as the stop and its low as the target.
- The candidate must have the correct stop and target sides and pass the
  existing stop-width, ATR-risk, and minimum reward:risk checks. If the stop
  floor would force the stop inside the reference candle, or the target is
  invalid/too close, reject the candidate. Do not substitute the baseline
  stop or target.
- Run once with the normal replay for the baseline, then with
  `BACKTEST_VLEVEL_STOPS_TARGETS=true` for the candidate, using the same window.
  The replay cache lets both runs use the same downloaded candles.
- The switch is read only by `worker/scripts/backtest.ts`; live Worker config
  does not expose it. No production setting or live alert behavior changes.

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

- Plain Fx TAYO playlist — https://www.youtube.com/playlist?list=PLjbd_lkDytnQ656fQVd93-7TLCwX_FN04
- 4TH MAN MENTORSHIP FULL — https://www.youtube.com/playlist?list=PLluTOcq9uKInvlN00dKr1fcnVrOoa13FU
- TAYO Strategy thread — https://www.mytradingland.com/thread/slk-strategy-c24584/1
- Top-Down Analysis Using TAYO (JhayFx) — https://jhayfx.substack.com/p/top-down-analysis-using-slk-strategy
- X: @The_4thMan, @Kelvinking_

### Read 2026-10-11

**`VfABZXNFaNI` — "Storyline and Entries."** — https://youtu.be/VfABZXNFaNI

Channel **"Trade with Ichiban"** (`UCgxZQzko_wVJU5GT8cyGOzw`, 419 subscribers).
The transcript service was rate-limited on all four automated attempts, so the
owner pasted it by hand. **Whether this channel is 4thman under another name or
a third party is still unconfirmed** — the references above name @The_4thMan
and two playlists, neither of which is this channel. The rules extracted from
it are recorded above and marked with the video id so they can be dropped if
the owner says it is not authoritative.

The transcript fetch route is `https://youtubetotranscript.com/transcript?v=<id>`,
read `chunkIndex` in order. Do not construct proxy URLs for it.
