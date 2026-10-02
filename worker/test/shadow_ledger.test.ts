import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { persistShadowCaptures, resolveShadowOutcomes, type Env } from "../src/index";
import { defaultStrategy, loadConfig } from "../src/config";
import { scanEntry } from "../src/engine";
import { computeRecapStats } from "../src/notify";
import { makeStore, MemStore, resetDefaultMemStore } from "../src/store";
import type { ShadowTradeCapture } from "../src/types";
import { BASE, SHORT_ROWS, SHORT_STORY, mkCandles, snapsFor } from "./fixtures";

function capture(
  setupId: string,
  rejectReason: ShadowTradeCapture["rejectReason"] = "TARGET_FLOOR",
): ShadowTradeCapture {
  return {
    setupId, pair: "EURUSD", entryTf: "30m", direction: "SHORT",
    entry: 100, stopLoss: 101, tp1: 98, rr: 2, rejectReason,
    candleCloseTime: BASE,
  };
}

const request = (path: string, authorization?: string) => new Request(`https://w.test${path}`, {
  headers: authorization ? { authorization } : undefined,
});

describe("private shadow ledger and isolated resolution", () => {
  beforeEach(() => resetDefaultMemStore());

  it("requires env.ADMIN_KEY for GET /api/shadow-ledger", async () => {
    const noHeader = await worker.fetch(request("/api/shadow-ledger"), { ADMIN_KEY: "owner-test" } as Env, {} as any);
    expect(noHeader.status).toBe(401);
    const noKey = await worker.fetch(request("/api/shadow-ledger", "Bearer anything"), {} as Env, {} as any);
    expect(noKey.status).toBe(401);
  });

  it("persists a floor near miss only to the shadow ledger, not alerts/events/notifications", async () => {
    const story = {
      ...SHORT_STORY,
      internalPools: [
        { price: 104.35, side: "sellside" as const, kind: "structural", sourceTime: BASE },
        { price: 103.5, side: "sellside" as const, kind: "structural", sourceTime: BASE },
      ],
      nearestExternalTarget: null,
      drawOnLiquidity: null,
    };
    const result = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: mkCandles(SHORT_ROWS, 30), snaps: snapsFor(story),
      cfg: { ...defaultStrategy(), minRiskAtr: 0.1 }, mode: "paper", provider: "test",
    });
    const store = new MemStore();
    const insertAlert = vi.spyOn(store, "insertAlert");
    const insertEvent = vi.spyOn(store, "insertEvent");
    await persistShadowCaptures(store, result.shadowTrades);

    expect(result.alerts).toEqual([]);
    expect(result.events.map((event) => event.state)).toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT"]);
    expect((await store.getShadowLedger()).rows).toHaveLength(1);
    expect(await store.recentAlerts(10)).toEqual([]);
    expect(await store.recentEvents(10)).toEqual([]);
    expect(insertAlert).not.toHaveBeenCalled();
    expect(insertEvent).not.toHaveBeenCalled();
  });

  it("returns private rows and aggregates by reject reason with the key", async () => {
    const store = makeStore(undefined);
    await store.insertShadowTrade(capture("floor-win"));
    await store.recordShadowOutcome("floor-win", {
      status: "TP_HIT", exitPrice: 98, exitTime: BASE + 3600_000, rMultiple: 2,
    });
    await store.insertShadowTrade(capture("floor-open"));
    await store.insertShadowTrade(capture("no-retest-loss", "NO_RETEST"));
    await store.recordShadowOutcome("no-retest-loss", {
      status: "SL_HIT", exitPrice: 101, exitTime: BASE + 7200_000, rMultiple: -1,
    });

    const response = await worker.fetch(
      request("/api/shadow-ledger", "Bearer owner-test"),
      { ADMIN_KEY: "owner-test" } as Env,
      {} as any,
    );
    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.available).toBe(true);
    expect(data.rows).toHaveLength(3);
    expect(data.rows.find((row: any) => row.setupId === "no-retest-loss")).toMatchObject({
      setupId: "no-retest-loss", rejectReason: "NO_RETEST", status: "SL_HIT",
      hypotheticalEntry: 100, hypotheticalTp1: 98, rMultiple: -1,
    });
    expect(data.aggregate.TARGET_FLOOR).toEqual({
      count: 2, resolved: 1, wins: 1, losses: 0, netR: 2, winRate: 100,
    });
    expect(data.aggregate.NO_RETEST).toEqual({
      count: 1, resolved: 1, wins: 0, losses: 1, netR: -1, winRate: 0,
    });
  });

  it("resolves TP and 120-bar expiry with the paper candle rules and correct R", async () => {
    const store = new MemStore();
    await store.insertShadowTrade(capture("tp-row"));
    const cfg = loadConfig({});
    const tpCount = await resolveShadowOutcomes(store, cfg, "EURUSD", "30m", [
      { t: BASE, o: 100, h: 100.5, l: 97.9, c: 99 },
    ]);
    expect(tpCount).toBe(1);
    const tp = (await store.getShadowLedger()).rows[0];
    expect(tp).toMatchObject({ status: "TP_HIT", exit_price: 98, r_multiple: 2 });

    await store.insertShadowTrade(capture("expiry-row", "NO_RETEST"));
    const expiryCandles = Array.from({ length: 120 }, (_, i) => ({
      t: BASE + i * 30 * 60_000,
      o: 100.2, h: 100.5, l: 100.1, c: i === 119 ? 100.25 : 100.2,
    }));
    const expiryCount = await resolveShadowOutcomes(store, cfg, "EURUSD", "30m", expiryCandles);
    expect(expiryCount).toBe(1);
    const expiry = (await store.getShadowLedger()).rows.find((row) => row.setup_id === "expiry-row");
    expect(expiry).toMatchObject({ status: "EXPIRED", exit_price: 100.25, r_multiple: -0.25 });
  });

  it("swallows shadow persistence and resolution errors", async () => {
    const store = new MemStore();
    vi.spyOn(store, "insertShadowTrade").mockRejectedValue(new Error("research table offline"));
    await expect(persistShadowCaptures(store, [capture("fail-safe")])).resolves.toBeUndefined();
    vi.spyOn(store, "openShadowTrades").mockRejectedValue(new Error("research read failed"));
    await expect(resolveShadowOutcomes(store, loadConfig({}), "EURUSD", "30m", [])).resolves.toBe(0);
  });

  it("keeps shadow rows out of stats, alerts, recaps, and Monte Carlo", async () => {
    const store = makeStore(undefined);
    await store.insertShadowTrade(capture("never-public-floor"));
    await store.recordShadowOutcome("never-public-floor", {
      status: "TP_HIT", exitPrice: 98, exitTime: BASE + 3600_000, rMultiple: 2,
    });

    const env = { ADMIN_KEY: "owner-test" } as Env;
    const [statsResponse, alertsResponse, recapResponse, monteCarloResponse] = await Promise.all([
      worker.fetch(request("/stats", "Bearer owner-test"), env, {} as any),
      worker.fetch(request("/alerts?includeSuppressed=true", "Bearer owner-test"), env, {} as any),
      worker.fetch(request("/admin/preview-recap?period=weekly&segment=institutional"), env, {} as any),
      worker.fetch(request("/api/monte-carlo?seed=11"), env, {} as any),
    ]);
    const bodies = await Promise.all([
      statsResponse.text(), alertsResponse.text(), recapResponse.text(), monteCarloResponse.text(),
    ]);
    expect(bodies.join("\n")).not.toContain("never-public-floor");
    expect(JSON.parse(bodies[1]).items).toEqual([]);
    expect(JSON.parse(bodies[2]).stats.periodSetups).toBe(0);
    expect(JSON.parse(bodies[3])).toMatchObject({ ok: false, error: "INSUFFICIENT_HISTORY", closedTrades: 0 });
    expect(computeRecapStats(await store.recentAlerts(1000) as any, "institutional", "weekly", BASE).allTimeSetups).toBe(0);
  });
});
