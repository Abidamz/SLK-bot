/** Report-rendering tests for src/report.ts.
 *
 *  SYNTHETIC trades only — this checks that the drawdown table and the two
 *  risk lines render (and degrade gracefully on an empty sample), not any
 *  market result. The renderers live in `src/` (not in the script) precisely so
 *  they can be tested without pulling Node globals into the typecheck. */
import { describe, expect, it } from "vitest";
import { riskSection, row, tableLines, COLS } from "../src/report";
import { summarize, type TradeRow } from "../src/perf";

function t(pair: string, r: number, n: number, status = "TP_HIT"): TradeRow {
  return {
    pair, tf: "30m", status, entry: 100, stop: 99, exit: 100 + r,
    exitTime: `2024-01-0${n} 00:00`, exitMs: Date.parse(`2024-01-0${n}T00:00:00Z`), r,
  };
}
const loser = (pair: string, n: number) => t(pair, -1, n, "SL_HIT");

describe("backtest report rendering", () => {
  it("renders one 11-column row per pair plus the TOTAL", () => {
    const rows = [
      row("EURUSD", summarize([t("EURUSD", 4, 1), loser("EURUSD", 2)])),
      row("**TOTAL**", summarize([t("EURUSD", 4, 1), loser("EURUSD", 2)])),
    ];
    expect(rows[0]).toHaveLength(COLS.length);
    expect(tableLines(rows).split("\n")).toHaveLength(2);
    expect(rows[0][0]).toBe("EURUSD");
    expect(rows[1][0]).toBe("**TOTAL**");
  });

  it("draws the exit-ordered curve and both risk lines", () => {
    // cum R: +2, +1, +4, +3, +2 → worst peak→trough = 2R (peak trade 3 → trough 5)
    const s = summarize([
      t("EURUSD", 2, 1), loser("EURUSD", 2), t("EURUSD", 3, 3), loser("EURUSD", 4), loser("EURUSD", 5),
    ]);
    const md = riskSection("Risk over time — Raw", s);
    expect(md).toContain("| # | exit time UTC | pair | tf | R | cum R | peak | DD |");
    expect(md).toContain("| 1 | 2024-01-01 00:00 | EURUSD | 30m | 2.00 | 2.00 | 2.00 | 0.00 |");
    expect(md).toContain("| 5 | 2024-01-05 00:00 | EURUSD | 30m | -1.00 | 2.00 | 4.00 | 2.00 |");
    expect(md).toContain("Max drawdown: **2.00R** (equity peak 2024-01-03 00:00 → trough 2024-01-05 00:00)");
    expect(md).toContain("Longest losing streak: **2**");
  });

  it("says so plainly when there is nothing to plot", () => {
    const md = riskSection("Risk over time — Raw", summarize([t("EURUSD", NaN, 1, "OPEN")]));
    expect(md).toContain("no closed trades");
    expect(md).not.toContain("Max drawdown");
  });
});
