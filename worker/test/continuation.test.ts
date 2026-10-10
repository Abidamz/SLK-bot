import { describe, it, expect } from "vitest";
import type { Candle, KeyLevel } from "../src/types";
import { defaultStrategy } from "../src/config";
import {
  DEFAULT_CONTINUATION_PARAMS,
  findContinuationSetups,
  levelHistory,
  mostRecentBreakout,
  multiTfGate,
  retraceDepth,
  type ContinuationParams,
} from "../src/continuation";

const cfg = defaultStrategy();

/** Candle from OHLC, with open times spaced one hour apart. */
function candles(rows: [number, number, number, number][]): Candle[] {
  const base = Date.UTC(2026, 0, 5);
  return rows.map(([o, h, l, c], i) => ({
    t: base + i * 3_600_000, o, h, l, c,
  }));
}

/**
 * Build candles from a close series: each opens at the prior close with a
 * small wick either side.
 *
 * Swing detection needs `left`+`right`+1 candles, so a BOS fixture has to
 * oscillate with a period long enough for findSwings to see extrema. A
 * monotonic series has no local extrema at all and therefore no breakout —
 * which is a property of the detector, not a bug in it.
 */
function fromCloses(closes: number[]): Candle[] {
  const base = Date.UTC(2026, 0, 5);
  return closes.map((c, i) => {
    const o = i === 0 ? closes[0] : closes[i - 1];
    return { t: base + i * 3_600_000, o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, c };
  });
}

/** Rising zigzag: swing highs at 3 and 9, swing lows at 5 and 11. */
const BULL = fromCloses([
  100.0, 100.4, 100.8, 101.3, 101.0, 100.7, 101.1, 101.5, 101.9, 102.4, 102.1, 101.8,
]);

/** Falling zigzag: swing lows at 3 and 9, swing highs at 5 and 11. */
const BEAR = fromCloses([
  102.4, 102.0, 101.6, 101.1, 101.4, 101.7, 101.3, 100.9, 100.5, 100.0, 100.3, 100.6,
]);

/** Oscillates with visible swings but never breaks one — no breakout. */
const FLAT = fromCloses([
  100.0, 100.5, 101.0, 101.2, 100.8, 100.5, 100.8, 101.1, 101.0, 100.7, 100.5, 100.7,
]);

function levelAt(originIndex: number, lo: number, hi: number): KeyLevel {
  return {
    kind: "A", originPrice: (lo + hi) / 2, zoneLo: lo, zoneHi: hi,
    originTime: Date.UTC(2026, 0, 5) + originIndex * 3_600_000,
    originIndex, touches: 0, flipped: false, fvgOverlap: false,
  };
}

const params = (over: Partial<ContinuationParams> = {}): ContinuationParams => ({
  ...DEFAULT_CONTINUATION_PARAMS, ...over,
});

describe("levelHistory", () => {
  it("counts touches before the break, and stops counting after it", () => {
    // Level spans 100-101. Two candles trade into it, then one closes above.
    const cs = candles([
      [100, 100.5, 99.5, 100.2],
      [100.2, 100.7, 99.8, 100.4],
      [100.4, 101.0, 100.1, 100.6],
      [100.6, 102.5, 100.4, 102.2], // closes above zoneHi + margin
      [102.2, 103.0, 101.9, 102.8],
    ]);
    const h = levelHistory(cs, levelAt(0, 100, 101), cfg);
    expect(h.touchesBefore).toBeGreaterThanOrEqual(1);
    expect(h.breakDir).toBe("LONG");
    expect(h.breakIndex).toBe(3);
  });

  it("reports no break when price never closes through the zone", () => {
    const cs = candles([
      [100, 100.5, 99.5, 100.2],
      [100.2, 100.6, 99.9, 100.3],
      [100.3, 100.7, 100.0, 100.4],
    ]);
    const h = levelHistory(cs, levelAt(0, 100, 101), cfg);
    expect(h.breakDir).toBeNull();
    expect(h.breakIndex).toBe(-1);
  });

  it("tracks the run to an extreme and the pullback after it", () => {
    const cs = candles([
      [100, 100.4, 99.6, 100.2],
      [100.2, 102.0, 100.1, 101.8], // break up
      [101.8, 104.0, 101.5, 103.8], // extreme
      [103.8, 103.9, 102.0, 102.2], // pullback
    ]);
    const h = levelHistory(cs, levelAt(0, 100, 101), cfg);
    expect(h.breakDir).toBe("LONG");
    expect(h.extreme).toBeCloseTo(104.0, 6);
    expect(h.pullback).toBeCloseTo(102.0, 6);
  });
});

describe("retraceDepth", () => {
  it("is near zero when price never comes back", () => {
    const h = { touchesBefore: 1, breakIndex: 1, breakDir: "LONG" as const, extreme: 110, pullback: 109.9 };
    expect(retraceDepth(h, levelAt(0, 100, 101))).toBeLessThan(0.05);
  });

  it("is about one when the whole impulsive leg is retraced", () => {
    const h = { touchesBefore: 1, breakIndex: 1, breakDir: "LONG" as const, extreme: 110, pullback: 100.5 };
    expect(retraceDepth(h, levelAt(0, 100, 101))).toBeGreaterThan(0.9);
  });
});

describe("mostRecentBreakout", () => {
  it("maps an up break to LONG and a down break to SHORT", () => {
    expect(mostRecentBreakout(BULL)?.dir).toBe("LONG");
    expect(mostRecentBreakout(BEAR)?.dir).toBe("SHORT");
  });

  it("finds no breakout where no swing is ever exceeded", () => {
    expect(mostRecentBreakout(FLAT)).toBeNull();
  });
});

describe("multiTfGate", () => {
  it("agrees when every timeframe breaks the same way", () => {
    expect(multiTfGate([BULL, BULL, BULL])).toBe("LONG");
    expect(multiTfGate([BEAR, BEAR])).toBe("SHORT");
  });

  it("returns null when a lower timeframe disagrees — patience, not a signal", () => {
    expect(multiTfGate([BULL, BULL, BEAR])).toBeNull();
    expect(multiTfGate([BEAR, BULL])).toBeNull();
  });

  it("returns null when any timeframe has no breakout at all", () => {
    expect(multiTfGate([BULL, FLAT])).toBeNull();
  });

  it("returns null with no timeframes", () => {
    expect(multiTfGate([])).toBeNull();
  });
});

describe("findContinuationSetups", () => {
  it("returns nothing without a bias, whatever the price does", () => {
    const cs = candles([
      [100, 100.4, 99.6, 100.1], [100.1, 102.0, 100.0, 101.8],
      [101.8, 104.0, 101.5, 103.8], [103.8, 103.9, 102.0, 102.2],
    ]);
    expect(findContinuationSetups(cs, cfg, null)).toEqual([]);
  });

  it("needs at least 40 candles to have any history to reason about", () => {
    const short = candles([[100, 100.4, 99.6, 100.1]]);
    expect(findContinuationSetups(short, cfg, "LONG")).toEqual([]);
  });

  it("produces setups with a positive risk and the configured target multiple", () => {
    // A long, steady advance with pullbacks — plenty of levels and FVGs.
    const rows: [number, number, number, number][] = [];
    let price = 100;
    for (let i = 0; i < 80; i++) {
      const o = price;
      const c = o + (i % 7 === 6 ? -0.25 : 0.35);
      price = c;
      rows.push([o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c]);
    }
    const cs = candles(rows);
    const setups = findContinuationSetups(cs, cfg, "LONG", params({ maxRetraceDepth: 1 }));
    for (const s of setups) {
      expect(s.direction).toBe("LONG");
      expect(Math.abs(s.entry - s.stop)).toBeGreaterThan(0);
      expect(s.rr).toBeCloseTo(params().rr, 6);
      expect(s.level.fvgOverlap).toBe(true);
      expect(s.touchesBefore).toBeGreaterThanOrEqual(params().minTouches);
    }
  });

  it("drops setups whose retracement is deeper than allowed", () => {
    const rows: [number, number, number, number][] = [];
    let price = 100;
    for (let i = 0; i < 80; i++) {
      const o = price;
      const c = o + (i % 7 === 6 ? -0.25 : 0.35);
      price = c;
      rows.push([o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c]);
    }
    const cs = candles(rows);
    const loose = findContinuationSetups(cs, cfg, "LONG", params({ maxRetraceDepth: 1 }));
    const tight = findContinuationSetups(cs, cfg, "LONG", params({ maxRetraceDepth: 0.05 }));
    expect(tight.length).toBeLessThanOrEqual(loose.length);
    for (const s of tight) expect(s.depth).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("gives every setup a stable id that changes with the break", () => {
    const rows: [number, number, number, number][] = [];
    let price = 100;
    for (let i = 0; i < 80; i++) {
      const o = price;
      const c = o + (i % 7 === 6 ? -0.25 : 0.35);
      price = c;
      rows.push([o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c]);
    }
    const cs = candles(rows);
    const setups = findContinuationSetups(cs, cfg, "LONG", params({ maxRetraceDepth: 1 }));
    const ids = new Set(setups.map((s) => s.setupId));
    expect(ids.size).toBe(setups.length);
  });
});
