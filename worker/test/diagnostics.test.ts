import { describe, expect, it, vi } from "vitest";
import { LIFECYCLE_STATES, buildEnginePulse, emptyEnginePulse, emptyScanDiagnostics } from "../src/diagnostics";
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
      const url = String(input);
      if (url.includes("GBP%2FUSD") || url.includes("GBP-USD") || url.includes("GBPUSD")) {
        throw new Error("simulated outage");
      }
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

  it("scanLogsSince tolerates a missing diagnostics_json column and caches the fallback", async () => {
    const sqlCalls: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        sqlCalls.push(sql);
        return {
          bind: (..._values: unknown[]) => ({
            run: async () => ({ meta: { changes: 0 } }),
            first: async () => null,
            all: async () => {
              if (sql.includes("diagnostics_json")) throw new Error("no such column: diagnostics_json");
              return { results: [{
                ts: "2026-09-29T12:00:00.000Z", timeframes: "30m", pairs: "EURUSD",
                alerts: 0, events: 2, errors: "", duration_ms: 12, note: "ok",
              }] };
            },
          }),
        };
      }),
    } as unknown as D1Like;
    const store = new D1Store(db);
    const since = "2026-09-28T00:00:00.000Z";
    const first = await store.scanLogsSince(since, 1000);
    const second = await store.scanLogsSince(since, 1000);
    expect(first).toEqual([{
      ts: "2026-09-29T12:00:00.000Z", timeframes: "30m", pairs: "EURUSD",
      alerts: 0, events: 2, errors: "", duration_ms: 12, note: "ok",
    }]);
    expect(second).toEqual(first);
    expect(sqlCalls).toHaveLength(3); // one failed probe, then legacy reads only
    expect(sqlCalls[1]).not.toContain("diagnostics_json");
    expect(sqlCalls[2]).not.toContain("diagnostics_json");
  });
});

describe("Engine Pulse aggregation (buildEnginePulse)", () => {
  const NOW = T0 + 8 * 3600_000;
  const HOUR = 3600_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  function diag(overrides: { recorded?: Record<string, number>; risk?: [number, number, number]; target?: number } = {}) {
    const d = emptyScanDiagnostics();
    for (const [k, v] of Object.entries(overrides.recorded ?? {})) (d.recorded as any)[k] = v;
    if (overrides.risk) d.replay.riskRejectReasons = { nonPositiveRisk: overrides.risk[0], belowMinRiskAtr: overrides.risk[1], aboveMaxStopAtr: overrides.risk[2] };
    if (overrides.target) d.replay.targetRejects = overrides.target;
    return d;
  }

  it("returns zeros for an empty window", () => {
    expect(buildEnginePulse([], NOW)).toEqual(emptyEnginePulse(24));
  });

  it("aggregates recorded counters, rejections, coverage, and last-scan time", () => {
    const rows = [
      // in-window, JSON-serialized diagnostics (D1 shape)
      { ts: iso(NOW - 1 * HOUR), pairs: "EURUSD,GBPUSD", diagnostics_json: JSON.stringify(diag({
        recorded: { MAP: 5, TOUCH: 2, SWEEP: 1, SHIFT: 1, RETEST: 3, confirmedAlerts: 1 },
        risk: [1, 2, 0], target: 4,
      })) },
      // in-window, in-memory diagnostics object (MemStore shape)
      { ts: iso(NOW - 2 * HOUR), pairs: "EURUSD", diagnostics: diag({ recorded: { MAP: 2, RETEST: 1 } }) },
      // out-of-window → excluded entirely
      { ts: iso(NOW - 25 * HOUR), pairs: "EURUSD", diagnostics: diag({ recorded: { MAP: 50, RETEST: 50 } }) },
      // idle scan — empty pairs: counted as a scan, diagnostics ignored
      { ts: iso(NOW - 3 * HOUR), pairs: "", diagnostics: diag({ recorded: { MAP: 99, RETEST: 99 } }) },
      // malformed diagnostics_json → counted as active, no crash, no counts
      { ts: iso(NOW - 4 * HOUR), pairs: "XAUUSD", diagnostics_json: "{not json" },
      // wrong version → ignored
      { ts: iso(NOW - 5 * HOUR), pairs: "XAUUSD", diagnostics: { ...diag({ recorded: { MAP: 7 } }), version: 2 } },
    ];
    const p = buildEnginePulse(rows as any[], NOW);
    expect(p.scans).toBe(5);            // idle + malformed + version rows included; 25h row excluded
    expect(p.activeScans).toBe(4);      // every non-idle row covered pairs (even w/ unparseable diag)
    expect(p.pairs).toEqual(["EURUSD", "GBPUSD", "XAUUSD"]);
    expect(p.pairsCovered).toBe(3);
    expect(p.evaluated).toBe(7);        // 5 + 2 MAP
    expect(p.chains).toEqual({ TOUCH: 2, SWEEP: 1, SHIFT: 1, RETEST: 4 });
    expect(p.confirmed).toBe(1);
    expect(p.rejections).toEqual({ nonPositiveRisk: 1, belowMinRiskAtr: 2, aboveMaxStopAtr: 0, targetFloor: 4 });
    expect(p.lastScanTs).toBe(iso(NOW - 1 * HOUR));
    expect(p.windowHours).toBe(24);
  });

  it("applies the window cutoff strictly (24h default, overridable)", () => {
    const rowAtCutoff = { ts: iso(NOW - 24 * HOUR), pairs: "EURUSD", diagnostics: diag({ recorded: { MAP: 3 } }) };
    // exactly at the cutoff → inside the rolling window
    expect(buildEnginePulse([rowAtCutoff] as any[], NOW).evaluated).toBe(3);
    const rowJustOutside = { ts: iso(NOW - 24 * HOUR - 1), pairs: "EURUSD", diagnostics: diag({ recorded: { MAP: 3 } }) };
    expect(buildEnginePulse([rowJustOutside] as any[], NOW).evaluated).toBe(0);
    // narrower window excludes the older of two in-window rows
    const two = [
      { ts: iso(NOW - 30 * 60_000), pairs: "EURUSD", diagnostics: diag({ recorded: { MAP: 1 } }) },
      { ts: iso(NOW - 90 * 60_000), pairs: "EURUSD", diagnostics: diag({ recorded: { MAP: 2 } }) },
    ];
    const p1h = buildEnginePulse(two as any[], NOW, 1);
    expect(p1h.scans).toBe(1);
    expect(p1h.evaluated).toBe(1);
    expect(p1h.windowHours).toBe(1);
  });
});
