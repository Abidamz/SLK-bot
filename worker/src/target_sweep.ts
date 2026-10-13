/** Target sweep: re-score one alert set at several R multiples of the same stop.
 *
 *  Why this exists rather than just reading the headline win rate: win rate and
 *  reward:risk move against each other by construction. At 1:3 the break-even
 *  win rate is 25%, so "60% of trades win" is only a good result next to the
 *  target it was measured at - 60% at a 1R target is worth +0.20R per alert,
 *  while 42% at 2.8R is worth more than twice that. Sweeping the target prints
 *  the whole curve over an identical alert set, so a candidate target can be
 *  compared against the shipped one without re-running the scan and without
 *  changing which setups fired.
 *
 *  These are pure functions on purpose. The sweep runs inside the replay, which
 *  needs live market history and cannot be exercised in CI; keeping the price
 *  maths and the table here means the parts that can be wrong silently - a
 *  sign flip on the short side, a win rate computed over unresolved rows - are
 *  covered by tests instead of by the next person reading the report.
 */

/** Price of a target `rr` R-multiples beyond entry, on the same stop distance.
 *
 *  A sign error here does not produce a wrong number, it produces no number at
 *  all: evaluateSignal rejects a target on the wrong side of entry and returns
 *  null, which would render as an all-open sweep. Catching it in a test is
 *  cheaper than diagnosing an empty table.
 */
export function targetPrice(
  direction: "LONG" | "SHORT", entry: number, stop: number, rr: number,
): number {
  const dist = Math.abs(entry - stop);
  return direction === "LONG" ? entry + rr * dist : entry - rr * dist;
}

export interface SweepBucket {
  /** Alerts scored at this target. */
  n: number;
  tp: number;
  sl: number;
  be: number;
  /** OPEN or EXPIRED: no outcome inside the horizon. Excluded from win%. */
  open: number;
  /** Sum of realised R. Breakeven rows contribute 0, not nothing. */
  r: number;
}

export function emptyBucket(): SweepBucket {
  return { n: 0, tp: 0, sl: 0, be: 0, open: 0, r: 0 };
}

export interface SweepRow extends SweepBucket {
  rr: number;
  /** TP / (TP + SL). NaN when nothing resolved - never 0, which reads as
   *  "it lost everything". */
  win: number;
  net: number;
  /** Expectancy per alert scored, including breakeven and unresolved rows.
   *  Dividing by resolved rows only would credit a target for the trades that
   *  never finished. */
  per: number;
}

export function sweepRows(
  targets: number[], buckets: Map<number, SweepBucket>,
): SweepRow[] {
  return targets.map((rr) => {
    const b = buckets.get(rr) ?? emptyBucket();
    const resolved = b.tp + b.sl;
    return {
      rr, ...b,
      win: resolved ? (b.tp / resolved) * 100 : NaN,
      net: b.r,
      per: b.n ? b.r / b.n : NaN,
    };
  });
}

/** Renders the table. `refPerAlert` is the shipped setting's expectancy on the
 *  same alerts, printed underneath so the sweep is read as a comparison rather
 *  than as a list of numbers with no baseline. */
export function renderSweepTable(
  rows: SweepRow[], refPerAlert: number, refAlerts: number,
): string[] {
  const best = rows.reduce<SweepRow | null>(
    (x, y) => (x === null || y.per > x.per ? y : x), null);
  const out = [
    `TARGET SWEEP - the same ${rows[0]?.n ?? 0} alerts re-scored at other R multiples of the same stop`,
    ``,
    `  target   alerts   TP   SL   BE  open    win%     netR   R/alert`,
    `  ------   ------  ---  ---  ---  -----  ------  -------  -------`,
  ];
  for (const r of rows) {
    const mark = best !== null && r.rr === best.rr ? "  <- best" : "";
    out.push(
      `  ${r.rr.toFixed(2).padStart(5)}R  ${String(r.n).padStart(6)} ${String(r.tp).padStart(4)} ` +
      `${String(r.sl).padStart(4)} ${String(r.be).padStart(4)} ${String(r.open).padStart(5)}  ` +
      `${(Number.isFinite(r.win) ? r.win.toFixed(1) : "-").padStart(6)}  ` +
      `${(Number.isFinite(r.net) ? r.net.toFixed(2) : "-").padStart(8)}  ` +
      `${(Number.isFinite(r.per) ? r.per.toFixed(3) : "-").padStart(8)}${mark}`,
    );
  }
  out.push(
    ``,
    `  shipped setting for reference: ${Number.isFinite(refPerAlert) ? refPerAlert.toFixed(3) : "-"}R/alert ` +
    `over ${refAlerts} alerts (raw)`,
    ``,
    `  Read the R/alert column, not win%. A 60% win rate at a 1R target is worth`,
    `  +0.20R/alert; 42% at 2.8R is worth more. "best" maximises expectancy per`,
    `  alert ON THIS WINDOW and is not a recommendation: the winner of a sweep`,
    `  over one window is partly selected by that window. Confirm out of sample`,
    `  before changing MIN_TP_R.`,
  );
  return out;
}
