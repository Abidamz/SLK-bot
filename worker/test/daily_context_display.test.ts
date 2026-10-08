/** Daily-context line must not overstate what the model actually knows.
 *
 *  `evaluateDailyContext` marks `incomplete` when fewer than 10 closed daily
 *  bars are available, and `classifyShadowSetup` returns OBSERVATION_ONLY on
 *  that basis. But `bodyToBodyBreakout` only needs 2 bars, so the rendered
 *  line used to read a confident "Bullish Breakout" on a setup the model had
 *  already graded observation-only — the alert looked confirming while the
 *  model was saying it could not assess the context.
 *
 *  Observed live 2026-10-08 on V100_1S:30m:LONG (a synthetic with thin daily
 *  history), shown as "Daily Cont. : Bullish Breakout" alongside
 *  "Bias Grade : 👀 OBSERVATION_ONLY". The setup hit SL for -1R. */
import { describe, expect, it } from "vitest";
import { formatAlert } from "../src/notify";
import type { Alert } from "../src/types";

const T0 = Date.parse("2026-10-08T19:30:00.000Z");

function mkAlert(daily: {
  incomplete: boolean;
  bodyToBodyBreakout: "bullish" | "bearish" | "none";
  bias: "bullish" | "bearish" | "neutral";
}): Alert {
  return {
    setupId: "V100_1S:30m:LONG:OC:1249.560000:2026-10-07T08:00:00.000Z",
    pair: "V100_1S", entryTf: "30m", mapTf: "4h", direction: "LONG",
    entry: 1260.58, stopLoss: 1235.58, tpInternal: 1328.1, tpExternal: 1350,
    candleCloseTime: T0,
    environment: "bullish", phase: "expansion", htfAlignment: "H4:↑",
    originKeyLevel: 1249.56, keyLevelType: "OC",
    keyLevelBounds: [1240.4, 1258.72], keyLevelTested: true, keyLevelFlipped: true,
    imbalanceContext: [], internalLiquidity: [], externalLiquidity: [],
    drawOnLiquidity: 1328.1, nearestExternalTarget: 1350, intermediateZones: [],
    opposingLiquidityStanding: true,
    sweepTime: T0 - 3600_000, bosTime: T0 - 3600_000, returnTime: T0 - 1800_000,
    invalidationLevel: 1251.75, invalidationReason: null, parameterVersion: "1",
    alertStatus: "PAPER", suppressReason: null, session: null,
    atrEntry: 25, rrInternal: 2.7, cycleStage: "entry_alert", entryMode: "confirmation",
    originTime: Date.parse("2026-10-07T08:00:00.000Z"),
    shadowClassification: "OBSERVATION_ONLY",
    directionalBias: {
      weekly: {
        weeklyHighSwept: true, weeklyLowSwept: false,
        primaryOpposingTarget: 1185.74, opposingLiquidityStanding: true,
      },
      daily: {
        bias: daily.bias,
        bodyToBodyBreakout: daily.bodyToBodyBreakout,
        liquiditySweepPlusStructureBreak: false,
        sweepDirection: null,
        incomplete: daily.incomplete,
      },
      h4: { direction: "bullish", breakoutStatus: "bullish_breakout", hasStructureBreak: true },
      h1: { direction: "bullish", agreesWith4H: true },
      entryQuality: {
        lowerTimeframeSweep: true, bosStructureShift: true,
        fvgDetected: true, fvgRebalanceDetected: false, retestDetected: true,
      },
    },
  } as unknown as Alert;
}

describe("daily context line", () => {
  it("does not claim a breakout when daily history is incomplete", () => {
    const text = formatAlert(mkAlert({ incomplete: true, bodyToBodyBreakout: "bullish", bias: "bullish" }));
    expect(text).toContain("Insufficient history");
    expect(text).not.toContain("Bullish Breakout");
  });

  it("still reports a bullish breakout when daily history is sufficient", () => {
    const text = formatAlert(mkAlert({ incomplete: false, bodyToBodyBreakout: "bullish", bias: "bullish" }));
    expect(text).toContain("Bullish Breakout");
    expect(text).not.toContain("Insufficient history");
  });

  it("still reports a bearish breakout when daily history is sufficient", () => {
    const text = formatAlert(mkAlert({ incomplete: false, bodyToBodyBreakout: "bearish", bias: "bearish" }));
    expect(text).toContain("Bearish Breakout");
  });

  it("reports Neutral, not 'insufficient', when there is history but no breakout", () => {
    const text = formatAlert(mkAlert({ incomplete: false, bodyToBodyBreakout: "none", bias: "neutral" }));
    expect(text).toContain("Daily Cont. : Neutral");
    expect(text).not.toContain("Insufficient history");
  });
});
