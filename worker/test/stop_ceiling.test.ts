/** The stop ceiling: "my highest stop loss I can go for every trade is 10
 *  pips" is a CAP, and the existing MIN_STOP_PIPS is a FLOOR. They are not the
 *  same rule and the difference is not cosmetic.
 *
 *  Two things are worth pinning. First, the ceiling is FX-only because cost is
 *  charged as spread / stopDistance, so the same 10 units cost 0.02R on EURUSD
 *  and 0.80R on JAPAN225 - a cap that is cheap on one pair is edge-destroying on
 *  another. Second, a setup needing more room is REJECTED rather than clamped:
 *  moving the stop inside the structure would park it somewhere arbitrary.
 *
 *  The end-to-end cases go through scanEntry, because a helper can be correct
 *  while every call site is wired wrong.
 */
import { describe, expect, it } from "vitest";
import { defaultStrategy, minStopDistance, pipSize, stopCeilingDistance, stopExceedsCeiling } from "../src/config";
import { scanEntry } from "../src/engine";
import { SHORT_ROWS, SHORT_STORY, mkCandles, snapsFor } from "./fixtures";

const cfg = { ...defaultStrategy(), minRiskAtr: 0.1 };

function runShort(extra = {}) {
  return scanEntry({
    pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
    candles: mkCandles(SHORT_ROWS, 30), snaps: snapsFor(SHORT_STORY),
    cfg: { ...cfg, ...extra }, mode: "paper", provider: "test",
  });
}

describe("stopCeilingDistance", () => {
  it("is 10 pips of the pair's own pip size on FX", () => {
    expect(stopCeilingDistance("EURUSD", 10)).toBeCloseTo(10 * pipSize("EURUSD"), 12);
    expect(stopCeilingDistance("EURUSD", 10)).toBeCloseTo(0.001, 12);
  });

  it("scales with pip size, so 10 pips on a JPY pair is 0.10 not 0.001", () => {
    // Getting this wrong would put the cap an order of magnitude off for every
    // yen pair, which is most of an FX book.
    expect(stopCeilingDistance("USDJPY", 10)).toBeCloseTo(0.1, 12);
    expect(pipSize("USDJPY")).toBe(0.01);
  });

  it("is null on indices, where a 10-unit stop costs 0.80R in spread", () => {
    expect(stopCeilingDistance("JAPAN225", 10)).toBeNull();
    expect(stopCeilingDistance("NAS100", 10)).toBeNull();
    expect(stopCeilingDistance("US30", 10)).toBeNull();
    expect(stopCeilingDistance("GER40", 10)).toBeNull();
  });

  it("is null on metals and synthetics", () => {
    expect(stopCeilingDistance("XAUUSD", 10)).toBeNull();
    expect(stopCeilingDistance("V75", 10)).toBeNull();
    expect(stopCeilingDistance("V100_1S", 10)).toBeNull();
  });

  it("is null when unset, so the shipped behaviour is no ceiling", () => {
    expect(stopCeilingDistance("EURUSD", undefined)).toBeNull();
    expect(stopCeilingDistance("EURUSD", 0)).toBeNull();
    expect(defaultStrategy().maxStopPips).toBeUndefined();
  });
});

describe("stopExceedsCeiling", () => {
  it("allows a stop exactly at the ceiling", () => {
    // At 10 pips with a 10-pip cap the trade is legal; > would reject a setup
    // that is precisely at the limit the teaching names.
    const cap = stopCeilingDistance("EURUSD", 10)!;
    expect(stopExceedsCeiling("EURUSD", cap, 10)).toBe(false);
    expect(stopExceedsCeiling("EURUSD", cap * 1.0001, 10)).toBe(true);
  });

  it("never rejects a non-FX pair, however wide the stop", () => {
    expect(stopExceedsCeiling("JAPAN225", 5_000, 10)).toBe(false);
    expect(stopExceedsCeiling("XAUUSD", 500, 10)).toBe(false);
  });

  it("never rejects when no ceiling is set", () => {
    expect(stopExceedsCeiling("EURUSD", 1e6, undefined)).toBe(false);
  });

  it("treats a non-finite distance as not exceeding, so it cannot reject everything", () => {
    expect(stopExceedsCeiling("EURUSD", NaN, 10)).toBe(false);
  });

  it("makes the floor and the ceiling coincide on FX at 10 pips", () => {
    // The consequence of running both at 10: every FX stop becomes exactly 10
    // pips, because anything narrower is raised and anything wider is rejected.
    expect(minStopDistance("EURUSD", 10)).toBeCloseTo(stopCeilingDistance("EURUSD", 10)!, 12);
    // ...and the indices keep their own floors, untouched by the cap.
    expect(minStopDistance("JAPAN225", 10)).toBe(50);
    expect(minStopDistance("NAS100", 10)).toBe(25);
  });
});

describe("the ceiling through scanEntry", () => {
  // scanEntry returns { alerts }, not an alert. Reading .entry off the wrapper
  // yields undefined, risk becomes NaN, and the assertions pass on nothing -
  // which is exactly how the first draft of this file "passed". So every case
  // below starts by asserting the baseline produced a real alert.
  const baseAlert = () => {
    const r = runShort();
    expect(r.alerts).toHaveLength(1);
    const a = r.alerts[0];
    expect(Number.isFinite(a.entry)).toBe(true);
    expect(Number.isFinite(a.stopLoss)).toBe(true);
    return a;
  };
  const pipsOf = (a: { entry: number; stopLoss: number }) =>
    Math.abs(a.entry - a.stopLoss) / pipSize("EURUSD");

  it("produces exactly one setup by default", () => {
    const a = baseAlert();
    expect(a.direction).toBe("SHORT");
    expect(pipsOf(a)).toBeGreaterThan(0);
  });

  it("rejects the setup when the cap is below the stop the structure needs", () => {
    const a = baseAlert();
    const justUnder = pipsOf(a) * 0.999;
    const r = runShort({ maxStopPips: justUnder });
    expect(r.alerts).toHaveLength(0);
  });

  it("keeps the identical setup when the cap is above the stop", () => {
    const a = baseAlert();
    const r = runShort({ maxStopPips: pipsOf(a) * 10 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].entry).toBe(a.entry);
    expect(r.alerts[0].stopLoss).toBe(a.stopLoss);
  });

  it("at the cap exactly, the fixture stop is what it is - not silently clamped", () => {
    // The ceiling rejects rather than clamps. If this ever returns an alert
    // with a DIFFERENT stop, someone turned the cap into a clamp, and stops
    // would start landing inside the structure.
    const a = baseAlert();
    const r = runShort({ maxStopPips: pipsOf(a) });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].stopLoss).toBe(a.stopLoss);
  });
});
