import { describe, expect, it } from "vitest";
import { evaluateSignal } from "../src/outcomes";
describe("corrupt-target guard", () => {
  const candles = [{ t: 1, o: 90, h: 91, l: 89, c: 90 }];
  it("SHORT with tp above entry never resolves as TP_HIT", () => {
    expect(evaluateSignal("SHORT", 4437.65, 4443.48, 4444.64, candles)).toBeNull();
  });
  it("LONG with tp below entry never resolves as TP_HIT", () => {
    expect(evaluateSignal("LONG", 100, 95, 90, candles)).toBeNull();
  });
  it("normal short still resolves", () => {
    const oc = evaluateSignal("SHORT", 100, 105, 90, [{ t: 1, o: 95, h: 96, l: 89, c: 92 }]);
    expect(oc?.status).toBe("TP_HIT");
    expect(oc?.rMultiple).toBeGreaterThan(0);
  });
});
