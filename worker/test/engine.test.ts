/** State-machine parity tests — row-for-row ports of the Python engine
 *  tests (tests/test_engine.py). Synthetic fixtures verify logic only. */
import { describe, expect, it } from "vitest";
import { defaultStrategy } from "../src/config";
import { scanEntry, selectTargets } from "../src/engine";
import { PARAM_VERSION } from "../src/config";
import {
  LONG_ROWS, LONG_STORY, SHORT_ROWS, SHORT_STORY, mkCandles, snapsFor,
} from "./fixtures";

const cfg = defaultStrategy();

function runShort(rows = SHORT_ROWS, extra = {}) {
  return scanEntry({
    pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
    candles: mkCandles(rows, 30), snaps: snapsFor(SHORT_STORY),
    cfg: { ...cfg, ...extra }, mode: "paper", provider: "test",
  });
}

describe("short confirmation path", () => {
  it("fires exactly once with full context", () => {
    const candles = mkCandles(SHORT_ROWS, 30);
    const { alerts, events } = runShort();
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.direction).toBe("SHORT");
    expect(a.entry).toBe(104.9);                    // retest candle close
    expect(a.invalidationLevel).toBeCloseTo(105.1); // sweep extreme
    expect(a.stopLoss).toBeGreaterThan(105.1);      // extreme + ATR buffer
    expect(a.tpInternal).toBe(104.0);               // nearest sellside internal pool
    expect(a.tpExternal).toBe(101.0);               // external draw target
    expect(a.sweepTime).toBe(candles[10].t);
    expect(a.bosTime).toBe(candles[11].t);
    expect(a.returnTime).toBe(candles[14].t);
    expect(a.keyLevelType).toBe("A");
    expect(a.keyLevelBounds).toEqual([104.95, 105.05]);
    expect(a.keyLevelTested).toBe(true);
    expect(a.environment).toBe("bearish");
    expect(a.phase).toBe("pullback");
    expect(a.opposingLiquidityStanding).toBe(true);
    expect(a.entryMode).toBe("confirmation");
    expect(a.parameterVersion).toBe(PARAM_VERSION);
    expect(a.alertStatus).toBe("PAPER");
    expect(events.map((e) => e.state)).toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]);
    expect(events.every((e) => e.setupId === a.setupId)).toBe(true);
  });

  it("is deterministic across replays", () => {
    const a1 = runShort();
    const a2 = runShort();
    expect(a1.alerts.map((x) => x.setupId)).toEqual(a2.alerts.map((x) => x.setupId));
    expect(a1.events.map((e) => [e.setupId, e.state, e.candleTime]))
      .toEqual(a2.events.map((e) => [e.setupId, e.state, e.candleTime]));
  });
});

describe("long mirror path", () => {
  it("fires the mirrored setup", () => {
    const candles = mkCandles(LONG_ROWS, 30);
    const { alerts, events } = scanEntry({
      pair: "GBPUSD", entryTf: "30m", tfSeconds: 1800,
      candles, snaps: snapsFor(LONG_STORY), cfg, mode: "paper", provider: "test",
    });
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.direction).toBe("LONG");
    expect(a.entry).toBe(98.1);
    expect(a.invalidationLevel).toBeCloseTo(96.9);
    expect(a.stopLoss).toBeLessThan(96.9);
    expect(a.tpInternal).toBe(100.0);
    expect(a.tpExternal).toBe(103.0);
    expect(events.map((e) => e.state)).toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]);
  });
});

describe("failure paths", () => {
  it("invalidates on a close beyond the sweep extreme", () => {
    const rows = [...SHORT_ROWS.slice(0, 12), [103.9, 105.6, 103.85, 105.3] as [number, number, number, number]];
    const { alerts, events } = runShort(rows);
    expect(alerts).toHaveLength(0);
    expect(events[events.length - 1].state).toBe("INVALID");
    expect(events[events.length - 1].reason).toContain("invalidation level");
  });

  it("arms nothing without a storyline", () => {
    const { alerts, events } = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: mkCandles(SHORT_ROWS, 30), snaps: [], cfg, mode: "paper", provider: "test",
    });
    expect(alerts).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("expires when no retest comes", () => {
    const rows: [number, number, number, number][] = [
      ...SHORT_ROWS.slice(0, 12),
      [103.9, 104.0, 103.4, 103.5],
      [103.5, 103.6, 103.3, 103.4],
      [103.4, 103.5, 103.1, 103.2],
    ];
    const { alerts, events } = runShort(rows, { retestWindow: 2 });
    expect(alerts).toHaveLength(0);
    expect(events[events.length - 1].state).toBe("EXPIRED");
  });

  it("records but suppresses alerts outside the session allowlist", () => {
    const { alerts } = runShort(SHORT_ROWS, {
      sessionsAllowlist: [["Nowhere", "01:00", "02:00"]],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alertStatus).toBe("SUPPRESSED");
    expect(alerts[0].suppressReason).toBe("outside session allowlist");
  });
});

describe("target selection (regression: stale external draw must never sit on the wrong side of entry)", () => {
  const base = { risk: 5.83, minTpR: 0.5, internalPools: [] as { side: string; price: number }[] };

  it("SHORT with external draw ABOVE entry → no alert (the XAUUSD 4444.64 case)", () => {
    expect(selectTargets({ ...base, isShort: true, entry: 4437.65, nearestExternalTarget: 4444.64 })).toBeNull();
  });

  it("LONG with external draw BELOW entry → no alert", () => {
    expect(selectTargets({ ...base, isShort: false, entry: 1.16, nearestExternalTarget: 1.15 })).toBeNull();
  });

  it("SHORT keeps a same-ticking external draw that is below entry", () => {
    const t = selectTargets({ ...base, isShort: true, entry: 4437.65, nearestExternalTarget: 4430.0 });
    expect(t).toEqual({ tp1: 4430.0, tp2: null });
  });

  it("internal pool preferred; external kept as tp2 when farther", () => {
    const t = selectTargets({
      ...base, isShort: true, entry: 100,
      internalPools: [{ side: "sellside", price: 97 }, { side: "buyside", price: 105 }],
      nearestExternalTarget: 90,
    });
    expect(t).toEqual({ tp1: 97, tp2: 90 });
  });

  it("upsizes tp1 to the external draw when the internal pool is too close", () => {
    const t = selectTargets({
      ...base, isShort: true, entry: 100,
      internalPools: [{ side: "sellside", price: 99.5 }],  // < minTpR away
      nearestExternalTarget: 90,
    });
    expect(t).toEqual({ tp1: 90, tp2: null });
  });
});
