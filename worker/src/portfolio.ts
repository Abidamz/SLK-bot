/**
 * Portfolio layer: turn a flat list of trades into the instruments-and-
 * correlation view the prop simulation needs.
 *
 * The prop sim takes a single `correlation` knob, and until now that number has
 * been assumed - 0 for "independent", 0.3 for "somewhat correlated". Assuming it
 * is how a book that passes on paper blows up in practice, because the whole
 * point of running many instruments is that their bad days do not arrive
 * together. So this measures it instead.
 *
 * IMPORTANT LIMITATION, stated plainly: at roughly two alerts per instrument per
 * month, two instruments almost never trade on the same day. Filling non-trading
 * days with zero attenuates every pairwise correlation toward 0, so the numbers
 * this produces are a LOWER BOUND on true correlation, not an estimate of it.
 * The alternative - only comparing days where both instruments traded - leaves a
 * handful of observations per pair, which is worse. Read the output as "at least
 * this correlated", and prefer the pessimistic reading.
 */
import { applySpreadRows, type Trade } from "./replay_stats";

/** Instrument -> ISO day -> realised R on that day. */
export type DailyR = Record<string, Record<string, number>>;

/**
 * Buckets realised R by the day the trade EXITED, because that is when the
 * account balance actually moves. Entry-day bucketing would smear a trade held
 * over a weekend across the wrong days.
 */
export function dailyRByPair(rows: Trade[], spreadAdj: boolean): DailyR {
  const out: DailyR = {};
  for (const t of applySpreadRows(rows, spreadAdj)) {
    if (t.status === "OPEN" || !Number.isFinite(t.r)) continue;
    if (!t.exitTime || t.exitTime === "-") continue;
    const day = t.exitTime.slice(0, 10);
    if (!out[t.pair]) out[t.pair] = {};
    out[t.pair][day] = (out[t.pair][day] ?? 0) + t.r;
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  // A flat series has no variance and therefore no defined correlation. Returning
  // 0 here would claim independence we have not observed.
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}

export type CorrMatrix = Record<string, Record<string, number>>;

/** Pairwise correlation of daily R series, aligned over the union of all days. */
export function corrMatrix(series: DailyR): CorrMatrix {
  const pairs = Object.keys(series).sort();
  const days = [...new Set(pairs.flatMap((p) => Object.keys(series[p])))].sort();
  const vec: Record<string, number[]> = {};
  for (const p of pairs) vec[p] = days.map((d) => series[p][d] ?? 0);

  const m: CorrMatrix = {};
  for (const a of pairs) {
    m[a] = {};
    for (const b of pairs) {
      m[a][b] = a === b ? 1 : pearson(vec[a], vec[b]);
    }
  }
  return m;
}

/**
 * Mean pairwise correlation across all distinct pairs - the single number the
 * prop sim's `correlation` knob consumes. NaN entries (a flat or empty series)
 * are excluded rather than treated as zero, for the same reason as above.
 */
export function meanPairwiseCorrelation(m: CorrMatrix): number {
  const pairs = Object.keys(m);
  let sum = 0, n = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const v = m[pairs[i]]?.[pairs[j]];
      if (typeof v === "number" && Number.isFinite(v)) { sum += v; n++; }
    }
  }
  return n ? sum / n : NaN;
}

/** The single most correlated distinct pair, so an outlier is visible. */
export function maxPair(m: CorrMatrix): { a: string; b: string; r: number } | null {
  const pairs = Object.keys(m);
  let best: { a: string; b: string; r: number } | null = null;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const v = m[pairs[i]]?.[pairs[j]];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (!best || v > best.r) best = { a: pairs[i], b: pairs[j], r: v };
    }
  }
  return best;
}

/**
 * Greedily drops instruments that are redundant with one already kept, walking
 * from the best expectancy down so the better of two correlated names survives.
 *
 * An instrument whose correlation to a kept name cannot be computed (NaN) is
 * KEPT. Treating an unknown as independent is exactly the optimistic assumption
 * this module exists to avoid.
 */
export function dropRedundant(opts: {
  expectancy: Record<string, number>;
  corr: CorrMatrix;
  threshold: number;
}): { kept: string[]; dropped: Array<{ pair: string; becauseOf: string; r: number }> } {
  const ranked = Object.keys(opts.expectancy)
    .filter((p) => Number.isFinite(opts.expectancy[p]))
    .sort((a, b) => opts.expectancy[b] - opts.expectancy[a]);

  const kept: string[] = [];
  const dropped: Array<{ pair: string; becauseOf: string; r: number }> = [];
  for (const p of ranked) {
    const clash = kept.find((k) => {
      const v = opts.corr[p]?.[k] ?? opts.corr[k]?.[p];
      return typeof v === "number" && Number.isFinite(v) && v >= opts.threshold;
    });
    if (clash) {
      dropped.push({ pair: p, becauseOf: clash, r: opts.corr[p]?.[clash] ?? opts.corr[clash]?.[p] });
    } else {
      kept.push(p);
    }
  }
  return { kept, dropped };
}
