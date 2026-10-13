# Liquidity specification — SLK foundation

Source: `QmEQkOU-7rA` "UNDERSTANDING LIQUIDITY | SLK FOUNDATION" (TRADE WITH
SCOFIELD), read in full; cross-checked against `qjePlTXFdtg` "MAXIMIZING SINGLE
CANDLE LIQUIDITY", also now read in full.

Captured because transcripts are not stored. Every rule below is a direct quote
or a close paraphrase, marked as such.

## 1. Hierarchy

> "my trading system is SLK, which means structure, liquidity and key levels. I
> pay attention to a liquidity resting close to a key level and then subjecting
> them to structure."

**Structure is supreme.** Liquidity and key levels are both *subjected to*
structure. A liquidity level that conflicts with structure loses.

Price has exactly two objectives:

> "price has two core objectives. The first is for it to attack liquidity, while
> the second is for it to rebalance an imbalance at a specific pricing level."

## 2. Internal vs external is ORDINAL, not a timeframe

This is the core mechanic and the one we had wrong.

> "it is the first break that presents for you internal liquidity while the
> second break presents for you external liquidity."

Sequence: **sweep of liquidity → break of structure → the first pullback/break
after that BOS is the internal → the second break is the external.**

Consequences, stated directly in the video:

- internal taken, in alignment with overall direction → **expansion** to the
  external ("after an internal liquidity has been taken out, you should expect
  an expansion towards your external")
- external taken → **reversal**, whose purpose is to take out the internal
- "any level, any target outside the external is just anticipatory — it may
  happen and it may never happen." **The external is the safest target.**
- **do not enter after the external is taken** — "you need to be patient enough
  and ensure price takes out the internal liquidity, because if you don't spot
  the liquidity at that point you might end up becoming the liquidity."

## 3. Types vs forms

**Types** (2): internal, external.

**Forms** (4): trend line, consolidation, session, single candle.

> "these forms of liquidity can definitely function as types of liquidity."

A form can occupy either type slot depending on position in the sequence. Worked
example from the video: sweep → BOS → internal taken → price fails to take the
high → **a range now exists** → that range is the *engineered* liquidity and the
standing high becomes the external.

### Form details

**Trend line.** "whenever you have several touches on a trend line that is what
makes it a liquidity pool." A line that has **sponsored two taps** is live. Trade
the break of it; price then takes out every touch inside.

**Consolidation.** "whenever you come across a consolidation, just know price is
trying to engineer liquidity... build the [liquidity] and then expand towards
delivering a direction." Approach it by **looking left**: where is price coming
from? Find the most recent break before the consolidation and the external
before it. If bullish beforehand, the range is accumulation. Two exits: price
sweeps the lows inside the range then expands, or it breaks out without
manipulating anyone.

**Session.** Asian / London / New York high and low. **A session does not have
to range to be liquidity** — "as long as it doesn't have what it takes to become
a strong low, price would end up taking it out."

**Single candle.** The high and low of any candle, monthly down to M1. Fractal:
24 H1 = 12 H2 = 8 H4 = 1 daily.

### Single-candle side depends on the environment

> "in a bearish environment the high of that candle becomes the internal while
> the low becomes the external. And the inverse applies to a bullish scenario."

**Bullish: low = internal, high = external. Bearish: high = internal, low =
external.**

Core rule, restated twice: sweep a candle's low → next target is that candle's
high; sweep a candle's high → next target is that candle's low.

**Explicit warning against trading this alone:** "it looks like a surface
understanding... there are other factors that you need to pay attention to that
makes this something you can bank on. You don't just expect price to take out
this low and then blindly just want to buy."

## 4. Inducement — now defined

Two independent sources agree on the mechanic:

- this video: **"liquidity is like a magnet that attracts price"**
- Trading Mind Map: *"Inducement Liquidity: internal range points acting as
  price magnets"*

The forms are the concrete instances: a trend line that has sponsored two taps,
and a consolidation range, are both **built** to be taken. Consolidation is
literally described as price *engineering* liquidity.

## 5. Confirmation and bias

> "your breakout validates your break of structure, not all of those double
> break of structure talks."

The lower-TF breakout's job is to **validate direction only** — not to be the
entry (`qjePlTXFdtg`, approach 1). Missed entries are expected and acceptable.

> "this information right here is valid until proven otherwise... you just have
> to work with the information you have currently."

**Trade with the trend.** "If you using it for continuations, I promise you, you
would have interesting win rates." Conversely, "if you have been able to define
the FVG as bullish, trust me, you have no reason trying to bank on sales."
Retracement and reversal trades are called **uncertain** repeatedly.

Named failure mode — **bias blindness**: "because you're selling, your eyes are
so clouded... price has presented for you another structure... now I have every
reason to pay attention to buys."

**Line chart is authoritative for BOS** ("the lines chart tells you the story"),
with body and wick together telling the full story.

**Stops** (`qjePlTXFdtg`): entry from the breakout candle, stop covering the
candle whose liquidity was taken out. Worked GBPUSD example: **15 pips, "which
is still fair enough."**

---

# Audit against the implementation

Verified by reading `worker/src/features.ts`, `engine.ts`, `notify.ts`,
`outcomes.ts` on branch `arena/0e17c27a-slk-bot`.

| Rule | State |
|---|---|
| Structure supreme | partial — `phase()` uses environment + BOS, but pools are not subjected to it |
| **Ordinal internal/external** | **ABSENT** |
| Internal taken → expansion; external → reversal | **ABSENT** |
| External = safest target, beyond is anticipatory | **PRESENT** in targeting and notification |
| Single-candle side flips with environment | **ABSENT** |
| Single-candle liquidity | present, but only for candles ≥ 1.5 × ATR |
| Trend line liquidity | **ABSENT** (0 hits in `src/`) |
| Consolidation / engineered liquidity | **ABSENT** (0 hits) |
| Session liquidity as a pool | **ABSENT** — `sessionFor()` is the trading-hours filter |
| Inducement | **ABSENT** (0 hits), now unblocked |
| Line chart authoritative for BOS | **PRESENT** — `bosEvent` compares closes |
| Lower-TF breakout validates direction | present via bias chain |

### Gap 1 — the split is by timeframe, not by sequence

`internalPools(candles, atrVal, decisionAtrMult, left, right)` emits **every**
entry-TF swing as `kind: "structural"` plus big candles as `kind: "single-candle"`.
`externalPools(daily, ...)` emits PDH/PDL, PWH/PWL, PMH/PML and the last 4 daily
swings.

Nothing is ordinal relative to a sweep→BOS event. Two pools that are internal or
external by *sequence* are indistinguishable in this model, so the expansion
versus reversal rule cannot be expressed at all.

### Gap 2 — `internalPools` never sees the environment

Signature is `(candles, atrVal, decisionAtrMult, left, right)` — no `env`. It
hardcodes `c.h → "buyside"`, `c.l → "sellside"`. Note `side` is a *different
axis* from internal/external: buyside/sellside says which stops rest there,
internal/external says where it sits in the sequence and which way the
environment is running. We have the first axis and not the second.

### Gap 3 — three of four forms missing

Only `single-candle` exists. The 6 `consolidation` hits in `src/` are all the
*environment label* (`bullish | bearish | consolidation`), and the 62 `session`
hits are `sessionFor()` — the trading-hours filter. Neither is a liquidity pool.

### What is already correct — correcting an earlier claim

I had recorded `tpExternal` as dead weight. **That is wrong.**
`selectTargets` (`engine.ts:541`) uses the nearest internal pool as `tp1` and
the nearest external as `tp2`, promotes `tp2` when `tp1`'s R:R is under
`minTpR`, and caps the promotion at `maxPromotedTpR`. `notify.ts:677` prints it
as *"nearest external liquidity (targets beyond are anticipatory)"* — the
video's exact language, already in production output.

One caveat worth noting: `engine.ts:221` is a separate path that falls back to a
flat `2.5 × risk` when no pool target maps. So there are two targeting paths and
they do not share a code path.

## Proposed build order

1. **Ordinal internal/external** relative to the most recent sweep→BOS, with the
   environment-dependent single-candle side. This is the foundation; the
   expansion/reversal rule cannot exist without it.
2. **Consumption state** — has the internal been taken, or the external? Drives
   expansion versus reversal, and the "do not enter after the external is taken"
   filter, which is a suppression and so ships behind a knob for A/B.
3. **Inducement** — now definable: trend line with ≥ 2 taps, and consolidation
   ranges, as magnet pools.
4. **Session liquidity pools** — cheap, and distinct from the hours filter.
