/** Execution instruction must match what was measured.
 *
 *  Over the 360-day replay on the same alerts the pending limit at the retest
 *  close returned 31.06R against 36.33R for a market entry at the next open,
 *  and 3 alerts never filled the limit at all. The limit wording was the worse
 *  of the three entry models on both the 180d and 360d windows, so the default
 *  is now market. These tests pin both wordings, because the instruction is
 *  what a subscriber actually acts on and silently reverting it would change
 *  their results without changing any number we monitor.
 */
import { describe, expect, it } from "vitest";
import { formatAlert } from "../src/notify";
import type { Alert } from "../src/types";

const T0 = Date.parse("2026-10-08T19:30:00.000Z");

function mkAlert(
  daily: {
    incomplete: boolean;
    bodyToBodyBreakout: "bullish" | "bearish" | "none";
    bias: "bullish" | "bearish" | "neutral";
  } = { incomplete: false, bodyToBodyBreakout: "none", bias: "neutral" },
): Alert {
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

describe("execution instruction", () => {
  it("defaults to a market entry", () => {
    const t = formatAlert(mkAlert());
    expect(t).toContain("MARKET on next candle open");
    expect(t).toContain("Market order on the next candle open");
    expect(t).not.toContain("BUY LIMIT");
    expect(t).not.toContain("not a market entry");
  });

  it("tells the subscriber to re-check the stop, since the fill will differ", () => {
    // The reference price is the retest close, not the fill. Omitting this
    // would have subscribers sizing 1R from a price they did not get.
    expect(formatAlert(mkAlert())).toContain("confirm the stop is still ~1R away");
  });

  it("still renders the limit wording when explicitly asked for", () => {
    const t = formatAlert(mkAlert(), "limit");
    expect(t).toContain("BUY LIMIT");
    expect(t).toContain("not a market entry");
    expect(t).not.toContain("MARKET on next candle open");
  });

  it("matches the direction", () => {
    const short = formatAlert({ ...mkAlert(), direction: "SHORT" } as Alert, "limit");
    expect(short).toContain("SELL LIMIT");
  });
});
