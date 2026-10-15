/**
 * Direction split grouping.
 *
 * The live book looked one-sided, and this helper is what turns "I only see
 * shorts" into a number. The property that matters is that it cannot make a
 * book look more balanced, or more one-sided, than it is: both directions are
 * always reported, and a row with no recorded direction gets its own group
 * instead of being folded into whichever side happens to be nearest.
 */
import { describe, expect, it } from "vitest";
import { directionGroups, type Trade } from "../src/replay_stats";

function mk(o: Partial<Trade> = {}): Trade {
  return {
    pair: "EURUSD", tf: "30m", setupId: `s${Math.random()}`,
    entryTime: "2026-01-05 18:00", entry: 1.1, stop: 1.099, tp: 1.1025,
    status: "SL_HIT", exit: 1.099, exitTime: "2026-01-05 20:00", r: -1,
    limitStatus: "OPEN", limitEntry: 1.1, limitExitTime: "-", limitR: NaN,
    marketStatus: "OPEN", marketEntry: 1.1, marketExitTime: "-", marketR: NaN,
    ...o,
  };
}

const longs = (n: number) => Array.from({ length: n }, () => mk({ dir: "LONG" }));
const shorts = (n: number) => Array.from({ length: n }, () => mk({ dir: "SHORT" }));

describe("directionGroups", () => {
  it("returns LONG then SHORT, with the rows in each", () => {
    const rows = [...longs(3), ...shorts(5)];
    const groups = directionGroups(rows);
    expect(groups.map(([name]) => name)).toEqual(["LONG", "SHORT"]);
    expect(groups[0][1]).toHaveLength(3);
    expect(groups[1][1]).toHaveLength(5);
  });

  it("still reports an empty LONG group for an all-short book", () => {
    // This is the case the whole breakdown exists for. If the empty side were
    // dropped, a 100%-short book and a book where LONG was never measured would
    // print identically - and the difference is the entire question.
    const groups = directionGroups(shorts(7));
    expect(groups.map(([name]) => name)).toEqual(["LONG", "SHORT"]);
    expect(groups[0][1]).toHaveLength(0);
    expect(groups[1][1]).toHaveLength(7);
  });

  it("still reports an empty SHORT group for an all-long book", () => {
    const groups = directionGroups(longs(4));
    expect(groups.map(([name, rows]) => [name, rows.length])).toEqual([["LONG", 4], ["SHORT", 0]]);
  });

  it("gives rows with no recorded direction their own group", () => {
    const rows = [...longs(2), ...shorts(3), mk(), mk()];
    const groups = directionGroups(rows);
    expect(groups.map(([name]) => name)).toEqual(["LONG", "SHORT", "UNKNOWN"]);
    expect(groups[2][1]).toHaveLength(2);
  });

  it("omits UNKNOWN when every row is labelled, so the table is not padded", () => {
    const names = directionGroups([...longs(1), ...shorts(1)]).map(([n]) => n);
    expect(names).not.toContain("UNKNOWN");
  });

  it("partitions exactly: no row counted twice, none dropped", () => {
    const rows = [...longs(6), ...shorts(9), mk(), mk(), mk()];
    const groups = directionGroups(rows);
    const total = groups.reduce((acc, [, r]) => acc + r.length, 0);
    expect(total).toBe(rows.length);
    // Disjoint, not just the right size: a row landing in two groups would pass
    // the count check above while still misstating the split.
    const ids = groups.flatMap(([, r]) => r.map((t) => t.setupId));
    expect(new Set(ids).size).toBe(rows.length);
  });

  it("returns both empty groups for an empty book rather than nothing", () => {
    const groups = directionGroups([]);
    expect(groups.map(([name, rows]) => [name, rows.length])).toEqual([["LONG", 0], ["SHORT", 0]]);
  });

  it("does not mutate the rows it is given", () => {
    const rows = [...longs(2), ...shorts(2)];
    const before = rows.map((t) => t.dir);
    directionGroups(rows);
    expect(rows.map((t) => t.dir)).toEqual(before);
  });
});
