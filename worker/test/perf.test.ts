/** Tests for the replay performance math in src/perf.ts.
 *
 *  SYNTHETIC numbers only — these verify arithmetic (drawdown, streaks,
 *  spread conversion), NOT market behaviour. No performance claim is made
 *  or implied by anything in this file. */
import { describe, expect, it } from "vitest";
import { summarize, rAfterCost, spreadFor, type TradeRow } from "../src/perf";

function t(pair: string, r: number, n: number, status = "TP_HIT"): TradeRow {
  return {
    pair, tf: "30m", status, entry: 100, stop: 99, exit: 100 + r,
    // exit time = 2024-01-0(n) 00:00, so insertion order ≠ exit order
    exitTime: `2024-01-0${n} 00:00`, exitMs: Date.parse(`2024-01-0${n}T00:00:00Z`), r,
  };
}
const loser = (pair: string, n: number) => t(pair, -1, n, "SL_HIT");
const winner = (pair: string, n: number, r = 2) => t(pair, r, n);

describe("summarize — counts, R and profit factor", () => {
  it("counts alerts/TP/SL/EXPIRED/open and rates over TP+SL only", () => {
    const s = summarize([
      winner("EURUSD", 1), loser("EURUSD", 2),
      t("EURUSD", 0.5, 3, "EXPIRED"), t("EURUSD", NaN, 4, "OPEN"),
    ]);
    expect(s.alerts).toBe(4);
    expect([s.tp, s.sl, s.expired, s.open]).toEqual([1, 1, 1, 1]);
    expect(s.winRate).toBe(50);          // EXPIRED/OPEN excluded
    expect(s.avgR).toBeCloseTo(0.5, 6);  // (2 + -1) / 2
    expect(s.pf).toBeCloseTo(2, 6);      // 2 / 1
  });

  it("returns NaN rates (never 0) when nothing closed", () => {
    const s = summarize([t("EURUSD", NaN, 1, "OPEN")]);
    expect(s.avgR).toBeNaN();
    expect(s.winRate).toBeNaN();
    expect(s.pf).toBeNaN();
    expect(s.maxDdR).toBe(0);
    expect(s.curve).toHaveLength(0);
  });
});

describe("summarize — exit-ordered equity curve and drawdown", () => {
  it("walks the curve in EXIT order regardless of input order", () => {
    // inserted 3rd, 1st, 2nd by exit time
    const s = summarize([winner("EURUSD", 3, 1), winner("EURUSD", 1), loser("EURUSD", 2)]);
    expect(s.curve.map((p) => p.r)).toEqual([2, -1, 1]);
    expect(s.curve.map((p) => p.cum)).toEqual([2, 1, 2]);
    expect(s.curve.map((p) => p.peak)).toEqual([2, 2, 2]);
  });

  it("max drawdown is the worst peak→trough and knows when it happened", () => {
    // cum: +2, +1, +4, +3, +2  → peak 4 at trade 3, trough +2 at trade 5
    const s = summarize([winner("EURUSD", 1), loser("EURUSD", 2), winner("EURUSD", 3, 3),
      loser("EURUSD", 4), loser("EURUSD", 5)]);
    expect(s.maxDdR).toBeCloseTo(2, 6);
    expect(s.ddFrom).toBe("2024-01-03 00:00");   // the equity peak
    expect(s.ddTo).toBe("2024-01-05 00:00");     // the trough
  });

  it("a losing start draws down from the opening balance", () => {
    const s = summarize([loser("EURUSD", 1), loser("EURUSD", 2), loser("EURUSD", 3)]);
    expect(s.maxDdR).toBeCloseTo(3, 6);
    expect(s.ddFrom).toBe("(start)");
    expect(s.ddTo).toBe("2024-01-03 00:00");
  });

  it("longest losing and winning streaks come off the same ordering", () => {
    const s = summarize([
      loser("EURUSD", 1), loser("EURUSD", 2), winner("EURUSD", 3),
      winner("EURUSD", 4), winner("EURUSD", 5), loser("EURUSD", 6),
    ]);
    expect(s.loseStreak).toBe(2);
    expect(s.winStreak).toBe(3);
  });
});

describe("spread adjustment", () => {
  it("converts a price spread into R using the trade's own risk", () => {
    // 10-pip risk on EURUSD (0.0010), 0.2-pip round-trip spread (0.00002)
    const row: TradeRow = { pair: "EURUSD", tf: "30m", status: "TP_HIT", entry: 1.1, stop: 1.099,
      exit: 1.101, exitTime: "2024-01-01 00:00", exitMs: Date.parse("2024-01-01T00:00:00Z"), r: 1 };
    expect(spreadFor("EURUSD")).toBeCloseTo(0.00002, 8);
    expect(rAfterCost(row)).toBeCloseTo(0.98, 6);   // −0.02R
  });

  it("subtracts the cost from every closed trade and can flip a thin win", () => {
    // winners of 4R and 0.01R with a 0.02R cost: the marginal win turns red
    const rows = [
      { ...t("EURUSD", 4, 1), entry: 1.1, stop: 1.099 },
      { ...t("EURUSD", 0.01, 2), entry: 1.1, stop: 1.099 },
    ];
    const raw = summarize(rows);
    const adj = summarize(rows, { spread: true });
    expect(raw.winRate).toBe(100);
    expect(adj.winRate).toBe(50);                       // one trade no longer pays
    expect(adj.avgR).toBeCloseTo(raw.avgR - 0.02, 6);   // every R drops by the cost
    expect(adj.tp).toBe(raw.tp);                        // same trades, same counts
    // raw has no losing trade at all → profit factor is undefined (NaN), and
    // the cost is what creates one: the model must never invent a "0 losses"
    // factor for a sample that simply hasn't lost yet
    expect(raw.pf).toBeNaN();
    expect(adj.pf).toBeGreaterThan(0);
    expect(adj.pf).toBeCloseTo(3.98 / 0.01, 2);
  });

  it("hurts a tight stop more than a wide one (cost is ~1/risk)", () => {
    const tight = { ...t("EURUSD", 2, 1), entry: 1.1, stop: 1.099 };   // 10 pips
    const wide = { ...t("EURUSD", 2, 2), entry: 1.1, stop: 1.09 };     // 100 pips
    expect(rAfterCost(tight)).toBeCloseTo(1.98, 6);
    expect(rAfterCost(wide)).toBeCloseTo(1.998, 6);
  });

  it("index CFDs quote in points, so their spread is a point cost", () => {
    expect(spreadFor("US30")).toBe(4);
    expect(spreadFor("JAPAN225")).toBe(8);
    const row: TradeRow = { pair: "US30", tf: "30m", status: "TP_HIT", entry: 40000, stop: 39980,
      exit: 40040, exitTime: "2024-01-01 00:00", exitMs: Date.parse("2024-01-01T00:00:00Z"), r: 2 };
    expect(rAfterCost(row)).toBeCloseTo(1.8, 6);   // 4 points / 20 points of risk
  });

  it("unknown pairs get zero cost (no invented spread)", () => {
    expect(spreadFor("EURPLN")).toBe(0);
    const row: TradeRow = { pair: "EURPLN", tf: "30m", status: "TP_HIT", entry: 4, stop: 3.99,
      exit: 4.02, exitTime: "2024-01-01 00:00", exitMs: Date.parse("2024-01-01T00:00:00Z"), r: 2 };
    expect(rAfterCost(row)).toBe(2);
  });
});
