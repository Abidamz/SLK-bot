import { describe, expect, it } from "vitest";
import { combineOutcomes } from "../src/outcomes";
import { secondaryProviderFor } from "../src/provider";
import type { Outcome } from "../src/types";

const oc = (status: Outcome["status"], exitTime: number): Outcome =>
  ({ status, exitPrice: 1, exitTime, rMultiple: 1, fillConfirmed: null, fillTime: null });

describe("combineOutcomes", () => {
  it("passes through when one feed is missing", () => {
    expect(combineOutcomes(null, oc("TP_HIT", 5))).toEqual(oc("TP_HIT", 5));
    expect(combineOutcomes(oc("SL_HIT", 5), null)).toEqual(oc("SL_HIT", 5));
    expect(combineOutcomes(null, null)).toBeNull();
  });

  it("earlier touch wins regardless of status", () => {
    expect(combineOutcomes(oc("TP_HIT", 5), oc("SL_HIT", 9))?.status).toBe("TP_HIT");
    expect(combineOutcomes(oc("SL_HIT", 9), oc("TP_HIT", 5))?.status).toBe("TP_HIT");
    expect(combineOutcomes(oc("SL_HIT", 3), oc("TP_HIT", 7))?.status).toBe("SL_HIT");
  });

  it("same-candle touches resolve conservatively", () => {
    expect(combineOutcomes(oc("TP_HIT", 5), oc("SL_HIT", 5))?.status).toBe("SL_HIT");
    expect(combineOutcomes(oc("TP_HIT", 5), oc("BE_HIT", 5))?.status).toBe("BE_HIT");
    expect(combineOutcomes(oc("BE_HIT", 5), oc("SL_HIT", 5))?.status).toBe("SL_HIT");
    expect(combineOutcomes(oc("TP_HIT", 5), oc("TP_HIT", 5))?.status).toBe("TP_HIT");
  });
});

describe("secondaryProviderFor", () => {
  it("oanda primary cross-checks against twelvedata", () => {
    expect(secondaryProviderFor("EURUSD", "oanda")).toBe("twelvedata");
  });

  it("twelvedata primary cross-checks against oanda for oanda-listed pairs", () => {
    expect(secondaryProviderFor("EURUSD", "twelvedata")).toBe("oanda");
    expect(secondaryProviderFor("NAS100", "twelvedata")).toBe("oanda");
  });

  it("pairs with no second source degrade to null", () => {
    expect(secondaryProviderFor("R_100", "deriv")).toBeNull();
    expect(secondaryProviderFor("1HZ10V", "deriv")).toBeNull();
  });
});
