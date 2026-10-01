/** Deterministic coverage for the dashboard replay evidence endpoint
 *  (Functionality #7 data contract): the chart payload must carry the stage
 *  markers, the confirmation timestamp, and the resolved outcome so the
 *  client-side candle stepper can rebuild the trade story exactly. */
import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { makeStore } from "../src/store";
import { T0, makeFakeFetch, type RecordedCalls } from "./fixtures";
import type { Alert } from "../src/types";

const NOW = T0 + 8 * 3600_000;

function mkAlert(setupId: string): Alert {
  return {
    setupId,
    pair: "EURUSD",
    entryTf: "30m",
    mapTf: "4h",
    direction: "SHORT",
    entry: 104.9,
    stopLoss: 105.2,
    tpInternal: 104.0,
    tpExternal: null,
    candleCloseTime: NOW,
    environment: "bearish",
    phase: "expansion",
    htfAlignment: "H4:↓",
    originKeyLevel: 105.0,
    keyLevelType: "OC",
    keyLevelBounds: [104.95, 105.05],
    keyLevelTested: true,
    keyLevelFlipped: false,
    imbalanceContext: [],
    internalLiquidity: [],
    externalLiquidity: [],
    drawOnLiquidity: null,
    nearestExternalTarget: null,
    intermediateZones: [],
    opposingLiquidityStanding: true,
    sweepTime: NOW - 3600_000,
    bosTime: NOW - 1800_000,
    returnTime: NOW,
    invalidationLevel: 105.2,
    invalidationReason: null,
    parameterVersion: "1",
    alertStatus: "PAPER",
    suppressReason: null,
    session: null,
    atrEntry: 0.3,
    rrInternal: 3.0,
    cycleStage: "entry_alert",
    entryMode: "confirmation",
    shadowClassification: "A_GRADE",
  };
}

describe("dashboard replay evidence endpoint", () => {
  it("/dashboard/signals/:id/chart carries markers, confirmedAt and outcome for the stepper", async () => {
    const store = makeStore(undefined); // shared mem store behind worker.fetch when DB is absent
    const setupId = "td:EURUSD:30m:SHORT:V:104.2:replay1";
    await store.insertAlert(mkAlert(setupId), "twelvedata");
    await store.insertEvent({
      setupId, pair: "EURUSD", state: "SWEEP", candleTime: NOW - 3600_000,
      reason: "swept buyside internal liquidity", price: 105.1,
    } as any);
    await store.insertEvent({
      setupId, pair: "EURUSD", state: "RETEST", candleTime: NOW,
      reason: "return to origin zone → confirmation entry", price: 104.9,
    } as any);
    await store.recordOutcome(setupId, {
      status: "TP_HIT", exitPrice: 104.0, exitTime: NOW + 3600_000, rMultiple: 3,
    });

    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    vi.stubGlobal("fetch", makeFakeFetch(calls));
    // The fixture ledger lives in 2024 — pin the clock next to the confirmation
    // candle so the feed passes the freshness gate exactly as in production.
    vi.setSystemTime(new Date(NOW + 5 * 60_000));
    try {
      const env = { TWELVEDATA_API_KEY: "K" } as unknown as Env;
      const resp = await worker.fetch(
        new Request(`https://w.test/dashboard/signals/${encodeURIComponent(setupId)}/chart?timeframe=30m&before=60&after=10`),
        env, {} as any,
      );
      expect(resp.status).toBe(200);
      const data = (await resp.json()) as any;
      expect(data.setupId).toBe(setupId);
      expect(data.candles.length).toBeGreaterThan(0);
      // stage markers the stepper walks through
      const stages = (data.evidenceMarkers as any[]).map((m) => m.type);
      expect(stages).toContain("SWEEP");
      expect(stages).toContain("RETEST");
      // final two replay stages
      expect(data.confirmedAt).toBe(new Date(NOW).toISOString());
      expect(data.outcome).toMatchObject({ status: "TP_HIT", rMultiple: 3 });
      expect(data.outcome.exitTime).toBe(new Date(NOW + 3600_000).toISOString());
      // levels feed the position-size calculator in the modal
      expect(data.levels).toMatchObject({ entry: 104.9, stop: 105.2, target1: 104.0 });
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("unknown setup ids answer 404 without leaking ledger data", async () => {
    const env = { TWELVEDATA_API_KEY: "K" } as unknown as Env;
    const resp = await worker.fetch(
      new Request("https://w.test/dashboard/signals/nope/chart?timeframe=30m"), env, {} as any,
    );
    expect(resp.status).toBe(404);
  });
});
