/** Regression coverage for informational notifications: context cards must
 * never read like confirmed entries. */
import { describe, expect, it } from "vitest";
import { formatBiasCard, formatWatch } from "../src/notify";
import type { DirectionalBiasDiagnostics } from "../src/shadow";
import type { EngineEvent } from "../src/types";

const watchEvent: EngineEvent = {
  setupId: "EURUSD:30m:SHORT:V:1.0850:2026-10-06T10:00:00.000Z",
  pair: "EURUSD",
  state: "SHIFT",
  candleTime: Date.UTC(2026, 9, 6, 10),
  reason: "BOS structure shift",
  price: 1.085,
};

const bias: DirectionalBiasDiagnostics = {
  classification: "A_GRADE",
  weekly: {
    weeklyHighSwept: false,
    weeklyLowSwept: true,
    opposingLiquidityStanding: true,
    primaryOpposingTarget: 1.12,
  },
  daily: {
    bias: "bullish",
    bodyToBodyBreakout: "bullish",
    liquiditySweepPlusStructureBreak: false,
    sweepDirection: null,
    incomplete: false,
  },
  h4: { direction: "bullish", breakoutStatus: "bullish_breakout", hasStructureBreak: true },
  h1: { direction: "bullish", agreesWith4H: true },
  entryQuality: {
    lowerTimeframeSweep: true,
    bosStructureShift: true,
    fvgDetected: true,
    fvgRebalanceDetected: true,
    retestDetected: true,
  },
  timeframeRole: { entryTf: "30m", structuralTf: "4h", executionContextTf: "1h" },
};

describe("informational Telegram card labels", () => {
  it("marks watch cards as pre-entry context, never as entries", () => {
    const card = formatWatch(watchEvent, "30m");
    expect(card).toContain("WATCH — NOT AN ENTRY");
    expect(card).toContain("Pre-entry context only. No entry exists unless a separate confirmed-entry alert is generated.");
    expect(card).toContain("No order was placed.");
  });

  it("marks bias cards as context, not confirmation entries", () => {
    const card = formatBiasCard("EURUSD", "LONG", bias);
    expect(card).toContain("TAYO BIAS CONTEXT — NOT AN ENTRY");
    expect(card).toContain("Context only—not an entry.");
    expect(card).not.toContain("BIAS CONFIRMATION");
  });
});
