/** A key level is disrespected when an IMPULSIVE BODY DISPLACEMENT candle
 *  breaks it - not when price merely closes on the far side. The shipped flip
 *  logic had no body condition, so a drifting candle that closed a hair past
 *  the zone retired a level the market never rejected, and that level then
 *  scored as a flipped breaker it never became.
 *
 *  Body, not range. A long wick through the zone with a small body is a SWEEP,
 *  which is the opposite event: the level held. Keying the gate on range would
 *  classify exactly those candles as displacement.
 */
import { describe, expect, it } from "vitest";
import { defaultStrategy } from "../src/config";
import { atr, keyLevels } from "../src/features";
import type { Candle } from "../src/types";

const H1 = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

function candle(i: number, o: number, h: number, l: number, c: number): Candle {
  return { t: T0 + i * H1, o, h, l, c } as Candle;
}

/** A descending-then-ascending close series with a clean V trough at index 10,
 *  then a final candle that closes below the trough. The break candle's body is
 *  a parameter so the same structure can be broken impulsively or not. */
function seriesWithBreak(body: number, close: number): Candle[] {
  const cs: Candle[] = [];
  for (let i = 0; i < 24; i++) {
    // Descend 100 -> 90 into the trough at 10, then climb back to ~100.
    const c = i <= 10 ? 100 - i : 90 + (i - 10) * 0.9;
    const o = i === 0 ? c : (i <= 10 ? 100 - (i - 1) : 90 + (i - 1 - 10) * 0.9);
    cs.push(candle(i, o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c));
  }
  // The break: closes below the trough, body size chosen by the caller.
  const o = close + body;
  cs.push(candle(24, o, Math.max(o, close) + 0.2, Math.min(o, close) - 0.2, close));
  return cs;
}

const levelsFor = (cs: Candle[], extra = {}) =>
  keyLevels(cs, { ...defaultStrategy(), ...extra });

const vLevels = (cs: Candle[], extra = {}) =>
  levelsFor(cs, extra).filter((l) => l.kind === "V" && l.originIndex === 10);

describe("displacement requirement on flips", () => {
  it("finds the V level at the trough", () => {
    const cs = seriesWithBreak(1.5, 88);
    expect(vLevels(cs)).toHaveLength(1);
  });

  it("still flips on any close beyond the zone when the gate is unset", () => {
    // Backwards compatibility: unset must reproduce today's behaviour exactly,
    // including for a small-bodied break that the spec would not call a
    // displacement.
    const drifting = seriesWithBreak(0.1, 88);
    const [lv] = vLevels(drifting);
    expect(lv.flipped).toBe(true);
    expect(lv.flipDir).toBe("down");
  });

  it("refuses to flip on a small-bodied close beyond the zone", () => {
    // Same structure, same close, small body. The level was closed through but
    // never displaced, so it is not a disrespected level.
    const drifting = seriesWithBreak(0.1, 88);
    const atrVal = atr(drifting, defaultStrategy().atrPeriod);
    const [lv] = vLevels(drifting, { flipImpulseAtr: 1.0 });
    expect(Math.abs(0.1) < 1.0 * atrVal).toBe(true); // guard: the body is under the gate
    expect(lv.flipped).toBe(false);
    expect(lv.flipDir).toBeNull();
  });

  it("does flip on an impulsive body through the zone", () => {
    const impulsive = seriesWithBreak(4.0, 88);
    const atrVal = atr(impulsive, defaultStrategy().atrPeriod);
    expect(4.0 >= 1.0 * atrVal).toBe(true); // guard: the body clears the gate
    const [lv] = vLevels(impulsive, { flipImpulseAtr: 1.0 });
    expect(lv.flipped).toBe(true);
    expect(lv.flipDir).toBe("down");
  });

  it("keeps the two cases identical except for the flip", () => {
    // If the gate changed anything other than the flip flag, the test above
    // could be passing on an unrelated difference.
    const drifting = seriesWithBreak(0.1, 88);
    const ungated = vLevels(drifting)[0];
    const gated = vLevels(drifting, { flipImpulseAtr: 1.0 })[0];
    expect(gated.originPrice).toBe(ungated.originPrice);
    expect(gated.zoneLo).toBe(ungated.zoneLo);
    expect(gated.zoneHi).toBe(ungated.zoneHi);
    expect(gated.kind).toBe(ungated.kind);
  });

  it("counts a non-impulsive break as neither a flip nor a touch", () => {
    // Price closed through the zone, so it is not a tap of the zone either.
    // Counting it as a touch would inflate the "tested severally holds value"
    // score on a level that was actually violated.
    const drifting = seriesWithBreak(0.1, 88);
    const ungated = vLevels(drifting)[0];
    const gated = vLevels(drifting, { flipImpulseAtr: 1.0 })[0];
    expect(gated.touches).toBe(ungated.touches);
  });

  it("is off by default", () => {
    expect(defaultStrategy().flipImpulseAtr).toBeUndefined();
  });
});
