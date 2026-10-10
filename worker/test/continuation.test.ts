import { describe, it, expect } from "vitest";
import type { Candle, KeyLevel } from "../src/types";
import { defaultStrategy } from "../src/config";
import {
  DEFAULT_CONTINUATION_PARAMS,
  breakStrength,
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

describe("levelHistory — which break counts", () => {
  // Both fixtures keep the consolidation tight and the breaks wide, so the
  // flip margin (0.5 * ATR) stays small next to the distance a break travels.
  // A fixture sized the other way round never breaks at all and tests nothing.

  it("uses the MOST RECENT break, not the first", () => {
    // The level forms at the top of a rise, is rejected down through the zone
    // (first break, SHORT), then closes back above it (most recent, LONG).
    // Trading off the first break would call this a short.
    const cs = candles([
      [100.0, 100.3, 99.8, 100.2],
      [100.2, 100.6, 100.0, 100.5],
      [100.5, 100.9, 100.3, 100.8],
      [100.8, 100.9, 100.4, 100.6],
      [100.6, 100.7, 97.4, 97.5], // closes below the zone → first break, SHORT
      [97.5, 97.8, 97.3, 97.7],
      [97.7, 100.7, 97.6, 100.6], // back inside the zone
      [100.6, 100.8, 100.3, 100.5],
      [100.5, 103.2, 100.4, 103.1], // closes above → most recent break, LONG
    ]);
    const h = levelHistory(cs, levelAt(2, 100, 101), cfg);
    expect(h.breaks).toBe(2);
    expect(h.breakDir).toBe("LONG");
    expect(h.breakIndex).toBe(8);
  });

  it("counts only the touches since the previous break", () => {
    const cs = candles([
      [100.0, 100.3, 99.8, 100.2],
      [100.2, 100.6, 100.0, 100.5],
      [100.5, 100.9, 100.3, 100.8],
      [100.8, 100.9, 100.4, 100.6],
      [100.6, 100.7, 97.4, 97.5], // first break down
      [97.5, 100.7, 97.4, 100.6], // back inside → touch 1
      [100.6, 100.8, 100.2, 100.4], // touch 2
      [100.4, 103.2, 100.3, 103.1], // most recent break up
    ]);
    const h = levelHistory(cs, levelAt(2, 100, 101), cfg);
    expect(h.breaks).toBe(2);
    expect(h.breakDir).toBe("LONG");
    expect(h.breakIndex).toBe(7);
    // Touches 1 and 2 only. The touches before the FIRST break belong to that
    // break's story, not this one.
    expect(h.touchesBefore).toBe(2);
  });

  it("treats consecutive closes beyond the zone as one break, not several", () => {
    // An impulsive move closes past the zone on several candles running. Each
    // one is not its own break — the last of them would report zero touches
    // before it and destroy the "tested that held" evidence.
    const cs = candles([
      [100.0, 100.4, 99.8, 100.2],
      [100.2, 100.6, 100.0, 100.5],
      [100.5, 100.8, 100.2, 100.6],
      [100.6, 102.9, 100.4, 102.8], // first close beyond
      [102.8, 103.4, 102.6, 103.2], // still beyond — same break
      [103.2, 103.9, 103.0, 103.7], // still beyond — same break
    ]);
    const h = levelHistory(cs, levelAt(0, 100, 101), cfg);
    expect(h.breaks).toBe(1);
    expect(h.breakIndex).toBe(3);
    expect(h.touchesBefore).toBe(2);
  });
});

describe("retraceDepth", () => {
  it("is near zero when price never comes back", () => {
    const h = { touchesBefore: 1, breakIndex: 1, breakDir: "LONG" as const, breaks: 1, breakPrice: 100, extreme: 110, pullback: 109.9 };
    expect(retraceDepth(h, levelAt(0, 100, 101), "break")).toBeLessThan(0.05);
  });

  it("is about one when the whole impulsive leg is retraced", () => {
    const h = { touchesBefore: 1, breakIndex: 1, breakDir: "LONG" as const, breaks: 1, breakPrice: 100, extreme: 110, pullback: 100.5 };
    expect(retraceDepth(h, levelAt(0, 100, 101), "break")).toBeGreaterThan(0.9);
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

describe("breakStrength", () => {
  const c = (o: number, h: number, l: number, cl: number) => ({ t: 0, o, h, l, c: cl });

  it("reads a wickless candle as fully committed", () => {
    const s = breakStrength(c(100, 105, 100, 105), 1);
    expect(s.bodyPct).toBeCloseTo(1, 6);
    expect(s.bodyAtr).toBeCloseTo(5, 6);
  });

  it("reads a doji as no commitment at all", () => {
    const s = breakStrength(c(102.5, 105, 100, 102.5), 1);
    expect(s.bodyPct).toBeCloseTo(0, 6);
  });

  it("reads a long-wicked crawl through the zone as weak", () => {
    // A big range, a small body: this is a close that happened to land past
    // the level, not an impulsive move through it.
    const s = breakStrength(c(100, 106, 99, 101), 1);
    expect(s.bodyPct).toBeLessThan(0.2);
  });

  it("normalises the body against ATR", () => {
    expect(breakStrength(c(100, 103, 99.9, 103), 1).bodyAtr).toBeCloseTo(3, 6);
    expect(breakStrength(c(100, 103, 99.9, 103), 3).bodyAtr).toBeCloseTo(1, 6);
  });

  it("does not divide by zero on a flat candle or a zero ATR", () => {
    expect(breakStrength(c(100, 100, 100, 100), 1).bodyPct).toBe(0);
    expect(breakStrength(c(100, 103, 99, 103), 0).bodyAtr).toBe(0);
  });
});

/**
 * A hand-built continuation pattern, evaluated as of the tick where the
 * rebalance is happening — which is how the replay sees it.
 *
 * Rise into a level, hold it, break it on a wickless candle that leaves an FVG
 * straddling the level, come back through the level, and stop there.
 */
function continuationPattern(): Candle[] {
  const LVL = 1.1002;
  const rows: [number, number, number, number][] = []; // o, c, l, h
  let p = 1.0960;
  for (let i = 0; i < 26; i++) {
    const o = p; const c = o + 0.0002; p = c;
    rows.push([o, c, o - 0.0001, c + 0.0001]);
  }
  rows.push([1.0992, 1.0996, 1.0991, 1.0997]);
  rows.push([1.0996, 1.0999, 1.0995, 1.1000]);
  rows.push([1.0999, LVL, 1.0998, LVL + 0.0001]);      // unique local max on closes
  rows.push([LVL, 1.0993, 1.0992, LVL]);
  rows.push([1.0993, 1.0986, 1.0985, 1.0994]);
  rows.push([1.0986, 1.0982, 1.0981, 1.0987]);
  rows.push([1.0982, 1.0990, 1.0981, LVL + 0.00005]);
  rows.push([1.0990, 1.0984, 1.0983, 1.0991]);
  rows.push([1.0984, 1.0991, 1.0983, LVL + 0.00005]);
  rows.push([1.0991, 1.0987, 1.0986, 1.0992]);
  rows.push([1.0987, 1.0990, 1.0986, LVL - 0.0002]);   // high below the level
  rows.push([1.0990, 1.1018, 1.0989, 1.1019]);          // impulsive, wickless
  rows.push([1.1018, 1.1028, LVL + 0.0005, 1.1029]);    // gap straddles the level
  rows.push([1.1028, 1.1040, 1.1027, 1.1041]);
  rows.push([1.1040, 1.1022, 1.1021, 1.1041]);
  rows.push([1.1022, 1.1010, 1.1009, 1.1023]);
  const rebalIdx = rows.length;
  rows.push([1.1010, 1.1000, 1.09960, 1.1011]);         // trades through the level
  rows.push([1.1000, 1.1024, 1.0999, 1.1025]);          // resumes
  rows.push([1.1024, 1.1044, 1.1023, 1.1045]);
  return rows.slice(0, rebalIdx + 1).map(([o, c, l, h], i) => ({
    t: Date.UTC(2026, 0, 1) + i * 3_600_000, o, c, h, l,
  }));
}

describe("findContinuationSetups", () => {
  it("emits a well-formed setup from the full pattern", () => {
    // minTouches 0: the level that qualifies here is the impulsive candle's own
    // DECISION zone, which by construction has no touches before its break.
    // The touch requirement is asserted separately below.
    const s = findContinuationSetups(continuationPattern(), cfg, "LONG",
      params({ maxRetraceDepth: 10, minTouches: 0 }));
    expect(s.length).toBeGreaterThanOrEqual(1);
    for (const x of s) {
      expect(x.level.fvgOverlap).toBe(true);
      // A long must have its stop below the entry and its target above it.
      expect(x.stop).toBeLessThan(x.entry);
      expect(x.tp).toBeGreaterThan(x.entry);
      expect(x.entry - x.stop).toBeGreaterThan(0);
      expect(x.rr).toBeCloseTo(3, 6);
    }
  });

  it("does not change the baseline while the impulsive test is off", () => {
    const off = findContinuationSetups(continuationPattern(), cfg, "LONG",
      params({ maxRetraceDepth: 10, minTouches: 0 }));
    expect(DEFAULT_CONTINUATION_PARAMS.minBreakBodyPct).toBe(0);
    expect(DEFAULT_CONTINUATION_PARAMS.minBreakAtrMult).toBe(0);
    expect(off.length).toBeGreaterThanOrEqual(1);
    // Every emitted setup carries the measurement even when nothing gates on it.
    for (const x of off) expect(x.bodyPct).toBeGreaterThan(0);
  });

  it("removes the setup when the break candle is not impulsive enough", () => {
    const strict = findContinuationSetups(continuationPattern(), cfg, "LONG",
      params({ maxRetraceDepth: 10, minTouches: 0, minBreakBodyPct: 0.999999 }));
    expect(strict).toEqual([]);
  });

  it("drops the pattern when a prior touch is required and there was none", () => {
    expect(findContinuationSetups(continuationPattern(), cfg, "LONG",
      params({ maxRetraceDepth: 10, minTouches: 1 }))).toEqual([]);
  });

  it("rejects the pattern when the pullback never reaches the entry price", () => {
    // The rebalance is the trade. A level that broke and kept running has not
    // been retested, so there is no limit to fill and nothing to enter.
    const all = continuationPattern();
    const beforeRebalance = all.slice(0, all.length - 1);
    expect(findContinuationSetups(beforeRebalance, cfg, "LONG",
      params({ maxRetraceDepth: 10 }))).toEqual([]);
  });

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
