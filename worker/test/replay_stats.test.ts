/**
 * Replay accounting. Pinned because these numbers are what decisions get made
 * from, and because one of them was wrong: evaluateSignal resolves a trade
 * that armed breakeven at +1.5R and was taken out at entry as BE_HIT with
 * rMultiple 0, and stats() counted only TP_HIT / SL_HIT / EXPIRED — so every
 * scratch was filed under `open` and reported as a position still running.
 */
import { describe, expect, it } from "vitest";
import {
  capPerDay, challengeVerdict, dailyRisk, entryTfGroups, f, limitShadowRows,
  marketShadowRows, monthlyBuckets, riskForLimit, stats, type Trade,
} from "../src/replay_stats";

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

describe("replay accounting — entry-timeframe breakdown", () => {
  // Every origin row has always carried its entry timeframe. Grouping by it is
  // what answers whether entries belong where production puts them (15m/30m/1h)
  // or one timeframe below the 4H breakout (2h), as the methodology specifies.
  const rows = [
    mk({ tf: "1h", status: "TP_HIT", r: 2.5 }),
    mk({ tf: "30m", status: "SL_HIT", r: -1 }),
    mk({ tf: "30m", status: "BE_HIT", r: 0 }),
    mk({ tf: "2h", status: "TP_HIT", r: 2.5 }),
  ];

  it("groups in the caller's order, not the order the rows arrived in", () => {
    expect(entryTfGroups(rows, ["30m", "1h", "2h"]).map(([tf]) => tf))
      .toEqual(["30m", "1h", "2h"]);
  });

  it("omits a named timeframe that produced no trades", () => {
    const g = entryTfGroups(rows, ["15m", "30m", "1h", "2h"]);
    expect(g.map(([tf]) => tf)).toEqual(["30m", "1h", "2h"]);
  });

  it("still reports a timeframe nobody named, so trades are never dropped", () => {
    const g = entryTfGroups(rows, ["30m", "1h"]);
    expect(g.map(([tf]) => tf)).toEqual(["30m", "1h", "2h"]);
    expect(g.find(([tf]) => tf === "2h")?.[1]).toHaveLength(1);
  });

  it("partitions exhaustively — the breakdown must sum back to the total", () => {
    const g = entryTfGroups(rows, ["2h", "1h", "30m"]);
    const sum = g.reduce((n, [, r]) => n + r.length, 0);
    expect(sum).toBe(rows.length);
    // ...and per-group net R has to reconcile with the whole book.
    const parts = g.map(([, r]) => stats(r, false).finalR);
    expect(Math.abs(parts.reduce((a, b) => a + b, 0) - stats(rows, false).finalR)).toBeLessThan(1e-9);
  });

  it("returns nothing for an empty book", () => {
    expect(entryTfGroups([], ["30m", "1h", "2h"])).toEqual([]);
  });
});

describe("daily risk — the prop-firm constraint", () => {
  // A funded account is lost on the daily limit, not the whole-window one, so
  // the distinction these tests pin is the one that decides whether a
  // subscriber can run the sizing the headline numbers imply.
  const at = (exitTime: string, r: number, status = "SL_HIT") =>
    mk({ status, r, exitTime, entryTime: exitTime, exit: 1.1, entry: 1.1010, stop: 1.1000 });

  it("measures the worst day from the start of the day, not its close", () => {
    // Down 2R mid-session, then recovers to close +1R. The close looks fine;
    // a 3% daily limit was breached on the way down.
    const rows = [at("2026-05-01 09:00", -1), at("2026-05-01 11:00", -1), at("2026-05-01 15:00", 3, "TP_HIT")];
    const d = dailyRisk(rows, false);
    expect(d.worstDayLoss).toBe(2);
    expect(d.worstDayLossDate).toBe("2026-05-01");
    expect(d.worstDayClose).toBe(1);   // positive close, still a breached day
  });

  it("takes the worst day across the window, and counts days with a close", () => {
    const rows = [
      at("2026-05-01 09:00", -1), at("2026-05-02 09:00", -3),
      at("2026-05-03 09:00", 2, "TP_HIT"),
    ];
    const d = dailyRisk(rows, false);
    expect(d.days).toBe(3);
    expect(d.worstDayLoss).toBe(3);
    expect(d.worstDayLossDate).toBe("2026-05-02");
    expect(d.worstDayClose).toBe(-3);
    expect(d.worstDayCloseDate).toBe("2026-05-02");
  });

  it("finds loss clustering the single-day figure misses", () => {
    const rows = [
      at("2026-05-01 09:00", -1), at("2026-05-02 09:00", -1),
      at("2026-05-03 09:00", -1), at("2026-05-04 09:00", 5, "TP_HIT"),
    ];
    const d = dailyRisk(rows, false);
    expect(d.worstDayLoss).toBe(1);    // no single day looks bad
    expect(d.worst3Day).toBe(-3);      // but three in a row is a 3R hole
    expect(Number.isNaN(d.worst5Day)).toBe(true);   // only four days exist
  });

  it("computes the rolling window once there are enough days", () => {
    const rows = ["01", "02", "03", "04", "05"].map((d) => at(`2026-05-${d} 09:00`, -1));
    const d = dailyRisk(rows, false);
    expect(d.worst3Day).toBe(-3);
    expect(d.worst5Day).toBe(-5);
  });

  it("reports no loss when the book never had a losing day", () => {
    const d = dailyRisk([at("2026-05-01 09:00", 3, "TP_HIT")], false);
    expect(d.worstDayLoss).toBe(0);
    expect(d.worstDayClose).toBe(3);   // the worst day was still a winner
    expect(Number.isNaN(d.worst3Day)).toBe(true);   // one day of history
  });

  it("charges spread the same way stats() does", () => {
    // entry-stop is 0.0010 and EURUSD's estimated spread is 0.00002, so the
    // round trip costs 2 * (0.00002 / 0.0010) = 0.04R.
    const rows = [at("2026-05-01 09:00", -1)];
    expect(dailyRisk(rows, false).worstDayLoss).toBe(1);
    expect(dailyRisk(rows, true).worstDayLoss).toBeCloseTo(1.04, 10);
  });

  it("ignores trades that never resolved", () => {
    const d = dailyRisk([mk({ status: "OPEN", r: NaN, exitTime: "-" })], false);
    expect(d.days).toBe(0);
    expect(d.worstDayLoss).toBe(0);
  });
});

describe("riskForLimit — sizing against a prop-firm cap", () => {
  it("sizes so the worst observed loss exactly meets the limit", () => {
    expect(riskForLimit(-2, 3)).toBe(1.5);     // 2R day at 1.5% = 3%
    expect(riskForLimit(-4, 5)).toBe(1.25);
  });

  it("returns Infinity when the worst case was not a loss", () => {
    expect(riskForLimit(0, 3)).toBe(Infinity);
    expect(riskForLimit(2, 3)).toBe(Infinity);
  });
});

describe("prop challenge — would a month have passed", () => {
  const lim = { targetPct: 8, dailyPct: 3, totalPct: 5 };
  const at = (exitTime: string, r: number, status = "SL_HIT") =>
    mk({ status, r, exitTime, entryTime: exitTime, exit: 1.1, entry: 1.1010, stop: 1.1000 });

  it("groups by calendar month, sorted, with the three figures a firm tests", () => {
    const rows = [
      at("2026-06-10 09:00", 2, "TP_HIT"), at("2026-05-10 09:00", -1),
      at("2026-06-11 09:00", -1),
    ];
    const m = monthlyBuckets(rows, false);
    expect(m.map((x) => x.month)).toEqual(["2026-05", "2026-06"]);
    expect(m[0]).toMatchObject({ alerts: 1, netR: -1, worstDay: 1 });
    expect(m[1]).toMatchObject({ alerts: 2, netR: 1 });
    expect(m[1].maxDD).toBe(1);        // +2 then -1: peak 2, trough 1
  });

  it("fails a month that made the target but breached the daily limit", () => {
    // 12% made, and the account was already gone on day one. Reporting this as
    // a pass is how a backtest starts lying about a funded account.
    const v = challengeVerdict(
      { month: "2026-05", alerts: 5, netR: 12, maxDD: 2, worstDay: 4 }, 1, lim);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("daily");
  });

  it("reports the daily breach, not the missed target, when both happen", () => {
    // The discriminating case: a month that misses the target AND breaches the
    // daily limit fails either way, so only the reason shows which check ran
    // first. A firm would have closed the account on the breach, and a report
    // that says "made 5% < 8%" implies the month was merely unprofitable.
    const m = { month: "2026-05", alerts: 5, netR: 5, maxDD: 2, worstDay: 4 };
    const v = challengeVerdict(m, 1, lim);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("daily");
    expect(v.reason).not.toContain("made");
  });

  it("fails on the overall limit before it considers the target", () => {
    const v = challengeVerdict(
      { month: "2026-05", alerts: 5, netR: 5, maxDD: 6, worstDay: 1 }, 1, lim);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("total");
    expect(v.reason).not.toContain("made");
  });

  it("fails a clean month that simply did not make the target", () => {
    const v = challengeVerdict(
      { month: "2026-05", alerts: 5, netR: 5, maxDD: 2, worstDay: 1 }, 1, lim);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("made");
  });

  it("passes a month inside every limit", () => {
    const v = challengeVerdict(
      { month: "2026-05", alerts: 5, netR: 9, maxDD: 3, worstDay: 2 }, 1, lim);
    expect(v.pass).toBe(true);
  });

  it("scales with risk per trade, which is the actual decision variable", () => {
    const m = { month: "2026-05", alerts: 5, netR: 9, maxDD: 3, worstDay: 2 };
    expect(challengeVerdict(m, 1, lim).pass).toBe(true);      // 9%, worst day 2%
    expect(challengeVerdict(m, 0.5, lim).pass).toBe(false);  // 4.5% < 8%
    expect(challengeVerdict(m, 2, lim).pass).toBe(false);    // worst day 4% >= 3%
  });

  it("charges spread once, not once per month", () => {
    const rows = [at("2026-05-10 09:00", -1)];
    const raw = monthlyBuckets(rows, false)[0];
    const adj = monthlyBuckets(rows, true)[0];
    // EURUSD spread 0.00002 over a 0.0010 stop = 0.02R a side, 0.04 round trip.
    expect(adj.netR).toBeCloseTo(raw.netR - 0.04, 10);
  });
});

describe("capPerDay — daily trade cap", () => {
  const at = (entryTime: string, r: number, status = "SL_HIT") =>
    mk({ status, r, entryTime, exitTime: entryTime, exit: 1.1, entry: 1.1010, stop: 1.1000 });

  it("keeps the first N of a day, in entry order", () => {
    const rows = [at("2026-05-01 09:00", -1), at("2026-05-01 11:00", 3, "TP_HIT"),
                  at("2026-05-01 14:00", -1)];
    const kept = capPerDay(rows, 1);
    expect(kept).toHaveLength(1);
    expect(kept[0].entryTime).toBe("2026-05-01 09:00");
  });

  it("does not pick the day's best trade - that would be untradeable", () => {
    // The loser is first and the winner is second. Choosing by outcome would
    // report a number no subscriber could actually have taken.
    const rows = [at("2026-05-01 09:00", -1), at("2026-05-01 11:00", 3, "TP_HIT")];
    expect(capPerDay(rows, 1)[0].r).toBe(-1);
  });

  it("sorts before capping, so unsorted input cannot change which trade wins", () => {
    const rows = [at("2026-05-01 14:00", -1), at("2026-05-01 09:00", 3, "TP_HIT")];
    const kept = capPerDay(rows, 1);
    expect(kept).toHaveLength(1);
    expect(kept[0].entryTime).toBe("2026-05-01 09:00");
  });

  it("counts days separately", () => {
    const rows = [at("2026-05-01 09:00", -1), at("2026-05-01 11:00", -1),
                  at("2026-05-02 09:00", -1)];
    expect(capPerDay(rows, 1)).toHaveLength(2);
    expect(capPerDay(rows, 2)).toHaveLength(3);
  });

  it("treats zero, negative and non-finite as uncapped", () => {
    const rows = [at("2026-05-01 09:00", -1), at("2026-05-01 11:00", -1)];
    expect(capPerDay(rows, 0)).toHaveLength(2);
    expect(capPerDay(rows, -1)).toHaveLength(2);
    expect(capPerDay(rows, NaN)).toHaveLength(2);
  });
});
