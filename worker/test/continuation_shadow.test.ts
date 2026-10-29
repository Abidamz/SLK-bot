import { describe, expect, it } from "vitest";
import { defaultStrategy } from "../src/config";
import {
  buildContinuationShadowExperiments,
  continuationSetupToShadowExperiment,
  runContinuationShadowForwardTest,
} from "../src/continuation_shadow";
import { MemStore } from "../src/store";
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
