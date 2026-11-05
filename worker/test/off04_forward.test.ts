import { describe, expect, it } from "vitest";
import {
  advanceOff04ForwardState,
  buildOff04ForwardCapture,
  createOff04ForwardBaseline,
  formatOff04ForwardTelegram,
  latestOff04SwingStop,
  OFF04_FORWARD_PAIRS,
  resampleOff04H1ToH4,
  resolveOff04ForwardTrade,
  runOff04ForwardTest,
} from "../src/off04_forward";
import { MemStore } from "../src/store";
import type { Candle } from "../src/types";

const H1 = 60 * 60_000;
const M15 = 15 * 60_000;
const utc = (hour: number, minute = 0) => Date.UTC(2026, 0, 15, hour, minute);

function candle(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c };
}

function hourlyBucket(startHour: number, values: { o: number; h: number; l: number; c: number }): Candle[] {
  return Array.from({ length: 4 }, (_, offset) => candle(
    utc(startHour + offset), values.o, values.h, values.l, values.c,
  ));
}

describe("OFF-04 alert-only forward path", () => {
  it("uses only the approved seven-symbol universe", () => {
    expect(OFF04_FORWARD_PAIRS).toEqual([
      "JAPAN225", "NAS100", "EURUSD", "XAUUSD", "NETHERLANDS25", "AUDJPY", "AUDUSD",
    ]);
  });

  it("aggregates only complete UTC-aligned H1 buckets", () => {
    const h1 = [
      ...hourlyBucket(0, { o: 9.5, h: 10, l: 9, c: 9.8 }),
      ...hourlyBucket(4, { o: 9.8, h: 10.5, l: 9.2, c: 10 }),
      candle(utc(8), 10, 12, 11, 11.5),
      candle(utc(9), 11.5, 12, 11.1, 11.7),
      candle(utc(10), 11.7, 12.2, 11, 12),
    ];
    const h4 = resampleOff04H1ToH4(h1);
    expect(h4).toHaveLength(2);
    expect(h4[0]).toEqual({ t: utc(0), o: 9.5, h: 10, l: 9, c: 9.8 });
    expect(h4[1]).toEqual({ t: utc(4), o: 9.8, h: 10.5, l: 9.2, c: 10 });
  });

  it("emits the all-session post-formation M15 retest and R03 next-open/swing-stop reference", () => {
    const h1History = [
      ...hourlyBucket(0, { o: 9.5, h: 10, l: 9, c: 9.8 }),
      ...hourlyBucket(4, { o: 9.8, h: 10.5, l: 9.2, c: 10 }),
    ];
    const m15History: Candle[] = [];
    for (let t = utc(0); t < utc(8); t += M15) {
      m15History.push(candle(t, 12, 12.2, 11.5, 12));
    }
    const state = createOff04ForwardBaseline({ h1: h1History, m15: m15History, now: utc(8) });

    const h1New = hourlyBucket(8, { o: 11.5, h: 12, l: 11, c: 11.8 });
    const m15New: Candle[] = [];
    for (let t = utc(8); t < utc(12); t += M15) {
      m15New.push(candle(t, 12, 12.2, 11.5, 12));
    }
    m15New.push(
      candle(utc(12), 10.8, 11.2, 10.6, 10.9),  // First H4-zone touch; available 12:15.
      candle(utc(12, 15), 11.0, 11.4, 10.8, 11.2),
      candle(utc(12, 30), 11.2, 11.6, 10.3, 11.5), // Unique 2-left/2-right swing low.
      candle(utc(12, 45), 11.8, 12.0, 11.7, 11.9), // Bullish M15 FVG available 13:00.
      candle(utc(13), 11.8, 11.8, 11.5, 11.7),    // First post-formation retest; closes 13:15.
    );

    const advanced = advanceOff04ForwardState({
      state,
      pair: "EURUSD",
      newH1: h1New,
      newM15: m15New,
    });
    expect(advanced.signals).toHaveLength(1);
    const signal = advanced.signals[0];
    expect(signal.direction).toBe("LONG");
    expect(signal.h4FvgAvailableAt).toBe(utc(12));
    expect(signal.h4FirstTouchAvailableAt).toBe(utc(12, 15));
    expect(signal.m15FvgAvailableAt).toBe(utc(13));
    expect(signal.triggerAvailableAt).toBe(utc(13, 15));

    const entryBar = candle(utc(13, 15), 12.3, 12.35, 12.25, 12.3);
    const capture = buildOff04ForwardCapture({
      signal,
      entryBar,
      pivots: advanced.state.pivots,
      now: utc(13, 15) + 30_000,
    });
    expect(capture).not.toBeNull();
    expect(capture).toMatchObject({
      pair: "EURUSD",
      direction: "LONG",
      entry: 12.3,
      stopLoss: 10.3,
      risk: 2,
      target: 18.3,
      entryTime: utc(13, 15),
    });
    expect(formatOff04ForwardTelegram(capture!)).toContain("PAPER / NO ORDER");
    expect(formatOff04ForwardTelegram(capture!)).toContain("post-formation M15-zone retest");
    expect(formatOff04ForwardTelegram(capture!)).toContain("No order was placed");
  });

  it("selects the latest eligible confirmed swing and rejects an unavailable or invalid stop", () => {
    const pivots = [
      { kind: "low" as const, price: 90, confirmedAt: 1_000 },
      { kind: "low" as const, price: 95, confirmedAt: 2_000 },
      { kind: "low" as const, price: 99, confirmedAt: 4_000 },
    ];
    expect(latestOff04SwingStop(pivots, "LONG", 100, 3_000)).toBe(95);
    expect(latestOff04SwingStop(pivots, "LONG", 94, 3_000)).toBe(90);
    expect(latestOff04SwingStop(pivots, "SHORT", 100, 3_000)).toBeNull();
  });

  it("resolves stop-first same-bar ambiguity and adverse stop gaps conservatively", () => {
    const baseRow = {
      setup_id: "OFF04:test",
      variant: "baseline_all_signals" as const,
      trigger_policy: "post_formation_m15_zone_retest" as const,
      canonical_symbol: "EURUSD",
      entry_timeframe: "15m" as const,
      direction: "LONG" as const,
      hypothetical_entry: 100,
      hypothetical_stop_loss: 90,
      hypothetical_target: 130,
      initial_risk: 10,
      target_r: 3 as const,
      h4_fvg_available_at_ms: 1,
      h4_first_touch_available_at_ms: 2,
      m15_fvg_available_at_ms: 3,
      trigger_available_at_ms: 4,
      entry_time_ms: utc(13),
      created_utc: new Date(0).toISOString(),
      status: "OPEN" as const,
      exit_time_ms: null,
      exit_price: null,
      r_multiple: null,
      telegram_status: "SENT" as const,
      telegram_sent_utc: null,
      delivery_error: null,
    };
    const ambiguous = resolveOff04ForwardTrade(baseRow, [
      candle(baseRow.entry_time_ms, 100, 135, 85, 120),
    ]);
    expect(ambiguous).toMatchObject({ status: "SL_HIT", exitPrice: 90, rMultiple: -1 });

    const stopGap = resolveOff04ForwardTrade(baseRow, [
      candle(baseRow.entry_time_ms, 88, 101, 87, 96),
    ]);
    expect(stopGap).toMatchObject({ status: "SL_HIT", exitPrice: 88, rMultiple: -1.2 });

    const targetGap = resolveOff04ForwardTrade(baseRow, [
      candle(baseRow.entry_time_ms, 135, 138, 132, 136),
    ]);
    expect(targetGap).toMatchObject({ status: "TP_HIT", exitPrice: 130, rMultiple: 3 });
  });

  it("defaults off and refuses to target any configured subscriber or private channel", async () => {
    let requests = 0;
    const fetchFn = (async () => {
      requests++;
      return new Response(JSON.stringify({ ok: true, candles: [] }), { status: 200 });
    }) as typeof fetch;
    const db = {} as never;
    const store = new MemStore();
    const disabled = await runOff04ForwardTest({
      env: { DB: db, TELEGRAM_BOT_TOKEN: "test-token", OFF04_FORWARD_TEST_CHAT_ID: "-100999", OFF04_FORWARD_ENABLED: "false" },
      now: utc(13, 15) + 30_000,
      fetchFn,
      storeOverride: store,
    });
    expect(disabled.state).toBe("disabled");

    const collision = await runOff04ForwardTest({
      env: {
        DB: db,
        TELEGRAM_BOT_TOKEN: "test-token",
        OFF04_FORWARD_TEST_CHAT_ID: "-100123",
        TELEGRAM_CHAT_ID: "-100123",
        OFF04_FORWARD_ENABLED: "true",
      },
      now: utc(13, 15) + 30_000,
      fetchFn,
      storeOverride: store,
    });
    expect(collision.state).toBe("missing_configuration");
    const kvCollisionStore = new MemStore();
    await kvCollisionStore.setKv("telegram_free_chat_id", "-100777888");
    const kvCollision = await runOff04ForwardTest({
      env: {
        DB: db,
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_CHAT_ID: "-100123456",
        OFF04_FORWARD_TEST_CHAT_ID: "-100777888",
        OFF04_FORWARD_ENABLED: "true",
      },
      now: utc(13, 15) + 30_000,
      fetchFn,
      storeOverride: kvCollisionStore,
    });
    expect(kvCollision.state).toBe("missing_configuration");
    const unresolvedAlias = await runOff04ForwardTest({
      env: {
        DB: db,
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_CHAT_ID: "@existing-subscriber-channel",
        OFF04_FORWARD_TEST_CHAT_ID: "-100999321",
        OFF04_FORWARD_ENABLED: "true",
      },
      now: utc(13, 15) + 30_000,
      fetchFn,
      storeOverride: new MemStore(),
    });
    expect(unresolvedAlias.state).toBe("missing_configuration");
    expect(requests).toBe(0);
  });

  it("sends one fresh paper signal only to the dedicated channel and keeps it out of production alerts", async () => {
    const store = new MemStore();
    const h1Seed = [
      ...hourlyBucket(0, { o: 9.5, h: 10, l: 9, c: 9.8 }),
      ...hourlyBucket(4, { o: 9.8, h: 10.5, l: 9.2, c: 10 }),
    ];
    const m15Seed: Candle[] = [];
    for (let t = utc(0); t < utc(8); t += M15) m15Seed.push(candle(t, 12, 12.2, 11.5, 12));
    const h1EurNew = hourlyBucket(8, { o: 11.5, h: 12, l: 11, c: 11.8 });
    const h1OtherNew = hourlyBucket(8, { o: 10, h: 10.5, l: 9.2, c: 10 });
    const m15New: Candle[] = [];
    for (let t = utc(8); t < utc(12); t += M15) m15New.push(candle(t, 12, 12.2, 11.5, 12));
    m15New.push(
      candle(utc(12), 10.8, 11.2, 10.6, 10.9),
      candle(utc(12, 15), 11.0, 11.4, 10.8, 11.2),
      candle(utc(12, 30), 11.2, 11.6, 10.3, 11.5),
      candle(utc(12, 45), 11.8, 12.0, 11.7, 11.9),
      candle(utc(13), 11.8, 11.8, 11.5, 11.7),
    );
    const entryBar = candle(utc(13, 15), 12.3, 12.35, 12.25, 12.3);
    let phase: "seed" | "advance" = "seed";
    const telegramBodies: Record<string, unknown>[] = [];
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      urls.push(url.toString());
      if (url.hostname === "api.telegram.org") {
        telegramBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
      }
      const isEurUsd = url.pathname.includes("EUR_USD");
      const isH1 = url.searchParams.get("granularity") === "H1";
      const duration = isH1 ? H1 : M15;
      let bars = isH1 ? h1Seed : m15Seed;
      if (phase === "advance") {
        if (isH1) bars = [...h1Seed, ...(isEurUsd ? h1EurNew : h1OtherNew)];
        else bars = [...m15Seed, ...m15New, ...(isEurUsd ? [entryBar] : [])];
      }
      return new Response(JSON.stringify({
        candles: bars.map((bar) => ({
          complete: bar.t + duration <= (phase === "seed" ? utc(8) : utc(13, 15) + 30_000),
          time: new Date(bar.t).toISOString(),
          mid: { o: String(bar.o), h: String(bar.h), l: String(bar.l), c: String(bar.c) },
        })),
      }), { status: 200 });
    }) as typeof fetch;
    const env = {
      DB: {} as never,
      OANDA_API_TOKEN: "oanda-test-token",
      TELEGRAM_BOT_TOKEN: "telegram-test-token",
      TELEGRAM_CHAT_ID: "-100123456",
      OFF04_FORWARD_TEST_CHAT_ID: "-100999123",
      OFF04_FORWARD_ENABLED: "true",
    };

    const seeded = await runOff04ForwardTest({ env, now: utc(8), fetchFn, storeOverride: store });
    expect(seeded.seeded).toBe(7);
    expect(seeded.signalsInserted).toBe(0);
    expect(telegramBodies).toHaveLength(0);

    phase = "advance";
    const delivered = await runOff04ForwardTest({
      env, now: utc(13, 15) + 30_000, fetchFn, storeOverride: store,
    });
    expect(delivered.signalsInserted).toBe(1);
    expect(delivered.telegramSent).toBe(1);
    expect(telegramBodies).toHaveLength(1);
    expect(telegramBodies[0].chat_id).toBe("-100999123");
    expect(String(telegramBodies[0].text)).toContain("PAPER / NO ORDER");
    expect(store.alerts.size).toBe(0);
    expect(store.events).toHaveLength(0);
    const ledger = await store.getOff04ForwardLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      canonical_symbol: "EURUSD",
      variant: "baseline_all_signals",
      trigger_policy: "post_formation_m15_zone_retest",
      hypothetical_entry: 12.3,
      hypothetical_stop_loss: 10.3,
      hypothetical_target: 18.3,
      telegram_status: "SENT",
    });
    expect(urls.every((url) => url.includes("/candles?") || url.includes("api.telegram.org"))).toBe(true);
  });

  it("keeps the OFF-04 ledger independent and idempotent in the memory store", async () => {
    const store = new MemStore();
    const row = {
      setupId: "OFF04:baseline_all_signals:post_formation_m15_zone_retest:EURUSD:1:2:LONG",
      pair: "EURUSD",
      direction: "LONG" as const,
      entry: 100,
      stopLoss: 90,
      target: 130,
      risk: 10,
      h4FvgAvailableAt: 10,
      h4FirstTouchAvailableAt: 20,
      m15FvgAvailableAt: 30,
      triggerAvailableAt: 40,
      entryTime: 40,
    };
    expect(await store.insertOff04ForwardTrade(row)).toBe(true);
    expect(await store.insertOff04ForwardTrade(row)).toBe(false);
    expect((await store.getOff04ForwardLedger()).map((trade) => trade.setup_id)).toEqual([row.setupId]);
    expect(await store.openAlerts()).toHaveLength(0);
    expect((await store.getOff04ForwardLedger())[0].telegram_status).toBe("PENDING");
  });
});
