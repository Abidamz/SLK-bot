import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeRecapStats, formatPerformanceRecap, formatEngineDisciplineDigest, sendPerformanceRecap } from "../src/notify";
import { checkAndDispatchScheduledRecaps } from "../src/index";
import { emptyScanDiagnostics } from "../src/diagnostics";
import { makeStore, MemStore } from "../src/store";
import type { EngineDisciplineTotals } from "../src/diagnostics";
import type { AlertRowish, NotifyEnv } from "../src/notify_types";
import type { Alert } from "../src/types";

describe("Performance Journal Recaps (Recommendation 1)", () => {
  const baseTime = Date.parse("2026-09-30T21:00:00.000Z");

  const sampleRows: AlertRowish[] = [
    // Institutional closed today
    {
      setup_id: "twelvedata:XAUUSD:30m:SHORT:V:1",
      canonical_symbol: "XAUUSD",
      entry_timeframe: "30m",
      direction: "SHORT",
      entry: 4300,
      status: "TP_HIT",
      alert_status: "SENT",
      exit_time: "2026-09-30T14:30:00.000Z",
      candle_close_time: "2026-09-30T12:00:00.000Z",
      r_multiple: 3.25,
    },
    {
      setup_id: "twelvedata:US30:15m:LONG:A:2",
      canonical_symbol: "US30",
      entry_timeframe: "15m",
      direction: "LONG",
      entry: 51500,
      status: "TP_HIT",
      alert_status: "SENT",
      exit_time: "2026-09-30T18:00:00.000Z",
      candle_close_time: "2026-09-30T17:00:00.000Z",
      r_multiple: 2.50,
    },
    // Institutional closed 3 days ago (in weekly window, not daily)
    {
      setup_id: "twelvedata:EURUSD:30m:SHORT:V:3",
      canonical_symbol: "EURUSD",
      entry_timeframe: "30m",
      direction: "SHORT",
      entry: 1.0850,
      status: "SL_HIT",
      alert_status: "SENT",
      exit_time: "2026-09-27T10:00:00.000Z",
      candle_close_time: "2026-09-27T08:00:00.000Z",
      r_multiple: -1.00,
    },
    // Synthetics closed today
    {
      setup_id: "deriv:V75:1h:LONG:A:4",
      canonical_symbol: "V75",
      entry_timeframe: "1h",
      direction: "LONG",
      entry: 45000,
      status: "TP_HIT",
      alert_status: "SENT",
      exit_time: "2026-09-30T19:00:00.000Z",
      candle_close_time: "2026-09-30T16:00:00.000Z",
      r_multiple: 2.80,
    },
    // Synthetics closed 2 days ago
    {
      setup_id: "deriv:V100:30m:SHORT:V:5",
      canonical_symbol: "V100",
      entry_timeframe: "30m",
      direction: "SHORT",
      entry: 1200,
      status: "SL_HIT",
      alert_status: "SENT",
      exit_time: "2026-09-28T04:00:00.000Z",
      candle_close_time: "2026-09-28T02:00:00.000Z",
      r_multiple: -1.00,
    },
  ];

  it("computes daily institutional stats strictly ignoring synthetics", () => {
    const stats = computeRecapStats(sampleRows, "institutional", "daily", baseTime);

    expect(stats.period).toBe("daily");
    expect(stats.segment).toBe("institutional");
    expect(stats.periodSetups).toBe(2);
    expect(stats.periodTp).toBe(2);
    expect(stats.periodSl).toBe(0);
    expect(stats.periodWinRate).toBe(100);
    expect(stats.periodNetR).toBe(5.75); // 3.25 + 2.50
    // All-time includes the EURUSD loss 3 days ago: 3 closed, 2 TP, 1 SL
    expect(stats.allTimeSetups).toBe(3);
    expect(stats.allTimeTp).toBe(2);
    expect(stats.allTimeSl).toBe(1);
    expect(stats.allTimeWinRate).toBeCloseTo(66.7, 1);
    expect(stats.allTimeNetR).toBe(4.75); // 3.25 + 2.50 - 1.00
  });

  it("computes weekly institutional stats over the rolling 7-day window", () => {
    const stats = computeRecapStats(sampleRows, "institutional", "weekly", baseTime);

    expect(stats.period).toBe("weekly");
    expect(stats.periodSetups).toBe(3);
    expect(stats.periodTp).toBe(2);
    expect(stats.periodSl).toBe(1);
    expect(stats.periodNetR).toBe(4.75);
  });

  it("computes daily synthetics stats strictly ignoring institutional pairs", () => {
    const stats = computeRecapStats(sampleRows, "synthetics", "daily", baseTime);

    expect(stats.period).toBe("daily");
    expect(stats.segment).toBe("synthetics");
    expect(stats.periodSetups).toBe(1);
    expect(stats.periodTp).toBe(1);
    expect(stats.periodSl).toBe(0);
    expect(stats.periodNetR).toBe(2.80);
    // All-time includes the V100 loss: 2 closed, 1 TP, 1 SL
    expect(stats.allTimeSetups).toBe(2);
    expect(stats.allTimeNetR).toBe(1.80);
  });

  it("formats high-conversion institutional recap card with proprietary SLK branding", () => {
    const stats = computeRecapStats(sampleRows, "institutional", "daily", baseTime);
    const card = formatPerformanceRecap(stats);

    expect(card).toContain("📊 [SLK RADAR] — DAILY PERFORMANCE RECAP");
    expect(card).toContain("Market: Institutional (Forex · Indices · Metals)");
    expect(card).toContain("• Setups Closed: 2");
    expect(card).toContain("• Outcomes: 2 TP Hit | 0 SL Hit");
    expect(card).toContain("• Net Return: +5.75R");
    expect(card).toContain("• Target Floor: 2.50R - 4.50R Asymmetric Expansion");
    expect(card).toContain("🔗 Track Record: https://slk-radar.pages.dev");
    expect(card).toContain("whop.com/slk-radar/slk-radar-vip-signals");
    expect(card).toContain("SLK Model · Structure · Liquidity · Key Levels");
    expect(card).not.toContain("ICT");
    expect(card).not.toContain("SMC");
  });

  it("formats zero-setup days gracefully highlighting risk discipline and capital preservation", () => {
    const stats = computeRecapStats([], "institutional", "daily", baseTime);
    const card = formatPerformanceRecap(stats);

    expect(card).toContain("• Setups Triggered: 0 (Strict Discipline)");
    expect(card).toContain("Capital preserved. Zero low-probability setups forced during non-expansion conditions.");
    expect(card).toContain("whop.com/slk-radar/slk-radar-vip-signals");
  });

  it("formats the exact weekly Engine Discipline digest", () => {
    const totals: EngineDisciplineTotals = {
      scans: 3, setupsEvaluated: 14, sweep: 10, shift: 8, retest: 4, confirmed: 0,
      rejectionCounts: {
        targetFloor: 5, belowMinRiskAtr: 2, aboveMaxStopAtr: 1,
        nonPositiveRisk: 0, invalid: 2, expired: 3,
      },
    };
    expect(formatEngineDisciplineDigest(totals)).toBe([
      "🧭 ENGINE DISCIPLINE — WEEKLY",
      "Setups evaluated: 14",
      "Chains: SWEEP 10 · SHIFT 8 · RETEST 4",
      "Confirmed: 0",
      "0 sent — none met our 2.5R minimum.",
      "Top rejection: 2.5R target floor (5)",
      "Research only — paper-mode observations; not audited performance or financial advice.",
      "SLK Model (Structure · Liquidity · Key Levels)",
    ].join("\n"));
  });

  it("dispatches weekly engine digest only to explicit FREE channels and dedupes it", async () => {
    const store = new MemStore();
    const diagnostics = emptyScanDiagnostics();
    diagnostics.replay.MAP = 14;
    diagnostics.replay.SWEEP = 10;
    diagnostics.replay.SHIFT = 8;
    diagnostics.replay.retestCandidates = 4;
    diagnostics.replay.targetRejects = 5;
    diagnostics.replay.riskRejects = 8;
    diagnostics.replay.riskRejectReasons.belowMinRiskAtr = 2;
    diagnostics.replay.riskRejectReasons.aboveMaxStopAtr = 1;
    diagnostics.replay.INVALID = 2;
    diagnostics.replay.EXPIRED = 3;
    const weeklyTime = Date.parse("2026-10-02T21:05:00.000Z");
    await store.insertScanLog({
      ts: new Date(weeklyTime - 3600_000).toISOString(), timeframes: "30m", pairs: "EURUSD",
      alerts: 0, events: 0, errors: "", durationMs: 10, note: "ok", diagnostics,
    });

    const sentMessages: { chatId: string; text: string }[] = [];
    const env = {
      TELEGRAM_BOT_TOKEN: "MOCK_TOKEN",
      TELEGRAM_CHAT_ID: "-100VIP-INSTITUTIONAL",
      TELEGRAM_DERIV_CHAT_ID: "-100VIP-SYNTHETICS",
      TELEGRAM_FREE_CHAT_ID: "-100FREE-INSTITUTIONAL",
      TELEGRAM_DERIV_FREE_CHAT_ID: "-100FREE-SYNTHETICS",
      fetchFn: async (_u: any, init: any) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        sentMessages.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
    const first = await checkAndDispatchScheduledRecaps(env, store, weeklyTime);
    expect(first.engineDigestSent).toBe(true);
    const digests = sentMessages.filter((message) => message.text.startsWith("🧭 ENGINE DISCIPLINE"));
    expect(digests).toHaveLength(2);
    expect(new Set(digests.map((message) => message.chatId))).toEqual(new Set([
      "-100FREE-INSTITUTIONAL", "-100FREE-SYNTHETICS",
    ]));
    expect(digests.every((message) => message.text === formatEngineDisciplineDigest({
      scans: 1, setupsEvaluated: 14, sweep: 10, shift: 8, retest: 4, confirmed: 0,
      rejectionCounts: {
        targetFloor: 5, belowMinRiskAtr: 2, aboveMaxStopAtr: 1,
        nonPositiveRisk: 0, invalid: 2, expired: 3,
      },
    }))).toBe(true);
    expect(sentMessages.some((message) => message.chatId.includes("VIP"))).toBe(false);

    const second = await checkAndDispatchScheduledRecaps(env, store, weeklyTime);
    expect(second.engineDigestSent).toBe(false);
    expect(sentMessages).toHaveLength(4); // two weekly recaps plus two digests, once each
  });

  it("honors ENGINE_DIGEST=false without affecting weekly recaps", async () => {
    const store = new MemStore();
    const diagnostics = emptyScanDiagnostics();
    diagnostics.replay.MAP = 1;
    await store.insertScanLog({
      ts: "2026-10-02T20:00:00.000Z", timeframes: "30m", pairs: "EURUSD",
      alerts: 0, events: 0, errors: "", durationMs: 10, note: "ok", diagnostics,
    });
    const messages: string[] = [];
    const env = {
      ENGINE_DIGEST: "false", TELEGRAM_BOT_TOKEN: "MOCK_TOKEN",
      TELEGRAM_FREE_CHAT_ID: "-100FREE", TELEGRAM_DERIV_FREE_CHAT_ID: "-100DERIV-FREE",
      fetchFn: async (_u: any, init: any) => {
        const body = JSON.parse(String(init?.body ?? "{}")); messages.push(body.text);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
    const result = await checkAndDispatchScheduledRecaps(env, store, Date.parse("2026-10-02T21:05:00.000Z"), { forceWeekly: true });
    expect(result.engineDigestSent).toBe(false);
    expect(messages.some((text) => text.startsWith("🧭 ENGINE DISCIPLINE"))).toBe(false);
    expect(messages).toHaveLength(2);
  });

  it("sendPerformanceRecap dispatches institutional recaps strictly to TELEGRAM_FREE_CHAT_ID", async () => {
    const sentMessages: { chatId: string; text: string }[] = [];
    const env: NotifyEnv = {
      TELEGRAM_BOT_TOKEN: "MOCK_TOKEN",
      TELEGRAM_FREE_CHAT_ID: "-100111222333",
      TELEGRAM_DERIV_FREE_CHAT_ID: "-100999888777",
      fetchFn: async (u, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        sentMessages.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };

    const res = await sendPerformanceRecap(env, sampleRows, "daily", "institutional", baseTime);
    expect(res.sent).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe("-100111222333");
    expect(sentMessages[0].text).toContain("Institutional (Forex · Indices · Metals)");
    expect(sentMessages[0].text).not.toContain("Continuous Synthetics");
  });

  it("sendPerformanceRecap dispatches synthetic recaps strictly to TELEGRAM_DERIV_FREE_CHAT_ID", async () => {
    const sentMessages: { chatId: string; text: string }[] = [];
    const env: NotifyEnv = {
      TELEGRAM_BOT_TOKEN: "MOCK_TOKEN",
      TELEGRAM_FREE_CHAT_ID: "-100111222333",
      TELEGRAM_DERIV_FREE_CHAT_ID: "-100999888777",
      fetchFn: async (u, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        sentMessages.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };

    const res = await sendPerformanceRecap(env, sampleRows, "daily", "synthetics", baseTime);
    expect(res.sent).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe("-100999888777");
    expect(sentMessages[0].text).toContain("Continuous Synthetics");
    expect(sentMessages[0].text).not.toContain("Forex · Indices · Metals");
  });

  it("checkAndDispatchScheduledRecaps handles daily 21:00 UTC schedule with deduplication via KV", async () => {
    const store = makeStore(undefined);
    // Insert a closed trade using Alert shape
    const alert = {
      setupId: "twelvedata:XAUUSD:30m:SHORT:V:test",
      pair: "XAUUSD",
      entryTf: "30m",
      mapTf: "4h",
      direction: "SHORT" as const,
      entry: 4300,
      stopLoss: 4310,
      tpInternal: 4275,
      tpExternal: null,
      environment: "bearish",
      phase: "expansion",
      htfAlignment: "M:↓ W:↔ D:↓ H4:↓",
      originKeyLevel: 4305,
      keyLevelType: "V",
      keyLevelBounds: [4300, 4310] as [number, number],
      keyLevelTested: true,
      keyLevelFlipped: false,
      imbalanceContext: [],
      internalLiquidity: [],
      externalLiquidity: [],
      drawOnLiquidity: null,
      nearestExternalTarget: null,
      intermediateZones: [],
      opposingLiquidityStanding: true,
      sweepTime: baseTime - 7200000,
      bosTime: baseTime - 7200000,
      returnTime: baseTime - 7200000,
      invalidationLevel: 4315,
      invalidationReason: null,
      parameterVersion: "slk-v1",
      alertStatus: "SENT",
      suppressReason: null,
      session: null,
      atrEntry: 15,
      rrInternal: 2.5,
      cycleStage: "entry_alert" as const,
      entryMode: "confirmation" as const,
      candleCloseTime: baseTime - 7200000,
    };
    await store.insertAlert(alert as Alert, "twelvedata");
    await store.recordOutcome(alert.setupId, {
      status: "TP_HIT",
      exitPrice: 4275,
      exitTime: baseTime - 3600000,
      rMultiple: 2.50,
    });

    const sentMessages: { chatId: string; text: string }[] = [];
    const env = {
      TELEGRAM_BOT_TOKEN: "MOCK_TOKEN",
      TELEGRAM_FREE_CHAT_ID: "-100111222333",
      TELEGRAM_DERIV_FREE_CHAT_ID: "-100999888777",
      fetchFn: async (_u: any, init: any) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        sentMessages.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };

    // 1st run at 21:00 UTC: should dispatch both institutional and synthetics
    const res1 = await checkAndDispatchScheduledRecaps(env, store, baseTime);
    expect(res1.dailyInstitutionalSent).toBe(true);
    expect(res1.dailySyntheticsSent).toBe(true);
    expect(sentMessages).toHaveLength(2);

    // 2nd run at 21:00 UTC (same day): deduplication skips sending
    const res2 = await checkAndDispatchScheduledRecaps(env, store, baseTime);
    expect(res2.dailyInstitutionalSent).toBe(false);
    expect(res2.dailySyntheticsSent).toBe(false);
    expect(sentMessages).toHaveLength(2); // no new message sent

    // Forced run overrides deduplication
    const res3 = await checkAndDispatchScheduledRecaps(env, store, baseTime, { forceDaily: true });
    expect(res3.dailyInstitutionalSent).toBe(true);
    expect(sentMessages).toHaveLength(4);
  });
});
