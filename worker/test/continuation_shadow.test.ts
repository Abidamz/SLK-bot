import { describe, expect, it } from "vitest";
import { defaultStrategy } from "../src/config";
import {
  buildContinuationShadowExperiments,
  continuationSetupToShadowExperiment,
  runContinuationShadowForwardTest,
} from "../src/continuation_shadow";
import { MemStore } from "../src/store";
import {
  continuationDemoPendingKey,
  createPendingContinuationDemoGroup,
} from "../src/continuation_demo_entries";
import type { Candle } from "../src/types";
import type { ContinuationSetup } from "../src/continuation";

const H4_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const cfg = defaultStrategy();

function flatCandles(count: number, step: number, end: number): Candle[] {
  const start = end - count * step;
  return Array.from({ length: count }, (_, i) => ({
    t: start + i * step,
    o: 100,
    h: 100.5,
    l: 99.5,
    c: 100,
  }));
}

describe("continuation forward shadow capture", () => {
  it("maps the model's limit entry and fixed R target into a distinct H4 row", () => {
    const setup = {
      direction: "LONG",
      entry: 100,
      stop: 99,
      tp: 103,
      setupId: "CONT|A|LONG|2026-01-01T00:00:00.000Z|42",
    } as ContinuationSetup;
    const closeTime = Date.UTC(2026, 0, 2, 4);
    const capture = continuationSetupToShadowExperiment("EURUSD", setup, closeTime);

    expect(capture).toMatchObject({
      experimentId: expect.stringContaining("CONTINUATION_SETUP_V1:EURUSD:4h:M30_OUTCOME:"),
      sourceSetupId: expect.stringContaining("CONTINUATION_SETUP_V1:EURUSD:4h:M30_OUTCOME:"),
      variant: "CONTINUATION_SETUP_V1",
      pair: "EURUSD",
      entryTf: "30m",
      direction: "LONG",
      entry: 100,
      stopLoss: 99,
      target: 103,
      rr: 3,
      candleCloseTime: closeTime,
    });
  });

  it("rejects invalid geometry and excludes non-approved symbols", () => {
    const invalid = {
      direction: "LONG", entry: 100, stop: 101, tp: 103,
      setupId: "bad-geometry",
    } as ContinuationSetup;
    expect(continuationSetupToShadowExperiment("EURUSD", invalid, Date.now())).toBeNull();

    const now = Date.UTC(2026, 0, 20);
    const h4 = flatCandles(45, H4_MS, now);
    expect(buildContinuationShadowExperiments({
      pair: "V75", h4, bias: "LONG", cfg, now,
    })).toEqual([]);
    expect(buildContinuationShadowExperiments({
      pair: "AUS200", h4, bias: "LONG", cfg, now,
    })).toEqual([]);
  });

  it("starts from a forward-only H4 baseline, then advances once per close", async () => {
    const store = new MemStore();
    const now = Date.UTC(2026, 0, 20, 12);
    const h4 = flatCandles(45, H4_MS, now);
    const daily = flatCandles(50, DAY_MS, now);
    const lastClose = h4[h4.length - 1].t + H4_MS;

    const disabled = await runContinuationShadowForwardTest({
      store, pair: "EURUSD", daily, h4, cfg, now, enabled: false, mode: "paper",
    });
    expect(disabled.state).toBe("disabled");
    expect(await store.getKv(`continuation-shadow:v1:last-h4-close:EURUSD`)).toBeNull();

    const liveMode = await runContinuationShadowForwardTest({
      store, pair: "EURUSD", daily, h4, cfg, now, enabled: true, mode: "live",
    });
    expect(liveMode.state).toBe("disabled");

    const baseline = await runContinuationShadowForwardTest({
      store, pair: "EURUSD", daily, h4, cfg, now, enabled: true, mode: "paper",
    });
    expect(baseline.state).toBe("baseline");
    expect(baseline.captures).toEqual([]);
    expect(baseline.insertedCaptures).toEqual([]);
    expect(await store.getKv(`continuation-shadow:v1:last-h4-close:EURUSD`)).toBe(String(lastClose));

    expect((await runContinuationShadowForwardTest({
      store, pair: "EURUSD", daily, h4, cfg, now, enabled: true, mode: "paper",
    })).state).toBe("unchanged");

    const advanced = [...h4, {
      t: lastClose, o: 100, h: 100.5, l: 99.5, c: 100,
    }];
    const nextNow = lastClose + H4_MS;
    const next = await runContinuationShadowForwardTest({
      store, pair: "EURUSD", daily, h4: advanced, cfg, now: nextNow, enabled: true, mode: "paper",
    });
    expect(next.state).toBe("processed");
    expect(next.latestCloseTime).toBe(nextNow);
    expect(await store.getKv(`continuation-shadow:v1:last-h4-close:EURUSD`)).toBe(String(nextNow));
    expect(await store.recentAlerts(10)).toEqual([]);
    expect(await store.recentEvents(10)).toEqual([]);
  });

  it("resolves a pending M30 trigger before H4 data checks and clears it without creating an order", async () => {
    const store = new MemStore();
    const setupClose = Date.UTC(2026, 9, 30, 8);
    const entryTime = setupClose + 30 * 60 * 1000;
    const capture = continuationSetupToShadowExperiment("EURUSD", {
      direction: "LONG", entry: 100, stop: 98, tp: 106, setupId: "demo-pending-test",
    } as ContinuationSetup, setupClose)!;
    const key = continuationDemoPendingKey("EURUSD");
    await store.setKv(key, JSON.stringify(createPendingContinuationDemoGroup("EURUSD", setupClose, [capture])));

    const result = await runContinuationShadowForwardTest({
      store,
      pair: "EURUSD",
      daily: [],
      h4: [],
      m30Candles: [{ t: setupClose, o: 101, h: 102, l: 99, c: 100.5 }],
      nextOpenCandles: [{ t: entryTime, o: 101, h: 101.5, l: 100.5, c: 101.2 }],
      cfg,
      now: entryTime + 30_000,
      enabled: true,
      mode: "paper",
      demoEntriesEnabled: true,
    });

    expect(result.state).toBe("insufficient_data");
    expect(result.demoEntries).toHaveLength(1);
    expect(result.demoEntries[0]).toMatchObject({
      entryTime,
      entryPrice: 101,
      stopLoss: 98,
      target: 106,
    });
    expect(result.demoEntries[0].rr).toBeCloseTo(5 / 3, 8);
    expect(await store.getKv(key)).toBe("");
    expect(await store.recentAlerts(10)).toEqual([]);
    expect(await store.recentEvents(10)).toEqual([]);
  });

  it("persists a late trigger as missed and keeps watching only for a later retest", async () => {
    const store = new MemStore();
    const setupClose = Date.UTC(2026, 9, 30, 8);
    const entryTime = setupClose + 30 * 60 * 1000;
    const capture = continuationSetupToShadowExperiment("EURUSD", {
      direction: "LONG", entry: 100, stop: 98, tp: 106, setupId: "demo-stale-test",
    } as ContinuationSetup, setupClose)!;
    const key = continuationDemoPendingKey("EURUSD");
    await store.setKv(key, JSON.stringify(createPendingContinuationDemoGroup("EURUSD", setupClose, [capture])));

    const result = await runContinuationShadowForwardTest({
      store,
      pair: "EURUSD",
      daily: [],
      h4: [],
      m30Candles: [{ t: setupClose, o: 101, h: 102, l: 99, c: 100.5 }],
      nextOpenCandles: [{ t: entryTime, o: 101, h: 101.5, l: 100.5, c: 101.2 }],
      cfg,
      now: entryTime + 60_001,
      enabled: true,
      mode: "paper",
      demoEntriesEnabled: true,
    });

    expect(result.demoEntries).toEqual([]);
    const persisted = JSON.parse((await store.getKv(key)) ?? "{}") as { candidates?: Array<{ ignoreTriggerCloseTime?: number }> };
    expect(persisted.candidates?.[0].ignoreTriggerCloseTime).toBe(entryTime);
  });

  it("does not run for a pair outside the approved universe", async () => {
    const store = new MemStore();
    const now = Date.UTC(2026, 0, 20, 12);
    const result = await runContinuationShadowForwardTest({
      store,
      pair: "V75",
      daily: flatCandles(50, DAY_MS, now),
      h4: flatCandles(45, H4_MS, now),
      cfg,
      now,
      enabled: true,
      mode: "paper",
    });
    expect(result.state).toBe("out_of_universe");
    expect(await store.getKv("continuation-shadow:v1:last-h4-close:V75")).toBeNull();
  });
});
