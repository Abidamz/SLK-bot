/** Cooldown keying. The gate is scoped to the setup's own entry timeframe by
 *  default, so a delivered 30m signal no longer silences a later 1h signal on
 *  the same pair. COOLDOWN_SCOPE=pair_direction restores the legacy behaviour
 *  and is covered here too, so the kill switch stays verified. */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { deliver, type Env } from "../src/index";
import { MemStore } from "../src/store";
import type { Alert } from "../src/types";

const T0 = Date.parse("2024-03-04T08:00:00.000Z");

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
    setupId: "td:XAUUSD:1h:SHORT:A:2400.0:z",
    pair: "XAUUSD", entryTf: "1h", mapTf: "4h", direction: "SHORT",
    entry: 2390, stopLoss: 2400, tpInternal: 2360, tpExternal: 2300,
    candleCloseTime: T0 + 30 * 60_000,
    environment: "bearish", phase: "expansion", htfAlignment: "H4:↓",
    originKeyLevel: 2400, keyLevelType: "OC",
    keyLevelBounds: [2399, 2401], keyLevelTested: true, keyLevelFlipped: false,
    imbalanceContext: [], internalLiquidity: [], externalLiquidity: [],
    drawOnLiquidity: 2300, nearestExternalTarget: 2300, intermediateZones: [],
    opposingLiquidityStanding: true,
    sweepTime: T0 - 3600_000, bosTime: T0 - 1800_000, returnTime: T0,
    invalidationLevel: 2400, invalidationReason: null, parameterVersion: "1",
    alertStatus: "PAPER", suppressReason: null, session: null,
    atrEntry: 3, rrInternal: 3, cycleStage: "entry_alert", entryMode: "confirmation",
    originTime: T0 - 7200_000,
    ...overrides,
  };
}

/** A delivered 30m signal on the same pair and direction, 30 minutes earlier. */
async function seedDelivered30m(store: MemStore): Promise<void> {
  await store.insertAlert(mkAlert({
    setupId: "td:XAUUSD:30m:SHORT:A:2400.0:prior",
    entryTf: "30m",
    candleCloseTime: T0,
  }), "test");
}

const okFetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

describe("cooldown scope", () => {
  it("default scope is per-timeframe", () => {
    expect(loadConfig(baseEnv()).strategy.cooldownScope).toBe("pair_direction_tf");
  });

  it("default: a 1h signal is NOT blocked by a delivered 30m signal", async () => {
    const store = new MemStore();
    await seedDelivered30m(store);
    const env = baseEnv();
    const cfg = loadConfig(env);

    const alert = mkAlert({ setupId: "td:XAUUSD:1h:SHORT:A:2400.0:a", entryTf: "1h" });
    await store.insertAlert(alert, "test");
    await deliver(env, store, alert, cfg, true, okFetch);

    expect(alert.alertStatus).not.toBe("SUPPRESSED");
  });

  it("default: a same-timeframe repeat IS still blocked", async () => {
    const store = new MemStore();
    await seedDelivered30m(store);
    const env = baseEnv();
    const cfg = loadConfig(env);

    const alert = mkAlert({
      setupId: "td:XAUUSD:30m:SHORT:A:2400.0:b",
      entryTf: "30m",
      originTime: T0 - 7000_000, // distinct identity, so the insert is not deduped
    });
    await store.insertAlert(alert, "test");
    await deliver(env, store, alert, cfg, true, okFetch);

    expect(alert.alertStatus).toBe("SUPPRESSED");
    expect(alert.suppressReason).toBe("cooldown (240m, 30m)");
  });

  it("legacy scope: a 1h signal IS blocked by a delivered 30m signal", async () => {
    const store = new MemStore();
    await seedDelivered30m(store);
    const env = baseEnv({ COOLDOWN_SCOPE: "pair_direction" });
    const cfg = loadConfig(env);
    expect(cfg.strategy.cooldownScope).toBe("pair_direction");

    const alert = mkAlert({ setupId: "td:XAUUSD:1h:SHORT:A:2400.0:c", entryTf: "1h" });
    await store.insertAlert(alert, "test");
    await deliver(env, store, alert, cfg, true, okFetch);

    expect(alert.alertStatus).toBe("SUPPRESSED");
    expect(alert.suppressReason).toBe("cooldown (240m)");
  });

  it("a signal far outside the window is never blocked, in either scope", async () => {
    for (const scope of ["pair_direction_tf", "pair_direction"]) {
      const store = new MemStore();
      await seedDelivered30m(store);
      const env = baseEnv({ COOLDOWN_SCOPE: scope });
      const cfg = loadConfig(env);

      const alert = mkAlert({
        setupId: `td:XAUUSD:30m:SHORT:A:2400.0:old-${scope}`,
        entryTf: "30m",
        candleCloseTime: T0 + 300 * 60_000, // 5h later, past the 240m window
        originTime: T0 - 6000_000,
      });
      await store.insertAlert(alert, "test");
      await deliver(env, store, alert, cfg, true, okFetch);

      expect(alert.alertStatus, scope).not.toBe("SUPPRESSED");
    }
  });
});
