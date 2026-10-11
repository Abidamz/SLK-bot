/**
 * Replay accounting. Pinned because these numbers are what decisions get made
 * from, and because one of them was wrong: evaluateSignal resolves a trade
 * that armed breakeven at +1.5R and was taken out at entry as BE_HIT with
 * rMultiple 0, and stats() counted only TP_HIT / SL_HIT / EXPIRED — so every
 * scratch was filed under `open` and reported as a position still running.
 */
import { describe, expect, it } from "vitest";
import { f, limitShadowRows, marketShadowRows, stats, type Trade } from "../src/replay_stats";

function mk(o: Partial<Trade> & { status: string; r: number }): Trade {
  return {
    pair: "EURUSD", tf: "30m", setupId: `s${Math.random()}`,
    entryTime: "2026-05-01 10:00", entry: 1.1000, stop: 1.0990, tp: 1.1025,
    exit: 1.1000, exitTime: "2026-05-01 12:00",
    limitStatus: "OPEN", limitEntry: 1.1000, limitExitTime: "-", limitR: NaN,
    marketStatus: "OPEN", marketEntry: 1.1000, marketExitTime: "-", marketR: NaN,
    ...o,
  };
}

describe("replay accounting — breakeven scratches", () => {
  it("counts BE_HIT separately and no longer files it under open", () => {
    const rows = [
      mk({ status: "TP_HIT", r: 2.5 }),
      mk({ status: "SL_HIT", r: -1 }),
      mk({ status: "BE_HIT", r: 0 }),
      mk({ status: "BE_HIT", r: 0 }),
      mk({ status: "OPEN", r: NaN }),
    ];
    const s = stats(rows, false);
    expect(s.tp).toBe(1);
    expect(s.sl).toBe(1);
    expect(s.be).toBe(2);
    // Only the genuinely unresolved row is open. Before the fix this read 3.
    expect(s.open).toBe(1);
    expect(s.alerts).toBe(5);
  });

  it("reports the scratch rate over everything that resolved", () => {
    const rows = [
      mk({ status: "TP_HIT", r: 2.5 }),
      mk({ status: "SL_HIT", r: -1 }),
      mk({ status: "BE_HIT", r: 0 }),
      mk({ status: "BE_HIT", r: 0 }),
    ];
    // 2 scratches of 4 resolved.
    expect(stats(rows, false).scratchPct).toBeCloseTo(50, 6);
    // An unresolved row is not part of that denominator.
    const withOpen = [...rows, mk({ status: "OPEN", r: NaN })];
    expect(stats(withOpen, false).scratchPct).toBeCloseTo(50, 6);
  });

  it("leaves win rate over TP+SL, so a scratch is neither a win nor a loss", () => {
    const rows = [
      mk({ status: "TP_HIT", r: 2.5 }),
      mk({ status: "SL_HIT", r: -1 }),
      mk({ status: "BE_HIT", r: 0 }),
    ];
    expect(stats(rows, false).winrate).toBeCloseTo(50, 6);
  });

  it("still charges a scratch its spread, because a round trip costs even at 0R", () => {
    // EURUSD spread estimate 0.00002 against a 0.0010 stop = 0.02R per side.
    const be = mk({ pair: "EURUSD", entry: 1.1000, stop: 1.0990, status: "BE_HIT", r: 0 });
    expect(stats([be], false).finalR).toBeCloseTo(0, 6);
    expect(stats([be], true).finalR).toBeCloseTo(-0.04, 6);
  });

  it("keeps a scratch in the equity curve, so drawdown and streaks still see it", () => {
    const rows = [
      mk({ status: "TP_HIT", r: 2.5, exitTime: "2026-05-01 12:00" }),
      mk({ status: "BE_HIT", r: 0, exitTime: "2026-05-02 12:00" }),
      mk({ status: "SL_HIT", r: -1, exitTime: "2026-05-03 12:00" }),
    ];
    const s = stats(rows, false);
    expect(s.finalR).toBeCloseTo(1.5, 6);
    // The scratch breaks the win streak and starts a losing one.
    expect(s.winStreak).toBe(1);
    expect(s.lossStreak).toBe(2);
  });

  it("is NaN, not zero, when nothing resolved", () => {
    const s = stats([mk({ status: "OPEN", r: NaN })], false);
    expect(Number.isNaN(s.scratchPct)).toBe(true);
    expect(Number.isNaN(s.winrate)).toBe(true);
    expect(s.open).toBe(1);
  });
});

describe("replay accounting — execution shadow rows", () => {
  const row = mk({
    status: "TP_HIT", r: 2.5, entry: 1.1000, exitTime: "2026-05-01 12:00",
    limitStatus: "NO_FILL", limitEntry: 1.0998, limitExitTime: "-", limitR: NaN,
    marketStatus: "SL_HIT", marketEntry: 1.1005, marketExitTime: "2026-05-01 13:00", marketR: -1.5,
  });

  it("re-reads the limit legs, carrying NO_FILL through", () => {
    const [l] = limitShadowRows([row]);
    expect(l.status).toBe("NO_FILL");
    expect(l.entry).toBe(1.0998);
    expect(Number.isNaN(l.r)).toBe(true);
  });

  it("re-reads the market legs", () => {
    const [m] = marketShadowRows([row]);
    expect(m.status).toBe("SL_HIT");
    expect(m.entry).toBe(1.1005);
    expect(m.r).toBe(-1.5);
  });
});

describe("f — the report formatter", () => {
  it("prints a dash rather than NaN, so a gap reads as absent not as zero", () => {
    expect(f(NaN)).toBe("-");
    expect(f(1.23456)).toBe("1.23");
    expect(f(1.23456, 1)).toBe("1.2");
  });
});
