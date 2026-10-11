# Backtest findings — 2026-10-11

Committed on purpose. `worker/backtest-report-*.md` is gitignored, and the
workspace has been reprovisioned often enough that three earlier sets of
results existed only in a terminal scrollback. Anything that has to survive
goes here.

## Runs

All OANDA, real candles, live engine gates (`defaultStrategy()`), 13 pairs.

| run | window | pairs | notes |
|---|---|---|---|
| default | 2026-04-14 → 2026-10-11 (180d) | 13 | bias levels `A,V,OC`, minTouches 0 |
| `BACKTEST_BIAS_LEVEL_KINDS=A,V` | same | 13 | bias levels `A,V` |
| `BACKTEST_END_OFFSET_DAYS=90` | 2026-04-14 → 2026-07-13 (90d) | 13 | older sub-window |

Bias-gate lookbacks in all runs: origin 4, confirm 6, swept 12.

## Origin model — the live engine's own alerts

180d: **149 alerts**, 37 TP / 86 SL / 26 open, **30.1% win**.

| | net R | PF | maxDD |
|---|---|---|---|
| raw (mid touch) | +22.51 | 1.26 | 12.00R |
| spread-adjusted | **+3.32** | 1.08 | 16.16R |

Costs are **19.19R of 22.51R gross — 85% of the edge**, ≈0.129R per trade.
Longest losing streak **19**, longest win streak 3. Net **+0.13R/week**.

Execution comparison, same 149 alerts, spread-adjusted:

- pending limit @ retest close — filled 145/149 (97.3%), **−3.54R**, PF 1.01
- market @ next open — 149/149, **+0.57R**, PF 1.05
- entry @ retest close, always filled — 149/149, **+3.32R**, PF 1.08

What production actually instructs (the pending limit) is the **negative** one.

Older 90d sub-window: 80 alerts, 33.3% win, raw +20.03R PF 1.48,
adj **+10.05R** PF 1.27, maxDD 10.88R.

### Per pair, spread-adjusted net R

| pair | 180d alerts | 180d netR | 180d PF | older-90d alerts | older-90d netR |
|---|---|---|---|---|---|
| NAS100 | 12 | **+12.8** | 4.02 | 9 | +14.9 |
| JAPAN225 | 15 | **+12.7** | 2.72 | 6 | +9.2 |
| EURUSD | 6 | **+10.7** | 2.14 | 6 | +10.7 |
| EURJPY | 8 | +2.2 | 1.34 | 3 | +1.0 |
| USDJPY | 11 | +0.7 | 1.17 | 6 | −5.2 |
| US30 | 7 | +0.4 | 1.13 | 4 | +0.2 |
| XAUUSD | 12 | +0.2 | 1.04 | 4 | +3.7 |
| GBPJPY | 13 | −0.8 | 1.20 | 6 | −5.6 |
| GBPUSD | 16 | −3.3 | 0.73 | 10 | −5.8 |
| GER40 | 14 | −5.9 | 0.34 | 6 | −3.4 |
| NZDUSD | 11 | −7.6 | 0.00 | 8 | −5.4 |
| AUDJPY | 10 | −9.2 | 0.21 | 4 | −0.9 |
| USDCAD | 14 | −9.5 | 0.24 | 8 | −3.3 |
| **TOTAL** | **149** | **+3.3** | 1.08 | **80** | **+10.1** |

Three pairs make **+36.2R**; the other ten make **−32.8R**.

Alert counts show where each pair's record actually sits:

- **JAPAN225** — 6 of 15 alerts in the older half, 9 in the recent half, and
  positive in both. The only pair that is both active and profitable across
  the whole window. maxDD 2.12R, longest losing streak 2.
- **NAS100** — 9 of 12 alerts in the older half; only 3 since.
- **EURUSD** — 6 alerts in 180d and 6 in the older 90d, i.e. **no alerts at
  all in the last 90 days**. Its record is historical, not current.

## The bias gate does not work

`biasGate` fired on **78,179 of 78,179 ticks — 100.0%**. With levels cut to
`A,V` it fired on 78,162 of 78,179 (99.98%). It is not a filter; it is a
constant.

Key levels available per tier (`A,V,OC` / `A,V`, last tick):

| tier | A,V,OC | A,V |
|---|---|---|
| daily | 123 | 36 |
| 4H | 117 | 29 |
| weekly | 93 | 25 |
| monthly | 24 | 6 |

**Cutting the level count by ~70% did not move the fire rate.** That rules out
tuning. The cause is structural: `rejectionClosure` asks whether *any* level's
zone sits between a candle's low and its close (or high and its close). With
93 weekly levels spread across the traded range, some line almost always falls
in that band, so criteria one and two are satisfied by construction on nearly
every candle. The confirmation one timeframe lower is satisfiable the same
way, which is why `mo>w1` alone accounts for 77,278 of 78,179 fires.

Confirmation kinds are all reached, so no branch is dead: `flipped_level`
38,152, `engulfing` 20,298, `sweep_bos` 19,729.

### It also does not help the book

Origin book split by whether the gate agreed with the alert, spread-adjusted,
window split at 2026-07-13:

| run | bucket | alerts | net R | PF | win% | older half | recent half |
|---|---|---|---|---|---|---|---|
| A,V,OC | agrees | 76 | +3.12 | 1.14 | 31.7% | +9.32 | **−6.19** |
| A,V,OC | opposes | 73 | +0.19 | 1.02 | 28.6% | −0.30 | +0.50 |
| A,V | agrees | 75 | **−0.71** | 1.04 | 30.5% | +8.24 | **−8.95** |
| A,V | opposes | 74 | +4.03 | 1.11 | 29.7% | +0.78 | +3.25 |

The test set in advance was: *the "agrees" bucket must beat the other in both
halves.* It fails, twice over.

- In the `A,V,OC` run agreeing looks mildly better; in the stricter `A,V` run
  the sign **flips** and agreeing is worse.
- In **both** runs "agrees" is positive in the older half and negative in the
  recent half.
- The split is ~50/50 (76/73, 75/74) even though the gate is LONG on 65% of
  ticks — the gate's direction is close to independent of the alert's.

Agreement with `multiTfGate` was 73.0% / 76.0%, but only where both fired
(27,736 of 78,179 ticks, 35.5%). On the 50,443 ticks where `multiTfGate`
abstained, `biasGate` supplied a direction every time. Supplying a direction
everywhere is precisely what makes it worthless.

**Verdict: do not ship it, and do not tune lookbacks at it.** The next change
has to make the rejection about a *specific* level — the nearest significant
one, or one with history — rather than any of a hundred. That is the
"key level with history" work, and this run is the evidence that it is the
binding constraint.

## Continuation shadow — still dead

2,831 setups over 180d, gate `w1→d1→h4`, rr 3R:

- limit: adj **−486.87R**, PF 0.59, 19.2% win, closed 1341/2831
- market @ next 30m open: adj **−155.68R**, PF 0.78, 24.3% win

Two pairs were positive — XAUUSD +88.61R (PF 1.55) and USDJPY +73.76R
(PF 3.34) — and neither survives. XAUUSD is **−62.29R** in the older 90d
window. USDJPY made +77.25R in the older 90d against +73.76R over the full
180d, so its entire record is in the older window and the recent 39 setups
gave roughly nothing back. Both are post-hoc selections from thirteen pairs.

## What changed as a result

`PAIRS` in `worker/wrangler.jsonc` cut 23 → 4
(`JAPAN225,NAS100,EURUSD,XAUUSD`), and `DEFAULT_PAIRS` in
`worker/scripts/backtest.ts` to match. All ten Deriv synthetics were removed as
**unproven** — they have never alerted, and no backtest can produce a result
for them because the replay requires OANDA.

**Correction, same day.** The first cut went to three pairs and its comment
claimed EURJPY was "the one dropped pair that was positive in both windows".
That was wrong twice over. Three dropped pairs met the criterion — EURJPY,
XAUUSD and US30 — and XAUUSD had been excluded by an unstated magnitude
judgement rather than by the rule. XAUUSD is restored. EURJPY (+2.2R / +1.0R)
and US30 (+0.4R / +0.2R) still meet the criterion and are held rather than
dropped; they are recorded in the `wrangler.jsonc` comment so the exclusion is
a decision on the record and not a silent one.

## Breakeven A/B — the first measurement of a rule that ships in every alert

Same 33 alerts, three pairs, 180d. The only difference is
`BACKTEST_BE=false`, which runs a fixed stop instead of moving to entry at
+1.5R.

| | alerts | TP | SL | BE | win% | raw netR | adj netR | adj PF | adj maxDD |
|---|---|---|---|---|---|---|---|---|---|
| breakeven armed at +1.5R | 33 | 17 | 12 | 4 | 58.6% | +37.67 | **+36.16** | **3.86** | **3.18R** |
| fixed stop | 33 | 18 | 15 | 0 | 54.5% | +37.35 | +35.84 | 3.27 | 4.18R |

The breakeven instruction is worth **+0.32R over 180 days — nothing in return
terms.** What it buys is risk shape: max drawdown 4.18R → 3.18R (−24%) and
profit factor 3.27 → 3.86. Four trades scratched at 12.1% of resolved, and
without the rule three of them became losses and one became a winner.

Keep it, but for the drawdown, not because it makes money.

### Execution matters far less on the kept pairs

Spread-adjusted, same 33 alerts:

| entry model | net R | PF |
|---|---|---|
| pending limit @ retest close (30/33 filled) | +31.87 | 3.76 |
| market @ next open | +33.83 | 3.68 |
| entry @ retest close, always filled | +36.16 | 3.86 |

On the 13-pair book the pending limit was **−3.54R** against +3.32R always
filled — a sign flip. On the kept pairs the same comparison is +31.87R against
+36.16R, a 4.3R gap over six months. Switching execution is still worth doing
but it is no longer the decisive lever it looked like before the cut.

### The bias gate is now consistently inverted on this subset

Still 100% fire (17,985/17,985 ticks). Split by agreement: **agrees 16 alerts
+13.35R PF 3.09** against **opposes 17 alerts +22.81R PF 4.65**, with
"opposes" ahead in both halves (older +21.13 vs +13.63, recent +1.68 vs
−0.28). On 33 alerts that is noise-level, but it is the third window in which
agreeing with the gate has not helped.

### Continuation shadow on the kept pairs

346 setups, adj **−105.33R**, PF 0.39, 12.3% win. Market entry −24.76R,
PF 0.83. Dead on every pair it now runs on.

**This is in-sample selection.** The pairs were picked from the window being
measured and the 90d run is a sub-window, not out-of-sample. Forward results
should be expected below these figures.

## Entry timeframe — the 2H is not where the edge is

`BACKTEST_ENTRY_TFS=30m,1h,2h`, four pairs, 180d, spread-adjusted. The 2H is the
arm the methodology specifies: after the 4H breakout you drop exactly one
timeframe. Measured, it is the worst of the three.

| entry tf | alerts | TP | SL | BE | win% | netR | PF | maxDD |
|---|---|---|---|---|---|---|---|---|
| 30m | 27 | 12 | 14 | 1 | 46.2% | +19.5 | 2.32 | 5.56R |
| **1h** | 18 | 8 | 6 | 4 | 57.1% | +16.8 | **3.72** | 3.20R |
| 2h | 8 | 2 | 4 | 2 | 33.3% | **+1.7** | **1.42** | 3.08R |

The 2H arm is 15% of the book for 4% of the return. **There is no case for
adding 2h to production `ENTRY_TFS`.** Eight alerts cannot settle much either
way — PF 1.42 on eight trades is noise — but the burden of proof was on the
change and it was not met.

**1h is the strongest arm measured**, PF 3.72 against 2.32 for 30m. Production
scans `15m,30m,1h`; the replay cannot test 15m at all, because the tick loop
walks 30m boundaries. Whether dropping 30m helps is untested — the arms overlap
in time, since an hourly close is also a 30m boundary, so this is a hypothesis
to run, not a change to ship.

## XAUUSD is the weakest pair in the book and it doubles the drawdown

Same run, spread-adjusted, per pair:

| pair | alerts | TP | SL | BE | win% | netR | PF | maxDD |
|---|---|---|---|---|---|---|---|---|
| JAPAN225 | 18 | 7 | 9 | 2 | 43.8% | +10.6 | 2.12 | 3.13R |
| NAS100 | 15 | 7 | 5 | 3 | 58.3% | +14.6 | 3.80 | 3.16R |
| EURUSD | 6 | 4 | 1 | 1 | 80.0% | +10.7 | 11.29 | 1.07R |
| **XAUUSD** | **14** | **4** | **9** | **1** | **30.8%** | **+2.1** | **1.24** | **6.65R** |

XAUUSD still meets the selection criterion — positive in both windows. What it
does to the book is the problem:

| | 3 pairs | 4 pairs | delta |
|---|---|---|---|
| alerts | 33 | 53 | +20 |
| net R | +36.2 | +38.0 | **+1.8** |
| PF | 3.86 | 2.52 | −1.34 |
| max DD | 3.18R | 7.33R | **+4.15R (×2.31)** |

**+1.8R of return for 2.3× the maximum drawdown.** That is the whole of
XAUUSD's contribution, and it is a bad trade at the book level even though the
pair is not a loser.

Two things pull the other way and both are on the record. The methodology names
gold as one of its two cleanest instruments, alongside JP225 — though that is a
claim about his discretionary method on higher timeframes, not about this
engine's alerts. And 14 alerts is a small sample: PF 1.24 on 13 resolved trades
is barely distinguishable from 1.0.

This is the owner's decision, not a magnitude judgement to be made quietly. The
pair was excluded once on exactly that basis and restored; it should not be
dropped the same way.

### Continuation shadow flipped positive, and it is entirely XAUUSD

Market entry now reads **+151.25R, PF 1.15** across 827 setups, against
−24.76R before. The whole of it is XAUUSD: 481 setups at **+88.61R, PF 1.55**.
That is the same figure measured in the 13-pair run, where the older 90d
sub-window had it at **−62.29R**. It does not survive the split, and the
spread-adjusted column for the same shadow is still negative (−16.72R,
PF 0.88). **Still do not ship.**

### Bias gate, fourth window

Still 100% fire, now 23,890/23,890 ticks. Agrees 28 alerts +10.75R PF 1.73
against opposes 25 alerts +27.28R PF 3.63 — and agrees is **−4.70R in the
recent half**. Agreement with `multiTfGate` fell from 81.0% to 67.5%. Four
windows now in which agreeing with the gate has not helped.

## Still open

- The 10R/week floor is unchanged and remains ~75× the measured +0.13R/week.
- Costs, not signals, are the binding constraint: 85% of gross edge.
- The pending-limit execution that production instructs is the worst of the
  three models measured.
- Key level with history — now the highest-value entry change on the evidence
  above.
- Opposing liquidity as the first target; intent-shift exit.
- Whether Deriv accepts a WebSocket from Cloudflare egress:
  `GET /api/probe-deriv?symbol=R_75` answers it, relay and direct side by side.
