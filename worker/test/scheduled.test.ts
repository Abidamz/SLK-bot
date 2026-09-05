/** End-to-end cron-tick tests (validation runbook rows): one scan cycle with
 *  the real feature-engine dataflow, simulated provider + notification
 *  channels, idempotent re-runs, unfinished-candle gating, and safe provider
 *  outage. Synthetic fixtures only — logic verification, not performance
 *  evidence. */
import { describe, expect, it } from "vitest";
import { scanAll, type Env } from "../src/index";
import { MemStore } from "../src/store";
import { T0, makeFakeFetch, type RecordedCalls } from "./fixtures";

const NOW = T0 + 8 * 3600_000; // 08:00 — just after the retest candle closed

function makeEnv(): Env {
  return {
    TWELVEDATA_API_KEY: "TESTKEY",
    TELEGRAM_BOT_TOKEN: "TGT",
    TELEGRAM_CHAT_ID: "123",
    DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/x/y",
    PAIRS: "EURUSD",
    ENTRY_TFS: "30m",
    MODE: "paper",
    PAPER_NOTIFY: "true",
  } as Env;
}

describe("scheduled scan cycle", () => {
  it("first tick records the setup but delivers nothing (boot gate)", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [] };
    const store = new MemStore();
    const summary = await scanAll(makeEnv(), {
      now: NOW, fetchFn: makeFakeFetch(calls), storeOverride: store,
    });
    expect(summary.ok).toBe(true);
    expect(summary.timeframes).toEqual(["30m"]);
    expect(summary.alerts).toBe(1);                 // recorded
    expect(calls.telegram).toHaveLength(0);         // …but boot-gated
    expect(calls.discord).toHaveLength(0);

    expect(store.events.map((e) => e.state))
      .toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]);
    expect(store.scanLog).toHaveLength(1);
    expect(store.scanLog[0].note).toBe("ok");
  });

  it("forced scan delivers exactly one Telegram + one Discord message", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [] };
    const store = new MemStore();
    const summary = await scanAll(makeEnv(), {
      now: NOW, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(summary.alerts).toBe(1);
    expect(calls.telegram).toHaveLength(1);
    expect(calls.discord).toHaveLength(1);
    const msg = calls.telegram[0];
    expect(msg).toContain("SLK 🧪 PAPER ALERT — EURUSD");
    expect(msg).toContain("Direction   : SHORT");
    expect(msg).toContain("RETEST → CONFIRMED");
    expect(msg).toContain("Research signal only. No order was placed.");
    expect(msg).toContain("Setup ID    : twelvedata:EURUSD:30m:SHORT:V:104.2");

    const alert = [...store.alerts.values()][0];
    expect(alert.tp_internal).toBeCloseTo(104.14, 2);    // H4 structural low
    expect(Number(alert.tp_external)).toBeLessThan(103.6); // external draw
    expect(alert.alert_status).toBe("PAPER");

    // identical re-run: dedupe → nothing new, no extra messages
    const again = await scanAll(makeEnv(), {
      now: NOW, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(again.alerts).toBe(0);
    expect(again.events).toBe(0);
    expect(calls.telegram).toHaveLength(1);
    expect(calls.discord).toHaveLength(1);
    expect(store.events).toHaveLength(5);
  });

  it("unfinished confirmation candle → no alert", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [] };
    const store = new MemStore();
    // at NOW−1h the retest candle (opened T0+7h) hasn't closed yet
    const summary = await scanAll(makeEnv(), {
      now: NOW - 3600_000, fetchFn: makeFakeFetch(calls), force: true,
      storeOverride: store,
    });
    expect(summary.alerts).toBe(0);
    expect(calls.telegram).toHaveLength(0);
  });

  it("provider outage fails safe: no alerts, visible error, scan logged", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [] };
    const store = new MemStore();
    const summary = await scanAll(makeEnv(), {
      now: NOW, fetchFn: makeFakeFetch(calls, { failData: true }),
      force: true, storeOverride: store,
    });
    expect(summary.ok).toBe(false);
    expect(summary.alerts).toBe(0);
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(calls.telegram).toHaveLength(0);
    expect(store.scanLog[0].note).toBe("partial");
    expect(store.scanLog[0].errors).toContain("network down");
  });
});
