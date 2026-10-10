import { describe, it, expect } from "vitest";
import type { Candle } from "../src/types";
import {
  DEFAULT_CONFIRMATION_PARAMS,
  findConfirmationEntries,
  thirdCandleOutcome,
  type ConfirmationParams,
} from "../src/confirmation";

const params = (over: Partial<ConfirmationParams> = {}): ConfirmationParams => ({
  ...DEFAULT_CONFIRMATION_PARAMS, ...over,
});

function candles(rows: [number, number, number, number][]): Candle[] {
  const base = Date.UTC(2026, 0, 5);
  return rows.map(([o, h, l, c], i) => ({ t: base + i * 3_600_000, o, h, l, c }));
}

/**
 * A long confirmation entry: a setup candle with a low that gets swept, the
 * sweep closing back above that low, and the setup candle's high untouched.
 */
const LONG_PATTERN = candles([
  [1.1000, 1.1004, 1.0996, 1.1002],
  [1.1002, 1.1010, 1.1001, 1.1008], // setup candle: low 1.1001, high 1.1010
  [1.1008, 1.1009, 1.0990, 1.1006], // sweeps 1.1001, closes back above it
  [1.1006, 1.1020, 1.1004, 1.1018], // third candle trades back into the level
]);

describe("findConfirmationEntries", () => {
  it("finds a swept low that closes back above it", () => {
    const s = findConfirmationEntries(LONG_PATTERN, "LONG");
    expect(s.length).toBeGreaterThanOrEqual(1);
    const e = s.find((x) => x.setupIndex === 1);
    expect(e).toBeDefined();
    expect(e!.direction).toBe("LONG");
    expect(e!.swept).toBeCloseTo(1.1001, 10);
    expect(e!.standing).toBeCloseTo(1.1010, 10);
    expect(e!.sweepIndex).toBe(2);
  });

  it("places the stop one pip beyond the swept extreme", () => {
    const e = findConfirmationEntries(LONG_PATTERN, "LONG").find((x) => x.setupIndex === 1)!;
    expect(e.stop).toBeCloseTo(1.1001 - DEFAULT_CONFIRMATION_PARAMS.stopBuffer, 10);
    expect(e.stop).toBeLessThan(e.entry);
  });

  it("targets the configured multiple", () => {
    for (const e of findConfirmationEntries(LONG_PATTERN, "LONG")) {
      expect(e.rr).toBeCloseTo(DEFAULT_CONFIRMATION_PARAMS.rr, 10);
      expect(e.tp).toBeGreaterThan(e.entry);
      expect(e.entry - e.stop).toBeGreaterThan(0);
    }
  });

  it("rejects the setup when the high is not still standing", () => {
    // Same sweep, but the sweeping candle also takes out the setup high.
    const broken = candles([
      [1.1000, 1.1004, 1.0996, 1.1002],
      [1.1002, 1.1010, 1.1001, 1.1008],
      [1.1008, 1.1015, 1.0990, 1.1012], // high 1.1015 >= standing 1.1010
    ]);
    const s = findConfirmationEntries(broken, "LONG");
    expect(s.find((x) => x.setupIndex === 1)).toBeUndefined();
  });

  it("rejects a sweep that does not close back inside", () => {
    // Takes out the low and stays below it — that is a breakdown, not a sweep.
    const noClose = candles([
      [1.1000, 1.1004, 1.0996, 1.1002],
      [1.1002, 1.1010, 1.1001, 1.1008],
      [1.1008, 1.1009, 1.0990, 1.0992], // closes below 1.1001
    ]);
    expect(findConfirmationEntries(noClose, "LONG").find((x) => x.setupIndex === 1)).toBeUndefined();
  });

  it("mirrors correctly on the short side", () => {
    const short = candles([
      [1.1020, 1.1024, 1.1016, 1.1018],
      [1.1018, 1.1019, 1.1010, 1.1012], // setup candle: high 1.1019, low 1.1010
      [1.1012, 1.1030, 1.1011, 1.1014], // sweeps 1.1019, closes back below it
    ]);
    const s = findConfirmationEntries(short, "SHORT");
    const e = s.find((x) => x.setupIndex === 1);
    expect(e).toBeDefined();
    expect(e!.swept).toBeCloseTo(1.1019, 10);
    expect(e!.stop).toBeCloseTo(1.1019 + DEFAULT_CONFIRMATION_PARAMS.stopBuffer, 10);
    expect(e!.stop).toBeGreaterThan(e!.entry);
    expect(e!.tp).toBeLessThan(e!.entry);
  });

  it("finds nothing without a bias", () => {
    expect(findConfirmationEntries(LONG_PATTERN, null)).toEqual([]);
  });

  it("never looks further back than setupLookback", () => {
    // The sweepable low sits further back than the lookback allows.
    const cs = candles([
      [1.1000, 1.1004, 1.0900, 1.1002],
      ...Array.from({ length: 14 }, (_, k) => [1.1000, 1.1002, 1.0998, 1.1000] as [number, number, number, number]),
      [1.1000, 1.1001, 1.0899, 1.1000],
    ]);
    const far = findConfirmationEntries(cs, "LONG", params({ setupLookback: 2 }));
    expect(far.find((x) => x.setupIndex === 0)).toBeUndefined();
  });

  it("gives every entry a distinct id", () => {
    const s = findConfirmationEntries(LONG_PATTERN, "LONG");
    expect(new Set(s.map((x) => x.setupId)).size).toBe(s.length);
  });
});

describe("thirdCandleOutcome", () => {
  it("reads a third candle that trades back into the level as played out", () => {
    const e = findConfirmationEntries(LONG_PATTERN, "LONG").find((x) => x.setupIndex === 1)!;
    expect(thirdCandleOutcome(LONG_PATTERN, e)).toBe("played_out");
  });

  it("reads a third candle that never comes back as internal liquidity", () => {
    const cs = candles([
      [1.1000, 1.1004, 1.0996, 1.1002],
      [1.1002, 1.1010, 1.1001, 1.1008],
      [1.1008, 1.1009, 1.0990, 1.1006],
      [1.1010, 1.1030, 1.1008, 1.1028], // low 1.1008 stays above the entry close
    ]);
    const e = findConfirmationEntries(cs, "LONG").find((x) => x.setupIndex === 1)!;
    expect(e.entry).toBeLessThan(1.1008);
    expect(thirdCandleOutcome(cs, e)).toBe("internal_liquidity");
  });

  it("is pending while the third candle has not closed", () => {
    const cs = LONG_PATTERN.slice(0, 3);
    const e = findConfirmationEntries(cs, "LONG").find((x) => x.setupIndex === 1)!;
    expect(thirdCandleOutcome(cs, e)).toBe("pending");
  });
});
