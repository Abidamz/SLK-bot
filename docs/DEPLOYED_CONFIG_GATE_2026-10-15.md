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
