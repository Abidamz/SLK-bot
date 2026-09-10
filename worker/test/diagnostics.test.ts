import { describe, expect, it, vi } from "vitest";
import { LIFECYCLE_STATES, emptyScanDiagnostics } from "../src/diagnostics";
import { scanAll, type Env } from "../src/index";
import { D1Store, MemStore, type D1Like, type ScanLogRow } from "../src/store";
import { T0, makeFakeFetch } from "./fixtures";

const now = T0 + 8 * 3600_000;
const env: Env = {
  TWELVEDATA_API_KEY: "TESTKEY", // fake fetch only; not a credential
  PAIRS: "EURUSD,GBPUSD", ENTRY_TFS: "30m,1h", MODE: "paper",
  WATCH_NOTIFY: "false", PAPER_NOTIFY: "true", MIN_RISK_ATR: "0.8",
};

function options(store: MemStore) {
  return { now, fetchFn: makeFakeFetch({ telegram: [], discord: [] }), storeOverride: store, force: true };
}

describe("scan diagnostics", () => {
  it("aggregates actual replay counts by pair/timeframe, preserving deduped counters on repeat", async () => {
    const store = new MemStore();
    // Only this synthetic fixture needs the smaller floor to exercise confirmation.
    const fixtureEnv = { ...env, MIN_RISK_ATR: "0.1" };
    const first = await scanAll(fixtureEnv, options(store));
    const second = await scanAll(fixtureEnv, options(store));
    expect(first.ok).toBe(true);
    expect(first.diagnostics.byPairTimeframe.map(r => [r.pair, r.timeframe])).toEqual([
      ["EURUSD", "30m"], ["EURUSD", "1h"], ["GBPUSD", "30m"], ["GBPUSD", "1h"],
    ]);
    for (const state of LIFECYCLE_STATES) {
      expect(first.diagnostics.replay[state]).toBe(first.diagnostics.byPairTimeframe.reduce((n, r) => n + r.replay[state], 0));
      expect(first.diagnostics.recorded[state]).toBe(store.events.filter(e => e.state === state).length);
      expect(second.diagnostics.recorded[state]).toBe(0);
    }
    expect(first.alerts).toBeGreaterThan(0);
    expect(first.diagnostics.recorded.confirmedAlerts).toBe(first.alerts);
    expect(second.alerts).toBe(0);
    expect(second.events).toBe(0);
    expect(second.diagnostics.recorded.confirmedAlerts).toBe(0);
    expect(second.diagnostics.replay).toEqual(first.diagnostics.replay);
    expect(second.diagnostics.byPairTimeframe).toEqual(first.diagnostics.byPairTimeframe);
    expect(store.scanLog.map(r => r.diagnostics)).toEqual([first.diagnostics, second.diagnostics]);
  });

  it("records risk rejects at the unchanged production floor, including on duplicate replays", async () => {
    const store = new MemStore();
    const first = await scanAll(env, options(store));
    const second = await scanAll(env, options(store));
    expect(first.ok).toBe(true);
    expect(first.alerts).toBe(0);
    expect(first.diagnostics.replay.riskRejects).toBeGreaterThan(0);
    expect(first.diagnostics.replay.riskRejectReasons.belowMinRiskAtr).toBe(first.diagnostics.replay.riskRejects);
    expect(first.diagnostics.replay.riskRejects).toBe(first.diagnostics.byPairTimeframe.reduce((n, r) => n + r.replay.riskRejects, 0));
    expect(second.diagnostics.replay).toEqual(first.diagnostics.replay);
    expect(second.events).toBe(0);
  });

  it("persists explicit zeros when idle, without fetching data", async () => {
    const store = new MemStore();
    await scanAll(env, { ...options(store), force: false });
    const fetchFn = vi.fn(() => { throw new Error("idle must not fetch"); });
    const idle = await scanAll(env, { now, storeOverride: store, fetchFn });
    expect(idle.diagnostics).toEqual(emptyScanDiagnostics());
    expect(idle.timeframes).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.scanLog[1]).toMatchObject({ note: "idle (no candle close)", diagnostics: idle.diagnostics });
  });

  it("leaves failed feeds out of replay coverage, retaining successful pairs on partial failure", async () => {
    const store = new MemStore();
    const opts = options(store);
    const fetchFn: typeof fetch = async (input, init) => {
      if (String(input).includes("GBP%2FUSD")) throw new Error("simulated outage");
      return opts.fetchFn(input, init);
    };
    const result = await scanAll(env, { ...opts, fetchFn });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.diagnostics.byPairTimeframe.map(r => r.pair)).toEqual(["EURUSD", "EURUSD"]);
    expect(store.scanLog[0]).toMatchObject({ note: "partial", diagnostics: result.diagnostics });
  });

  it("returns zeros and empty coverage on total provider failure (not evidence of no setups)", async () => {
    const store = new MemStore();
    const result = await scanAll(env, {
      ...options(store), fetchFn: makeFakeFetch({ telegram: [], discord: [] }, { failData: true }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.diagnostics).toEqual(emptyScanDiagnostics());
    expect(store.scanLog[0].diagnostics).toEqual(result.diagnostics);
  });
});

describe("D1 scan diagnostics serialization", () => {
  it("binds versioned JSON separately from the unchanged note; legacy callers bind null", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run, first: async () => null, all: async () => ({ results: [] }) }));
    const db: D1Like = { prepare: vi.fn(() => ({ bind })) };
    const store = new D1Store(db);
    const row: ScanLogRow = { ts: "2024-03-04T08:00:00.000Z", timeframes: "30m", pairs: "EURUSD", alerts: 0, events: 0, errors: "", durationMs: 42, note: "ok" };
    const diagnostics = emptyScanDiagnostics();
    await store.insertScanLog({ ...row, diagnostics });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("note, diagnostics_json)"));
    expect(bind).toHaveBeenLastCalledWith(row.ts, "30m", "EURUSD", 0, 0, "", 42, "ok", JSON.stringify(diagnostics));
    await store.insertScanLog(row);
    expect(bind).toHaveBeenLastCalledWith(row.ts, "30m", "EURUSD", 0, 0, "", 42, "ok", null);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
