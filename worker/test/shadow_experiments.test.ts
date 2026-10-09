import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, {
  captureFvgRetest50Experiments,
  persistShadowExperiments,
  resolveShadowExperimentOutcomes,
  type Env,
} from "../src/index";
import { defaultStrategy, loadConfig } from "../src/config";
import { scanEntry } from "../src/engine";
import { makeStore, D1Store, MemStore, resetDefaultMemStore, type D1Like } from "../src/store";
import type { ShadowExperimentCapture } from "../src/types";
import { BASE, LONG_STORY, SHORT_ROWS, SHORT_STORY, mkCandles, snapsFor } from "./fixtures";

function experiment(
  experimentId: string,
  variant: ShadowExperimentCapture["variant"] = "FVG_RETEST_50",
): ShadowExperimentCapture {
  return {
    experimentId,
    sourceSetupId: `setup:${experimentId}`,
    variant,
    pair: "EURUSD",
    entryTf: "30m",
    direction: "SHORT",
    entry: 100,
    stopLoss: 101,
    target: 98,
    rr: 2,
    candleCloseTime: BASE,
  };
}

const request = (path: string, authorization?: string) => new Request(`https://w.test${path}`, {
  headers: authorization ? { authorization } : undefined,
});

describe("isolated TAYO shadow experiments", () => {
  beforeEach(() => resetDefaultMemStore());

  it("compares a latest 50% FVG-retest candidate without accepting stale or suppressed alerts", () => {
    const story = {
      ...SHORT_STORY,
      imbalances: [{ lo: 104.95, hi: 105.05, direction: "bearish" as const, time: BASE }],
    };
    const rows = [...SHORT_ROWS];
    rows[14] = [103.55, 104.99, 103.50, 104.90];
    rows[15] = [104.90, 105.00, 104.85, 104.92];
    const candles = mkCandles(rows, 30);
    const result = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles, snaps: snapsFor(story),
      cfg: { ...defaultStrategy(), minRiskAtr: 0.1, retestDepthPct: 50 },
      mode: "paper", provider: "test", shadowOnly: true,
    });
    expect(result.events).toEqual([]);
    expect(result.alerts).toHaveLength(1);

    const captured = captureFvgRetest50Experiments("EURUSD", "30m", 1800, candles, result.alerts);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      variant: "FVG_RETEST_50", pair: "EURUSD", entryTf: "30m",
      direction: "SHORT", entry: 104.92,
    });
    expect(captureFvgRetest50Experiments("EURUSD", "30m", 1800, candles, [
      { ...result.alerts[0], candleCloseTime: result.alerts[0].candleCloseTime - 1800_000 },
    ])).toEqual([]);
    expect(captureFvgRetest50Experiments("EURUSD", "30m", 1800, candles, [
      { ...result.alerts[0], alertStatus: "SUPPRESSED" },
    ])).toEqual([]);
  });

  it("only records a Breakout continuation through the aligned H4 vantage sequence", () => {
    // This fixture used to be captured by the old "fresh swing break on the
    // latest closed candle" heuristic. The experiment is now aligned to
    // recent H4 breakout → liquidity sweep → rebalance into the breakout's
    // H4 FVG → entry at the zone touch, so a standalone swing break records
    // nothing on its own.
    const rows: [number, number, number, number][] = [
      [100, 100.5, 99.5, 100],
      [100, 100.6, 99.0, 100],
      [100, 101.0, 98.9, 100.8],
      [100.8, 102.5, 100.5, 102.0], // confirmed local swing high
      [102.0, 102.2, 99.8, 100.0],
      [100.0, 100.2, 99.7, 99.9],
      [99.9, 100.3, 99.8, 99.5],
      [99.5, 101.0, 99.4, 100.8],
      [100.8, 101.3, 100.5, 101.0],
      [101.0, 101.5, 100.7, 101.2],
      [101.2, 103.5, 101.1, 103.2], // fresh body close above prior swing
    ];
    const story = {
      ...LONG_STORY,
      nearestExternalTarget: 110,
      externalPools: [{ price: 110, side: "buyside" as const, kind: "PWH", sourceTime: BASE }],
    };
    const result = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: mkCandles(rows, 30), snaps: snapsFor(story),
      cfg: { ...defaultStrategy(), minStopPips: 0 },
      mode: "paper", provider: "test",
    });

    expect(result.alerts).toEqual([]);
    expect(result.shadowExperiments).toEqual([]);
    expect(result.events.some((event) => event.state === "BREAKOUT_CONTINUATION")).toBe(false);
  });

  it("dedupes, resolves and aggregates variants separately from alerts and events", async () => {
    const store = new MemStore();
    const first = experiment("fvg-midpoint");
    const second = experiment("aligned-breakout", "BREAKOUT_CONTINUATION");
    expect(await store.insertShadowExperiment(first)).toBe(true);
    expect(await store.insertShadowExperiment(first)).toBe(false);
    expect(await store.insertShadowExperiment(second)).toBe(true);

    const resolved = await resolveShadowExperimentOutcomes(store, loadConfig({}), "EURUSD", "30m", [
      { t: BASE, o: 100, h: 100.5, l: 97.9, c: 99 },
    ]);
    expect(resolved).toBe(2);
    const ledger = await store.getShadowExperimentLedger();
    expect(ledger.aggregate.FVG_RETEST_50).toMatchObject({ count: 1, resolved: 1, wins: 1, netR: 2 });
    expect(ledger.aggregate.BREAKOUT_CONTINUATION).toMatchObject({ count: 1, resolved: 1, wins: 1, netR: 2 });
    expect(await store.recentAlerts(10)).toEqual([]);
    expect(await store.recentEvents(10)).toEqual([]);
  });

  it("no-ops when the additive D1 experiment table has not been applied", async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: (..._values: unknown[]) => ({
        run: async () => ({ meta: { changes: 0 } }),
        first: async () => null,
        all: async () => {
          if (sql.includes("slk_shadow_experiments")) throw new Error("no such table: slk_shadow_experiments");
          return { results: [] };
        },
      }),
    }));
    const store = new D1Store({ prepare } as unknown as D1Like);
    expect(await store.insertShadowExperiment(experiment("missing-table"))).toBe(false);
    expect(await store.openShadowExperiments()).toEqual([]);
    expect((await store.getShadowExperimentLedger()).available).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("keeps the owner-only experiment endpoint separate from normal public trade surfaces", async () => {
    const store = makeStore(undefined);
    await store.insertShadowExperiment(experiment("private-experiment"));
    const env = { ADMIN_KEY: "owner-test" } as Env;
    const unauthorized = await worker.fetch(request("/api/shadow-experiments"), env, {} as any);
    expect(unauthorized.status).toBe(401);

    const authorized = await worker.fetch(
      request("/api/shadow-experiments", "Bearer owner-test"), env, {} as any,
    );
    expect(authorized.status).toBe(200);
    const data = await authorized.json() as any;
    expect(data.rows[0]).toMatchObject({
      experimentId: "private-experiment", variant: "FVG_RETEST_50", status: "OPEN",
    });

    const [stats, alerts, mc] = await Promise.all([
      worker.fetch(request("/stats", "Bearer owner-test"), env, {} as any),
      worker.fetch(request("/alerts?includeSuppressed=true", "Bearer owner-test"), env, {} as any),
      worker.fetch(request("/api/monte-carlo?seed=11"), env, {} as any),
    ]);
    const [statsText, alertsBody, mcBody] = await Promise.all([stats.text(), alerts.json() as Promise<any>, mc.json() as Promise<any>]);
    expect(statsText).not.toContain("private-experiment");
    expect(alertsBody.items).toEqual([]);
    expect(mcBody).toMatchObject({ ok: false, error: "INSUFFICIENT_HISTORY", closedTrades: 0 });
  });

  it("persists through the isolated helper and swallows experiment storage errors", async () => {
    const store = new MemStore();
    await persistShadowExperiments(store, [experiment("saved")]);
    expect((await store.getShadowExperimentLedger()).rows).toHaveLength(1);
    vi.spyOn(store, "insertShadowExperiment").mockRejectedValue(new Error("research table offline"));
    await expect(persistShadowExperiments(store, [experiment("fail-safe")])).resolves.toBeUndefined();
  });
});
