/** Deterministic coverage for Live Desk Mode (Functionality #11):
 *  the cursor-based /api/recent-events tape feed. Monotonic id cursor means
 *  no duplicates, no gaps, and ~1ms CPU per poll (Free-tier safe). */
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { makeStore } from "../src/store";
import type { EngineEvent } from "../src/types";

const T0 = Date.parse("2024-03-04T00:00:00.000Z");

function ev(setupId: string, state: string, pair = "EURUSD"): EngineEvent {
  return { setupId, pair, state, candleTime: T0, reason: `${state} reason`, price: 104.5 } as EngineEvent;
}

describe("live desk cursor feed", () => {
  it("MemStore eventsSince walks the monotonic id cursor ascending", async () => {
    const store = makeStore(undefined);
    await store.insertEvent(ev("s1", "MAP"));
    await store.insertEvent(ev("s1", "TOUCH"));
    await store.insertEvent(ev("s2", "SWEEP", "V75"));
    const all = await store.eventsSince(0, 10);
    expect(all.map((e) => Number(e.id))).toEqual([1, 2, 3]);
    const tail = await store.eventsSince(2, 10);
    expect(tail.map((e) => String(e.state))).toEqual(["SWEEP"]);
    expect(await store.eventsSince(3, 10)).toHaveLength(0);
    expect(await store.eventsSince(0, 2)).toHaveLength(2);
  });

  it("/api/recent-events pages by cursor with zero duplicates or gaps", async () => {
    const store = makeStore(undefined);
    const before = (await store.eventsSince(0, 500)).length;
    for (let i = 0; i < 5; i++) await store.insertEvent(ev(`ld${i}`, i === 4 ? "RETEST" : "SHIFT", i % 2 ? "V75" : "XAUUSD"));
    const env = {} as Env;

    const first = await worker.fetch(new Request("https://w.test/api/recent-events?since=0&limit=200"), env, {} as any);
    const d1 = (await first.json()) as any;
    expect(first.status).toBe(200);
    expect(d1.ok).toBe(true);
    expect(d1.items.length).toBeGreaterThanOrEqual(5);
    const ids = d1.items.map((i: any) => i.id);
    expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b)); // ascending
    expect(new Set(ids).size).toBe(ids.length); // no duplicates

    // second page starts exactly after the cursor → no overlap, no gap
    const second = await worker.fetch(new Request(`https://w.test/api/recent-events?since=${d1.cursor}&limit=200`), env, {} as any);
    const d2 = (await second.json()) as any;
    expect(d2.items).toHaveLength(0);
    expect(d2.cursor).toBe(d1.cursor);

    // a fresh event arrives → only the new row is delivered
    await store.insertEvent(ev("ld-fresh", "RETEST", "V75"));
    const third = await worker.fetch(new Request(`https://w.test/api/recent-events?since=${d1.cursor}&limit=200`), env, {} as any);
    const d3 = (await third.json()) as any;
    expect(d3.items).toHaveLength(1);
    expect(d3.items[0]).toMatchObject({ state: "RETEST", pair: "V75" });
    expect(typeof d3.items[0].createdUtc).toBe("string");
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it("validates cursor and limit params", async () => {
    const env = {} as Env;
    const badLimit = await worker.fetch(new Request("https://w.test/api/recent-events?since=0&limit=999"), env, {} as any);
    expect(badLimit.status).toBe(400);
    const badSince = await worker.fetch(new Request("https://w.test/api/recent-events?since=-5"), env, {} as any);
    expect(badSince.status).toBe(400);
  });
});
