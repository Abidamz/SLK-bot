/** State-machine parity tests — row-for-row ports of the Python engine
 *  tests (tests/test_engine.py). Synthetic fixtures verify logic only. */
import { describe, expect, it } from "vitest";
import { defaultStrategy } from "../src/config";
import { scanEntry, selectTargets } from "../src/engine";
import { PARAM_VERSION } from "../src/config";
import {
  LONG_ROWS, LONG_STORY, SHORT_ROWS, SHORT_STORY, mkCandles, snapsFor,
} from "./fixtures";

const cfg = { ...defaultStrategy(), minRiskAtr: 0.1 }; // parity fixtures include a tiny stop

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
    // min 1:3 RR: the close-by 100.0 internal pool is skipped; TP1 is
    // bounded at 3R and the distant external draw remains TP2/context.
    expect(a.tpInternal).toBeCloseTo(101.8857857143, 5);
    expect(a.tpExternal).toBe(103.0);
    expect(a.rrInternal).toBeGreaterThanOrEqual(3);
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

  it("bounds a far promoted draw at the minimum execution target", () => {
    const t = selectTargets({
      ...base, isShort: true, entry: 100,
      internalPools: [{ side: "sellside", price: 99.5 }],  // < minTpR away
      nearestExternalTarget: 90,
    });
    expect(t).toEqual({ tp1: 97.085, tp2: 90 });
  });
});

describe("risk shaping (min 1:3 RR + ATR-normalized stop ceiling)", () => {
  it("skips setups whose best target is under 3R", () => {
    const { alerts } = runShort(SHORT_ROWS, { minTpR: 999 });
    expect(alerts).toHaveLength(0);
  });

  it("skips setups whose structural stop is wider than 3.5× entry-TF ATR", () => {
    const { alerts } = runShort(SHORT_ROWS, { maxStopAtr: 0.05 });
    expect(alerts).toHaveLength(0);
  });

  it("the exact same setup still fires when the cap is reasonable", () => {
    const { alerts } = runShort(SHORT_ROWS, { maxStopAtr: 3.5 });
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    for (const a of alerts) {
      expect(a.rrInternal).toBeGreaterThanOrEqual(3); // minTpR default
      // stop width never exceeds 3.5 ATR from entry
      expect(Math.abs(a.entry - a.stopLoss)).toBeLessThanOrEqual(3.5 * a.atrEntry + 1e-9);
    }
  });
});

describe("behavior-neutral replay diagnostics", () => {
  it("counts the confirmation path without adding lifecycle events", () => {
    const result = runShort();
    expect(result.diagnostics).toEqual({
      MAP: 1, TOUCH: 1, SWEEP: 1, SHIFT: 1, RETEST: 1, INVALID: 0, EXPIRED: 0,
      retestCandidates: 1, riskRejects: 0,
      riskRejectReasons: { nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0 },
      targetRejects: 0, confirmedAlerts: 1,
    });
    expect(runShort()).toEqual(result);
  });

  it.each([
    ["belowMinRiskAtr", { minRiskAtr: 0.8 }], // production floor rejects this tiny-stop fixture
    ["aboveMaxStopAtr", { maxStopAtr: 0.05 }],
    ["nonPositiveRisk", { slBufferAtr: -10 }], // synthetic branch coverage only
  ])("counts %s once, without fabricating RETEST/INVALID events", (reason, extra) => {
    const result = runShort(SHORT_ROWS, extra);
    expect(result.alerts).toEqual([]);
    expect(result.events.map(e => e.state)).toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT"]);
    expect(result.diagnostics).toMatchObject({ retestCandidates: 1, riskRejects: 1, targetRejects: 0, RETEST: 0, confirmedAlerts: 0 });
    expect(result.diagnostics.riskRejectReasons).toEqual({
      nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0, [reason as string]: 1,
    });
    expect(runShort(SHORT_ROWS, extra)).toEqual(result);
  });

  it("separates target/RR rejection from stop-risk rejection", () => {
    const result = runShort(SHORT_ROWS, { minTpR: 999 });
    expect(result.diagnostics).toMatchObject({ retestCandidates: 1, targetRejects: 1, riskRejects: 0, RETEST: 0, confirmedAlerts: 0 });
    expect(result.alerts).toEqual([]);
    expect(result.events.map(e => e.state)).toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT"]);
  });

  it("counts invalidation and expiration separately, not as risk rejects", () => {
    const invalid = runShort([...SHORT_ROWS.slice(0, 12), [103.9, 105.6, 103.85, 105.3]]);
    const expired = runShort([
      ...SHORT_ROWS.slice(0, 12), [103.9, 104.0, 103.4, 103.5],
      [103.5, 103.6, 103.3, 103.4], [103.4, 103.5, 103.1, 103.2],
    ], { retestWindow: 2 });
    expect(invalid.diagnostics).toMatchObject({ INVALID: 1, EXPIRED: 0, riskRejects: 0, retestCandidates: 0, confirmedAlerts: 0 });
    expect(expired.diagnostics).toMatchObject({ INVALID: 0, EXPIRED: 1, riskRejects: 0, retestCandidates: 0, confirmedAlerts: 0 });
  });

  it("returns explicit independent zero counts on short feeds and missing storylines", () => {
    const short = runShort([]);
    const noStory = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: mkCandles(SHORT_ROWS), snaps: [], cfg, mode: "paper", provider: "test",
    });
    expect(short).toEqual(noStory);
    expect(short.diagnostics).toEqual({
      MAP: 0, TOUCH: 0, SWEEP: 0, SHIFT: 0, RETEST: 0, INVALID: 0, EXPIRED: 0,
      retestCandidates: 0, riskRejects: 0,
      riskRejectReasons: { nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0 },
      targetRejects: 0, confirmedAlerts: 0,
    });
    runShort();
    expect(runShort([])).toEqual(short);
  });

  it("counts structural confirmations even when delivery is session-suppressed", () => {
    const result = runShort(SHORT_ROWS, { sessionsAllowlist: [["Nowhere", "01:00", "02:00"]] });
    expect(result.alerts[0].alertStatus).toBe("SUPPRESSED");
    expect(result.diagnostics.confirmedAlerts).toBe(1);
    expect(result.diagnostics.RETEST).toBe(1);
    expect(result.diagnostics.riskRejects).toBe(0);
  });
});
