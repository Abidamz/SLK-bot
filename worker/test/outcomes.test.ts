import { describe, expect, it } from "vitest";
import { evaluateSignal } from "../src/outcomes";
import { validateCandlesForOutcome } from "../src/provider";
import { resolveAllOpenAlerts } from "../src/index";
import { MemStore } from "../src/store";
import { loadConfig } from "../src/config";
import type { Alert, Candle } from "../src/types";

describe("corrupt-target guard", () => {
  const candles = [{ t: 1, o: 90, h: 91, l: 89, c: 90 }];
  it("SHORT with tp above entry never resolves as TP_HIT", () => {
    expect(evaluateSignal("SHORT", 4437.65, 4443.48, 4444.64, candles)).toBeNull();
  });
  it("LONG with tp below entry never resolves as TP_HIT", () => {
    expect(evaluateSignal("LONG", 100, 95, 90, candles)).toBeNull();
  });
  it("normal short still resolves", () => {
    const oc = evaluateSignal("SHORT", 100, 105, 90, [{ t: 1, o: 95, h: 96, l: 89, c: 92 }]);
    expect(oc?.status).toBe("TP_HIT");
    expect(oc?.rMultiple).toBeGreaterThan(0);
  });

  it("touch-based SL triggers SL_HIT when wick pierces stop loss even if close recovers", () => {
    // LONG entry at 100, stop at 95, TP at 115.
    // Candle wicks down to 94 (triggering broker stop loss), but closes at 116.
    // In real trading, the stop loss executed at 94.
    const candle = { t: 1, o: 100, h: 116, l: 94, c: 116 };
    const oc = evaluateSignal("LONG", 100, 95, 115, [candle], 120, false);
    expect(oc?.status).toBe("SL_HIT");
    expect(oc?.rMultiple).toBe(-1);
  });
});

describe("validateCandlesForOutcome (Option 2 Real-Time Intrabar Resolution)", () => {
  const baseT = 1700000000000;
  const tfSec = 1800; // 30m
  const c1: Candle = { t: baseT, o: 100, h: 105, l: 98, c: 102 }; // closed
  const c2: Candle = { t: baseT + tfSec * 1000, o: 102, h: 110, l: 101, c: 108 }; // active forming bar
  const now = baseT + tfSec * 1000 + 300 * 1000; // 5 minutes into candle 2

  it("includes in-progress active candle when slOnClose is false for instant touch resolution", () => {
    const outcomeCandles = validateCandlesForOutcome([c1, c2], tfSec, now, false);
    expect(outcomeCandles).toHaveLength(2);
    expect(outcomeCandles[1]).toEqual(c2);
  });

  it("excludes in-progress active candle when slOnClose is true", () => {
    const outcomeCandles = validateCandlesForOutcome([c1, c2], tfSec, now, true);
    expect(outcomeCandles).toHaveLength(1);
    expect(outcomeCandles[0]).toEqual(c1);
  });
});

describe("resolveAllOpenAlerts every-minute execution", () => {
  const t0 = 1700000000000;
  const t1 = t0 + 1800 * 1000;
  const now = t1 + 300 * 1000; // 5 min into active candle

  const dummyAlert = (overrides: Partial<Alert> = {}): Alert => ({
    setupId: "deriv:V10_1S:30m:SHORT:OC:test",
    pair: "V10_1S",
    entryTf: "30m",
    mapTf: "4h",
    candleCloseTime: t0,
    direction: "SHORT",
    environment: "bearish",
    phase: "expansion",
    htfAlignment: "H4:↓",
    originKeyLevel: 9700,
    keyLevelType: "OC",
    keyLevelBounds: [9690, 9710],
    keyLevelTested: true,
    keyLevelFlipped: false,
    imbalanceContext: [],
    internalLiquidity: [],
    externalLiquidity: [],
    drawOnLiquidity: null,
    nearestExternalTarget: null,
    intermediateZones: [],
    opposingLiquidityStanding: false,
    cycleStage: "CONFIRMED",
    entryMode: "CONFIRMATION",
    entry: 9659.29,
    stopLoss: 9669.29,
    tpInternal: 9629.29,
    tpExternal: null,
    sweepTime: t0 - 3600 * 1000,
    bosTime: t0 - 1800 * 1000,
    returnTime: t0,
    invalidationLevel: 9669.29,
    invalidationReason: null,
    parameterVersion: "v2.5.2",
    alertStatus: "PAPER",
    suppressReason: null,
    session: null,
    atrEntry: 10,
    rrInternal: 3,
    ...overrides,
  });

  it("returns 0 and does not fetch when no alerts are open", async () => {
    const store = new MemStore();
    const cfg = loadConfig({});
    let fetched = false;
    const fakeFetch = (async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const count = await resolveAllOpenAlerts({}, store, cfg, now, fakeFetch);
    expect(count).toBe(0);
    expect(fetched).toBe(false);
  });

  it("resolves open SHORT trade immediately on active candle when wick breaches SL", async () => {
    const store = new MemStore();
    await store.insertAlert(dummyAlert(), "deriv");

    // Candle feed where the active candle pierced SL (9669.29) with high = 9674.22
    const candles: Candle[] = [
      { t: t0, o: 9650, h: 9660, l: 9645, c: 9659.29 },
      { t: t1, o: 9666.37, h: 9674.22, l: 9664.71, c: 9666.31 },
    ];

    const fakeFetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("api.derivws.com") || urlStr.includes("candles")) {
        return new Response(JSON.stringify({ ok: true, candles }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const cfg = loadConfig({ DERIV_PROXY_URL: "https://mock-proxy.test" });
    const count = await resolveAllOpenAlerts({}, store, cfg, now, fakeFetch);
    expect(count).toBe(1);

    // Verify database alert status transitioned from OPEN to SL_HIT
    const openAfter = await store.openAlerts();
    expect(openAfter).toHaveLength(0);

    const recent = await store.recentAlerts(1);
    expect(recent[0].status).toBe("SL_HIT");
    expect(Number(recent[0].exit_price)).toBe(9669.29);
    expect(Number(recent[0].r_multiple)).toBe(-1);
  });

  it("resolves open LONG trade immediately on active candle when wick reaches TP1", async () => {
    const store = new MemStore();
    await store.insertAlert(dummyAlert({
      direction: "LONG",
      entry: 100,
      stopLoss: 95,
      tpInternal: 115,
      setupId: "deriv:V10_1S:30m:LONG:test",
    }), "deriv");

    // Candle feed where active candle reaches TP1 (115) with high = 116.5
    const candles: Candle[] = [
      { t: t0, o: 98, h: 101, l: 97, c: 100 },
      { t: t1, o: 100, h: 116.5, l: 99, c: 112 },
    ];

    const fakeFetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("candles")) {
        return new Response(JSON.stringify({ ok: true, candles }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const cfg = loadConfig({ DERIV_PROXY_URL: "https://mock-proxy.test" });
    const count = await resolveAllOpenAlerts({}, store, cfg, now, fakeFetch);
    expect(count).toBe(1);

    const recent = await store.recentAlerts(1);
    expect(recent[0].status).toBe("TP_HIT");
    expect(Number(recent[0].exit_price)).toBe(115);
    expect(Number(recent[0].r_multiple)).toBe(3);
  });

  it("leaves trade OPEN when active candle touches neither SL nor TP", async () => {
    const store = new MemStore();
    await store.insertAlert(dummyAlert(), "deriv");

    // Active candle price stayed safely inside entry and SL (high 9662 < 9669.29, low 9640 > 9629.29)
    const candles: Candle[] = [
      { t: t0, o: 9650, h: 9660, l: 9645, c: 9659.29 },
      { t: t1, o: 9659, h: 9662, l: 9640, c: 9650 },
    ];

    const fakeFetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("candles")) {
        return new Response(JSON.stringify({ ok: true, candles }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const cfg = loadConfig({ DERIV_PROXY_URL: "https://mock-proxy.test" });
    const count = await resolveAllOpenAlerts({}, store, cfg, now, fakeFetch);
    expect(count).toBe(0);

    const openAfter = await store.openAlerts();
    expect(openAfter).toHaveLength(1);
    expect(openAfter[0].status).toBe("OPEN");
  });
});

