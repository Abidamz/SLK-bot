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

  it("touch-based SL triggers SL_HIT when wick pierces stop loss even if close recovers", () => {
    // LONG entry at 100, stop at 95, TP at 115.
    // Candle wicks down to 94 (triggering broker stop loss), but closes at 116.
    // In real trading, the stop loss executed at 94.
    const candle = { t: 1, o: 100, h: 116, l: 94, c: 116 };
    const oc = evaluateSignal("LONG", 100, 95, 115, [candle], 120, false);
    expect(oc?.status).toBe("SL_HIT");
    expect(oc?.rMultiple).toBe(-1);
  });
});
