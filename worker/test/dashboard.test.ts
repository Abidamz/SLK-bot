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

  it("hides never-delivered (SUPPRESSED) signals from /alerts journal and /stats", async () => {
    const store = makeStore(undefined);
    await store.resetAllAlerts();

    const deliveredAlert = mkAlert("td:EURUSD:30m:SHORT:V:delivered:1");
    deliveredAlert.alertStatus = "SENT";
    await store.insertAlert(deliveredAlert, "twelvedata");
    await store.recordOutcome(deliveredAlert.setupId, {
      status: "TP_HIT", exitPrice: 104.0, exitTime: NOW + 1800_000, rMultiple: 3.0,
    });

    const suppressedAlert = mkAlert("td:EURUSD:30m:SHORT:V:suppressed:2");
    suppressedAlert.alertStatus = "SUPPRESSED";
    suppressedAlert.suppressReason = "first scan boot gate — record-only";
    await store.insertAlert(suppressedAlert, "twelvedata");
    await store.recordOutcome(suppressedAlert.setupId, {
      status: "TP_HIT", exitPrice: 104.0, exitTime: NOW + 1800_000, rMultiple: 15.0,
    });

    const env = { TWELVEDATA_API_KEY: "K" } as unknown as Env;

    // 1. Verify GET /alerts hides suppressed by default
    const alertsResp = await worker.fetch(new Request("https://w.test/alerts"), env, {} as any);
    expect(alertsResp.status).toBe(200);
    const alertsData = (await alertsResp.json()) as any;
    expect(alertsData.total).toBe(1);
    expect(alertsData.items).toHaveLength(1);
    expect(alertsData.items[0].setupId).toBe(deliveredAlert.setupId);

    // 2. Verify GET /stats excludes suppressed from all aggregates
    const statsResp = await worker.fetch(new Request("https://w.test/stats"), env, {} as any);
    expect(statsResp.status).toBe(200);
    const statsData = (await statsResp.json()) as any;
    expect(statsData.total).toBe(1);
    expect(statsData.completed).toBe(1);
    expect(statsData.tp).toBe(1);
    expect(statsData.netR).toBe(3.0); // Exactly the delivered 3.0R, NOT 18.0R
  });

  it("admin/delete-alert requires ADMIN_KEY and deletes alerts cleanly", async () => {
    const store = makeStore(undefined);
    await store.resetAllAlerts();

    const alertToKeep = mkAlert("td:EURUSD:30m:SHORT:V:keep:1");
    await store.insertAlert(alertToKeep, "twelvedata");

    const alertToDelete = mkAlert("td:EURUSD:30m:SHORT:V:delete:2");
    await store.insertAlert(alertToDelete, "twelvedata");
    await store.insertEvent({
      setupId: alertToDelete.setupId, pair: "EURUSD", state: "MAP",
      candleTime: NOW, reason: "armed", price: 105.0,
    } as any);

    const envWithAdmin = {
      TWELVEDATA_API_KEY: "K",
      ADMIN_KEY: "supersecret-admin-key",
    } as unknown as Env;

    // 1. 401 when unauthorized
    const unauthReq = new Request("https://w.test/admin/delete-alert?setup_id=" + alertToDelete.setupId, {
      method: "POST",
    });
    const unauthResp = await worker.fetch(unauthReq, envWithAdmin, {} as any);
    expect(unauthResp.status).toBe(401);

    // 2. 400 when missing setup_id
    const missingParamReq = new Request("https://w.test/admin/delete-alert", {
      method: "POST",
      headers: { Authorization: "Bearer supersecret-admin-key" },
    });
    const missingParamResp = await worker.fetch(missingParamReq, envWithAdmin, {} as any);
    expect(missingParamResp.status).toBe(400);

    // 3. 404 when alert does not exist
    const notFoundReq = new Request("https://w.test/admin/delete-alert?setup_id=does-not-exist", {
      method: "POST",
      headers: { Authorization: "Bearer supersecret-admin-key" },
    });
    const notFoundResp = await worker.fetch(notFoundReq, envWithAdmin, {} as any);
    expect(notFoundResp.status).toBe(404);

    // 4. Successful delete via Bearer token
    const deleteReq = new Request("https://w.test/admin/delete-alert", {
      method: "POST",
      headers: {
        Authorization: "Bearer supersecret-admin-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ setup_id: alertToDelete.setupId }),
    });
    const deleteResp = await worker.fetch(deleteReq, envWithAdmin, {} as any);
    expect(deleteResp.status).toBe(200);
    const deleteData = (await deleteResp.json()) as any;
    expect(deleteData.ok).toBe(true);
    expect(deleteData.action).toBe("delete_alert");
    expect(deleteData.setup_id).toBe(alertToDelete.setupId);

    // Verify only the kept alert remains in the journal
    const remainingAlerts = await store.recentAlerts(10);
    expect(remainingAlerts).toHaveLength(1);
    expect(remainingAlerts[0].setup_id).toBe(alertToKeep.setupId);

    // 5. Successful delete via query param ?key= (GET method)
    const alertToDelete2 = mkAlert("td:EURUSD:30m:SHORT:V:delete:3");
    await store.insertAlert(alertToDelete2, "twelvedata");
    const getDeleteReq = new Request(`https://w.test/admin/delete-alert?setup_id=${alertToDelete2.setupId}&key=supersecret-admin-key`, {
      method: "GET",
    });
    const getDeleteResp = await worker.fetch(getDeleteReq, envWithAdmin, {} as any);
    expect(getDeleteResp.status).toBe(200);
    const getDeleteData = (await getDeleteResp.json()) as any;
    expect(getDeleteData.ok).toBe(true);
  });

  it("all /admin/* routes return 401 without ADMIN_KEY and non-401 with ADMIN_KEY", async () => {
    const store = makeStore(undefined);
    await store.resetAllAlerts();
    await store.setKv("last_boundary:30m", String(Date.now() + 3600_000));

    const fastFetch = (async () =>
      new Response(JSON.stringify({ ok: true, result: [], candles: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fastFetch);
    try {
      const env: Env = {
        TWELVEDATA_API_KEY: "K",
        ADMIN_KEY: "test-admin-secret",
        PAIRS: "EURUSD",
        ENTRY_TFS: "30m",
        fetchFn: fastFetch,
      };

      const adminRoutes: Array<{ method: string; path: string }> = [
        { method: "GET", path: "/admin/waitlist" },
        { method: "GET", path: "/admin/expire-open" },
        { method: "POST", path: "/admin/confirmed-only" },
        { method: "POST", path: "/admin/enable-watch" },
        { method: "POST", path: "/admin/test-silent" },
        { method: "GET", path: "/admin/connect-dm" },
        { method: "GET", path: "/admin/connect-free-channel" },
        { method: "GET", path: "/admin/connect-deriv-channel" },
        { method: "GET", path: "/admin/set-deriv-channel" },
        { method: "GET", path: "/admin/connect-deriv-free-channel" },
        { method: "GET", path: "/admin/set-deriv-free-channel" },
        { method: "POST", path: "/admin/test-deriv-free-teaser" },
        { method: "POST", path: "/admin/test-deriv" },
        { method: "GET", path: "/admin/set-dm" },
        { method: "POST", path: "/admin/test-dm" },
        { method: "GET", path: "/admin/set-free-channel" },
        { method: "POST", path: "/admin/test-free-teaser" },
        { method: "POST", path: "/admin/test-bias" },
        { method: "POST", path: "/admin/test-free-bias" },
        { method: "POST", path: "/admin/test-be" },
        { method: "GET", path: "/admin/preview-recap" },
        { method: "POST", path: "/admin/trigger-recap" },
        { method: "POST", path: "/admin/test-recap" },
        { method: "GET", path: "/admin/telegram-status" },
        { method: "GET", path: "/admin/system-health" },
        { method: "GET", path: "/admin/set-deriv-proxy" },
        { method: "GET", path: "/admin/probe-deriv?target=fetch_frontend" },
        { method: "GET", path: "/admin/set-oanda-token" },
        { method: "GET", path: "/admin/probe-oanda?pair=EURUSD" },
        { method: "POST", path: "/admin/trigger-scan" },
        { method: "POST", path: "/admin/test-telegram" },
        { method: "POST", path: "/admin/test-loud" },
        { method: "POST", path: "/admin/clear-synthetics" },
        { method: "POST", path: "/admin/reset-journal" },
        { method: "POST", path: "/admin/delete-alert" },
        { method: "POST", path: "/admin/trades" },
        { method: "GET", path: "/admin/whop-member" },
        { method: "POST", path: "/admin/generate-invite" },
        { method: "POST", path: "/admin/test-whop" },
        { method: "GET", path: "/admin/test-chart" },
        { method: "GET", path: "/admin/set-chart-key" },
        { method: "GET", path: "/admin/probe-chart-img" },
      ];

      for (const route of adminRoutes) {
        const unauthResp = await worker.fetch(
          new Request(`https://w.test${route.path}`, { method: route.method }),
          env,
          {} as any,
        );
        expect(unauthResp.status, `Expected 401 without key for ${route.method} ${route.path}`).toBe(401);

        const authedResp = await worker.fetch(
          new Request(`https://w.test${route.path}`, {
            method: route.method,
            headers: { "x-admin-key": "test-admin-secret" },
          }),
          env,
          {} as any,
        );
        expect(authedResp.status, `Expected non-401 with key for ${route.method} ${route.path}`).not.toBe(401);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("public endpoints return 200 without an admin key", async () => {
    const store = makeStore(undefined);
    await store.resetAllAlerts();

    const setupId = "td:EURUSD:30m:SHORT:V:public:1";
    await store.insertAlert(mkAlert(setupId), "twelvedata");

    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    vi.stubGlobal("fetch", makeFakeFetch(calls));
    vi.setSystemTime(new Date(NOW + 5 * 60_000));
    try {
      const env: Env = {
        TWELVEDATA_API_KEY: "K",
        ADMIN_KEY: "test-admin-secret",
      };

      const publicPaths = [
        "/",
        "/stats",
        "/alerts",
        "/health",
        "/scan-log",
        "/api/recent-events",
        "/api/monte-carlo",
        `/dashboard/signals/${encodeURIComponent(setupId)}/chart?timeframe=30m`,
        "/terms.html",
        "/alerts?pageSize=200&page=1&sort=candleCloseTime&order=desc",
      ];

      for (const path of publicPaths) {
        const resp = await worker.fetch(new Request(`https://w.test${path}`), env, {} as any);
        expect(resp.status, `Expected 200 on public path ${path}`).toBe(200);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("/alerts?includeSuppressed=true ignores flag without admin key and honors it with admin key", async () => {
    const store = makeStore(undefined);
    await store.resetAllAlerts();

    const deliveredAlert = mkAlert("td:EURUSD:30m:SHORT:V:audit-delivered:1");
    deliveredAlert.alertStatus = "SENT";
    await store.insertAlert(deliveredAlert, "twelvedata");

    const suppressedAlert = mkAlert("td:EURUSD:30m:SHORT:V:audit-suppressed:2");
    suppressedAlert.alertStatus = "SUPPRESSED";
    suppressedAlert.suppressReason = "HTF conflict gate";
    await store.insertAlert(suppressedAlert, "twelvedata");

    const env: Env = {
      TWELVEDATA_API_KEY: "K",
      ADMIN_KEY: "test-admin-secret",
    };

    // 1. Without key: 200 OK, zero SUPPRESSED rows (both includeSuppressed=true and include_suppressed=1)
    const unauthResp1 = await worker.fetch(
      new Request("https://w.test/alerts?includeSuppressed=true"),
      env,
      {} as any,
    );
    expect(unauthResp1.status).toBe(200);
    const unauthData1 = (await unauthResp1.json()) as any;
    expect(unauthData1.items.filter((r: any) => r.alertStatus === "SUPPRESSED")).toHaveLength(0);
    expect(unauthData1.total).toBe(1);

    const unauthResp2 = await worker.fetch(
      new Request("https://w.test/alerts?include_suppressed=1"),
      env,
      {} as any,
    );
    expect(unauthResp2.status).toBe(200);
    const unauthData2 = (await unauthResp2.json()) as any;
    expect(unauthData2.items.filter((r: any) => r.alertStatus === "SUPPRESSED")).toHaveLength(0);
    expect(unauthData2.total).toBe(1);

    // 2. With key: 200 OK, includes SUPPRESSED rows
    const authedResp = await worker.fetch(
      new Request("https://w.test/alerts?includeSuppressed=true", {
        headers: { "x-admin-key": "test-admin-secret" },
      }),
      env,
      {} as any,
    );
    expect(authedResp.status).toBe(200);
    const authedData = (await authedResp.json()) as any;
    expect(authedData.total).toBe(2);
    expect(authedData.items.some((r: any) => r.alertStatus === "SUPPRESSED")).toBe(true);
  });
});
