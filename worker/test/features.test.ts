/** Feature-extraction parity tests (ports a subset of tests/test_features.py). */
import { describe, expect, it } from "vitest";
import * as F from "../src/features";
import { BASE, fromCloses, mkCandles } from "./fixtures";
import type { Candle } from "../src/types";

describe("structure", () => {
  it("reads bearish lower-highs/lower-lows", () => {
    const candles = fromCloses([
      110, 109, 108, 107, 106,
      106.5, 107, 107.5, 108,
      107, 106, 105, 104,
      104.5, 105, 105.5,
      105, 104, 103, 102, 101,
      101.8, 102.3, 102.1, 102.2,
    ]);
    expect(F.environment(candles)).toBe("bearish");
    expect(F.structureInvalidationLevel(candles, "SHORT")).toBeCloseTo(102.3 + 0.08, 6);
  });

  it("reads bullish higher-highs/higher-lows and consolidations", () => {
    const bull = fromCloses([
      100, 101, 102, 103, 104,
      103.5, 103, 102.5, 102,
      103, 104, 105, 106,
      105.5, 105, 104.5,
      105, 106, 107, 108, 109,
    ]);
    expect(F.environment(bull)).toBe("bullish");
    const chop = fromCloses([100, 101, 100, 101, 100, 101, 100, 101, 100, 101]);
    expect(F.environment(chop)).toBe("consolidation");
  });

  it("detects the first close through a pivot (BOS) and the phase", () => {
    const candles = mkCandles([
      [100, 101, 99, 100.5],
      [100.5, 103, 100, 102.5],
      [102.5, 102.8, 101.5, 102],
      [102, 102.5, 100.5, 101],
      [101, 102, 100, 101.5],
      [101.5, 104, 101, 103.5],
    ], 240);
    const ev = F.bosEvent(candles, 1, 1);
    expect(ev).not.toBeNull();
    expect(ev![0]).toBe(5);
    expect(ev![1]).toBe("up");
    expect(ev![2]).toBe(103);
    expect(F.phase(candles, "bullish", 3, 1, 1)).toBe("expansion");
    expect(F.phase(candles, "bearish", 3, 1, 1)).toBe("reversal");
  });
});

describe("resampling", () => {
  it("resamples 1h → 4h epoch-aligned", () => {
    const candles = mkCandles(
      Array.from({ length: 8 }, (_, i) => [100 + i, 101 + i, 99 + i, 100.5 + i] as [number, number, number, number]),
      60, BASE,
    );
    const h4 = F.resampleCandles(candles, 14400);
    expect(h4).toHaveLength(2);
    expect(h4[0]).toMatchObject({ t: BASE, o: 100, h: 104, l: 99, c: 103.5 });
  });

  it("aggregates calendar weeks and months", () => {
    const days = mkCandles(
      Array.from({ length: 10 }, (_, i) => [100 + i, 101 + i, 99 + i, 100 + i] as [number, number, number, number]),
      1440, BASE,
    );
    const weeks = F.resampleCalendar(days, "W");
    const months = F.resampleCalendar(days, "M");
    expect(weeks).toHaveLength(2);
    expect(months).toHaveLength(1);
    expect(weeks[0].h).toBe(107);
    expect(weeks[1].c).toBe(109);
  });
});

describe("key levels & imbalances", () => {
  it("finds unmitigated bullish FVGs and drops mitigated ones", () => {
    const rows: [number, number, number, number][] = [
      [100.0, 101.0, 99.5, 100.5],
      [100.5, 102.0, 100.0, 101.8],
      [101.8, 103.0, 101.5, 102.6],
      [102.6, 103.5, 102.0, 103.0],
      [103.0, 103.8, 102.5, 103.4],
    ];
    const zones = F.fvgZones(mkCandles(rows, 240), 20);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ lo: 101, hi: 101.5, direction: "bullish" });
    const mitigated = mkCandles([...rows, [103.4, 104.0, 100.5, 101.0]], 240);
    expect(F.fvgZones(mitigated, 20)).toHaveLength(0);
  });

  it("detects A-top levels and flips them after a decisive close through", () => {
    const strat = {
      atrPeriod: 14, avLen: 2, levelToleranceAtr: 0.25, levelLookback: 120,
      decisionAtrMult: 1.5, flipMarginAtr: 0.5,
    };
    const candles = fromCloses([100, 101, 102, 103, 104, 103, 102, 103, 104, 105, 106], 240);
    const levels = F.keyLevels(candles, strat as never);
    const aTop = levels.find((l) => l.kind === "A" && l.originPrice === 104);
    expect(aTop).toBeTruthy();
    expect(aTop!.flipped).toBe(true);
  });

  it("defines OC as consecutive candle-body overlap, not a single wide candle", () => {
    const strat = {
      atrPeriod: 14, avLen: 2, levelToleranceAtr: 0.25, levelLookback: 120,
      decisionAtrMult: 1.5, flipMarginAtr: 0.5,
    };
    const overlapCandles = mkCandles([
      [100.0, 100.8, 99.6, 100.4],
      [100.3, 101.0, 100.1, 100.8],
      [100.8, 101.5, 100.5, 101.3],
      [101.3, 102.0, 101.0, 101.8],
      [101.8, 102.5, 101.5, 102.3],
    ], 240);
    const overlap = F.keyLevels(overlapCandles, strat as never)
      .find((l) => l.kind === "OC" && l.originIndex === 1);
    expect(overlap).toBeTruthy();
    expect(overlap!.zoneLo).toBeCloseTo(100.3);
    expect(overlap!.zoneHi).toBeCloseTo(100.4);
    expect(overlap!.originPrice).toBeCloseTo(100.35);

    const decisionCandles = mkCandles(
      Array.from({ length: 10 }, (_, i) => [100 + i, 100.6 + i, 99.5 + i, 100.4 + i] as [number, number, number, number]),
      240,
    );
    decisionCandles[6] = { ...decisionCandles[6], o: 100.4, h: 105.0, l: 100.2, c: 104.6 };
    const decisionLevels = F.keyLevels(decisionCandles, strat as never);
    expect(decisionLevels.some((l) => l.kind === "OC" && l.originIndex === 6)).toBe(false);
    expect(decisionLevels.some((l) => l.kind === "DECISION" && l.originIndex === 6
      && Math.abs(l.zoneLo - 100.4) < 1e-9 && Math.abs(l.zoneHi - 104.6) < 1e-9)).toBe(true);
  });
});

describe("misc gates", () => {
  it("session windows incl. overnight", () => {
    const at = (hh: number, mm: number) => BASE + hh * 3600_000 + mm * 60_000;
    const zones: [string, string, string][] = [["London", "07:00", "10:00"], ["NewYork", "12:00", "15:00"]];
    expect(F.sessionFor(at(8, 30), zones)).toBe("London");
    expect(F.sessionFor(at(10, 0), zones)).toBeNull();
    expect(F.sessionFor(at(23, 15), [["Asia", "22:00", "02:00"]])).toBe("Asia");
    expect(F.sessionFor(at(0, 45), [["Asia", "22:00", "02:00"]])).toBe("Asia");
  });

  it("drops the in-progress candle", () => {
    const now = BASE + 1000_000;
    const closed = { t: now - 1800_000, o: 1, h: 2, l: 0.5, c: 1.5 };
    const forming = { t: now - 5_000, o: 1, h: 2, l: 0.5, c: 1.5 };
    expect(F.dropIncomplete([closed, forming], 900, now)).toEqual([closed]);
  });
});

describe("calendarSeriesComplete — the period still in progress is dropped", () => {
  const day = (y: number, m: number, d: number, c: number): Candle =>
    ({ t: Date.UTC(y, m - 1, d), o: c, h: c + 0.01, l: c - 0.01, c });

  // Mon 2026-09-28 to Fri 2026-10-02 is one ISO week; Mon 2026-10-05 opens the next.
  const weekA = [day(2026, 9, 28, 1.10), day(2026, 9, 29, 1.11), day(2026, 9, 30, 1.12),
    day(2026, 10, 1, 1.13), day(2026, 10, 2, 1.14)];
  const weekB = [day(2026, 10, 5, 1.15), day(2026, 10, 6, 1.16), day(2026, 10, 7, 1.17)];

  it("drops the week that has not finished, keeping the Friday close", () => {
    const w = F.calendarSeriesComplete([...weekA, ...weekB], "W", Date.UTC(2026, 9, 7, 12));
    expect(w.length).toBe(1);
    expect(w[0].t).toBe(Date.UTC(2026, 8, 28));
    expect(w[0].c).toBe(1.14);
  });

  it("keeps a finished week before any new bar has landed", () => {
    // Monday morning: the newest daily bar is Friday's, so the week behind it is
    // complete. Unconditionally dropping the last group would lose a whole week.
    expect(F.calendarSeriesComplete(weekA, "W", Date.UTC(2026, 9, 5, 0, 30)).length).toBe(1);
  });

  it("drops an in-progress month that dropIncomplete would keep", () => {
    const july = [day(2026, 7, 1, 1.00), day(2026, 7, 15, 1.05), day(2026, 7, 31, 1.10)];
    const close = Date.UTC(2026, 6, 31, 12);
    expect(F.calendarSeriesComplete(july, "M", close).length).toBe(0);
    // The fixed-period test this replaces. July opens on the 1st, so t + 30d
    // lands on the 31st and the unfinished candle passes — a gate reading it
    // would be reading a monthly close that has not happened yet.
    expect(F.dropIncomplete(F.resampleCalendar(july, "M"), 30 * 86400, close).length).toBe(1);
  });

  it("keeps a month once the next one has started", () => {
    const m = F.calendarSeriesComplete(
      [day(2026, 7, 1, 1.00), day(2026, 7, 31, 1.10), day(2026, 8, 3, 1.20)],
      "M", Date.UTC(2026, 7, 3, 12),
    );
    expect(m.length).toBe(1);
    expect(m[0].c).toBe(1.10);
  });

  it("is empty in, empty out", () => {
    expect(F.calendarSeriesComplete([], "W", Date.UTC(2026, 9, 7))).toEqual([]);
  });
});
