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

function makeEnv(overrides: Record<string, string> = {}): Env {
  return {
    TWELVEDATA_API_KEY: "TESTKEY",
    TELEGRAM_BOT_TOKEN: "TGT",
    TELEGRAM_CHAT_ID: "123",
    DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/x/y",
    PAIRS: "EURUSD",
    ENTRY_TFS: "30m",
    MODE: "paper",
    PAPER_NOTIFY: "true",
    ...overrides,
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

    // winning setup walked the full state machine
    const winning = [...store.alerts.values()][0];
    expect(store.events.filter((e) => e.setup_id === winning.setup_id).map((e) => e.state))
      .toEqual(["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]);
    // a stale pre-touch arm from an earlier storyline snapshot is recorded
    // (expected: follow-the-storyline re-arm), never more than MAP
    const stale = store.events.filter((e) => e.setup_id !== winning.setup_id);
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale.every((e) => e.state === "MAP")).toBe(true);
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
    expect(alert.tp_internal).toBeCloseTo(104.15, 2);    // H4 structural V-low (104.2 − 0.05 wick)
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
    // 6 events: stale pre-touch MAP (superseded origin) + winning setup's
    // MAP→TOUCH→SWEEP→SHIFT→RETEST — replay above inserted none of them again
    expect(store.events).toHaveLength(6);
  });

  it("multi-provider: explicit PROVIDER_MAP route to Yahoo, flat feed yields no alert, TD pair unaffected", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    const env = makeEnv({ PAIRS: "EURUSD,US30", PROVIDER_MAP: "{\"US30\":\"yahoo\"}", SYMBOL_MAP: "{\"US30\":\"^DJI\"}" });
    const summary = await scanAll(env, {
      now: NOW, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(summary.ok).toBe(true);
    expect(summary.pairs).toEqual(["EURUSD", "US30"]);
    expect(summary.alerts).toBe(1);                    // EURUSD storyline only
    expect(calls.telegram).toHaveLength(1);            // (boot gate off: forced)
    const yahoo = (calls.dataCalls ?? []).filter((u) => u.includes("finance.yahoo.com"));
    expect(yahoo.length).toBeGreaterThanOrEqual(2);    // 1d context + 30m base
    expect(yahoo.every((u) => u.includes("%5EDJI"))).toBe(true);
    expect((calls.dataCalls ?? []).some((u) => u.includes("api.twelvedata.com"))).toBe(true);
    expect(summary.errors.filter((e) => e.startsWith("US30"))).toHaveLength(0);
    // alert carries the winning provider in its setup id
    expect(calls.telegram[0]).toContain("twelvedata:EURUSD");
  });

  it("default index CFD route is the Dukascopy public feed (no token needed)", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    const env = makeEnv({ PAIRS: "EURUSD,US30" });
    const summary = await scanAll(env, {
      now: NOW, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(summary.ok).toBe(true);
    expect(summary.pairs).toEqual(["EURUSD", "US30"]);
    expect(summary.alerts).toBe(1);                    // EURUSD only (flat duka feed)
    const duka = (calls.dataCalls ?? []).filter((u) => u.includes("jetta.dukascopy.com"));
    expect(duka.length).toBeGreaterThanOrEqual(3);    // day-file buckets + 1d year-file
    expect(duka.every((u) => u.includes("USA30.IDX-USD"))).toBe(true);
    expect((calls.dataCalls ?? []).some((u) => u.includes("finance.yahoo.com"))).toBe(false);
    expect(summary.errors.filter((e) => e.startsWith("US30"))).toHaveLength(0);
  });

  it("auto-routes index CFDs to OANDA when its token exists (preferred over Dukascopy/Yahoo)", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    const env = makeEnv({ PAIRS: "EURUSD,US30", OANDA_API_TOKEN: "OANDA_TEST_TOKEN" });
    const summary = await scanAll(env, {
      now: NOW, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(summary.ok).toBe(true);
    expect(summary.alerts).toBe(1);                    // EURUSD only
    const oanda = (calls.dataCalls ?? []).filter((u) => u.includes("oanda.com"));
    expect(oanda.length).toBeGreaterThanOrEqual(2);    // 1d context + 30m base
    expect(oanda.every((u) => u.includes("US30_USD"))).toBe(true);
    expect((calls.dataCalls ?? []).some((u) => u.includes("jetta.dukascopy.com"))).toBe(false);
    expect((calls.dataCalls ?? []).some((u) => u.includes("finance.yahoo.com"))).toBe(false);
    expect(summary.errors.filter((e) => e.startsWith("US30"))).toHaveLength(0);
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

  it("index CFD pair goes quietly idle on a weekend stale feed (not an error)", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    // T0 is Monday 00:00 UTC — jump to Saturday, when index venues are closed
    const SAT = T0 + 5 * 86400_000 + 8 * 3600_000;
    const env = makeEnv({ PAIRS: "US30" });
    const summary = await scanAll(env, {
      now: SAT, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    // the duka feed's newest candle is Monday-morning data → stale on Saturday,
    // but that must be an idle skip, not a scan failure
    expect(summary.errors.filter((e) => e.startsWith("US30"))).toHaveLength(0);
    expect(calls.telegram).toHaveLength(0);
  });

  it("same stale feed on a weekday IS an error (real outage signal)", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    // Thursday — index venues are open; a week-old feed is a genuine outage
    const THU = T0 + 21 * 86400_000 + 8 * 3600_000;
    const env = makeEnv({ PAIRS: "US30" });
    const summary = await scanAll(env, {
      now: THU, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(summary.errors.some((e) => e.startsWith("US30") && e.includes("stale feed"))).toBe(true);
  });

  it("watch toggle: sends 👀 TOUCH/SWEEP/SHIFT heads-ups ahead of the entry alert", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    const env = makeEnv({ WATCH_NOTIFY: "true" });
    const summary = await scanAll(env, {
      now: NOW, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(summary.alerts).toBe(1);
    const watch = calls.telegram.filter((m) => m.startsWith("👀 WATCH"));
    expect(watch.length).toBeGreaterThanOrEqual(1);
    expect(watch.some((m) => m.includes("🌊 SWEEP"))).toBe(true);
    expect(watch.every((m) => m.includes("Setup ID  : twelvedata:EURUSD"))).toBe(true);
    expect(watch.every((m) => m.includes("Watch only"))).toBe(true);
    // the real entry alert still arrives alongside the heads-ups
    expect(calls.telegram.some((m) => m.includes("PAPER ALERT"))).toBe(true);
  });

  it("watch toggle obeys the boot gate (first scan notifies nothing)", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    const summary = await scanAll(makeEnv({ WATCH_NOTIFY: "true" }), {
      now: NOW, fetchFn: makeFakeFetch(calls), storeOverride: store, // no force → first scan
    });
    expect(summary.alerts).toBeGreaterThanOrEqual(0);
    expect(calls.telegram).toHaveLength(0);
  });

  it("watch heads-ups are silent by default (toggle off)", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [], dataCalls: [] };
    const store = new MemStore();
    await scanAll(makeEnv(), {
      now: NOW, fetchFn: makeFakeFetch(calls), force: true, storeOverride: store,
    });
    expect(calls.telegram.filter((m) => m.startsWith("👀 WATCH"))).toHaveLength(0);
  });
