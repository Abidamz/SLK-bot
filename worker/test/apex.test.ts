/** APEX: the extreme protected high or low of the structure, and the stop that
 *  sits strictly beyond it. "Protected" is what separates an apex from an
 *  ordinary swing extreme - the liquidity beyond it was taken and the move away
 *  confirmed, so it is the level the structure is built from rather than a
 *  price the market happened to reach.
 */
import { describe, expect, it } from "vitest";
import { defaultStrategy, type StrategyConfig } from "../src/config";
import { apex, apexFromPivots, apexStop, type StrongPivot } from "../src/features";
import type { Candle } from "../src/types";

const H1 = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

function pivot(
  kind: "strong_high" | "strong_low", price: number, i = 0,
): StrongPivot {
  return {
    kind, price,
    sweepIndex: i, sweepTime: T0 + i * H1,
    bosIndex: i + 1, bosTime: T0 + (i + 1) * H1,
  };
}

describe("apexFromPivots", () => {
  it("takes the highest defended high, not the most recent one", () => {
    const a = apexFromPivots([
      pivot("strong_high", 105, 2),
      pivot("strong_high", 112, 9),   // higher but later
      pivot("strong_high", 108, 15),  // most recent but lower
    ]);
    expect(a.high?.price).toBe(112);
  });

  it("takes the lowest defended low", () => {
    const a = apexFromPivots([
      pivot("strong_low", 95, 2),
      pivot("strong_low", 88, 9),
      pivot("strong_low", 91, 15),
    ]);
    expect(a.low?.price).toBe(88);
  });

  it("never lets a high stand in for a low", () => {
    // A structure with only defended highs has no protected low, and inventing
    // one from the wrong side would put a long's stop above the trade.
    const a = apexFromPivots([pivot("strong_high", 105), pivot("strong_high", 110)]);
    expect(a.high?.price).toBe(110);
    expect(a.low).toBeNull();
  });

  it("is null on both sides with no confirmed pivots", () => {
    expect(apexFromPivots([])).toEqual({ high: null, low: null });
  });

  it("is deterministic when two pivots share the extreme price", () => {
    // First wins. Unordered iteration over a set would make this vary between
    // runs, and a stop that moves between runs is not reproducible.
    const first = pivot("strong_high", 110, 3);
    const second = pivot("strong_high", 110, 8);
    expect(apexFromPivots([first, second]).high).toBe(first);
    expect(apexFromPivots([second, first]).high).toBe(second);
  });
});

describe("apexStop", () => {
  const both = { high: pivot("strong_high", 112), low: pivot("strong_low", 88) };

  it("puts a long's stop strictly below the defended low", () => {
    expect(apexStop("LONG", both, 0.5)).toBeCloseTo(87.5, 10);
  });

  it("puts a short's stop strictly above the defended high", () => {
    expect(apexStop("SHORT", both, 0.5)).toBeCloseTo(112.5, 10);
  });

  it("adds the buffer rather than sitting on the apex", () => {
    // A stop exactly at the apex sits where the liquidity that was already
    // taken used to rest. Zero buffer must still be honoured, not defaulted.
    expect(apexStop("LONG", both, 0)).toBe(88);
    expect(apexStop("LONG", both, 2)).toBe(86);
  });

  it("returns null when the protective side is undefined", () => {
    // Not a fallback to another placement: a caller that silently substituted a
    // stop would be reporting an apex stop it never used.
    expect(apexStop("LONG", { high: pivot("strong_high", 112), low: null }, 1)).toBeNull();
    expect(apexStop("SHORT", { high: null, low: pivot("strong_low", 88) }, 1)).toBeNull();
    expect(apexStop("LONG", { high: null, low: null }, 1)).toBeNull();
  });
});

describe("apex over candles", () => {
  const cfg: StrategyConfig = { ...defaultStrategy(), atrPeriod: 5 };
  const mk = (rows: Array<[number, number, number, number]>): Candle[] =>
    rows.map(([o, h, l, c], i) => ({ t: T0 + i * H1, o, h, l, c }) as Candle);

  // Sweep of high 105 at index 10, impulsive displacement through 95 at 11.
  const BULL: Array<[number, number, number, number]> = [
    [100.0, 101.0, 99.0, 100.5], [100.5, 102.0, 100.0, 101.5],
    [101.5, 105.0, 101.0, 104.0], [104.0, 104.5, 102.0, 102.5],
    [102.5, 103.0, 101.0, 101.5], [101.5, 102.0, 100.0, 100.5],
    [100.5, 101.0, 99.0, 99.5], [99.5, 100.0, 97.0, 97.5],
    [97.5, 98.0, 95.0, 96.0], [96.0, 99.0, 95.5, 98.5],
    [98.5, 106.0, 98.0, 103.5], [103.5, 104.0, 93.0, 93.5],
  ];
  // Sweep of low 95 at index 10, impulsive displacement through 104 at 11.
  const BEAR: Array<[number, number, number, number]> = [
    [100.0, 101.0, 99.0, 99.5], [99.5, 100.0, 98.0, 98.5],
    [98.5, 99.0, 95.0, 96.0], [96.0, 97.5, 95.5, 97.0],
    [97.0, 98.0, 96.5, 97.5], [97.5, 99.0, 97.0, 98.5],
    [98.5, 100.0, 98.0, 99.5], [99.5, 102.0, 99.0, 101.5],
    [101.5, 104.0, 101.0, 103.0], [103.0, 103.5, 100.0, 100.5],
    [100.5, 101.0, 94.0, 96.5], [96.5, 106.0, 96.0, 105.5],
  ];

  it("finds the defended high from a sweep-then-displacement sequence", () => {
    const a = apex(mk(BULL), cfg, 6, 1.0);
    expect(a.high?.price).toBe(105);
    // The bullish sequence defends a high, not a low - the low was broken
    // through by the displacement, so it is the opposite of protected.
    expect(a.low).toBeNull();
    expect(apexStop("SHORT", a, 0.5)).toBeCloseTo(105.5, 10);
    expect(apexStop("LONG", a, 0.5)).toBeNull();
  });

  it("finds the defended low on the bearish mirror", () => {
    const a = apex(mk(BEAR), cfg, 6, 1.0);
    expect(a.low?.price).toBe(95);
    expect(a.high).toBeNull();
    expect(apexStop("LONG", a, 0.5)).toBeCloseTo(94.5, 10);
    expect(apexStop("SHORT", a, 0.5)).toBeNull();
  });

  it("is empty on a series too short to have structure", () => {
    expect(apex(mk(BULL.slice(0, 4)), cfg, 6, 1.0)).toEqual({ high: null, low: null });
  });
});
