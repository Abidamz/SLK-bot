/**
 * Out-of-sample split. The whole point is that an instrument chosen because it
 * performed well on a window must then be judged on a window that played no
 * part in choosing it - otherwise the largest number in a sample gets reported
 * as if it were the mean.
 *
 * Entry times here are 18:00 and 06:00 rather than midnight so that no plausible
 * host UTC offset can move a row across the boundary; the UTC-parsing fix is
 * verified separately by running this file under an extreme TZ.
 */
import { describe, expect, it } from "vitest";
import { oosReport, type Trade } from "../src/replay_stats";

const NOW = Date.UTC(2026, 9, 13); // 2026-10-13T00:00Z
const HELD_OUT = 120; // days -> split falls on 2026-06-15T00:00Z

function mk(o: Partial<Trade> & { status: string; r: number }): Trade {
  return {
    pair: "EURUSD", tf: "30m", setupId: `s${Math.random()}`,
    entryTime: "2026-01-05 18:00", entry: 1.1, stop: 1.099, tp: 1.1025,
    exit: 1.1, exitTime: "2026-01-05 20:00",
    limitStatus: "OPEN", limitEntry: 1.1, limitExitTime: "-", limitR: NaN,
    marketStatus: "OPEN", marketEntry: 1.1, marketExitTime: "-", marketR: NaN,
    ...o,
  };
}

/** n trades for `pair`, one per day from `day` (Jan 1 2026 + day), `wins` of them winners. */
function series(pair: string, day: number, n: number, wins: number, tp = 2.5): Trade[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + day + i, 18, 0));
    const win = i < wins;
    return mk({
      pair,
      entryTime: d.toISOString().slice(0, 16).replace("T", " "),
      exitTime: d.toISOString().slice(0, 16).replace("T", " "),
      status: win ? "TP_HIT" : "SL_HIT",
      r: win ? tp : -1,
    });
  });
}

// GOOD: strong in the selection period, loses money held out.
// BAD:  loses in the selection period, wins big held out.
// THIN: great expectancy but only 3 selection trades.
const GOOD_SEL = series("GOOD", 0, 10, 6);      // +15 -4  = +11R  -> exp +1.10
const GOOD_OOS = series("GOOD", 200, 10, 2);    // +5  -8  = -3R   -> exp -0.30
const BAD_SEL = series("BAD", 0, 10, 2);        // +5  -8  = -3R   -> not selected
const BAD_OOS = series("BAD", 200, 10, 6);      // +15 -4  = +11R  -> excluded
const THIN_SEL = series("THIN", 0, 3, 3);       // +7.5R on 3 alerts -> too thin
const THIN_OOS = series("THIN", 200, 5, 0);     // -5R

const ALL = [...GOOD_SEL, ...GOOD_OOS, ...BAD_SEL, ...BAD_OOS, ...THIN_SEL, ...THIN_OOS];

describe("oosReport", () => {
  const rep = oosReport(ALL, false, { heldOutDays: HELD_OUT, now: NOW, minAlerts: 10 });

  it("ranks instruments by selection-period expectancy, best first", () => {
    expect(rep.instruments.map((i) => i.pair)).toEqual(["THIN", "GOOD", "BAD"]);
    expect(rep.instruments[1].selExp).toBeCloseTo(1.1, 6);
    expect(rep.instruments[2].selExp).toBeCloseTo(-0.3, 6);
  });

  it("refuses to let a 3-trade sample select its own instrument", () => {
    // THIN has the best expectancy of the three but nowhere near enough trades
    // for it to mean anything; a single +2.5R trade would otherwise qualify.
    const thin = rep.instruments.find((i) => i.pair === "THIN")!;
    expect(thin.selAlerts).toBe(3);
    expect(thin.selected).toBe(false);
    expect(rep.selectedPairs).toEqual(["GOOD"]);
  });

  it("reports the selected instruments' HELD-OUT result, including when it is bad", () => {
    // This is the number the feature exists to produce. GOOD looked like the
    // best instrument in the book and then lost money out of sample.
    expect(rep.oosAlerts).toBe(10);
    expect(rep.oosNet).toBeCloseTo(-3, 6);
    expect(rep.oosExp).toBeCloseTo(-0.3, 6);
  });

  it("excludes an instrument that was negative in the selection period", () => {
    // BAD earns +11R out of sample, but it was never selectable, so crediting
    // it would be choosing on the held-out period - the exact error being
    // guarded against.
    expect(rep.oosNet).toBeCloseTo(-3, 6);
    expect(rep.allOosNet).toBeCloseTo(-3 + 11 - 5, 6);
    expect(rep.allOosAlerts).toBe(25);
  });

  it("assigns trades by entry time, not exit time", () => {
    // A trade entered before the split but resolved after it must not carry
    // post-split information back into the selection period.
    const straddler = mk({
      pair: "STRADDLE",
      entryTime: "2026-06-14 06:00",
      exitTime: "2026-09-01 06:00",
      status: "TP_HIT", r: 2.5,
    });
    const r = oosReport(
      [...series("STRADDLE", 0, 10, 10), ...series("STRADDLE", 200, 10, 10), straddler],
      false, { heldOutDays: HELD_OUT, now: NOW, minAlerts: 10 },
    );
    const s = r.instruments[0];
    expect(s.selAlerts).toBe(11); // the straddler counts as selection
    expect(s.oosAlerts).toBe(10);
    expect(s.selNet).toBeCloseTo(11 * 2.5, 6);
  });

  it("derives the split from the data when no explicit now is given", () => {
    const r = oosReport(ALL, false, { heldOutDays: HELD_OUT });
    // Latest entry is day 209 (GOOD/BAD/THIN oos series), so the split lands
    // 120 days before that and still separates the two periods cleanly.
    expect(Number.isFinite(r.splitTime)).toBe(true);
    expect(r.selectedPairs).toEqual(["GOOD"]);
    expect(r.oosAlerts).toBe(10);
  });

  it("places a row stamped exactly at the split instant in the held-out period", () => {
    // Stored timestamps are UTC with no zone marker, so parsed naively they read
    // as LOCAL time. On a host east of Greenwich this row would slide back into
    // the selection period and quietly change the answer. Deterministic with the
    // fix; only detectable on a non-UTC host without it.
    const rows = [
      ...series("EDGE", 0, 10, 10),
      mk({
        pair: "EDGE", entryTime: "2026-06-15 00:00", exitTime: "2026-06-15 00:00",
        status: "TP_HIT", r: 2.5,
      }),
    ];
    const r = oosReport(rows, false, { heldOutDays: HELD_OUT, now: NOW, minAlerts: 10 });
    expect(r.instruments[0].selAlerts).toBe(10);
    expect(r.instruments[0].oosAlerts).toBe(1);
  });

  it("returns an empty report rather than NaN arithmetic on no rows", () => {
    const r = oosReport([], false, { heldOutDays: HELD_OUT, now: NOW });
    expect(r.instruments).toEqual([]);
    expect(r.selectedPairs).toEqual([]);
    expect(r.oosAlerts).toBe(0);
    expect(Number.isNaN(r.oosExp)).toBe(true);
    expect(Number.isNaN(r.splitTime)).toBe(true);
  });

  it("treats an instrument with no held-out trades as zero, not as missing", () => {
    const r = oosReport([...GOOD_SEL], false, { heldOutDays: HELD_OUT, now: NOW, minAlerts: 10 });
    expect(r.selectedPairs).toEqual(["GOOD"]);
    expect(r.oosAlerts).toBe(0);
    expect(r.oosNet).toBe(0);
    expect(Number.isNaN(r.oosExp)).toBe(true);
  });
});
