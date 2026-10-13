# The 16-instrument sweep, and the decision to stop

Run 2026-10-13. 16 OANDA instruments, 360 days (2025-10-18 → 2026-10-13), entry
timeframes 30m and 1h, 410 alerts. This is the measurement the whole prop-firm
plan was waiting on, and it is recorded here so it does not get re-run and
re-hoped later.

## The gate, and its result

A hard gate was agreed before this run existed: **out-of-sample per-alert
expectancy below ~0.3R means stop**, and fall back to something else. It was
fixed in advance specifically so the result could not be argued with afterwards.

| reading | held-out R/alert | verdict |
|---|---|---|
| picked book, raw | +0.197 ± 0.178 | FAIL |
| picked book, spread-adjusted | **+0.104 ± 0.178** | **FAIL** |
| whole book, spread-adjusted | −0.039 | FAIL |

The selection was made on entries before 2026-06-14 and judged on the 120 days
after. Nine of sixteen instruments were picked. They made +7.4R adjusted on 71
alerts.

The adjusted figure is **statistically indistinguishable from zero** — 0.104
against a standard error of 0.178.

**Decision: stop.**

## The number that ends the argument

Gross expectancy, before any cost whatsoever:

    57.7R / 410 alerts = +0.141R/alert   (1.9 sigma)

**The gross edge is half the gate.** With zero spread, zero slippage and zero
commission this book still does not clear 0.3R. Cost engineering cannot fix a
threshold it was never near.

After spread: **+0.033R/alert, 0.4 sigma — indistinguishable from zero.** Spread
takes **0.108R per trade**, 44.2R of the 57.7R gross. The 1h arm goes from +7.2R
raw to **−4.9R adjusted**; costs do not dent it, they erase it.

Monte Carlo on the book's own measured mix, 2-loss daily cap, 20,000 trials:

| risk | pass | blown | neither |
|---|---|---|---|
| 0.50% | 5.8% | 13.3% | 80.9% |
| 0.75% | **18.7%** | **31.6%** | 49.7% |
| 1.00% | 29.1% | 43.9% | 27.0% |

At 0.75% the account is blown nearly twice as often as the challenge is passed.

Monthly replay: 2 of 13 months pass at 0.75% (2026-01 and 2026-06). Most
failures are the 3% daily limit, not the 8% target.

## What else this run settled

**XAUUSD is a loser over a year.** 27 alerts, 16.7% win, −9.6R adjusted, PF 0.59,
losing streak 16. It scored −0.28R/alert in the selection period so it was not
picked, and −0.51R/alert held out. Its +132.99R in the 60-day continuation
shadow was a window artifact. Concentrating on it would have been the worst
available decision, and it was seriously proposed.

**Correlation was never the problem.** Mean pairwise r **0.004**; worst pair
NAS100/SPX500 at 0.319. The diversification plan was sound — there was no edge
to diversify.

**The continuation model is dead.** −1,364.70R adjusted on 8,292 setups, PF 0.55,
win 17.3%. Fourteen of sixteen instruments lose. Its earlier 60-day reading of
+210.09R at market was the same window artifact as XAUUSD's.

**The bias gate is vacuous at scale.** 187,104 of 187,333 ticks, 99.9%. Gate
agreement separates almost nothing: agrees +13.78R PF 1.14, opposes −0.30R
PF 1.01.

**Known gap that makes these numbers optimistic:** no spread estimate exists for
XAGUSD, SPX500 or UK100, so their adjusted figures equal raw. UK100's +8.6R is
uncosted. The true total is below +13.5R.

## Projections that this run refuted

The prop simulation previously indicated ~89% pass at 30 instruments. That was
driven by +0.51R/alert measured on a **3-pair** 360-day run — itself a favourable
sample. Across 16 instruments the real figure is +0.033R/alert adjusted and
18.7% pass. A three-instrument expectancy did not generalise, and should not
have been trusted as a book-wide input.

## State of the code

Everything built on this branch is either default-off or reporting-only. Verified
before recording this:

- `FLIP_IMPULSE_ATR`, `MAX_STOP_PIPS` — absent from `wrangler.jsonc`, so unset,
  so shipped behaviour
- `FLIP_DIRECTION_AWARE` — explicitly `"false"`
- `apex`, `apexStop`, `strongPivots` — detectors with no consumer; zero
  references outside `features.ts` and their tests
- `oosReport`, the portfolio layer, the Monte Carlo block — reporting only

**No live signal changed.** The worker behaves as it did before this work.

## What would be required to reopen this

Not a re-run of the same thing. The gross edge is 0.141R against a 0.30R gate,
so reopening requires a materially different entry model, not tuning. The
unimplemented parts of the methodology — ordinal internal/external liquidity,
APEX stop placement, inducement, the rule against entering after the external
has been taken — are the only candidates, and there is no evidence they would
triple expectancy.

If that work is ever done, the criterion is fixed now: same 16 instruments, same
360 days, **gross R/alert ≥ 0.30R or stop permanently.**

## Addendum: the continuation book was tested out-of-sample too

The out-of-sample split originally ran on the origin book only. The
eye-catching per-instrument numbers all came from the continuation shadow, so
judging that model solely on the window that produced its best result was the
one gap left. It is now split as well, and the XAUUSD question is closed.

**XAUUSD continuation, split at 2026-06-15 (raw):**

| period | alerts | R/alert |
|---|---|---|
| selection (before) | 300 | **−0.17** — not picked |
| held out (after) | 416 | **+0.42** |
| full year | 716 | +102.12R |

It made its money in the period a selection rule would **not** have chosen it
for, and lost money in the period the rule judged it on. The edge is not weak —
it is unstable, and instability in both directions is worse than weakness,
because it cannot be selected for in advance.

**The mirror image in the origin book:** EURUSD scored +0.48R/alert in selection
and −0.50R/alert held out. Same test, both books, opposite directions. Per-
instrument performance in one eight-month window carries essentially no
predictive content for the next four.

**The selection was anti-predictive, not merely useless.** It picked UK100,
USDCAD, GBPUSD and GBPJPY on positive selection expectancy. Held out:

    UK100    sel +0.14 -> -0.22
    USDCAD   sel +0.09 -> +0.23
    GBPUSD   sel +0.01 -> -0.48
    GBPJPY   sel +0.00 -> -0.39
    picked book held out: 693 alerts, -173.3R, -0.25R/alert

**The continuation book as a whole, held out:** −102.0R raw and −292.8R adjusted
over 3,075 alerts. At market execution the full year now reads **−13.47R**; the
previous run's +47.59R did not survive a data refresh.

## Final position

There is nothing to build around on XAUUSD. Not because gold is a bad
instrument — it made +102R on the continuation model over the year — but because
the performance does not persist in either direction, so it cannot be selected
for in advance. A rule that picks it today would have rejected it eight months
ago, and a rule that rejected it then would have missed the recovery.

Both books, both directions, one year, sixteen instruments. This is closed.
