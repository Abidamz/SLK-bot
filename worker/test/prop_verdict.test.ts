import { describe, expect, it } from "vitest";
import { propVerdictGrid } from "../src/prop_sim";
import type { Trade } from "../src/replay_stats";

const mk = (status: string, r: number, i: number): Trade => ({
  pair: "EURUSD", tf: "30m", setupId: `s${i}`,
  entryTime: `2026-09-0${(i % 9) + 1}T10:00:00.000Z`, entry: 1.1, stop: 1.09, tp: NaN,
  status, exit: NaN, exitTime: "-", r,
  limitStatus: "OPEN", limitEntry: NaN, limitExitTime: "-", limitR: NaN,
  marketStatus: "OPEN", marketEntry: NaN, marketExitTime: "-", marketR: NaN,
  dir: "LONG",
});

const book = (tp: number, sl: number, be: number): Trade[] => [
  ...Array(tp).fill(0).map((_, i) => mk("TP_HIT", 3, i)),
  ...Array(sl).fill(0).map((_, i) => mk("SL_HIT", -1, tp + i)),
  ...Array(be).fill(0).map((_, i) => mk("BE_HIT", 0, tp + sl + i)),
];

describe("propVerdictGrid", () => {
  it("refuses to verdict a sample below five closed trades", () => {
    const v = propVerdictGrid(book(2, 1, 1), 30);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.closedTrades).toBe(4);
  });

  it("returns a nine-cell grid with coherent rates for a positive book", () => {
    const v = propVerdictGrid(book(6, 5, 1), 50, { trials: 400, bootstraps: 20, bootTrials: 200 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.grid).toHaveLength(9);
    expect(v.n).toBe(12);
    expect(v.mix.winRate).toBeCloseTo(0.5, 10);
    expect(v.alertsPerMonth).toBeGreaterThan(0);
    for (const c of v.grid) {
      expect(c.pass + c.blown + c.neither).toBeCloseTo(100, 1);
      expect(c.lo).toBeLessThanOrEqual(c.hi);
      expect(c.pass).toBeGreaterThanOrEqual(0);
      expect(c.pass).toBeLessThanOrEqual(100);
    }
  });

  it("scores a losing book near zero pass", () => {
    const v = propVerdictGrid(book(1, 10, 1), 50, { trials: 400, bootstraps: 10, bootTrials: 200 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.grid[0].pass).toBeLessThan(10);
  });

  it("is deterministic for a fixed seed", () => {
    const a = propVerdictGrid(book(6, 5, 1), 50, { trials: 300, bootstraps: 10, bootTrials: 150, seed: 7 });
    const b = propVerdictGrid(book(6, 5, 1), 50, { trials: 300, bootstraps: 10, bootTrials: 150, seed: 7 });
    expect(a.ok && b.ok ? a.grid[0].pass : -1).toBe(b.ok && a.ok ? b.grid[0].pass : -2);
  });
});
