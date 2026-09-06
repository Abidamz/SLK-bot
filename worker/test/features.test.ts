/** Feature-extraction parity tests (ports a subset of tests/test_features.py). */
import { describe, expect, it } from "vitest";
import * as F from "../src/features";
import { BASE, fromCloses, mkCandles } from "./fixtures";

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
