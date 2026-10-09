/** observationOnlyReason must name the condition that actually demoted a
 *  setup — and must agree with classifyShadowSetup on every branch.
 *
 *  Motivation: OBSERVATION_ONLY collapses six distinct conditions into one
 *  label. On 2026-10-08 a delivered V100_1S:30m:LONG rendered full entry
 *  quality ticks and "Bullish Breakout" underneath "Bias Grade:
 *  OBSERVATION_ONLY", then hit SL for -1R — and nothing in the alert said
 *  which check had failed. Guessing at the cause afterwards is unreliable;
 *  naming it at render time is not. */
import { describe, expect, it } from "vitest";
import {
  classifyShadowSetup,
  observationOnlyReason,
  type DailyContext,
  type EntryQuality,
  type H1ExecutionContext,
  type H4VantageContext,
  type WeeklyLiquidityContext,
} from "../src/shadow";

const weeklyOk: WeeklyLiquidityContext = {
  weeklyHighSwept: true, weeklyLowSwept: false,
  primaryOpposingTarget: 1185.74, opposingLiquidityStanding: true,
};

const dailyOk: DailyContext = {
  bias: "bullish", bodyToBodyBreakout: "bullish",
  liquiditySweepPlusStructureBreak: false, sweepDirection: null, incomplete: false,
};

const h4Ok: H4VantageContext = { direction: "bullish", breakoutStatus: "bullish_breakout", hasStructureBreak: true };
const h1Ok: H1ExecutionContext = { direction: "bullish", agreesWith4H: true };

const eqOk: EntryQuality = {
  lowerTimeframeSweep: true, bosStructureShift: true,
  fvgDetected: true, fvgRebalanceDetected: false, retestDetected: true,
};

function grade(over: Partial<Parameters<typeof classifyShadowSetup>[0]> = {}) {
  const args = {
    direction: "LONG" as const,
    weekly: weeklyOk, daily: dailyOk, h4: h4Ok, h1: h1Ok, entryQuality: eqOk,
    ...over,
  };
  return {
    classification: classifyShadowSetup(args),
    reason: observationOnlyReason(args),
  };
}

describe("observationOnlyReason", () => {
  it("returns null for a clean B_GRADE setup", () => {
    const { classification, reason } = grade();
    expect(classification).toBe("B_GRADE");
    expect(reason).toBeNull();
  });

  it("returns null for A_GRADE (FVG rebalanced) too", () => {
    const { classification, reason } = grade({
      entryQuality: { ...eqOk, fvgRebalanceDetected: true },
    });
    expect(classification).toBe("A_GRADE");
    expect(reason).toBeNull();
  });

  // Each of the six OBSERVATION_ONLY branches, named distinctly.
  const cases: Array<[string, Partial<Parameters<typeof classifyShadowSetup>[0]>, string]> = [
    ["insufficient daily history", { daily: { ...dailyOk, incomplete: true } }, "insufficient daily history"],
    ["no opposing target", { weekly: { ...weeklyOk, primaryOpposingTarget: null } }, "opposing liquidity target"],
    ["daily bias conflicts", { daily: { ...dailyOk, bias: "bearish", bodyToBodyBreakout: "bearish" } }, "daily bias is bearish"],
    ["neutral 1H", { h1: { direction: "neutral", agreesWith4H: true } }, "1H execution context is neutral"],
    // Reachable only when both point the same way but the flag disagrees:
    // opposing directions are caught as HTF_CONFLICT upstream.
    ["1H agreement flag", { h1: { direction: "bullish", agreesWith4H: false } }, "1H disagrees with 4H"],
    ["neutral 4H", { h4: { direction: "neutral", breakoutStatus: "none", hasStructureBreak: false } }, "4H vantage is neutral"],
    ["opposing liquidity taken", { weekly: { ...weeklyOk, opposingLiquidityStanding: false } }, "opposing liquidity already taken"],
    ["missing sweep", { entryQuality: { ...eqOk, lowerTimeframeSweep: false } }, "sweep"],
    ["missing BOS", { entryQuality: { ...eqOk, bosStructureShift: false } }, "BOS"],
    ["missing retest", { entryQuality: { ...eqOk, retestDetected: false } }, "retest"],
  ];

  for (const [name, over, expectFragment] of cases) {
    it(`names the ${name} condition, agreeing with the classifier`, () => {
      const { classification, reason } = grade(over);
      expect(classification).toBe("OBSERVATION_ONLY");
      expect(reason).not.toBeNull();
      expect(reason).toContain(expectFragment);
    });
  }

  it("reports every missing entry-quality item, not just the first", () => {
    const { reason } = grade({
      entryQuality: {
        ...eqOk, lowerTimeframeSweep: false, bosStructureShift: false, retestDetected: false,
      },
    });
    expect(reason).toContain("sweep");
    expect(reason).toContain("BOS");
    expect(reason).toContain("retest");
  });

  it("is not consulted for HTF_CONFLICT — the classifier short-circuits first", () => {
    // Opposing 1H/4H is graded HTF_CONFLICT before any OBSERVATION_ONLY branch
    // is reached, so callers must gate on classification. This pins that the
    // conflict case is decided upstream and never reaches the reason helper.
    const { classification } = grade({
      h4: { direction: "bearish", breakoutStatus: "bearish_breakout", hasStructureBreak: true },
      h1: { direction: "bullish", agreesWith4H: false },
    });
    expect(classification).toBe("HTF_CONFLICT");
  });
});
