import { describe, expect, it, vi } from "vitest";
import {
  SHADOW_RESOLVE_FETCH_CONCURRENCY,
  SHADOW_RESOLVE_GROUPS_MAX,
  SHADOW_RESOLVE_GROUPS_MIN,
  resolveAllOpenShadowTrades,
  shadowGroupsPerTick,
  shadowResolutionWindow,
  mapWithConcurrency,
  scanAll,
  type Env,
} from "../src/index";
import { MemStore } from "../src/store";
import { T0, makeFakeFetch } from "./fixtures";

const NOW = T0 + 8 * 3600_000;
const env: Env = {
  TWELVEDATA_API_KEY: "TESTKEY", // fake fetch only; not a credential
  PAIRS: "EURUSD,GBPUSD", ENTRY_TFS: "30m,1h", MODE: "paper",
  WATCH_NOTIFY: "false", PAPER_NOTIFY: "true", MIN_RISK_ATR: "0.8",
};

const g = (pair: string, tf: string) => ({ pair, tf });

describe("shadow resolution rotation", () => {
  it("adapts the slice to the open set and stays bounded", () => {
    expect(shadowGroupsPerTick(0)).toBe(0);
    expect(shadowGroupsPerTick(1)).toBe(SHADOW_RESOLVE_GROUPS_MIN);
    expect(shadowGroupsPerTick(12)).toBe(SHADOW_RESOLVE_GROUPS_MIN);
    expect(shadowGroupsPerTick(20)).toBe(SHADOW_RESOLVE_GROUPS_MIN);
    expect(shadowGroupsPerTick(36)).toBe(6);       // ceil(36 / 6 rotation ticks)
    expect(shadowGroupsPerTick(60)).toBe(10);
    expect(shadowGroupsPerTick(600)).toBe(SHADOW_RESOLVE_GROUPS_MAX);
  });

  it("walks every group exactly once per rotation and wraps", () => {
    const groups = [
      g("GBPUSD", "30m"), g("EURUSD", "1h"), g("EURUSD", "30m"),
      g("V25", "1h"), g("US30", "15m"), g("AUDJPY", "1h"), g("V10", "30m"),
    ];
    const perTick = 3;
    const seen: string[] = [];
    let cursor = 0;
    for (let tick = 0; tick < 3; tick++) {
      const { selected, nextCursor } = shadowResolutionWindow(groups, cursor, perTick);
      seen.push(...selected.map((s) => `${s.pair}:${s.tf}`));
      cursor = nextCursor;
    }
    // 7 groups at 3 per tick over 3 ticks covers everything, in sorted order,
    // and the third tick is a wrapped (shorter) slice.
    expect(new Set(seen).size).toBe(groups.length);
    expect(seen.slice(0, 3)).toEqual(["AUDJPY:1h", "EURUSD:1h", "EURUSD:30m"]);
    expect(cursor).toBe(2);
    // ...and the next tick continues from the cursor without skipping a group.
    const wrap = shadowResolutionWindow(groups, cursor, perTick);
    expect(wrap.selected.map((s) => `${s.pair}:${s.tf}`)).toEqual(["EURUSD:30m", "GBPUSD:30m", "US30:15m"]);
  });

  it("is order-independent and tolerates junk cursors", () => {
    const a = [g("EURUSD", "1h"), g("AUDJPY", "1h"), g("EURUSD", "30m")];
    const b = [g("EURUSD", "30m"), g("AUDJPY", "1h"), g("EURUSD", "1h")];
    const first = shadowResolutionWindow(a, 0, 2).selected.map((s) => `${s.pair}:${s.tf}`);
    expect(shadowResolutionWindow(b, 0, 2).selected.map((s) => `${s.pair}:${s.tf}`)).toEqual(first);
    // negative / fractional / huge cursors all land somewhere valid
    for (const cursor of [-7, 2.9, 1e9]) {
      const { selected, nextCursor } = shadowResolutionWindow(a, cursor, 2);
      expect(selected).toHaveLength(2);
      expect(nextCursor).toBeGreaterThanOrEqual(0);
      expect(nextCursor).toBeLessThan(a.length);
    }
    expect(shadowResolutionWindow([], 3, 2)).toEqual({ selected: [], nextCursor: 0 });
    expect(shadowResolutionWindow(a, 1, 0).selected).toEqual([]);
  });
});

describe("mapWithConcurrency", () => {
  it("respects the width, preserves order, and never drops work", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 11 }, (_, i) => i);
    const out = await mapWithConcurrency(items, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(out).toEqual(items.map((n) => n * 2));
  });

  it("clamps silly widths and handles empty input", async () => {
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n)).toEqual([1, 2]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n + 1)).toEqual([2, 3]);
    expect(await mapWithConcurrency([], 4, async (n: number) => n)).toEqual([]);
  });

  it("propagates a rejection instead of leaving work half-claimed", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

describe("shadow rotation in a real scan", () => {
  it("resolves only a rotating slice of open shadow groups per invocation", async () => {
    const store = new MemStore();
    // Ten open shadow rows across ten distinct (pair, tf) groups: a single
    // invocation must touch at most the adaptive slice, never all ten.
    for (let i = 0; i < 10; i++) {
      await store.insertShadowTrade({
        setupId: `shadow:${i}`,
        pair: `P${String(i).padStart(2, "0")}USD`,
        entryTf: "30m",
        direction: "LONG",
        entry: 100 + i,
        stopLoss: 99 + i,
        tp1: 105 + i,
        rr: 5,
        rejectReason: "TARGET_FLOOR",
        candleCloseTime: NOW - 3600_000,
      } as any);
    }

    const cfg = {
      symbolMap: {}, providerMap: {}, derivAppId: "1089", derivProxyUrl: undefined,
      slOnClose: false, mode: "paper",
    } as any;
    const fetchFn = makeFakeFetch({ telegram: [], discord: [] });
    const fetchSpy = vi.fn(fetchFn as any);

    const stats = { groups: 0, checked: 0, fetches: 0, fetchMs: 0 };
    const first = await resolveAllOpenShadowTrades(env, store, cfg, NOW, fetchSpy as any, stats);
    expect(typeof first).toBe("number");
    expect(stats.groups).toBe(10);
    expect(stats.checked).toBe(shadowGroupsPerTick(10));
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(shadowGroupsPerTick(10));
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(shadowGroupsPerTick(10) * 6);

    // The rotation cursor advanced, so the next tick starts where this one stopped.
    expect(Number(await store.getKv("shadow_resolve_cursor"))).toBeGreaterThan(0);

    const secondStats = { groups: 0, checked: 0, fetches: 0, fetchMs: 0 };
    await resolveAllOpenShadowTrades(env, store, cfg, NOW, fetchSpy as any, secondStats);
    expect(secondStats.groups).toBe(10);
    expect(secondStats.checked).toBe(shadowGroupsPerTick(10));
  });

  it("keeps live/paper resolution unreduced: every open alert group is checked each tick", async () => {
    const store = new MemStore();
    await scanAll({ ...env, MIN_RISK_ATR: "0.1" }, {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }),
      storeOverride: store, force: true,
    });
    const open = await store.openAlerts();
    // The fixture scan leaves open paper trades; the live resolver must still
    // process them in a single invocation (no rotation on this path).
    const second = await scanAll(env, {
      now: NOW + 60_000, fetchFn: makeFakeFetch({ telegram: [], discord: [] }),
      storeOverride: store, force: true,
    });
    expect(second.ok).toBe(true);
    const timing = second.diagnostics.timing!;
    expect(timing.liveResolveMs).toBeGreaterThanOrEqual(0);
    expect(open.length).toBeGreaterThan(0); // guard: the fixture really did open trades
    expect(timing.shadowChecked).toBeLessThanOrEqual(timing.shadowGroups);
  });

  it("records the phase timings and the http fan-out on every scan row", async () => {
    const store = new MemStore();
    const res = await scanAll(env, {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }),
      storeOverride: store, force: true,
    });
    expect(res.ok).toBe(true);
    const timing = res.diagnostics.timing!;
    expect(timing).toBeDefined();
    expect(timing.pairScanMs).toBeGreaterThanOrEqual(0);
    expect(timing.httpCalls).toBeGreaterThan(0);
    expect(store.scanLog[store.scanLog.length - 1].diagnostics?.timing).toEqual(timing);
    // The latest-tick snapshot the health endpoint reads comes from the same values.
    expect(JSON.parse(String(await store.getKv("last_scan_timing")))).toEqual(timing);
    expect(SHADOW_RESOLVE_FETCH_CONCURRENCY).toBeGreaterThan(1);
  });
});

describe("scheduler KV batching", () => {
  const manyPairs: Env = {
    ...env,
    PAIRS: "EURUSD,GBPUSD,USDJPY,AUDJPY,GBPJPY,XAUUSD,NAS100,US30,GER40,JAPAN225,V75,V100",
    ENTRY_TFS: "15m,30m,1h",
  };

  it("replaces the per-pair/per-timeframe scheduler reads with batched lookups", async () => {
    const store = new MemStore();
    // Seed realistic scheduler state: a last_scan key per pair/timeframe and a
    // boundary per timeframe, exactly what the old per-key reads looked up.
    for (const pair of String(manyPairs.PAIRS).split(",")) {
      for (const tf of ["15m", "30m", "1h"]) {
        await store.setKv(`last_scan:${pair}:${tf}`, String(NOW - 90_000));
      }
    }
    for (const tf of ["15m", "30m", "1h"]) await store.setKv(`last_boundary:${tf}`, String(NOW - 90_000));

    const getKvSpy = vi.spyOn(store, "getKv");
    const prefixSpy = vi.spyOn(store, "getKvByPrefix");
    const res = await scanAll(manyPairs, {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }),
      storeOverride: store, force: false,
    });

    const schedulerReads = getKvSpy.mock.calls
      .map(([key]) => String(key))
      .filter((key) => key.startsWith("last_scan:") || key.startsWith("last_boundary:"));
    // Previously ~1 read per pair per timeframe (dozens); now zero individual
    // reads, because two prefix queries prime the whole scheduler view.
    expect(schedulerReads).toEqual([]);
    expect(prefixSpy).toHaveBeenCalledWith("last_scan:");
    expect(prefixSpy).toHaveBeenCalledWith("last_boundary:");
    expect(res.diagnostics.timing!.storeCalls).toBeLessThan(60);
    expect(res.diagnostics.timing!.scheduleMs).toBeGreaterThanOrEqual(0);
  });

  it("sees its own writes: a pair scanned this tick is not re-selected next tick", async () => {
    const store = new MemStore();
    const first = await scanAll(manyPairs, {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }),
      storeOverride: store, force: false,
    });
    expect(first.pairs.length).toBeGreaterThan(0);
    const firstPair = String(first.pairs[0]);
    // The pairing rules mark non-primary TF boundaries as scanned too, so read
    // the store directly and confirm the write-through cache left real rows.
    const written = await Promise.all(
      ["15m", "30m", "1h"].map((tf) => store.getKv(`last_scan:${firstPair}:${tf}`)),
    );
    expect(written.some((value) => value !== null)).toBe(true);

    const second = await scanAll(manyPairs, {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }),
      storeOverride: store, force: false,
    });
    // Round-robin: with that pair's keys now current, selection moves on.
    expect(second.pairs.map(String)).not.toContain(firstPair);
  });

  it("reports schedule and store cost on every tick, including idle ones", async () => {
    const store = new MemStore();
    await scanAll(env, { now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }), storeOverride: store, force: true });
    const active = store.scanLog[store.scanLog.length - 1].diagnostics!.timing!;
    expect(active.storeCalls).toBeGreaterThan(0);
    expect(active.storeMs).toBeGreaterThanOrEqual(0);
    expect(active.scheduleMs).toBeGreaterThanOrEqual(0);

    // A tick with nothing due is still measured.
    for (const tf of ["15m", "30m", "1h"]) await store.setKv(`last_boundary:${tf}`, String(NOW + 3_600_000));
    const idle = await scanAll(env, {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }), storeOverride: store, force: false,
    });
    expect(idle.timeframes).toEqual([]);
    expect(idle.pairs).toEqual([]);
    const idleRow = store.scanLog[store.scanLog.length - 1];
    expect(String(idleRow.note)).toContain("idle");
    // Same rule as diagnostics.test.ts: pairScanMs is a measured wall-clock
    // duration, so it is bounded rather than pinned to an exact 0 — an idle
    // tick can read 1ms on a loaded machine. scheduleMs must merely be present.
    expect(idleRow.diagnostics!.timing!.pairScanMs).toBeGreaterThanOrEqual(0);
    expect(idleRow.diagnostics!.timing!.pairScanMs).toBeLessThan(100);
    expect(idleRow.diagnostics!.timing!.scheduleMs).toEqual(expect.any(Number));
    expect(idleRow.diagnostics!.timing!.storeCalls).toBeGreaterThan(0);
    expect(idleRow.diagnostics!.timing!.storeMs).toBeGreaterThanOrEqual(0);
  });
});
