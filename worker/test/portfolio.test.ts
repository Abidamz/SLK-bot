/**
 * Portfolio layer. The prop sim's correlation knob has always been assumed
 * rather than measured; these pin the measurement, including the two places
 * where the tempting shortcut gives a wrong answer - a flat series reported as
 * "independent", and an unknown correlation treated as zero.
 */
import { describe, expect, it } from "vitest";
import {
  corrMatrix, dailyRByPair, dropRedundant, maxPair, meanPairwiseCorrelation,
} from "../src/portfolio";
import type { Trade } from "../src/replay_stats";

function mk(o: Partial<Trade> & { status: string; r: number }): Trade {
  return {
    pair: "EURUSD", tf: "1h", setupId: `s${Math.random()}`,
    entryTime: "2026-05-01 10:00", entry: 1.1, stop: 1.099, tp: 1.1025,
    exit: 1.1, exitTime: "2026-05-01 12:00",
    limitStatus: "OPEN", limitEntry: 1.1, limitExitTime: "-", limitR: NaN,
    marketStatus: "OPEN", marketEntry: 1.1, marketExitTime: "-", marketR: NaN,
    ...o,
  };
}

describe("dailyRByPair", () => {
  it("buckets by exit day and sums multiple trades on the same day", () => {
    const s = dailyRByPair([
      mk({ pair: "A", exitTime: "2026-05-01 12:00", status: "TP_HIT", r: 2.5 }),
      mk({ pair: "A", exitTime: "2026-05-01 18:00", status: "SL_HIT", r: -1 }),
      mk({ pair: "A", exitTime: "2026-05-02 12:00", status: "SL_HIT", r: -1 }),
    ], false);
    expect(s.A["2026-05-01"]).toBeCloseTo(1.5, 6);
    expect(s.A["2026-05-02"]).toBeCloseTo(-1, 6);
  });

  it("uses the exit day, not the entry day", () => {
    const s = dailyRByPair([
      mk({ pair: "A", entryTime: "2026-05-01 10:00", exitTime: "2026-05-04 10:00", status: "TP_HIT", r: 2 }),
    ], false);
    expect(s.A["2026-05-01"]).toBeUndefined();
    expect(s.A["2026-05-04"]).toBe(2);
  });

  it("skips unresolved trades and rows with no exit timestamp", () => {
    const s = dailyRByPair([
      mk({ pair: "A", status: "OPEN", r: NaN }),
      mk({ pair: "A", status: "TP_HIT", r: 2, exitTime: "-" }),
      mk({ pair: "A", status: "TP_HIT", r: 2, exitTime: "2026-05-01 12:00" }),
    ], false);
    expect(Object.keys(s.A)).toEqual(["2026-05-01"]);
    expect(s.A["2026-05-01"]).toBe(2);
  });

  it("charges spread when asked, through the same arithmetic as stats()", () => {
    // SPREAD_EST.EURUSD is 0.00002 against a |1.1 - 1.099| = 0.001 risk
    // distance, so 0.02R per side and 0.04R round trip: 2 - 0.04 = 1.96.
    const s = dailyRByPair([mk({ pair: "EURUSD", status: "TP_HIT", r: 2 })], true);
    expect(s.EURUSD["2026-05-01"]).toBeCloseTo(1.96, 6);
  });
});

describe("corrMatrix", () => {
  const A = { d1: 1, d2: -1, d3: 2, d4: -2 };

  it("returns 1 for perfectly co-moving series and 1 on the diagonal", () => {
    const m = corrMatrix({ A, B: { d1: 2, d2: -2, d3: 4, d4: -4 } });
    expect(m.A.B).toBeCloseTo(1, 6);
    expect(m.A.A).toBe(1);
  });

  it("returns -1 for perfectly opposing series", () => {
    const m = corrMatrix({ A, B: { d1: -2, d2: 2, d3: -4, d4: 4 } });
    expect(m.A.B).toBeCloseTo(-1, 6);
  });

  it("returns NaN, not 0, for a flat series", () => {
    // Zero variance has no defined correlation. Reporting 0 would claim
    // independence that was never observed, which is the optimistic error this
    // module exists to prevent.
    const m = corrMatrix({ A, FLAT: { d1: 1, d2: 1, d3: 1, d4: 1 } });
    expect(Number.isNaN(m.A.FLAT)).toBe(true);
  });

  it("aligns over the union of days, filling gaps with zero", () => {
    const m = corrMatrix({ A, B: { d1: 1, d5: 3 } });
    expect(Number.isFinite(m.A.B)).toBe(true);
  });
});

describe("meanPairwiseCorrelation and maxPair", () => {
  it("averages only the distinct off-diagonal finite entries", () => {
    const m = corrMatrix({
      A: { d1: 1, d2: -1, d3: 2, d4: -2 },
      B: { d1: 2, d2: -2, d3: 4, d4: -4 },   // +1 with A
      C: { d1: -1, d2: 1, d3: -2, d4: 2 },   // -1 with A, -1 with B
    });
    expect(meanPairwiseCorrelation(m)).toBeCloseTo((1 - 1 - 1) / 3, 6);
  });

  it("excludes NaN pairs from the mean rather than counting them as zero", () => {
    const m = corrMatrix({
      A: { d1: 1, d2: -1, d3: 2, d4: -2 },
      B: { d1: 2, d2: -2, d3: 4, d4: -4 },
      FLAT: { d1: 1, d2: 1, d3: 1, d4: 1 },
    });
    // Only the A-B pair counts. Including the two NaN pairs as 0 would give 1/3.
    expect(meanPairwiseCorrelation(m)).toBeCloseTo(1, 6);
  });

  it("is NaN when no pair is computable", () => {
    expect(Number.isNaN(meanPairwiseCorrelation(corrMatrix({ A: { d1: 1 }, B: { d1: 2 } })))).toBe(true);
  });

  it("surfaces the most correlated distinct pair", () => {
    const m = corrMatrix({
      A: { d1: 1, d2: -1, d3: 2, d4: -2 },
      B: { d1: 2, d2: -2, d3: 4, d4: -4 },
      C: { d1: -1, d2: 1, d3: -2, d4: 2 },
    });
    expect(maxPair(m)).toMatchObject({ a: "A", b: "B", r: 1 });
  });
});

describe("dropRedundant", () => {
  const corr = {
    BEST: { BEST: 1, TWIN: 0.9, FREE: 0.1 },
    TWIN: { BEST: 0.9, TWIN: 1, FREE: 0.1 },
    FREE: { BEST: 0.1, TWIN: 0.1, FREE: 1 },
  };

  it("keeps the higher-expectancy of two correlated names and drops the other", () => {
    const r = dropRedundant({
      expectancy: { BEST: 1.0, TWIN: 0.4, FREE: 0.6 },
      corr, threshold: 0.7,
    });
    expect(r.kept).toEqual(["BEST", "FREE"]);
    expect(r.dropped).toEqual([{ pair: "TWIN", becauseOf: "BEST", r: 0.9 }]);
  });

  it("keeps everything when nothing exceeds the threshold", () => {
    const r = dropRedundant({
      expectancy: { BEST: 1.0, TWIN: 0.4, FREE: 0.6 },
      corr, threshold: 0.95,
    });
    expect(r.kept.sort()).toEqual(["BEST", "FREE", "TWIN"]);
    expect(r.dropped).toEqual([]);
  });

  it("keeps an instrument whose correlation is unknown", () => {
    // Treating NaN as independent would be the optimistic assumption; but so
    // would dropping it. Keeping it is the conservative choice for the count
    // and the honest one for the unknown.
    const r = dropRedundant({
      expectancy: { BEST: 1.0, ODD: 0.5 },
      corr: { BEST: { BEST: 1, ODD: NaN }, ODD: { BEST: NaN, ODD: 1 } },
      threshold: 0.7,
    });
    expect(r.kept).toEqual(["BEST", "ODD"]);
  });

  it("ignores instruments with no finite expectancy", () => {
    const r = dropRedundant({
      expectancy: { BEST: 1.0, GHOST: NaN },
      corr: { BEST: { BEST: 1 }, GHOST: { GHOST: 1 } },
      threshold: 0.7,
    });
    expect(r.kept).toEqual(["BEST"]);
  });
});
