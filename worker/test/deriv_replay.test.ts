import { describe, expect, it } from "vitest";
import {
  applyDerivSpreadScenario, derivCrossTimeframeDuplicate, derivDeliveryCooldownActive,
  splitDerivHoldout,
} from "../src/deriv_replay";
import type { Trade } from "../src/replay_stats";

const mk = (overrides: Partial<Trade> = {}): Trade => ({
  pair: "V75", tf: "30m", setupId: "trade",
  entryTime: "2026-04-01 10:00", entry: 100, stop: 99, tp: 103,
  status: "TP_HIT", exit: 103, exitTime: "2026-04-01 11:00", r: 3,
  limitStatus: "OPEN", limitEntry: 100, limitExitTime: "-", limitR: Number.NaN,
  marketStatus: "OPEN", marketEntry: 100, marketExitTime: "-", marketR: Number.NaN,
  ...overrides,
});

describe("fixed chronological Deriv holdout", () => {
  const end = Date.UTC(2026, 5, 1);
  const splitTime = Date.UTC(2026, 4, 2);

  it("keeps the final 120 days fixed to the replay end and includes the boundary in holdout", () => {
    const rows = [
      mk({ setupId: "before", entryTime: "2026-05-01 23:59", exitTime: "2026-05-02 00:00" }),
      mk({ setupId: "at-boundary", entryTime: "2026-05-02 00:00", exitTime: "2026-05-02 01:00" }),
    ];
    const split = splitDerivHoldout(rows, { heldOutDays: 30, now: end });
    expect(split.splitTime).toBe(splitTime);
    expect(split.endTime).toBe(end);
    expect(split.development).toHaveLength(0);
    expect(split.holdout.map((row) => row.setupId)).toEqual(["at-boundary"]);
    expect(split.purged).toBe(1);
  });

  it("purges development trades that resolve across the boundary or remain open", () => {
    const rows = [
      mk({ setupId: "resolved-in-development", entryTime: "2026-04-20 10:00", exitTime: "2026-04-21 12:00" }),
      mk({ setupId: "crosses-boundary", entryTime: "2026-05-01 10:00", exitTime: "2026-05-03 12:00" }),
      mk({ setupId: "unresolved", status: "OPEN", entryTime: "2026-04-30 10:00", exitTime: "-" }),
      mk({ setupId: "held-out-open", status: "OPEN", entryTime: "2026-05-03 10:00", exitTime: "-" }),
    ];
    const split = splitDerivHoldout(rows, { heldOutDays: 30, now: end });
    expect(split.development.map((row) => row.setupId)).toEqual(["resolved-in-development"]);
    expect(split.holdout.map((row) => row.setupId)).toEqual(["held-out-open"]);
    expect(split.purged).toBe(2);
  });

  it("ignores invalid timestamps, entries after the replay end, and invalid split options", () => {
    const rows = [
      mk({ setupId: "invalid", entryTime: "not-a-date" }),
      mk({ setupId: "future", entryTime: "2026-06-01 00:01" }),
    ];
    const split = splitDerivHoldout(rows, { heldOutDays: 30, now: end });
    expect(split.ignored).toBe(2);
    expect(() => splitDerivHoldout([], { heldOutDays: 0, now: end })).toThrow("positive integer");
    expect(() => splitDerivHoldout([], { heldOutDays: 30, now: Number.NaN })).toThrow("finite timestamp");
  });
});

describe("Deriv spread and delivery scenarios", () => {
  it("charges both spread sides against initial risk without mutating source rows", () => {
    const rows = [
      mk({ setupId: "win", r: 2.5 }),
      mk({ setupId: "loss", r: -1 }),
      mk({ setupId: "open", status: "OPEN", r: Number.NaN }),
      mk({ setupId: "zero-risk", entry: 100, stop: 100, r: 1 }),
    ];
    const adjusted = applyDerivSpreadScenario(rows, 0.025);
    expect(adjusted[0].r).toBeCloseTo(2.45, 10);
    expect(adjusted[1].r).toBeCloseTo(-1.05, 10);
    expect(Number.isNaN(adjusted[2].r)).toBe(true);
    expect(adjusted[3].r).toBe(1);
    expect(rows[0].r).toBe(2.5);
    expect(() => applyDerivSpreadScenario([], -0.01)).toThrow("non-negative");
  });

  it("keeps the 240-minute cooldown boundary and only blocks cross-timeframe duplicates", () => {
    const now = Date.UTC(2026, 9, 16, 12);
    expect(derivDeliveryCooldownActive(now, now + 239 * 60_000, 240)).toBe(true);
    expect(derivDeliveryCooldownActive(now, now + 240 * 60_000, 240)).toBe(false);
    expect(derivDeliveryCooldownActive(undefined, now, 240)).toBe(false);

    const previous = [{ tf: "30m", time: now }];
    expect(derivCrossTimeframeDuplicate(previous, "1h", now + 30 * 60_000, 240)).toBe(true);
    expect(derivCrossTimeframeDuplicate(previous, "30m", now + 30 * 60_000, 240)).toBe(false);
    expect(derivCrossTimeframeDuplicate(previous, "1h", now + 240 * 60_000, 240)).toBe(false);
  });
});
