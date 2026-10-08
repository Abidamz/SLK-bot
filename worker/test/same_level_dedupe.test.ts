/** Same-level cross-timeframe dedupe.
 *
 *  Making the cooldown per-timeframe stopped a 30m signal silencing a later 1h
 *  signal on the same pair — but when both fire off the *same origin level*
 *  they are one trade, not two. Observed live on JAPAN225: a 15m SHORT and a 1h
 *  SHORT, setup IDs identical apart from the timeframe field, entries 0.1%
 *  apart. A subscriber acting on both carries 2.7x intended risk on one thesis.
 *
 *  These tests pin that the duplicate is suppressed while genuinely different
 *  setups still reach subscribers, and that the kill switch works. */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { deliver, type Env } from "../src/index";
import { MemStore } from "../src/store";
import type { Alert } from "../src/types";

const T0 = Date.parse("2024-03-04T08:00:00.000Z");
const ORIGIN = Date.parse("2024-03-04T06:00:00.000Z");
const ORIGIN_ISO = "2024-03-04T06:00:00.000Z";
// A second, later-born level. Both the setup ID's ISO suffix and the alert's
// originTime must agree — in production buildSetupId() derives the suffix from
// the same origin-level birth time.
const ORIGIN_OTHER = Date.parse("2024-03-04T07:00:00.000Z");

// Real setup-ID shape: PAIR:TF:DIR:KIND:PRICE:ISO. The two below differ only in
// the timeframe field — exactly the JAPAN225 duplicate.
const ID_15M = `JAPAN225:15m:SHORT:DECISION:68918.000000:${ORIGIN_ISO}`;
const ID_1H = `JAPAN225:1h:SHORT:DECISION:68918.000000:${ORIGIN_ISO}`;
// A different origin level on the same pair — a different trade.
const ID_1H_OTHER = `JAPAN225:1h:SHORT:DECISION:69500.000000:${new Date(ORIGIN_OTHER).toISOString()}`;

function baseEnv(extra: Record<string, string> = {}): Env {
  return {
    MODE: "paper",
    TELEGRAM_BOT_TOKEN: "TGT",
    TELEGRAM_CHAT_ID: "123",
    ...extra,
  } as Env;
}

function mkAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    setupId: ID_1H,
    pair: "JAPAN225", entryTf: "1h", mapTf: "4h", direction: "SHORT",
    entry: 68204, stopLoss: 69268.5, tpInternal: 65312.5, tpExternal: 65000,
    candleCloseTime: T0,
    environment: "bearish", phase: "expansion", htfAlignment: "H4:↓",
    originKeyLevel: 68918, keyLevelType: "DECISION",
    keyLevelBounds: [68345.7, 68918.2], keyLevelTested: true, keyLevelFlipped: false,
    imbalanceContext: [], internalLiquidity: [], externalLiquidity: [],
    drawOnLiquidity: 65000, nearestExternalTarget: 65000, intermediateZones: [],
    opposingLiquidityStanding: true,
    sweepTime: T0 - 3600_000, bosTime: T0 - 1800_000, returnTime: T0 - 900_000,
    invalidationLevel: 69268.5, invalidationReason: null, parameterVersion: "1",
    alertStatus: "PAPER", suppressReason: null, session: null,
    atrEntry: 120, rrInternal: 2.72, cycleStage: "entry_alert", entryMode: "confirmation",
    originTime: ORIGIN,
    ...overrides,
  };
}

const okFetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

/** Seed a delivered 15m alert on the same origin level, `ago` ms before T0. */
async function seed15m(store: MemStore, ago = 30 * 60_000): Promise<void> {
  await store.insertAlert(mkAlert({
    setupId: ID_15M,
    entryTf: "15m",
    candleCloseTime: T0 - ago,
  }), "test");
}

describe("same-level dedupe", () => {
  it("is enabled by default", () => {
    expect(loadConfig(baseEnv()).strategy.dedupSameLevel).toBe(true);
  });

  it("suppresses the 1h alert when the 15m already published the same level", async () => {
    const store = new MemStore();
    await seed15m(store);
    const alert = mkAlert();

    await deliver(baseEnv(), store, alert, loadConfig(baseEnv()), true, okFetch);

    expect(alert.alertStatus).toBe("SUPPRESSED");
    expect(alert.suppressReason).toContain("same-level duplicate");
  });

  it("does NOT suppress a different origin level on the same pair and direction", async () => {
    const store = new MemStore();
    await seed15m(store);
    // Same pair, same direction, same timeframe slot — but a different level,
    // so this is a separate trade and must still reach subscribers.
    const alert = mkAlert({ setupId: ID_1H_OTHER, originKeyLevel: 69500, originTime: ORIGIN_OTHER });

    await deliver(baseEnv(), store, alert, loadConfig(baseEnv()), true, okFetch);

    expect(alert.alertStatus).not.toBe("SUPPRESSED");
  });

  it("does NOT suppress the opposite direction on the same level", async () => {
    const store = new MemStore();
    await seed15m(store);
    // A long and a short off one level are different trades.
    const alert = mkAlert({
      setupId: `JAPAN225:1h:LONG:DECISION:68918.000000:${ORIGIN_ISO}`,
      direction: "LONG",
    });

    await deliver(baseEnv(), store, alert, loadConfig(baseEnv()), true, okFetch);

    expect(alert.alertStatus).not.toBe("SUPPRESSED");
  });

  it("does NOT suppress the same level once the window has passed", async () => {
    const store = new MemStore();
    // 300 minutes ago — outside the 240m window. Price leaving and returning to
    // the same level later is a legitimate new trade.
    await seed15m(store, 300 * 60_000);
    const alert = mkAlert();

    await deliver(baseEnv(), store, alert, loadConfig(baseEnv()), true, okFetch);

    expect(alert.alertStatus).not.toBe("SUPPRESSED");
  });

  it("can be disabled with DEDUP_SAME_LEVEL=false", async () => {
    const store = new MemStore();
    await seed15m(store);
    const env = baseEnv({ DEDUP_SAME_LEVEL: "false" });
    const cfg = loadConfig(env);
    expect(cfg.strategy.dedupSameLevel).toBe(false);
    const alert = mkAlert();

    await deliver(env, store, alert, cfg, true, okFetch);

    expect(alert.alertStatus).not.toBe("SUPPRESSED");
  });
});

describe("lastAlertTimeSameLevel", () => {
  it("matches a delivered alert on another timeframe sharing the origin time", async () => {
    const store = new MemStore();
    await seed15m(store);
    const got = await store.lastAlertTimeSameLevel(
      "JAPAN225", "SHORT", "DECISION", ORIGIN, ID_1H, "1h",
    );
    expect(got).toBe(T0 - 30 * 60_000);
  });

  it("ignores alerts on a different level", async () => {
    const store = new MemStore();
    await store.insertAlert(mkAlert({
      setupId: ID_1H_OTHER, entryTf: "15m", candleCloseTime: T0 - 60_000,
    }), "test");
    const got = await store.lastAlertTimeSameLevel(
      "JAPAN225", "SHORT", "DECISION", ORIGIN, ID_1H, "1h",
    );
    expect(got).toBeNull();
  });

  it("ignores suppressed alerts — a blocked duplicate must not block in turn", async () => {
    const store = new MemStore();
    await seed15m(store);
    const row = (await store.recentAlerts(50)).find((r) => String(r.setup_id) === ID_15M);
    expect(row).toBeDefined();
    await store.updateAlertStatus(ID_15M, "SUPPRESSED", "test");
    const got = await store.lastAlertTimeSameLevel(
      "JAPAN225", "SHORT", "DECISION", ORIGIN, ID_1H, "1h",
    );
    expect(got).toBeNull();
  });

  it("returns null when the origin time is unknown rather than matching loosely", async () => {
    const store = new MemStore();
    await seed15m(store);
    const got = await store.lastAlertTimeSameLevel(
      "JAPAN225", "SHORT", "DECISION", undefined, ID_1H, "1h",
    );
    expect(got).toBeNull();
  });
});
