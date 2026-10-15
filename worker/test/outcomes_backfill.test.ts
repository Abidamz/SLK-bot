import { describe, expect, it } from "vitest";
import { backfillOutcome } from "../src/outcomes";
import type { Candle } from "../src/types";

const T0 = Date.parse("2026-10-15T09:00:00Z");
const mk = (i: number, o: number, h: number, l: number, c: number): Candle =>
  ({ t: T0 + i * 900_000, o, h, l, c });

describe("backfillOutcome", () => {
  it("resolves a LONG TP touch from history with the correct R", () => {
    const r = backfillOutcome("LONG", 100, 99, 103, T0 - 60_000, [
      mk(0, 100, 100.5, 99.8, 100.2),
      mk(1, 100.2, 103.5, 100.1, 103.1),
    ]);
    expect(r.reason).toBeNull();
    expect(r.outcome?.status).toBe("TP_HIT");
    expect(r.outcome?.rMultiple).toBeCloseTo(3, 10);
    expect(r.outcome?.exitTime).toBe(T0 + 900_000);
  });

  it("resolves a SHORT TP touch from history", () => {
    const r = backfillOutcome("SHORT", 100, 101, 97, T0, [
      mk(0, 100, 100.4, 96.5, 96.9),
    ]);
    expect(r.reason).toBeNull();
    expect(r.outcome?.status).toBe("TP_HIT");
    expect(r.outcome?.rMultiple).toBeCloseTo(3, 10);
  });

  it("reports BAD_TARGET for a null-derived (0) target", () => {
    const r = backfillOutcome("LONG", 100, 99, Number(null), T0, [mk(0, 100, 105, 99, 104)]);
    expect(r.outcome).toBeNull();
    expect(r.reason).toBe("BAD_TARGET");
  });

  it("reports BAD_TARGET for a target on the wrong side of entry", () => {
    expect(backfillOutcome("LONG", 100, 99, 95, T0, [mk(0, 100, 105, 99, 104)]).reason).toBe("BAD_TARGET");
    expect(backfillOutcome("SHORT", 100, 101, 105, T0, [mk(0, 100, 105, 99, 104)]).reason).toBe("BAD_TARGET");
  });

  it("reports NO_CANDLES_AFTER_ENTRY when the feed window predates the entry", () => {
    const r = backfillOutcome("LONG", 100, 99, 103, T0 + 10 * 900_000, [
      mk(0, 100, 100.5, 99.8, 100.2),
      mk(1, 100.2, 103.5, 100.1, 103.1),
    ]);
    expect(r.outcome).toBeNull();
    expect(r.reason).toBe("NO_CANDLES_AFTER_ENTRY");
  });

  it("reports UNRESOLVED while history contains neither touch nor expiry", () => {
    const r = backfillOutcome("LONG", 100, 99, 103, T0, [
      mk(0, 100, 100.5, 99.8, 100.2),
      mk(1, 100.2, 101.0, 99.9, 100.6),
    ]);
    expect(r.outcome).toBeNull();
    expect(r.reason).toBe("UNRESOLVED");
  });

  it("ignores candles before the entry time even if they touch the target", () => {
    const r = backfillOutcome("LONG", 100, 99, 103, T0, [
      mk(0, 100, 104.0, 99.8, 103.5), // touches tp but is the entry candle boundary
    ], 120, false, 1.5, true);
    // entry candle IS included (c.t >= entryTime), so this resolves TP_HIT
    expect(r.outcome?.status).toBe("TP_HIT");
    const r2 = backfillOutcome("LONG", 100, 99, 103, T0 + 900_000, [
      mk(0, 100, 104.0, 99.8, 103.5), // touch happens strictly before entry
      mk(1, 102.5, 102.8, 101.9, 102.2), // post-entry candle stays below tp
    ]);
    expect(r2.outcome).toBeNull();
    expect(r2.reason).toBe("UNRESOLVED");
  });
});
