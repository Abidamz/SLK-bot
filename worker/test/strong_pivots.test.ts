/** Strong highs and lows: a liquidity sweep DIRECTLY followed by an impulsive
 *  move that breaks structure. Both halves are required, and the tests are
 *  built to fail if either is dropped - a sweep alone proves nothing, since
 *  price takes liquidity and often carries straight on through.
 */
import { describe, expect, it } from "vitest";
import { defaultStrategy, type StrategyConfig } from "../src/config";
import { atr, strongPivots } from "../src/features";
import type { Candle } from "../src/types";

const H1 = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

function mk(rows: Array<[number, number, number, number]>): Candle[] {
  return rows.map(([o, h, l, c], i) => ({ t: T0 + i * H1, o, h, l, c }) as Candle);
}

/** Bullish case: swing high 105 at index 2, swing low 95 at index 8, the high
 *  swept at index 10 (wick 106, close back to 103.5), then an impulsive
 *  displacement at index 11 that closes through the swing low. */
const BULL_ROWS: Array<[number, number, number, number]> = [
  [100.0, 101.0, 99.0, 100.5],
  [100.5, 102.0, 100.0, 101.5],
  [101.5, 105.0, 101.0, 104.0],  // swing high 105
  [104.0, 104.5, 102.0, 102.5],
  [102.5, 103.0, 101.0, 101.5],
  [101.5, 102.0, 100.0, 100.5],
  [100.5, 101.0, 99.0, 99.5],
  [99.5, 100.0, 97.0, 97.5],
  [97.5, 98.0, 95.0, 96.0],      // swing low 95
  [96.0, 99.0, 95.5, 98.5],
  [98.5, 106.0, 98.0, 103.5],    // sweeps 105, closes back below
  [103.5, 104.0, 93.0, 93.5],    // impulsive displacement through 95
];

/** Bearish mirror: swing low 95 at index 2, swing high 104 at index 8, the low
 *  swept at index 10, impulsive displacement up through 104 at index 11. */
const BEAR_ROWS: Array<[number, number, number, number]> = [
  [100.0, 101.0, 99.0, 99.5],
  [99.5, 100.0, 98.0, 98.5],
  [98.5, 99.0, 95.0, 96.0],      // swing low 95
  [96.0, 97.5, 95.5, 97.0],
  [97.0, 98.0, 96.5, 97.5],
  [97.5, 99.0, 97.0, 98.5],
  [98.5, 100.0, 98.0, 99.5],
  [99.5, 102.0, 99.0, 101.5],
  [101.5, 104.0, 101.0, 103.0],  // swing high 104
  [103.0, 103.5, 100.0, 100.5],
  [100.5, 101.0, 94.0, 96.5],    // sweeps 95, closes back above
  [96.5, 106.0, 96.0, 105.5],    // impulsive displacement through 104
];

// Short ATR window so a 12-bar fixture is enough to measure one.
const cfg: StrategyConfig = { ...defaultStrategy(), atrPeriod: 5 };

describe("strongPivots", () => {
  it("marks the swept high as strong once displacement breaks structure", () => {
    const cs = mk(BULL_ROWS);
    const found = strongPivots(cs, cfg, 6, 1.0);
    const sh = found.filter((p) => p.kind === "strong_high");
    expect(sh).toHaveLength(1);
    expect(sh[0].price).toBe(105);
    expect(sh[0].sweepIndex).toBe(10);
    expect(sh[0].bosIndex).toBe(11);
  });

  it("marks the swept low as strong on the bearish mirror", () => {
    const cs = mk(BEAR_ROWS);
    const found = strongPivots(cs, cfg, 6, 1.0);
    const sl = found.filter((p) => p.kind === "strong_low");
    expect(sl).toHaveLength(1);
    expect(sl[0].price).toBe(95);
    expect(sl[0].sweepIndex).toBe(10);
    expect(sl[0].bosIndex).toBe(11);
  });

  it("requires the follow-through to be impulsive, not merely a break", () => {
    // Same close through the swing low, but a small body: that is a drift, not
    // a displacement, and it must not promote the pivot.
    const rows = [...BULL_ROWS];
    rows[11] = [94.0, 94.5, 93.0, 93.5];
    const cs = mk(rows);
    const atrVal = atr(cs, cfg.atrPeriod);
    expect(Math.abs(93.5 - 94.0) < 1.0 * atrVal).toBe(true); // guard: under the gate
    expect(strongPivots(cs, cfg, 6, 1.0).filter((p) => p.kind === "strong_high"))
      .toHaveLength(0);
  });

  it("requires a sweep, not a break that carries on through", () => {
    // Index 10 breaks 105 and CLOSES ABOVE it. That is a breakout, not a sweep:
    // the level was not defended, it was taken. Dropping the close-back-inside
    // half of the sweep test would promote this pivot, so this case fails if
    // that condition is ever weakened.
    const rows = BULL_ROWS.map((r, i) =>
      (i === 10 ? [98.5, 107.0, 98.0, 106.0] as [number, number, number, number] : r));
    const cs = mk(rows);
    expect(cs[10].h).toBeGreaterThan(105);   // guard: it does exceed the high
    expect(cs[10].c).toBeGreaterThan(105);   // guard: ...and closes above it
    expect(strongPivots(cs, cfg, 6, 1.0).filter((p) => p.kind === "strong_high"))
      .toHaveLength(0);
  });

  it("bounds 'directly followed' by the confirmation window", () => {
    // The same sequence with a window of zero cannot confirm, which is what
    // proves the window is enforced rather than decorative.
    const cs = mk(BULL_ROWS);
    expect(strongPivots(cs, cfg, 0, 1.0).filter((p) => p.kind === "strong_high"))
      .toHaveLength(0);
    expect(strongPivots(cs, cfg, 6, 1.0).filter((p) => p.kind === "strong_high"))
      .toHaveLength(1);
  });

  it("records the sweep and the displacement separately", () => {
    // APEX placement needs the swept extreme; the stop needs to know when it
    // was confirmed. Collapsing them into one timestamp would lose both.
    const cs = mk(BULL_ROWS);
    const [sh] = strongPivots(cs, cfg, 6, 1.0).filter((p) => p.kind === "strong_high");
    expect(sh.sweepTime).toBe(cs[10].t);
    expect(sh.bosTime).toBe(cs[11].t);
    expect(sh.bosTime).toBeGreaterThan(sh.sweepTime);
  });

  it("returns nothing on a series too short to have structure", () => {
    expect(strongPivots(mk(BULL_ROWS.slice(0, 4)), cfg, 6, 1.0)).toEqual([]);
    expect(strongPivots([], cfg, 6, 1.0)).toEqual([]);
  });
});
