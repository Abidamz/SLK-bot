/** Deterministic coverage for the MT5 execution bridge wiring (Roadmap #6).
 *  Verifies the hard safety gate (paper mode never dispatches), the HMAC
 *  signature contract against scripts/mt5_bridge.py, and the live-mode
 *  trade + breakeven dispatch paths. Synthetic fixtures only. */
import { describe, expect, it } from "vitest";
import {
  buildBreakevenPayload, buildTradePayload, dispatchMt5Breakeven,
  dispatchMt5Trade, mt5Active, signBody,
} from "../src/mt5";
import { beArmedTime } from "../src/outcomes";
import { loadConfig } from "../src/config";
import { deliver, resolveAllOpenAlerts, type Env } from "../src/index";
import { MemStore } from "../src/store";
import type { Alert, Candle } from "../src/types";

const MT5_URL = "https://mt5-bridge.internal:8000";
const SECRET = "test-hmac-secret";

const LIVE_MT5_ENV = {
  MODE: "live",
  MT5_ENABLED: "true",
  MT5_WEBHOOK_URL: MT5_URL,
  MT5_HMAC_SECRET: SECRET,
};

function mkAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    setupId: "td:EURUSD:30m:SHORT:V:104.2:m5",
    pair: "EURUSD",
    entryTf: "30m",
    mapTf: "4h",
    direction: "SHORT",
    entry: 104.9,
    stopLoss: 105.2,
    tpInternal: 104.0,
    tpExternal: null,
    candleCloseTime: Date.parse("2024-03-04T08:00:00.000Z"),
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
    sweepTime: Date.parse("2024-03-04T07:00:00.000Z"),
    bosTime: Date.parse("2024-03-04T07:30:00.000Z"),
    returnTime: Date.parse("2024-03-04T08:00:00.000Z"),
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
    ...overrides,
  };
}

interface Mt5Call { url: string; signature: string | null; body: any; }

function mkFetch(calls: Mt5Call[], opts: { candles?: Candle[] } = {}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(MT5_URL)) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({
        url,
        signature: (init?.headers as Record<string, string>)["x-slk-signature"] ?? null,
        body,
      });
      return new Response(JSON.stringify({ status: "simulated" }), { status: 200 });
    }
    if (url.includes("api.telegram.org")) {
      if (url.includes("/pinChatMessage")) return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    if (url.includes("derivws.com") || url.includes("binaryws.com")) {
      const feed = opts.candles ?? [];
      const mockWs = {
        closed: false,
        listeners: {} as Record<string, ((...args: any[]) => void)[]>,
        addEventListener(type: string, cb: (...args: any[]) => void) { (this.listeners[type] ??= []).push(cb); },
        send() {
          setTimeout(() => {
            const msg = {
              msg_type: "candles",
              candles: feed.map((c) => ({ epoch: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c })),
            };
            this.listeners["message"]?.forEach((cb) => cb({ data: JSON.stringify(msg) }));
          }, 5);
        },
        accept() {},
        close() { this.closed = true; },
      };
      const resp = new Response(null, { status: 200 });
      (resp as any).webSocket = mockWs;
      return resp;
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("MT5 bridge safety gate", () => {
  it("never activates outside live mode with explicit enablement + credentials", () => {
    expect(mt5Active(LIVE_MT5_ENV, "live")).toBe(true);
    expect(mt5Active(LIVE_MT5_ENV, "paper")).toBe(false); // production default
    expect(mt5Active({ ...LIVE_MT5_ENV, MT5_ENABLED: "false" }, "live")).toBe(false);
    expect(mt5Active({ ...LIVE_MT5_ENV, MT5_WEBHOOK_URL: "" }, "live")).toBe(false);
    expect(mt5Active({ ...LIVE_MT5_ENV, MT5_HMAC_SECRET: "" }, "live")).toBe(false);
    expect(mt5Active({}, "live")).toBe(false);
  });

  it("paper mode dispatch is a no-op that never calls fetch", async () => {
    let called = false;
    const spy = (async () => { called = true; return new Response("", { status: 200 }); }) as unknown as typeof fetch;
    const res = await dispatchMt5Trade(LIVE_MT5_ENV, "paper", mkAlert(), spy);
    expect(res.status).toBe("skipped");
    expect(res.status === "skipped" && res.reason).toContain("paper mode");
    expect(called).toBe(false);
  });
});

describe("MT5 bridge wire contract (scripts/mt5_bridge.py)", () => {
  it("signBody matches the published HMAC-SHA256 test vector (bridge verification)", async () => {
    // RFC-style known vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    expect(await signBody("key", "The quick brown fox jumps over the lazy dog"))
      .toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("trade payload mirrors TradePayload and breakeven payload mirrors BreakevenPayload", () => {
    const a = mkAlert({ tpExternal: 97.42 });
    const payload = buildTradePayload(a, 100);
    expect(Object.keys(payload).sort()).toEqual([
      "direction", "entry", "entry_timeframe", "pair", "risk_usd",
      "setup_id", "stop_loss", "tp_external", "tp_internal",
    ]);
    expect(payload).toMatchObject({
      setup_id: a.setupId, pair: "EURUSD", direction: "SHORT",
      entry: 104.9, stop_loss: 105.2, tp_internal: 104.0, tp_external: 97.42,
      entry_timeframe: "30m", risk_usd: 100,
    });
    expect(buildBreakevenPayload("s1", "V75", 45038.5)).toEqual({
      setup_id: "s1", pair: "V75", entry_price: 45038.5,
    });
  });

  it("live trade dispatch POSTs /webhook/trade with a valid x-slk-signature", async () => {
    const calls: Mt5Call[] = [];
    const res = await dispatchMt5Trade(LIVE_MT5_ENV, "live", mkAlert(), mkFetch(calls));
    expect(res.status).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${MT5_URL}/webhook/trade`);
    const rawBody = JSON.stringify(calls[0].body);
    // re-sign the exact transmitted body: header must match byte-for-byte
    expect(calls[0].signature).toBe(await signBody(SECRET, rawBody));
    expect(calls[0].body.setup_id).toBe(mkAlert().setupId);
  });

  it("live breakeven dispatch POSTs /webhook/breakeven with entry price", async () => {
    const calls: Mt5Call[] = [];
    const res = await dispatchMt5Breakeven(LIVE_MT5_ENV, "live", "s9", "V100", 44120.1, mkFetch(calls));
    expect(res.status).toBe("sent");
    expect(calls[0].url).toBe(`${MT5_URL}/webhook/breakeven`);
    expect(calls[0].body).toEqual({ setup_id: "s9", pair: "V100", entry_price: 44120.1 });
  });
});

describe("MT5 bridge integration", () => {
  it("deliver() forwards confirmed entries to the bridge in live mode only", async () => {
    const calls: Mt5Call[] = [];
    const store = new MemStore();
    const env = {
      TELEGRAM_BOT_TOKEN: "TGT", TELEGRAM_CHAT_ID: "123",
      ...LIVE_MT5_ENV,
    } as Env;
    const cfg = loadConfig(env);
    expect(cfg.mode).toBe("live");

    const alert = mkAlert();
    await store.insertAlert(alert, "test");
    await deliver(env, store, alert, cfg, true, mkFetch(calls));
    expect(alert.alertStatus).not.toBe("SUPPRESSED");
    expect(calls.filter((c) => c.url.endsWith("/webhook/trade"))).toHaveLength(1);

    // paper deployment (production): identical alert dispatches nothing
    const paperCalls: Mt5Call[] = [];
    const paperStore = new MemStore();
    const paperEnv = { TELEGRAM_BOT_TOKEN: "TGT", TELEGRAM_CHAT_ID: "123", ...LIVE_MT5_ENV, MODE: "paper" } as Env;
    const paperCfg = loadConfig(paperEnv);
    const paperAlert = mkAlert({ setupId: "td:EURUSD:30m:SHORT:V:104.2:paper" });
    await paperStore.insertAlert(paperAlert, "test");
    await deliver(paperEnv, paperStore, paperAlert, paperCfg, true, mkFetch(paperCalls));
    expect(paperCalls).toHaveLength(0);
  });

  it("trails the broker stop to breakeven on the +1.5R arming candle, exactly once", async () => {
    const t0 = 1700000000000;
    const t1 = t0 + 1800 * 1000;
    const now = t1 + 300 * 1000;
    const entry = 9659.29;
    const stop = 9669.29; // risk 10 pts → +1.5R arm at low ≤ 9644.29
    const candles: Candle[] = [
      { t: t0, o: 9665, h: 9668, l: 9655, c: entry },
      { t: t1, o: 9658, h: 9665, l: 9640, c: 9650 }, // 1.93R favorable wick, no TP/SL/BE touch
    ];
    expect(beArmedTime("SHORT", entry, stop, candles)).toBe(t1);
    expect(beArmedTime("SHORT", entry, stop, [candles[0]])).toBeNull();

    const store = new MemStore();
    await store.insertAlert(mkAlert({
      setupId: "deriv:V10_1S:30m:SHORT:OC:be1",
      pair: "V10_1S", entry, stopLoss: stop, tpInternal: 9629.29,
      candleCloseTime: t0, shadowClassification: "A_GRADE",
    }), "deriv");

    const calls: Mt5Call[] = [];
    const env = { ...LIVE_MT5_ENV } as Env;
    const cfg = loadConfig(env);

    const first = await resolveAllOpenAlerts(env, store, cfg, now, mkFetch(calls, { candles }));
    expect(first).toBe(0); // still open — BE armed, not hit
    const beCalls = calls.filter((c) => c.url.endsWith("/webhook/breakeven"));
    expect(beCalls).toHaveLength(1);
    expect(beCalls[0].body).toEqual({ setup_id: "deriv:V10_1S:30m:SHORT:OC:be1", pair: "V10_1S", entry_price: entry });

    // second pass: KV dedupe prevents a duplicate trailing command
    const again = await resolveAllOpenAlerts(env, store, cfg, now, mkFetch(calls, { candles }));
    expect(again).toBe(0);
    expect(calls.filter((c) => c.url.endsWith("/webhook/breakeven"))).toHaveLength(1);
  });
});
