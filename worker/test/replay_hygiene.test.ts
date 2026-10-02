/**
 * Replay hygiene (Task 2): stale replayed transitions (candle closed >3 days
 * ago) are skipped at slk_events INSERT time — a pure write reduction —
 * EXCEPT for setups with an active (OPEN) alert row, whose evidence trail
 * must stay complete. The freshness GATES (alertEventFresh / watchEventFresh)
 * and all entry/alert behavior are untouched, proven A/B at scan level:
 * filter on (default) vs filter off (eventReplayMaxAgeMs: 0) produce
 * byte-identical alerts, events, and delivery.
 */
import { describe, expect, it } from "vitest";
import {
  scanAll, shouldRecordReplayEvent, isReplayEventStale,
  EVENT_REPLAY_MAX_AGE_MS, type Env,
} from "../src/index";
import { MemStore } from "../src/store";
import type { Alert } from "../src/types";
import { T0, makeFakeFetch, type RecordedCalls } from "./fixtures";

const DAY = 86400_000;
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
    MIN_RISK_ATR: "0.1",
    ...overrides,
  } as Env;
}

function alertRows(store: MemStore): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of store.alerts) out[k] = { ...v };
  return out;
}

function eventSig(store: MemStore): string[] {
  // ignore id / created_utc (wall-clock, run-specific)
  return [...store.events]
    .sort((a, b) => String(a.setup_id).localeCompare(String(b.setup_id)) || String(a.state).localeCompare(String(b.state)) || String(a.candle_time).localeCompare(String(b.candle_time)))
    .map((e) => `${e.setup_id}|${e.state}|${e.candle_time}|${e.reason}|${e.price}`);
}

function makeAlert(setupId: string): Alert {
  const t = Date.parse("2026-03-02T10:30:00.000Z");
  return {
    setupId, pair: "EURUSD", entryTf: "30m", mapTf: "1H", direction: "SHORT",
    entry: 104.2, stopLoss: 104.29, tpInternal: 104.02, tpExternal: 97.42,
    candleCloseTime: t, environment: "PAPER", phase: "RETEST",
    htfAlignment: "aligned", originKeyLevel: 104.2, keyLevelType: "V",
    keyLevelBounds: [104.19, 104.21], keyLevelTested: true, keyLevelFlipped: false,
    imbalanceContext: [], internalLiquidity: [], externalLiquidity: [],
    drawOnLiquidity: 97.42, nearestExternalTarget: 97.42, intermediateZones: [],
    opposingLiquidityStanding: false, sweepTime: t, bosTime: t, returnTime: t,
    invalidationLevel: 104.29, invalidationReason: null, parameterVersion: "v1",
    alertStatus: "PAPER", suppressReason: null, session: "London",
    atrEntry: 0.05, rrInternal: 2.5, cycleStage: "RETEST", entryMode: "confirmation",
  };
}

describe("replay hygiene — write reduction", () => {
  it("default horizon is 3 days", () => {
    expect(EVENT_REPLAY_MAX_AGE_MS).toBe(3 * DAY);
  });

  it("isReplayEventStale: strict 3-day boundary, 0 disables the filter", () => {
    const now = T0 + 8 * 3600_000;
    // fresh — never stale
    expect(isReplayEventStale({ candleTime: now - 3600_000 }, now, EVENT_REPLAY_MAX_AGE_MS)).toBe(false);
    // exactly at the horizon — not stale (strict >)
    expect(isReplayEventStale({ candleTime: now - EVENT_REPLAY_MAX_AGE_MS }, now, EVENT_REPLAY_MAX_AGE_MS)).toBe(false);
    // 1ms past the horizon — stale
    expect(isReplayEventStale({ candleTime: now - EVENT_REPLAY_MAX_AGE_MS - 1 }, now, EVENT_REPLAY_MAX_AGE_MS)).toBe(true);
    // 0 disables the horizon entirely
    expect(isReplayEventStale({ candleTime: now - 40 * DAY }, now, 0)).toBe(false);
  });

  it("shouldRecordReplayEvent: stale skipped unless the setup has an active alert", async () => {
    const now = T0 + 8 * 3600_000;
    const stale = { setupId: "EURUSD:30m:SHORT:V:104.200000:2026-03-02T10:30:00.000Z", candleTime: now - 4 * DAY };

    const empty = new MemStore();
    expect(await shouldRecordReplayEvent(empty, stale, now, EVENT_REPLAY_MAX_AGE_MS)).toBe(false);

    const open = new MemStore();
    expect(await open.insertAlert(makeAlert(stale.setupId), "oanda")).toBe(true);
    // OPEN row → trail stays complete
    expect(await shouldRecordReplayEvent(open, stale, now, EVENT_REPLAY_MAX_AGE_MS)).toBe(true);

    const closed = new MemStore();
    expect(await closed.insertAlert(makeAlert(stale.setupId), "oanda")).toBe(true);
    await closed.recordOutcome(stale.setupId, {
      status: "TP_HIT", exitPrice: 104.02,
      exitTime: stale.candleTime + 3600_000, rMultiple: 2.5,
    });
    // resolved trade → no longer "active" → stale replay skipped
    expect(await shouldRecordReplayEvent(closed, stale, now, EVENT_REPLAY_MAX_AGE_MS)).toBe(false);

    // fresh events are always recorded, regardless of alert state
    const fresh = { ...stale, candleTime: now - 3600_000 };
    expect(await shouldRecordReplayEvent(empty, fresh, now, EVENT_REPLAY_MAX_AGE_MS)).toBe(true);
    // horizon disabled (0) → always recorded
    expect(await shouldRecordReplayEvent(empty, stale, now, 0)).toBe(true);
  });

  it("A/B at scan level: filter on (default) vs off → identical entry/alert/event behavior", async () => {
    const storeA = new MemStore(); // default 3-day horizon
    const summaryA = await scanAll(makeEnv(), {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }), force: true, storeOverride: storeA,
    });

    const storeB = new MemStore(); // filter disabled
    const summaryB = await scanAll(makeEnv(), {
      now: NOW, fetchFn: makeFakeFetch({ telegram: [], discord: [] }), force: true,
      storeOverride: storeB, eventReplayMaxAgeMs: 0,
    });

    // identical pipeline outcomes
    expect(summaryA.ok).toBe(true);
    expect(summaryB.ok).toBe(true);
    expect(summaryA.alerts).toBe(summaryB.alerts);
    expect(summaryA.events).toBe(summaryB.events);
    expect(summaryA.alerts).toBe(1); // the storyline alert is delivered in both arms
    expect(summaryA.errors).toEqual(summaryB.errors);

    // identical alert rows (every field)
    expect(alertRows(storeA)).toEqual(alertRows(storeB));
    // identical event trails
    expect(eventSig(storeA)).toEqual(eventSig(storeB));
    expect(eventSig(storeA).length).toBeGreaterThan(0);
  });
});
