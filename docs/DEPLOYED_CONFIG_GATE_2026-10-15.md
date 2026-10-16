# Deployed-config gate — 2026-10-15

_Run: `BACKTEST_ENTRY_TFS=15m,30m,1h npx tsx scripts/backtest.ts JAPAN225,NAS100,EURUSD,XAUUSD 360`
(commit 9ecd3e2, first replay able to scan 15m). Report: backtest-report-2026-10-15.md._

## The pre-committed gate: FAILED

Gate: gross R/alert ≥ 0.30 on the deployed configuration.
Measured: **296 alerts, +34.6R raw = +0.14 R/alert gross; +11.4R adjusted = +0.06 R/alert net.**
PF 1.20 raw / 1.08 adjusted. Max DD 23.0R raw / 29.7R adjusted. Win 28.8% (TP/(TP+SL)).
The stop decision of 2026-10-13 therefore stands for the deployed config as well:
the configuration subscribers actually receive does not clear the bar that would
reopen the project on measurement grounds.

## What the run settled

**1. Regime vs drift on the short skew: no drift detected.**
Replay direction counts are balanced: LONG 150 (50.7%) / SHORT 146 (49.3%).
The live ledger's 14 SHORT / 5 LONG over n=19 is not significantly different
from balanced (two-sided binomial p ≈ 0.06). The "shorts only" experience is
small sample plus a risk-off recency, not a production defect.
The asymmetry that IS real is in P&L, not counts: over the full year longs
lose (−0.23 R/alert adjusted, 21.8% win) while shorts earn (+0.36 R/alert
adjusted, 36.0% win). The method's thin edge is short-side; longs are a drag
in replay. Live's five positive longs are n=5 noise against 150 replay longs.

**2. The 15m arm is the deployed config's largest liability.**
160 of 296 alerts (54%) come from 15m: −18.2R adjusted, −0.14 R/alert, PF 0.84,
win 23.8%. 30m: +14.1R (+0.19). 1h: +15.6R (+0.56, PF 1.91, win 41.4%).
The per-entry-TF table was designated in advance as the arbiter of whether the
15m difference matters. It matters. Removing 15m from production ENTRY_TFS
would leave a 136-alert book at +0.28 R/alert raw / +0.22 adjusted — better,
still below the gate. Signal-affecting: requires owner confirmation.

**3. The bias gate has no stable content.**
Fires on 99.6% of ticks; agreement vs profit inverted between runs: this
window agrees −8.74R / opposes +20.17R adjusted, the opposite sign of the
earlier 16-instrument run. A filter whose sign flips with the window is noise.
Rebuilding the HTF bias chain as a real navigator (fidelity program) remains
the right organ; tuning the current gate is not.

**4. Continuation at market entry is quarantined, not chased.**
The shadow book at market-next-30m-open prints +452.73R adjusted (PF 1.26),
XAUUSD +207.73R — the largest number in the report, and the same shape as the
+132.99R 60-window artifact that died on refresh, and the +197.6R held-out
whole-book figure whose selection period was negative on every pair.
Window-dependent appearances of this magnitude have failed every forward test
so far. Status: hypothesis. Forward adjudication only — the live shadow ledger
already accumulates these setups; a reporting-only market-entry metric on it
would produce the first forward evidence without risking anything.

**5. Prop challenge, unchanged verdict.**
Monthly windows at 8/3/5: 1–2 of 13 months pass at 0.5–1.0% risk.
Monte Carlo on this book's mix: 13.9–22.8% pass at 0.75%, 23.9% blown.
Max risk the limits allow: 0.47–0.50% (3% daily), 0.17–0.22% (5% overall).

## Decisions pending owner

- Remove 15m from production ENTRY_TFS (replay-designated arbiter says it
  destroys value; live n=7 disagrees; replay n=160 outweighs it).
- Quarterly kill rule and XAUUSD keep-under-rule vs cut (unchanged).
- Live-shadow market-entry continuation metric (reporting-only).
- First organ of the fidelity program (unchanged).

## Addendum — matched-window run (52d, 2026-08-24 → 2026-10-15)

_Run: same config, 52 days — the exact span of the live ledger._

**1. Regime vs drift: REGIME CONFIRMED, drift closed.** The pre-committed
test: if the replay over the live window reproduces the live short skew, the
skew is the market. It reproduces it: replay 26 SHORT / 12 LONG (68.4% short)
versus live 14/5 (74% short) — within noise of each other. The engine given
the same recent tape offers the same book subscribers received. No
production defect; the "shorts only" experience is the tape.

**2. The long side is the broken organ, and it is current.** In-window longs:
12 alerts, 0 TP, 10 SL, 2 BE — win 0.0%, −10.9R adjusted. Over 360d: longs
−0.23 R/alert adjusted (21.8% win) versus shorts +0.36 (36.0%). Two windows,
same sign, 150+ long alerts: the method's measurable edge is short-side;
long entries are the weakest component in the machine. Not a config change
(direction selection on performance is the same trap as pair selection) —
a fidelity target, and forward-adjudicated: the live census already prints
the direction split; if delivered longs stay below −0.2 R/alert at n≥30, a
long-suppression knob gets proposed with the evidence attached.

**3. The 52d gross figure (+0.36 R/alert) does NOT reopen the gate.** The
gate was pre-committed at 360d on the deployed config: +0.14, failed. A 52-day
slice above the bar is the best-slice-of-the-year pattern in a new hat — the
same error as projecting from the best two of thirteen months. Recorded,
not used. Likewise the continuation shadow's +175.7R adjusted (PF 3.09) in
this window, of which XAUUSD alone is +212.7R at PF 16.31: third appearance
of a huge recent-window continuation number, now visibly concentrated in one
instrument in one gold-trend regime. Quarantine stands; any forward test of
continuation must be pair-diverse or an explicit single-instrument hypothesis.

**4. Live +0.94 vs replay +0.06 reconciled as composition, not conflict.**
On the identical window the replay prints +0.29 R/alert adjusted on the four
current pairs. The live +0.94 book additionally contains pre-cut-era pairs
(GER40 2/2, synthetics) the replay cannot see, and the manually corrected
NAS100 TP (+3.0R). Window recency, universe breadth, and the correction
explain the gap; neither measurement was lying, they were measuring
different books.

_2026-10-16 update — re-censused after the second NAS100 correction
(+3.00R, TP_HIT, logged in `docs/OUTCOME_OVERRIDE_POLICY.md`). The live
book is now **20 delivered alerts** (2026-08-25T13:00Z → 2026-10-16T09:30Z,
51.9 days, 11.7 alerts/month): TP 10 / SL 8 / BE 2, win 55.6% (10 of 18 decided), **+22.5R raw
(+1.13/alert) and +20.7R adjusted (+1.04/alert)**. Direction adjusted:
LONG 5 alerts +1.51 (3/1/1), SHORT 15 alerts +0.88 (7/7/1). Entry TF
adjusted: 15m 8 alerts +1.13, 30m 5 at +1.04, 1h 7 at +0.93. NAS100 4
alerts +1.94 including both corrections. `scripts/prop_live.ts` now runs
on this census: at 0.75% risk the challenge passes 59.9% (8% target) /
80.6% (5% target), blown 0.4%; the categorical bootstrap's 90% intervals
are 20–88% and 40–97% respectively. This is a small-sample scenario model,
not a promise; it resamples outcome counts and holds the adjusted win-size
equivalent fixed. The live dashboard's verdict resamples full ledger rows.
Two live slices now point the
opposite way from the 360d replay (15m best live TF, longs positive);
both are n≤8 and neither overturns the year, but they are exactly the
slices the standing forward adjudications watch: longs stay unsuppressed
until delivered longs sit below −0.2 R/alert at n≥30, and the 15m cut
stays an owner decision on the year, not the fortnight._

**5. 15m nuance.** In-window 15m is neutral (+0.02 R/alert adjusted, 17
alerts); its 360d damage (−0.14) sits outside the recent window. The cut
case rests on the year, not the fortnight; owner decision unchanged.

**6. Bias gate inverted again** (agrees −5.91R / opposes +13.91R adjusted),
matching the 360d run and contradicting the older 16-instrument run. Two of
three windows inverted. The current gate has no stable content; the HTF bias
chain rebuild (fidelity organ #1) carries the long-side evidence above as
its justification: counter-trend longs are exactly what a real monthly →
weekly navigator exists to refuse.

## Addendum 2 — navigator verdict: FAILED its bars, stayed off

_Run: `BACKTEST_NAVIGATOR=true` 360d, commit a031f8c (first-emission gating,
all three confirmation forms including daily key levels)._

**Bars, all three missed:**
- Filtered book: 50 alerts, −0.01 R/alert raw, **−0.11 adjusted** (bar: ≥ 0.8).
- Frequency: ~3.8 alerts/month (bar: ~5).
- Weather: three months worse than −2R at 0.75% (Mar −2.2, Jul −2.5, Aug −2.4).

**The diagnostic that matters: the chain inverted the book.** Unfiltered
direction mix was 50.7/49.3 with shorts carrying the edge (+0.37 adj). The
filtered book is **78% LONG** — JAPAN225 and NAS100 permitted LONG on nearly
every confirmed tick and never SHORT — and both sides lost (LONG −0.10 adj,
SHORT −0.13 adj). The sit-out switch sat out the profitable shorts and kept
the losing longs. JAPAN225's chain said LONG all year (zero
WEEKLY_MISALIGNED ticks) through a year in which its longs printed 15% win
and −0.42 R/alert.

**Reading: the carrier is wrong, not the concept.** Three direction-context
filters have now been measured on this engine — the old bias gate (vacuous,
sign-flipping), the HTF conflict gate (inert), and this navigator (selective,
strict, and value-destroying). None separates winners from losers. The
monthly tier as taught is about key levels and liquidity posture subjected
to structure; this implementation carried bias as BOS direction, which lags
regime flips (it permitted longs through the bear quarter) and excludes the
tape geometry where the engine's actual edge lives. Adding the pre-declared
4H rung is NOT applied: that rung was pre-committed for a confirmation-rate
collapse, and what collapsed was the quality of permitted trades, not the
confirmation rate (ALIGNED_CONFIRMED reached ~36% of ticks once the third
confirmation form was wired). Extending a failed carrier one tier lower
would be tuning toward a dead hypothesis.

**Disposition:** navigator stays default-off; no production wiring; no
outcome-tuning. Fidelity-program priority redirects to the entry side —
route C retrace-and-reject geometry, V-level stops, inducement and ordinal
internal/external sequence — because every persistent asymmetry in every
dataset measured so far is entry-side (shorts vs longs, 1h vs 15m), never
context-side. The navigator may be reborn later on a key-level/liquidity
carrier once the LIQUIDITY_SPEC organs exist to supply it.
