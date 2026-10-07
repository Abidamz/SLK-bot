import { describe, expect, it, vi } from "vitest";
import { LIFECYCLE_STATES, buildEnginePulse, emptyEnginePulse, emptyScanDiagnostics, noteConfirmationAttempt } from "../src/diagnostics";
import { scanAll, type Env } from "../src/index";
import worker from "../src/index";
import { D1Store, MemStore, makeStore, type D1Like, type ScanLogRow } from "../src/store";
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
    // Idle ticks still record their (zero-work) phase timings alongside the
    // explicit zero counters.
    const { timing: idleTiming, ...idleCounters } = idle.diagnostics;
    expect(idleCounters).toEqual(emptyScanDiagnostics());
    expect(idleTiming).toMatchObject({
      shadowResolveMs: 0, pairScanMs: 0, shadowGroups: 0, shadowChecked: 0, httpCalls: 0,
    });
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
    const { timing: failedTiming, ...failedCounters } = result.diagnostics;
    expect(failedCounters).toEqual(emptyScanDiagnostics());
    expect(failedTiming).toMatchObject({ shadowResolveMs: 0, shadowGroups: 0, shadowChecked: 0 });
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

  it("aggregates the confirmation funnel per timeframe, newest latency wins, unknowns clamp", () => {
    const rows = [
      { ts: iso(NOW - 1 * HOUR), pairs: "EURUSD", diagnostics: diag({}) },
      { ts: iso(NOW - 2 * HOUR), pairs: "EURUSD", diagnostics: diag({}) },
      // out-of-window row must not leak into the funnel
      { ts: iso(NOW - 30 * HOUR), pairs: "EURUSD", diagnostics: diag({}) },
    ];
    rows[1].diagnostics.recorded.confirmations = {
      "15m": { built: 3, fresh: 1, stale: 2, inserted: 1, duplicate: 0, nearMiss: 1, ageSumSec: 900, ageMaxSec: 700, freshAgeSumSec: 200 },
      "1h": { built: 1, fresh: 0, stale: 1, inserted: 0, duplicate: 0, nearMiss: 0, ageSumSec: 9000, ageMaxSec: 9000, freshAgeSumSec: 0 },
      "4h": { built: 0, fresh: 0, stale: 0, inserted: 0, duplicate: 0, nearMiss: 0, ageSumSec: 0, ageMaxSec: 0, freshAgeSumSec: 0 },
    } as any;
    rows[0].diagnostics.recorded.confirmations = {
      "15m": { built: 2, fresh: 2, stale: 0, inserted: 2, duplicate: 0, nearMiss: 0, ageSumSec: 1300, ageMaxSec: 800, freshAgeSumSec: 1300 },
      "1h": { built: 1, fresh: 1, stale: 0, inserted: 1, duplicate: 0, nearMiss: 0, ageSumSec: 400, ageMaxSec: 400, freshAgeSumSec: 400 },
    } as any;
    rows[2].diagnostics.recorded.confirmations = { "15m": { built: 99, fresh: 99, stale: 0, inserted: 99, duplicate: 0, nearMiss: 0, ageSumSec: 1, ageMaxSec: 1, freshAgeSumSec: 1 } } as any;

    const p = buildEnginePulse(rows as any[], NOW);
    expect(p.confirmations.map(r => r.timeframe)).toEqual(["15m", "1h"]); // 4h dropped: all zeros
    const f15 = p.confirmations[0];
    expect(f15).toMatchObject({ built: 5, fresh: 3, stale: 2, inserted: 3, nearMiss: 1 });
    expect(f15.maxAgeSec).toBe(800); // max of the per-row maxima (700, 800) — never their sum
    expect(f15.avgAgeSec).toBe(440); // 2200 / 5 built
    expect(f15.avgFreshAgeSec).toBe(500); // 1500 / 3 fresh
    const f60 = p.confirmations[1];
    expect(f60).toMatchObject({ built: 2, fresh: 1, stale: 1, inserted: 1, avgAgeSec: 4700, maxAgeSec: 9000 });
    expect(f60.avgFreshAgeSec).toBe(400);
  });

  it("aggregates per-tick phase timings, ignoring rows that predate them", () => {
    const rows = [
      { ts: iso(NOW - 1 * HOUR), pairs: "EURUSD", diagnostics: diag({}) },
      { ts: iso(NOW - 2 * HOUR), pairs: "EURUSD", diagnostics: diag({}) },
    ];
    rows[0].diagnostics.timing = {
      liveResolveMs: 100, shadowResolveMs: 5000, pairScanMs: 8000,
      shadowGroups: 23, shadowChecked: 5, httpCalls: 12,
    } as any;
    rows[1].diagnostics.timing = {
      liveResolveMs: 300, shadowResolveMs: 7000, pairScanMs: 12000,
      shadowGroups: 25, shadowChecked: 5, httpCalls: 20,
    } as any;
    const p = buildEnginePulse(rows as any[], NOW);
    expect(p.timing.ticks).toBe(2);
    expect(p.timing.avgPairScanMs).toBe(10000);
    expect(p.timing.maxPairScanMs).toBe(12000);
    expect(p.timing.avgLiveResolveMs).toBe(200);
    expect(p.timing.maxLiveResolveMs).toBe(300);
    expect(p.timing.avgShadowResolveMs).toBe(6000);
    expect(p.timing.maxShadowResolveMs).toBe(7000);
    expect(p.timing.avgShadowGroups).toBe(24);
    expect(p.timing.avgShadowChecked).toBe(5);
    expect(p.timing.avgHttpCalls).toBe(16);
    expect(p.timing.maxHttpCalls).toBe(20);
  });

  it("reports zeroed timings when no row carries them and clamps junk values", () => {
    const bare = [{ ts: iso(NOW - 1 * HOUR), pairs: "EURUSD", diagnostics: diag({}) }];
    expect(buildEnginePulse(bare as any[], NOW).timing).toEqual(emptyEnginePulse().timing);

    const junk = [
      { ts: iso(NOW - 1 * HOUR), pairs: "EURUSD", diagnostics: diag({}) },
      { ts: iso(NOW - 2 * HOUR), pairs: "EURUSD", diagnostics: diag({}) },
    ];
    junk[0].diagnostics.timing = {
      liveResolveMs: 250, shadowResolveMs: -5, pairScanMs: "1500",
      shadowGroups: null, shadowChecked: "junk", httpCalls: 8,
    } as any;
    junk[1].diagnostics.timing = "not-an-object" as any;
    const p = buildEnginePulse(junk as any[], NOW);
    expect(p.timing.ticks).toBe(1);            // only the object-shaped row counts
    expect(p.timing.avgPairScanMs).toBe(1500);
    expect(p.timing.maxShadowResolveMs).toBe(0);
    expect(p.timing.avgShadowGroups).toBe(0);
    expect(p.timing.avgHttpCalls).toBe(8);
  });

  it("omits the funnel for rows without the field and survives malformed values", () => {
    const rows = [
      { ts: iso(NOW - 1 * HOUR), pairs: "EURUSD", diagnostics: diag({ recorded: { MAP: 1 } }) },
      { ts: iso(NOW - 2 * HOUR), pairs: "EURUSD", diagnostics_json: JSON.stringify(diag({ recorded: { MAP: 1 } })) },
    ];
    expect(buildEnginePulse(rows as any[], NOW).confirmations).toEqual([]);

    rows[1].diagnostics_json = JSON.stringify({ version: 1, recorded: { MAP: 1, confirmations: {
      "30m": { built: "3", fresh: null, stale: -5, inserted: 2, nearMiss: "junk", ageSumSec: 600, ageMaxSec: null, freshAgeSumSec: 100 },
      "1h": "not-an-object",
      "2h": { built: 0, fresh: 0, stale: 0, inserted: 0, duplicate: 0, nearMiss: 0, ageSumSec: 0, ageMaxSec: 0, freshAgeSumSec: 0 },
    } } });
    const p = buildEnginePulse(rows as any[], NOW);
    expect(p.confirmations).toHaveLength(1);
    expect(p.confirmations[0]).toMatchObject({ timeframe: "30m", built: 3, fresh: 0, stale: 0, inserted: 2, nearMiss: 0, maxAgeSec: 0 });
    expect(p.confirmations[0].avgAgeSec).toBe(200); // 600 / 3 built
  });
});

describe("Confirmation funnel (noteConfirmationAttempt)", () => {
  it("buckets a fresh confirmation and records its discovery age", () => {
    const d = emptyScanDiagnostics();
    noteConfirmationAttempt(d.recorded, "15m", 300, "inserted", 2250);
    const f = d.recorded.confirmations!["15m"];
    expect(f.inserted).toBe(1);
    expect(f.fresh).toBe(1);
    expect(f.built).toBe(1);
    expect(f.stale).toBe(0);
    expect(f.ageSumSec).toBe(300);
    expect(f.ageMaxSec).toBe(300);
    expect(f.freshAgeSumSec).toBe(300);
  });

  it("counts stale drops, keeps the window-exact case fresh, and flags near-misses", () => {
    const d = emptyScanDiagnostics();
    // exactly at the window edge → still fresh (gate is age <= window)
    noteConfirmationAttempt(d.recorded, "30m", 4500, "inserted", 4500);
    // just outside → stale, but within 2× window → near-miss
    noteConfirmationAttempt(d.recorded, "30m", 5000, "stale", 4500);
    // far outside → stale, not a near-miss
    noteConfirmationAttempt(d.recorded, "30m", 20000, "stale", 4500);
    const f = d.recorded.confirmations!["30m"];
    expect(f.built).toBe(3);
    expect(f.fresh).toBe(1);
    expect(f.stale).toBe(2);
    expect(f.nearMiss).toBe(1);
    expect(f.inserted).toBe(1);
    expect(f.ageSumSec).toBe(4500 + 5000 + 20000);
    expect(f.ageMaxSec).toBe(20000);
    expect(f.freshAgeSumSec).toBe(4500);
  });

  it("counts a duplicate as a gate-passing attempt (fresh), not a loss", () => {
    const d = emptyScanDiagnostics();
    noteConfirmationAttempt(d.recorded, "1h", 100, "duplicate", 9000);
    const f = d.recorded.confirmations!["1h"];
    expect(f.built).toBe(1);
    expect(f.fresh).toBe(1);   // fresh = cleared the gate = inserted + duplicate
    expect(f.duplicate).toBe(1);
    expect(f.stale).toBe(0);
    expect(f.inserted).toBe(0);
    expect(f.ageSumSec).toBe(100); // latency is real regardless of outcome
    expect(f.freshAgeSumSec).toBe(100);
  });

  it("keeps timeframes independent and tolerates a zero/absent window", () => {
    const d = emptyScanDiagnostics();
    noteConfirmationAttempt(d.recorded, "15m", 10, "inserted", 2250);
    noteConfirmationAttempt(d.recorded, "4h", 30, "stale", 0); // window 0 → nothing is fresh
    expect(Object.keys(d.recorded.confirmations!).sort()).toEqual(["15m", "4h"]);
    expect(d.recorded.confirmations!["15m"].inserted).toBe(1);
    expect(d.recorded.confirmations!["4h"]).toMatchObject({ built: 1, stale: 1, fresh: 0, nearMiss: 0, ageMaxSec: 30 });
  });
});

describe("confirmation funnel end to end", () => {
  it("a real scan records the funnel and /api/engine-pulse serves it as JSON", async () => {
    const store = makeStore(undefined);
    await store.resetAllAlerts(); // clean ledger + clean scan log
    const fixtureEnv: Env = { ...env, MIN_RISK_ATR: "0.1" };
    const res = await scanAll(fixtureEnv, options(store as MemStore));
    expect(res.ok).toBe(true);
    expect(res.alerts).toBeGreaterThan(0);

    const funnel = res.diagnostics.recorded.confirmations ?? {};
    const tfs = Object.keys(funnel);
    expect(tfs).toEqual(["30m"]); // only the 30m fixture confirms in this run
    const f = funnel["30m"];
    expect(f.inserted).toBe(res.alerts);
    expect(f.built).toBe(f.fresh + f.stale);
    expect(f.fresh).toBe(f.inserted + f.duplicate);
    expect(f.stale).toBe(res.diagnostics.recorded.staleConfirmationSkips);
    expect(f.duplicate).toBe(res.diagnostics.recorded.duplicateConfirmationSkips);
    expect(f.ageMaxSec).toBeGreaterThan(0);
    expect(f.ageMaxSec).toBeGreaterThanOrEqual(Math.floor(f.ageSumSec / f.built));

    // The fixture candles live in 2024 — pin the clock next to them so the
    // scan-log row stays inside the endpoint's rolling 24h window.
    vi.setSystemTime(new Date(now + 5 * 60_000));
    try {
      const resp = await worker.fetch(
        new Request("https://w.test/api/engine-pulse"),
        fixtureEnv,
        {} as any,
      );
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as any;
      expect(Array.isArray(body.confirmations)).toBe(true);
      expect(body.confirmations).toHaveLength(1);
      expect(body.confirmations[0]).toMatchObject({ timeframe: "30m", inserted: res.alerts });
      expect(body.confirmations[0].built).toBe(res.alerts);
      expect(body.confirmations[0].avgAgeSec).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
