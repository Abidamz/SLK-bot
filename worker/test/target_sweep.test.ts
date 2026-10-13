/** The target sweep decides whether a different take-profit would beat the
 *  shipped one, so its two failure modes are worth pinning: a target placed on
 *  the wrong side of entry (which evaluateSignal rejects, silently turning the
 *  whole sweep into unresolved rows), and a win rate computed over rows that
 *  never resolved (which reads as "it lost everything" instead of "unknown").
 */
import { describe, expect, it } from "vitest";
import { evaluateSignal } from "../src/outcomes";
import {
  emptyBucket, renderSweepTable, sweepRows, targetPrice, type SweepBucket,
} from "../src/target_sweep";
import type { Candle } from "../src/types";

const c = (t: number, o: number, h: number, l: number, close: number): Candle =>
  ({ t, o, h, l, c: close } as Candle);

/** Flat-ish candles that never touch a 3R target but never breach the stop, so
 *  the trade expires unresolved. */
function flatCandles(entry: number, n = 5): Candle[] {
  return Array.from({ length: n }, (_, i) =>
    c(1_000 + i * 60_000, entry, entry + 0.1, entry - 0.1, entry));
}

function bucket(o: Partial<SweepBucket>): SweepBucket {
  return { ...emptyBucket(), ...o };
}

describe("targetPrice", () => {
  it("places a long target above entry by rr risk units", () => {
    expect(targetPrice("LONG", 100, 98, 3)).toBeCloseTo(106, 10);  // risk 2, so 3R = +6
    expect(targetPrice("LONG", 100, 98, 1)).toBeCloseTo(102, 10);
  });

  it("places a short target below entry, not above it", () => {
    // The mirror of the long case. Getting this backwards is the bug the whole
    // file exists to prevent: evaluateSignal would return null for every short.
    expect(targetPrice("SHORT", 100, 102, 3)).toBeCloseTo(94, 10);  // risk 2, so 3R = -6
    expect(targetPrice("SHORT", 100, 102, 1)).toBeCloseTo(98, 10);
  });

  it("measures risk as a distance, so a stop above entry is still positive risk", () => {
    expect(targetPrice("SHORT", 100, 102, 2)).toBe(targetPrice("SHORT", 100, 102, 2));
    expect(Math.abs(targetPrice("SHORT", 100, 102, 2) - 100)).toBeCloseTo(4, 10);
  });

  it("produces targets evaluateSignal accepts, on both sides", () => {
    // End-to-end tripwire: a sign flip here makes evaluateSignal return null
    // (its corrupt-target guard), which renders as an all-open sweep rather
    // than as an error. Asserting non-null catches it at the seam.
    for (const rr of [0.5, 1, 2, 3, 5]) {
      const longTp = targetPrice("LONG", 100, 98, rr);
      const shortTp = targetPrice("SHORT", 100, 102, rr);
      // Horizon 5 against 5 candles: evaluateSignal returns null when there is
      // LESS history than the horizon, so a short fixture would read as a
      // rejected target and hide the very bug this test is for.
      expect(evaluateSignal("LONG", 100, 98, longTp, flatCandles(100), 5, false, 1.5, false))
        .not.toBeNull();
      expect(evaluateSignal("SHORT", 100, 102, shortTp, flatCandles(100), 5, false, 1.5, false))
        .not.toBeNull();
    }
  });

  it("resolves to exactly the swept R multiple when the target is touched", () => {
    // A long from 100, stop 98 (1R = 2), target 3R = 106. A candle that trades
    // through 106 must book exactly +3R - proof the target and the R accounting
    // agree, which is the assumption the whole table rests on.
    const tp = targetPrice("LONG", 100, 98, 3);
    const o = evaluateSignal("LONG", 100, 98, tp,
      [c(1_000, 100, 107, 99.5, 106.5)], 1, false, 99, false);
    expect(o?.status).toBe("TP_HIT");
    expect(o?.rMultiple).toBeCloseTo(3, 10);
  });

  it("returns null for insufficient history, which the sweep books as open", () => {
    // The sweep counts a null as an unresolved row. That is only correct
    // because null here means "fewer candles than the horizon", not "invalid
    // target" - and it is why every target in the table sees the same open
    // count near the end of the window, so the comparison stays fair.
    const tp = targetPrice("LONG", 100, 98, 3);
    expect(evaluateSignal("LONG", 100, 98, tp, flatCandles(100, 5), 120, false, 1.5, false))
      .toBeNull();
    expect(evaluateSignal("LONG", 100, 98, tp, flatCandles(100, 5), 5, false, 1.5, false))
      .not.toBeNull();
  });
});

describe("sweepRows", () => {
  it("computes win% over TP+SL only, excluding breakeven and unresolved", () => {
    const m = new Map<number, SweepBucket>([
      [2, bucket({ n: 10, tp: 3, sl: 1, be: 4, open: 2 })],
    ]);
    const [r] = sweepRows([2], m);
    // 3 of 4 resolved - not 3 of 10, and not 3 of 6.
    expect(r.win).toBeCloseTo(75, 10);
  });

  it("divides expectancy by every alert scored, not just resolved ones", () => {
    // Crediting only resolved rows would reward a target for the trades that
    // never finished, which is exactly how a worse target can look better.
    const m = new Map<number, SweepBucket>([
      [1, bucket({ n: 10, tp: 5, sl: 3, be: 0, open: 2, r: 12 })],
    ]);
    const [r] = sweepRows([1], m);
    expect(r.per).toBeCloseTo(1.2, 10);
    expect(r.net).toBe(12);
  });

  it("is NaN, not 0, when nothing resolved", () => {
    const m = new Map<number, SweepBucket>([
      [5, bucket({ n: 4, tp: 0, sl: 0, be: 0, open: 4 })],
    ]);
    const [r] = sweepRows([5], m);
    expect(Number.isNaN(r.win)).toBe(true);
    expect(r.per).toBe(0); // no R at all, which is a real 0, not an unknown
  });

  it("is NaN when no alerts were scored at that target", () => {
    const [r] = sweepRows([3], new Map());
    expect(r.n).toBe(0);
    expect(Number.isNaN(r.win)).toBe(true);
    expect(Number.isNaN(r.per)).toBe(true);
  });

  it("preserves the target order it is given", () => {
    const m = new Map<number, SweepBucket>([
      [3, bucket({ n: 1 })], [1, bucket({ n: 1 })], [2, bucket({ n: 1 })],
    ]);
    expect(sweepRows([1, 2, 3], m).map((r) => r.rr)).toEqual([1, 2, 3]);
  });
});

describe("renderSweepTable", () => {
  it("marks the row with the best R/alert, not the best win%", () => {
    // 1R target wins 90% but earns +0.8R/alert; 4R target wins 30% and earns
    // +0.8R/alert too; 3R at 50% earns +1.0R/alert. The highest win rate is not
    // the best target, and the table must not imply that it is.
    const rows = sweepRows([1, 3, 4], new Map<number, SweepBucket>([
      [1, bucket({ n: 10, tp: 9, sl: 1, be: 0, open: 0, r: 8 })],   // 0.800
      [3, bucket({ n: 10, tp: 5, sl: 5, be: 0, open: 0, r: 10 })],  // 1.000 <- best
      [4, bucket({ n: 10, tp: 3, sl: 7, be: 0, open: 0, r: 8 })],   // 0.800
    ]));
    const t = renderSweepTable(rows, 0.5, 10).join("\n");
    const lines = t.split("\n").filter((l) => /^\s+\d+\.\d\dR/.test(l));
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.includes("<- best"))).toHaveLength(1);
    expect(lines.find((l) => l.includes("<- best"))).toContain("3.00R");
    expect(lines.find((l) => l.includes("1.00R"))).not.toContain("<- best");
  });

  it("prints the shipped setting as the baseline", () => {
    const rows = sweepRows([2], new Map([[2, bucket({ n: 4, tp: 2, sl: 2, r: 2 })]]));
    expect(renderSweepTable(rows, 0.512, 69).join("\n"))
      .toContain("shipped setting for reference: 0.512R/alert over 69 alerts");
  });

  it("warns that the winner of one window is partly selected by it", () => {
    const rows = sweepRows([2], new Map([[2, bucket({ n: 1, tp: 1, sl: 0, r: 2 })]]));
    const t = renderSweepTable(rows, 0.5, 1).join("\n");
    expect(t).toContain("not a recommendation");
    expect(t).toContain("Confirm out of sample");
  });

  it("survives an empty sweep rather than throwing on rows[0]", () => {
    const t = renderSweepTable([], NaN, 0).join("\n");
    expect(t).toContain("TARGET SWEEP");
    expect(t).toContain("shipped setting for reference: -R/alert over 0 alerts");
  });

  it("renders unresolved rows as dashes, not as zeros", () => {
    const rows = sweepRows([5], new Map([[5, bucket({ n: 3, open: 3 })]]));
    const line = renderSweepTable(rows, NaN, 3).join("\n")
      .split("\n").find((l) => l.includes("5.00R"))!;
    expect(line).toContain("-");
    expect(line).not.toMatch(/\s0\.0%\s/);
  });
});
