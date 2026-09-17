/** Deterministic tests for video-aligned directional bias shadow classification.
 *
 *  Verifies:
 *    - aligned 1H/4H bearish setup
 *    - aligned 1H/4H bullish setup
 *    - 1H/4H conflict
 *    - neutral 1H
 *    - missing weekly/daily context
 *    - valid sweep plus FVG rebalance
 *    - sweep without rebalance
 *    - existing alert output unchanged
 *
 *  All candles are synthetic logic fixtures — no live network, no execution.
 */
import { describe, expect, it } from "vitest";
import { defaultStrategy } from "../src/config";
import { scanEntry } from "../src/engine";
import {
  evaluateDirectionalBias,
  evaluateWeeklyContext,
  evaluateDailyContext,
  evaluateH4VantageContext,
  evaluateH1ExecutionContext,
  detectFvgAndRebalance,
  type DirectionalBiasDiagnostics,
} from "../src/shadow";
import type { Candle, Direction } from "../src/types";
import {
  BASE,
  LONG_ROWS,
  LONG_STORY,
  SHORT_ROWS,
  SHORT_STORY,
  mkCandles,
  snapsFor,
} from "./fixtures";

const cfg = { ...defaultStrategy(), minRiskAtr: 0.1 };

// ── Synthetic candle helpers ───────────────────────────────────────────────

function makeCandle(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c };
}

/** Construct a sequence of candles with timestamps incrementing by stepMinutes. */
function buildPath(
  ohlc: [number, number, number, number][],
  stepMin: number,
  baseTime = BASE,
): Candle[] {
  return ohlc.map(([o, h, l, c], i) => ({
    t: baseTime + i * stepMin * 60_000,
    o, h, l, c,
  }));
}

/** Bearish H4 series with confirmed LH / LL swings and downward BOS. */
function makeBearishH4(): Candle[] {
  // 30 bars with clear lower highs and lower lows
  const closes = [
    110, 109, 108, 107, 106, 105, 104, 103, // lead in
    102, 101, 100, 102, 104, 105, 104, 102, // swing high 105 at idx 13
    100, 98, 96, 95, 96, 98, 100, 99,       // swing low 95 at idx 19
    97, 95, 93, 91, 90, 89,                  // LL break downward
  ];
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return makeCandle(BASE - (closes.length - i) * 4 * 3600_000, o, Math.max(o, c) + 0.5, Math.min(o, c) - 0.5, c);
  });
}

/** Bullish H4 series with confirmed HH / HL swings and upward BOS. */
function makeBullishH4(): Candle[] {
  const closes = [
    90, 91, 92, 93, 94, 95, 96, 97,         // lead in
    98, 99, 100, 98, 96, 95, 96, 98,        // swing low 95 at idx 13
    100, 102, 104, 105, 104, 102, 100, 101, // swing high 105 at idx 19
    103, 105, 107, 109, 110, 111,           // HH break upward
  ];
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return makeCandle(BASE - (closes.length - i) * 4 * 3600_000, o, Math.max(o, c) + 0.5, Math.min(o, c) - 0.5, c);
  });
}

/** Bearish 1H series. */
function makeBearishH1(): Candle[] {
  const closes = [
    106, 105.5, 105, 104.5, 104, 103.5, 103, 102.5,
    102, 103, 104, 103.5, 103, 102, 101, 100,
    101, 102, 101.5, 100.5, 99.5, 98.5, 97.5, 97,
  ];
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return makeCandle(BASE - (closes.length - i) * 3600_000, o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c);
  });
}

/** Bullish 1H series. */
function makeBullishH1(): Candle[] {
  const closes = [
    94, 94.5, 95, 95.5, 96, 96.5, 97, 97.5,
    98, 97, 96, 96.5, 97, 98, 99, 100,
    99, 98, 98.5, 99.5, 100.5, 101.5, 102.5, 103,
  ];
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return makeCandle(BASE - (closes.length - i) * 3600_000, o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c);
  });
}

/** Flat / consolidation 1H series (neutral). */
function makeNeutralH1(): Candle[] {
  return Array.from({ length: 24 }, (_, i) => {
    const mid = 100.0;
    const offset = (i % 2 === 0 ? 0.05 : -0.05);
    return makeCandle(BASE - (24 - i) * 3600_000, mid, mid + 0.1, mid - 0.1, mid + offset);
  });
}

/** 22 daily candles with a bearish body-to-body breakout on the latest bar
 *  and prior week high swept while prior week low stands. */
function makeBearishDaily(): Candle[] {
  const out: Candle[] = [];
  const dayMs = 86400_000;
  // Weeks 7 & 8 (14 days, from -21d to -8d)
  for (let i = 21; i >= 8; i--) {
    const p = 108 - (21 - i) * 0.1;
    out.push(makeCandle(BASE - i * dayMs, p, p + 0.5, p - 0.5, p - 0.1));
  }
  // Week 9 (7 days, from -7d to -1d: 2024-02-26 to 2024-03-03)
  // High = 107.0, Low = 100.0
  out.push(makeCandle(BASE - 7 * dayMs, 105.0, 106.0, 103.0, 104.0));
  out.push(makeCandle(BASE - 6 * dayMs, 104.0, 107.0, 103.0, 106.0)); // Week 9 high 107.0
  out.push(makeCandle(BASE - 5 * dayMs, 106.0, 106.5, 102.0, 103.0));
  out.push(makeCandle(BASE - 4 * dayMs, 103.0, 104.0, 100.0, 101.0)); // Week 9 low 100.0
  out.push(makeCandle(BASE - 3 * dayMs, 101.0, 103.0, 101.0, 102.5));
  out.push(makeCandle(BASE - 2 * dayMs, 102.5, 104.5, 102.0, 104.0));
  out.push(makeCandle(BASE - 1 * dayMs, 104.0, 106.0, 104.0, 105.5)); // Yesterday body [104.0, 105.5]

  // Week 10 (today: 2024-03-04)
  // Swept W9 high (107.5 > 107.0), low 103.5 > 100.0 (W9 low stands!),
  // close 103.6 < 104.0 (bearish body-to-body break)
  out.push(makeCandle(BASE, 106.0, 107.5, 103.5, 103.6));
  return out;
}

/** 22 daily candles with a bullish body-to-body breakout on the latest bar
 *  and prior week low swept while prior week high stands. */
function makeBullishDaily(): Candle[] {
  const out: Candle[] = [];
  const dayMs = 86400_000;
  // Weeks 7 & 8 (14 days, from -21d to -8d)
  for (let i = 21; i >= 8; i--) {
    const p = 92 + (21 - i) * 0.1;
    out.push(makeCandle(BASE - i * dayMs, p, p + 0.5, p - 0.5, p + 0.1));
  }
  // Week 9 (7 days, from -7d to -1d: 2024-02-26 to 2024-03-03)
  // Low = 93.0, High = 100.0
  out.push(makeCandle(BASE - 7 * dayMs, 95.0, 97.0, 94.0, 96.0));
  out.push(makeCandle(BASE - 6 * dayMs, 96.0, 97.0, 93.0, 94.0)); // Week 9 low 93.0
  out.push(makeCandle(BASE - 5 * dayMs, 94.0, 98.0, 94.0, 97.0));
  out.push(makeCandle(BASE - 4 * dayMs, 97.0, 100.0, 96.0, 99.0)); // Week 9 high 100.0
  out.push(makeCandle(BASE - 3 * dayMs, 99.0, 99.5, 96.5, 97.0));
  out.push(makeCandle(BASE - 2 * dayMs, 97.0, 98.0, 95.5, 96.0));
  out.push(makeCandle(BASE - 1 * dayMs, 96.0, 96.5, 94.0, 94.5)); // Yesterday body [94.5, 96.0]

  // Week 10 (today: 2024-03-04)
  // Swept W9 low (92.5 < 93.0), high 97.0 < 100.0 (W9 high stands!),
  // close 96.8 > 96.0 (bullish body-to-body break)
  out.push(makeCandle(BASE, 94.0, 97.0, 92.5, 96.8));
  return out;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("video-aligned directional bias shadow classification", () => {
  it("aligned 1H/4H bearish setup earns A_GRADE with full confluence", () => {
    const d1 = makeBearishDaily();
    const h4 = makeBearishH4();
    const h1 = makeBearishH1();
    const entry30m = mkCandles(SHORT_ROWS, 30);

    const diag = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "SHORT",
      entryCandles: entry30m,
      d1Candles: d1,
      h4Candles: h4,
      h1Candles: h1,
      cfg,
      setup: {
        sweepTime: entry30m[10].t,
        sweepIndex: 10,
        bosTime: entry30m[11].t,
        bosIndex: 11,
        retestTime: entry30m[14].t,
        retestIndex: 14,
      },
    });

    expect(diag.timeframeRole).toEqual({
      entryTf: "30m",
      structuralTf: "4h",
      executionContextTf: "1h",
    });

    // 1. Weekly liquidity context
    expect(diag.weekly.primaryOpposingTarget).not.toBeNull();
    expect(diag.weekly.opposingLiquidityStanding).toBe(true);

    // 2. Daily context
    expect(diag.daily.incomplete).toBe(false);
    expect(diag.daily.bias).toBe("bearish");
    expect(diag.daily.bodyToBodyBreakout).toBe("bearish");

    // 3. 4H Vantage context
    expect(diag.h4.direction).toBe("bearish");

    // 4. 1H Execution context
    expect(diag.h1.direction).toBe("bearish");
    expect(diag.h1.agreesWith4H).toBe(true);

    // 5. Entry quality
    expect(diag.entryQuality.lowerTimeframeSweep).toBe(true);
    expect(diag.entryQuality.bosStructureShift).toBe(true);
    expect(diag.entryQuality.fvgDetected).toBe(true);
    expect(diag.entryQuality.fvgRebalanceDetected).toBe(true);
    expect(diag.entryQuality.retestDetected).toBe(true);

    // 6. Classification
    expect(diag.classification).toBe("A_GRADE");
  });

  it("aligned 1H/4H bullish setup earns A_GRADE with full confluence", () => {
    const d1 = makeBullishDaily();
    const h4 = makeBullishH4();
    const h1 = makeBullishH1();
    const entry30m = mkCandles(LONG_ROWS, 30);

    const diag = evaluateDirectionalBias({
      pair: "GBPUSD",
      entryTf: "30m",
      direction: "LONG",
      entryCandles: entry30m,
      d1Candles: d1,
      h4Candles: h4,
      h1Candles: h1,
      cfg,
      setup: {
        sweepTime: entry30m[10].t,
        sweepIndex: 10,
        bosTime: entry30m[11].t,
        bosIndex: 11,
        retestTime: entry30m[14].t,
        retestIndex: 14,
      },
    });

    // Weekly & Daily
    expect(diag.weekly.opposingLiquidityStanding).toBe(true);
    expect(diag.daily.bias).toBe("bullish");
    expect(diag.daily.bodyToBodyBreakout).toBe("bullish");

    // 4H & 1H alignment
    expect(diag.h4.direction).toBe("bullish");
    expect(diag.h1.direction).toBe("bullish");
    expect(diag.h1.agreesWith4H).toBe(true);

    // Entry quality
    expect(diag.entryQuality.lowerTimeframeSweep).toBe(true);
    expect(diag.entryQuality.bosStructureShift).toBe(true);
    expect(diag.entryQuality.fvgDetected).toBe(true);
    expect(diag.entryQuality.fvgRebalanceDetected).toBe(true);
    expect(diag.entryQuality.retestDetected).toBe(true);

    // Classification
    expect(diag.classification).toBe("A_GRADE");
  });

  it("1H/4H conflict is diagnosed as HTF_CONFLICT", () => {
    const d1 = makeBearishDaily();
    const h4 = makeBearishH4(); // 4H is bearish
    const h1 = makeBullishH1(); // 1H is bullish -> conflict!
    const entry30m = mkCandles(SHORT_ROWS, 30);

    const diag = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "SHORT",
      entryCandles: entry30m,
      d1Candles: d1,
      h4Candles: h4,
      h1Candles: h1,
      cfg,
    });

    expect(diag.h4.direction).toBe("bearish");
    expect(diag.h1.direction).toBe("bullish");
    expect(diag.h1.agreesWith4H).toBe(false);
    expect(diag.classification).toBe("HTF_CONFLICT");

    // Mirrored conflict: 4H bullish vs 1H bearish
    const h4Bull = makeBullishH4();
    const h1Bear = makeBearishH1();
    const diagMirror = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "LONG",
      entryCandles: mkCandles(LONG_ROWS, 30),
      d1Candles: makeBullishDaily(),
      h4Candles: h4Bull,
      h1Candles: h1Bear,
      cfg,
    });
    expect(diagMirror.h1.agreesWith4H).toBe(false);
    expect(diagMirror.classification).toBe("HTF_CONFLICT");
  });

  it("neutral 1H execution context is diagnosed as OBSERVATION_ONLY", () => {
    const d1 = makeBearishDaily();
    const h4 = makeBearishH4();
    const h1Neutral = makeNeutralH1(); // no trend
    const entry30m = mkCandles(SHORT_ROWS, 30);

    const diag = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "SHORT",
      entryCandles: entry30m,
      d1Candles: d1,
      h4Candles: h4,
      h1Candles: h1Neutral,
      cfg,
    });

    expect(diag.h4.direction).toBe("bearish");
    expect(diag.h1.direction).toBe("neutral");
    expect(diag.h1.agreesWith4H).toBe(false);
    expect(diag.classification).toBe("OBSERVATION_ONLY");
  });

  it("missing weekly/daily context is diagnosed as OBSERVATION_ONLY", () => {
    const h4 = makeBearishH4();
    const h1 = makeBearishH1();
    const entry30m = mkCandles(SHORT_ROWS, 30);

    // Empty daily feed
    const diagEmpty = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "SHORT",
      entryCandles: entry30m,
      d1Candles: [],
      h4Candles: h4,
      h1Candles: h1,
      cfg,
    });

    expect(diagEmpty.daily.incomplete).toBe(true);
    expect(diagEmpty.weekly.primaryOpposingTarget).toBeNull();
    expect(diagEmpty.classification).toBe("OBSERVATION_ONLY");

    // Insufficient daily feed (< 10 bars)
    const diagShort = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "SHORT",
      entryCandles: entry30m,
      d1Candles: makeBearishDaily().slice(0, 5),
      h4Candles: h4,
      h1Candles: h1,
      cfg,
    });

    expect(diagShort.daily.incomplete).toBe(true);
    expect(diagShort.classification).toBe("OBSERVATION_ONLY");
  });

  it("valid sweep plus FVG rebalance earns A_GRADE", () => {
    // SHORT_ROWS has:
    // Bar 10: high 105.10 touches origin and sweeps 104.55 internal liquidity
    // Bar 11: BOS candle down (o:104.50, h:104.62, l:103.85, c:103.90)
    // Bar 12: (o:103.90, h:103.95, l:103.55, c:103.60)
    // Gap between bar 10 low (104.30) and bar 12 high (103.95) forms a bearish FVG
    // Bar 14: pulls back to high 105.00, rebalancing the 103.95-104.30 gap
    const entry30m = mkCandles(SHORT_ROWS, 30);
    const fvgCheck = detectFvgAndRebalance(entry30m, "SHORT", 10, 14);

    expect(fvgCheck.fvgDetected).toBe(true);
    expect(fvgCheck.fvgRebalanceDetected).toBe(true);
    expect(fvgCheck.fvgRange).not.toBeNull();

    const diag = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "SHORT",
      entryCandles: entry30m,
      d1Candles: makeBearishDaily(),
      h4Candles: makeBearishH4(),
      h1Candles: makeBearishH1(),
      cfg,
      setup: {
        sweepTime: entry30m[10].t,
        sweepIndex: 10,
        bosTime: entry30m[11].t,
        bosIndex: 11,
        retestTime: entry30m[14].t,
        retestIndex: 14,
      },
    });

    expect(diag.entryQuality.lowerTimeframeSweep).toBe(true);
    expect(diag.entryQuality.fvgDetected).toBe(true);
    expect(diag.entryQuality.fvgRebalanceDetected).toBe(true);
    expect(diag.entryQuality.bosStructureShift).toBe(true);
    expect(diag.entryQuality.retestDetected).toBe(true);
    expect(diag.classification).toBe("A_GRADE");
  });

  it("sweep without rebalance is diagnosed as B_GRADE", () => {
    // Construct a setup where sweep, BOS, and retest happen,
    // and an FVG is created, but subsequent candles never reach into it before retest.
    const modifiedRows: [number, number, number, number][] = [
      [103.80, 103.86, 103.74, 103.82], // 0
      [103.82, 103.92, 103.78, 103.90], // 1
      [103.90, 104.04, 103.86, 104.00], // 2
      [104.00, 104.15, 103.95, 104.10], // 3
      [104.10, 104.55, 104.05, 104.50], // 4 swing high 104.55
      [104.50, 104.52, 104.25, 104.30], // 5
      [104.30, 104.33, 104.10, 104.15], // 6
      [104.15, 104.20, 104.03, 104.06], // 7 swing low 104.03
      [104.06, 104.30, 104.06, 104.25], // 8
      [104.25, 104.40, 104.20, 104.35], // 9
      [104.35, 105.10, 104.30, 104.50], // 10 sweep (l=104.30)
      [104.50, 104.62, 103.85, 103.90], // 11 BOS (l=103.85)
      [103.90, 104.00, 103.55, 103.60], // 12 (h=104.00 < 104.30 -> FVG [104.00, 104.30])
      [103.60, 103.88, 103.50, 103.55], // 13 (h=103.88)
      [103.55, 103.90, 103.50, 103.80], // 14 retest (h=103.90 < 104.00 -> FVG NOT rebalanced)
    ];
    const candles = mkCandles(modifiedRows, 30);
    const fvgCheck = detectFvgAndRebalance(candles, "SHORT", 10, 14);
    expect(fvgCheck.fvgDetected).toBe(true);
    expect(fvgCheck.fvgRebalanceDetected).toBe(false);

    const diag = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "30m",
      direction: "SHORT",
      entryCandles: candles,
      d1Candles: makeBearishDaily(),
      h4Candles: makeBearishH4(),
      h1Candles: makeBearishH1(),
      cfg,
      setup: {
        sweepTime: candles[10].t,
        sweepIndex: 10,
        bosTime: candles[11].t,
        bosIndex: 11,
        retestTime: candles[14].t,
        retestIndex: 14,
      },
    });

    expect(diag.entryQuality.lowerTimeframeSweep).toBe(true);
    expect(diag.entryQuality.bosStructureShift).toBe(true);
    expect(diag.entryQuality.fvgDetected).toBe(true);
    expect(diag.entryQuality.fvgRebalanceDetected).toBe(false);
    expect(diag.entryQuality.retestDetected).toBe(true);
    expect(diag.h1.agreesWith4H).toBe(true);
    expect(diag.classification).toBe("B_GRADE");
  });

  it("existing alert output unchanged (exact baseline parity)", () => {
    // 1. Short confirmation baseline
    const shortCandles = mkCandles(SHORT_ROWS, 30);
    const shortResult = scanEntry({
      pair: "EURUSD",
      entryTf: "30m",
      tfSeconds: 1800,
      candles: shortCandles,
      snaps: snapsFor(SHORT_STORY),
      cfg,
      mode: "paper",
      provider: "test",
    });

    expect(shortResult.alerts).toHaveLength(1);
    const shortAlert = shortResult.alerts[0];
    expect(shortAlert.direction).toBe("SHORT");
    expect(shortAlert.entry).toBe(104.9);
    expect(shortAlert.invalidationLevel).toBeCloseTo(105.1);
    expect(shortAlert.stopLoss).toBeGreaterThan(105.1);
    expect(shortAlert.tpInternal).toBe(104.0);
    expect(shortAlert.tpExternal).toBe(101.0);
    expect(shortAlert.sweepTime).toBe(shortCandles[10].t);
    expect(shortAlert.bosTime).toBe(shortCandles[11].t);
    expect(shortAlert.returnTime).toBe(shortCandles[14].t);
    expect(shortAlert.keyLevelType).toBe("A");
    expect(shortAlert.keyLevelBounds).toEqual([104.95, 105.05]);
    expect(shortAlert.keyLevelTested).toBe(true);
    expect(shortAlert.environment).toBe("bearish");
    expect(shortAlert.phase).toBe("pullback");
    expect(shortAlert.opposingLiquidityStanding).toBe(true);
    expect(shortAlert.entryMode).toBe("confirmation");
    expect(shortAlert.alertStatus).toBe("PAPER");
    expect(shortResult.events.map((e) => e.state)).toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]);
    expect(shortResult.diagnostics).toEqual({
      MAP: 1, TOUCH: 1, SWEEP: 1, SHIFT: 1, RETEST: 1, INVALID: 0, EXPIRED: 0,
      retestCandidates: 1, riskRejects: 0,
      riskRejectReasons: { nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0 },
      targetRejects: 0, confirmedAlerts: 1,
    });

    // Shadow classification is attached observationally without mutating alert fields
    expect(shortAlert.shadowClassification).toBeDefined();
    expect(shortAlert.directionalBias).toBeDefined();

    // 2. Long confirmation baseline
    const longCandles = mkCandles(LONG_ROWS, 30);
    const longResult = scanEntry({
      pair: "GBPUSD",
      entryTf: "30m",
      tfSeconds: 1800,
      candles: longCandles,
      snaps: snapsFor(LONG_STORY),
      cfg,
      mode: "paper",
      provider: "test",
    });

    expect(longResult.alerts).toHaveLength(1);
    const longAlert = longResult.alerts[0];
    expect(longAlert.direction).toBe("LONG");
    expect(longAlert.entry).toBe(98.1);
    expect(longAlert.invalidationLevel).toBeCloseTo(96.9);
    expect(longAlert.stopLoss).toBeLessThan(96.9);
    expect(longAlert.tpInternal).toBeCloseTo(101.8857857143, 5);
    expect(longAlert.tpExternal).toBe(103.0);
    expect(longAlert.rrInternal).toBeGreaterThanOrEqual(3);
    expect(longResult.events.map((e) => e.state)).toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]);

    // 3. Replay determinism
    const repeatShort = scanEntry({
      pair: "EURUSD",
      entryTf: "30m",
      tfSeconds: 1800,
      candles: shortCandles,
      snaps: snapsFor(SHORT_STORY),
      cfg,
      mode: "paper",
      provider: "test",
    });
    expect(repeatShort.alerts.map((a) => a.setupId)).toEqual(shortResult.alerts.map((a) => a.setupId));
    expect(repeatShort.events).toEqual(shortResult.events);
    expect(repeatShort.diagnostics).toEqual(shortResult.diagnostics);
  });

  it("evaluates 1H entries where 4H is structural direction and 1H provides entry confirmation", () => {
    const entry1h = mkCandles(SHORT_ROWS, 60); // 1H entry candles
    const h4 = makeBearishH4();
    const d1 = makeBearishDaily();

    const diag = evaluateDirectionalBias({
      pair: "EURUSD",
      entryTf: "1h",
      direction: "SHORT",
      entryCandles: entry1h,
      d1Candles: d1,
      h4Candles: h4,
      cfg,
      setup: {
        sweepTime: entry1h[10].t,
        sweepIndex: 10,
        bosTime: entry1h[11].t,
        bosIndex: 11,
        retestTime: entry1h[14].t,
        retestIndex: 14,
      },
    });

    expect(diag.timeframeRole).toEqual({
      entryTf: "1h",
      structuralTf: "4h",
      executionContextTf: "1h",
    });
    expect(diag.h4.direction).toBe("bearish");
    // 1H entry confirmation: sweep, BOS, FVG rebalance, retest are provided by 1H
    expect(diag.entryQuality.lowerTimeframeSweep).toBe(true);
    expect(diag.entryQuality.bosStructureShift).toBe(true);
    expect(diag.entryQuality.fvgDetected).toBe(true);
    expect(diag.entryQuality.fvgRebalanceDetected).toBe(true);
    expect(diag.entryQuality.retestDetected).toBe(true);
  });
});
