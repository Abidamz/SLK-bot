/** Monte Carlo bootstrap engine (Roadmap Priority 5).
 *
 *  Resamples the VERIFIED historical R-multiple distribution (with replacement)
 *  to stress-test the strategy's equity curve: growth percentiles, drawdown
 *  probabilities, and losing-streak risk over a chosen trade horizon.
 *
 *  Deterministic by design: a seeded mulberry32 PRNG means the same seed +
 *  inputs always reproduce the exact same simulation (testable & auditable).
 *  This is a research/stress-test tool — never a performance promise. */

/** Tiny fast seeded PRNG (mulberry32) — deterministic across runtimes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated percentile of a PRE-SORTED ascending array. */
export function percentileSorted(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface MonteCarloInput {
  /** closed-trade R multiples in chronological order (the bootstrap pool) */
  rSeries: number[];
  iterations: number;
  /** simulated trades per iteration */
  horizon: number;
  /** fraction of equity risked per trade (compounding), e.g. 1 = 1% */
  riskPct: number;
  seed: number;
}

export interface MonteCarloResult {
  seed: number;
  iterations: number;
  horizon: number;
  riskPct: number;
  trades: number;
  histWinRate: number;
  histExpectancyR: number;
  /** equity multiplier (1 = starting equity) percentiles at the horizon */
  finalGrowth: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  probNetLoss: number;
  probDd10: number;
  probDd20: number;
  consecLoss: { mean: number; p95: number; worst: number };
  maxDrawdownPct: { p50: number; p95: number; worst: number };
  /** per-trade-index equity multiplier bands for the fan chart */
  bands: { p5: number[]; p50: number[]; p95: number[] };
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

export function runMonteCarlo(inp: MonteCarloInput): MonteCarloResult {
  const { rSeries, horizon, riskPct, seed } = inp;
  const iterations = Math.max(1, Math.floor(inp.iterations));
  const n = rSeries.length;
  const rand = mulberry32(seed);

  const perIndex: number[][] = Array.from({ length: horizon + 1 }, () => []);
  const finals: number[] = [];
  const ddPct: number[] = [];
  const streaks: number[] = [];

  for (let it = 0; it < iterations; it++) {
    let equity = 1;
    let peak = 1;
    let maxDd = 0; // stored as negative fraction
    let curLoss = 0;
    let maxLoss = 0;
    perIndex[0].push(equity);
    for (let t = 1; t <= horizon; t++) {
      const r = rSeries[Math.floor(rand() * n) % n];
      equity *= 1 + (r * riskPct) / 100;
      if (equity <= 0) equity = 0; // blow-up floor: equity cannot go negative
      if (r < 0) {
        curLoss++;
        if (curLoss > maxLoss) maxLoss = curLoss;
      } else {
        curLoss = 0;
      }
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (equity - peak) / peak : -1;
      if (dd < maxDd) maxDd = dd;
      perIndex[t].push(equity);
    }
    finals.push(equity);
    ddPct.push((-maxDd * 100) || 0); // normalize -0 → 0 for clean assertions
    streaks.push(maxLoss);
  }

  const sortedFinals = [...finals].sort((a, b) => a - b);
  const sortedDd = [...ddPct].sort((a, b) => a - b);
  const sortedStreak = [...streaks].sort((a, b) => a - b);
  const wins = rSeries.filter((r) => r > 0).length;

  const bands = { p5: [] as number[], p50: [] as number[], p95: [] as number[] };
  for (let t = 0; t <= horizon; t++) {
    const sorted = [...perIndex[t]].sort((a, b) => a - b);
    bands.p5.push(round5(percentileSorted(sorted, 0.05)));
    bands.p50.push(round5(percentileSorted(sorted, 0.5)));
    bands.p95.push(round5(percentileSorted(sorted, 0.95)));
  }

  return {
    seed,
    iterations,
    horizon,
    riskPct,
    trades: n,
    histWinRate: n ? wins / n : 0,
    histExpectancyR: n ? rSeries.reduce((s, r) => s + r, 0) / n : 0,
    finalGrowth: {
      p5: round5(percentileSorted(sortedFinals, 0.05)),
      p25: round5(percentileSorted(sortedFinals, 0.25)),
      p50: round5(percentileSorted(sortedFinals, 0.5)),
      p75: round5(percentileSorted(sortedFinals, 0.75)),
      p95: round5(percentileSorted(sortedFinals, 0.95)),
      mean: round5(finals.reduce((s, x) => s + x, 0) / finals.length),
    },
    probNetLoss: finals.filter((x) => x < 1).length / finals.length,
    probDd10: ddPct.filter((d) => d >= 10).length / ddPct.length,
    probDd20: ddPct.filter((d) => d >= 20).length / ddPct.length,
    consecLoss: {
      mean: round5(streaks.reduce((s, x) => s + x, 0) / streaks.length),
      p95: round5(percentileSorted(sortedStreak, 0.95)),
      worst: sortedStreak[sortedStreak.length - 1] ?? 0,
    },
    maxDrawdownPct: {
      p50: round5(percentileSorted(sortedDd, 0.5)),
      p95: round5(percentileSorted(sortedDd, 0.95)),
      worst: round5(sortedDd[sortedDd.length - 1] ?? 0),
    },
    bands,
  };
}
