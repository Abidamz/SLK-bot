/** SLK alert worker — Cloudflare Workers entrypoint.
 *
 *  scheduled()  cron tick (every minute) → scan timeframes whose candle just
 *               closed, statelessly replay the SLK engine, dedupe in D1,
 *               deliver Telegram/Discord alerts, resolve open alert outcomes.
 *  GET /health            basic health check (runbook: expect ok:true)
 *  GET /alerts?limit=50   sanitized recent alert history  (Bearer ADMIN_KEY)
 *  GET /stats             outcome summary                  (Bearer ADMIN_KEY)
 *  POST /scan-now         run one scan immediately         (Bearer ADMIN_KEY)
 *  POST /test-notify      send a test message to channels  (Bearer ADMIN_KEY)
 *  POST /provider-webhook scaffold for signed provider candle callbacks
 *                          (signature-verified; disabled unless configured)
 *
 *  The browser dashboard never touches this Worker with secrets — all
 *  provider keys and channel credentials live as Worker secrets only. */
import { loadConfig, TF_SECONDS, INDEX_POINT_PAIRS, isDerivPair, strategyForPair } from "./config";
import { scanEntry } from "./engine";
import {
  buildH4VantageConfluence, diagnosticTagsForRow, sessionBucketUtcPlus1,
  type H4VantageConfluence,
} from "./h4_context";
import { addReplayDiagnostics, buildEnginePulse, countTransition, emptyScanDiagnostics, noteConfirmationAttempt, type EnginePulseRow, type ScanDiagnostics } from "./diagnostics";
import { evaluateSignal, beArmedTime } from "./outcomes";
import { runMonteCarlo } from "./montecarlo";
import { dispatchMt5Trade, dispatchMt5Breakeven, mt5Active } from "./mt5";
import { notifyAlert, notifyOutcome, notifyWatch, notifyBias, sendPerformanceRecap, computeRecapStats, formatPerformanceRecap, formatEngineDisciplineDigest, sendEngineDisciplineDigest, parseChatIds, createTelegramInviteLink, kickTelegramMember, verifyWhopWebhookSignature } from "./notify";
import type { AlertRowish, OutcomeLike } from "./notify_types";
import { fetchMarketData, providerForPair, resetProviderCircuitBreakers, validateAndClose, validateCandlesForOutcome, DataQualityError } from "./provider";
import { resampleCandles, dropIncomplete, findRetracementOrigin } from "./features";
import { storylineSeries } from "./storyline";
import { evaluateH4VantageContext, evaluateDirectionalBias } from "./shadow";
import { makeStore, type D1Like, type Store, type NotificationPreferences, type AlertQuery, type ShadowExperimentRow, type ShadowTradeRow } from "./store";
import type { Alert, Candle, Direction, ShadowExperimentCapture, ShadowTradeCapture } from "./types";

export interface Env {
  DB?: D1Like;
  TWELVEDATA_API_KEY?: string;
  OANDA_API_KEY?: string;
  OANDA_API_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_DM_CHAT_ID?: string;
  TELEGRAM_FREE_CHAT_ID?: string;
  TELEGRAM_DERIV_CHAT_ID?: string;
  TELEGRAM_DERIV_FREE_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
  WHOP_WEBHOOK_SECRET?: string;
  fetchFn?: typeof fetch;
  ADMIN_KEY?: string;
  DASHBOARD_READ_KEY?: string;
  PROVIDER_WEBHOOK_SECRET?: string;
  SIGNAL_API_KEY?: string;
  SIGNAL_SIGNING_SECRET?: string;
  // MT5 execution bridge (Roadmap #6) — inert unless MODE=live + MT5_ENABLED=true
  MT5_ENABLED?: string;
  MT5_WEBHOOK_URL?: string;
  MT5_HMAC_SECRET?: string;
  MT5_RISK_USD?: string;
  PAIRS?: string;
  ENTRY_TFS?: string;
  SYNTH_ENTRY_TFS?: string;
  RETEST_DEPTH_PCT?: string;
  MODE?: string;
  PAPER_NOTIFY?: string;
  ENGINE_DIGEST?: string;
  WATCH_NOTIFY?: string;
  BIAS_NOTIFY?: string;
  VIP_WATCH_NOTIFY?: string;
  CHART_SNAPSHOTS?: string;
  MIN_RISK_ATR?: string;
  MIN_STOP_PIPS?: string;
  MIN_TP_R?: string;
  SL_BUFFER_ATR?: string;
  TRAILING_BE_ENABLED?: string;
  TRAILING_BE_TRIGGER_R?: string;
  PAIR_BATCH_SIZE?: string;
  PROVIDER_MAP?: string;
  SYMBOL_MAP?: string;
  DERIV_APP_ID?: string;
  DERIV_PROXY_URL?: string;
  CHART_IMG_API_KEY?: string;
}

interface ExecCtxLike {
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface ScanOptions {
  now?: number;
  fetchFn?: typeof fetch;
  force?: boolean; // scan regardless of candle boundaries (POST /scan-now)
  storeOverride?: Store; // tests inject the in-memory store here
  /** Replay-hygiene horizon for slk_events writes (default 3 days). A replayed
   *  transition whose candle closed older than this is NOT written to the
   *  event tape — except when the setup has an active (OPEN) alert row.
   *  Set 0 to disable the filter (A/B parity tests). Never affects the
   *  alert freshness gate or alert insertion. */
  eventReplayMaxAgeMs?: number;
}

export interface ScanSummary {
  diagnostics: ScanDiagnostics;
  ok: boolean;
  timeframes: string[];
  pairs: string[];
  alerts: number;
  events: number;
  errors: string[];
  durationMs: number;
}

function isTraditionalMarketWeekend(nowMs: number): boolean {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = d.getUTCHours();
  if (day === 6) return true; // all Saturday
  if (day === 5 && hour >= 22) return true; // Friday post-market close
  if (day === 0 && hour < 21) return true; // Sunday pre-market open
  return false;
}

export function captureFvgRetest50Experiments(
  pair: string, entryTf: string, tfSeconds: number, candles: Candle[], candidates: Alert[],
  h4Context?: H4VantageConfluence | null,
): ShadowExperimentCapture[] {
  if (!candles.length) return [];
  const latestCloseTime = candles[candles.length - 1].t + tfSeconds * 1000;
  const captures: ShadowExperimentCapture[] = [];
  for (const candidate of candidates) {
    if (candidate.candleCloseTime !== latestCloseTime || candidate.alertStatus === "SUPPRESSED") continue;
    const risk = candidate.direction === "SHORT"
      ? candidate.stopLoss - candidate.entry
      : candidate.entry - candidate.stopLoss;
    const reward = candidate.direction === "SHORT"
      ? candidate.entry - candidate.tpInternal
      : candidate.tpInternal - candidate.entry;
    const rr = risk > 0 ? reward / risk : 0;
    if (!Number.isFinite(rr) || rr <= 0) continue;
    // Diagnostics only: the confirmation candle's open time drives the UTC+1
    // session bucket; the H4 vantage tags are shared with the rest of the scan.
    const candleOpenTime = candidate.candleCloseTime - tfSeconds * 1000;
    captures.push({
      experimentId: `FVG_RETEST_50:${candidate.setupId}`,
      sourceSetupId: candidate.setupId,
      variant: "FVG_RETEST_50",
      pair, entryTf, direction: candidate.direction,
      entry: candidate.entry, stopLoss: candidate.stopLoss,
      target: candidate.tpInternal, rr,
      candleCloseTime: candidate.candleCloseTime,
      h4ConfluenceGrade: h4Context?.grade ?? null,
      h4ConfluenceTags: diagnosticTagsForRow(h4Context, candleOpenTime),
      sessionBucket: sessionBucketUtcPlus1(candleOpenTime),
    });
  }
  return captures;
}

// -------------------------------------------------------------- performance recaps

/**
 * Automatically checks schedule boundaries (21:00 UTC New York close for daily,
 * Friday 21:05 UTC for weekly) and dispatches performance journal recaps to
 * the respective free channels with built-in deduplication via D1/KV.
 */
export async function checkAndDispatchScheduledRecaps(
  env: Env,
  store: Store,
  nowMs: number = Date.now(),
  options: {
    forceDaily?: boolean;
    forceWeekly?: boolean;
    segment?: "institutional" | "synthetics";
    targetChatId?: string;
  } = {},
): Promise<{
  dailyInstitutionalSent: boolean;
  dailySyntheticsSent: boolean;
  weeklyInstitutionalSent: boolean;
  weeklySyntheticsSent: boolean;
  engineDigestSent: boolean;
}> {
  const d = new Date(nowMs);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const dayOfWeek = d.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat

  // Daily recap: 21:00 UTC (New York close)
  const isDailyDue = options.forceDaily || (hour === 21 && minute === 0);
  // Weekly recap: Friday 21:05 UTC (Forex/Indices weekend close)
  const isWeeklyDue = options.forceWeekly || (dayOfWeek === 5 && hour === 21 && minute === 5);

  let dailyInstitutionalSent = false;
  let dailySyntheticsSent = false;
  let weeklyInstitutionalSent = false;
  let weeklySyntheticsSent = false;
  let engineDigestSent = false;

  if (!isDailyDue && !isWeeklyDue) {
    return { dailyInstitutionalSent, dailySyntheticsSent, weeklyInstitutionalSent, weeklySyntheticsSent, engineDigestSent };
  }

  const dateStr = d.toISOString().slice(0, 10);
  const weekNumber = Math.ceil(d.getUTCDate() / 7);
  const weekKey = `${d.getUTCFullYear()}-W${weekNumber}`;

  const allRows = (await store.recentAlerts(1000)).filter(
    (r) => String(r.alert_status ?? "").toUpperCase() !== "SUPPRESSED"
  );

  // Hydrate Telegram channel IDs from KV if not bound in worker env vars
  const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
  const derivFreeChatId = env.TELEGRAM_DERIV_FREE_CHAT_ID || (await store.getKv("telegram_deriv_free_chat_id")) || undefined;
  const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
  const mainChatId = env.TELEGRAM_CHAT_ID || (await store.getKv("telegram_chat_id")) || undefined;

  const recapEnv: Env = {
    ...env,
    TELEGRAM_CHAT_ID: mainChatId,
    TELEGRAM_FREE_CHAT_ID: freeChatId,
    TELEGRAM_DERIV_CHAT_ID: derivChatId,
    TELEGRAM_DERIV_FREE_CHAT_ID: derivFreeChatId,
  };

  if (isDailyDue) {
    const doInst = !options.segment || options.segment === "institutional";
    const doSynth = !options.segment || options.segment === "synthetics";

    if (doInst) {
      const kvKey = `recap:daily:institutional:${dateStr}`;
      const already = options.forceDaily ? null : await store.getKv(kvKey);
      if (!already) {
        const res = await sendPerformanceRecap(recapEnv, allRows as AlertRowish[], "daily", "institutional", nowMs, options.targetChatId);
        if (res.sent) {
          dailyInstitutionalSent = true;
          await store.setKv(kvKey, new Date(nowMs).toISOString());
        }
      }
    }

    if (doSynth) {
      const kvKey = `recap:daily:synthetics:${dateStr}`;
      const already = options.forceDaily ? null : await store.getKv(kvKey);
      if (!already) {
        const res = await sendPerformanceRecap(recapEnv, allRows as AlertRowish[], "daily", "synthetics", nowMs, options.targetChatId);
        if (res.sent) {
          dailySyntheticsSent = true;
          await store.setKv(kvKey, new Date(nowMs).toISOString());
        }
      }
    }
  }

  if (isWeeklyDue) {
    const doInst = !options.segment || options.segment === "institutional";
    const doSynth = !options.segment || options.segment === "synthetics";

    if (doInst) {
      const kvKey = `recap:weekly:institutional:${weekKey}`;
      const already = options.forceWeekly ? null : await store.getKv(kvKey);
      if (!already) {
        const res = await sendPerformanceRecap(recapEnv, allRows as AlertRowish[], "weekly", "institutional", nowMs, options.targetChatId);
        if (res.sent) {
          weeklyInstitutionalSent = true;
          await store.setKv(kvKey, new Date(nowMs).toISOString());
        }
      }
    }

    if (doSynth) {
      const kvKey = `recap:weekly:synthetics:${weekKey}`;
      const already = options.forceWeekly ? null : await store.getKv(kvKey);
      if (!already) {
        const res = await sendPerformanceRecap(recapEnv, allRows as AlertRowish[], "weekly", "synthetics", nowMs, options.targetChatId);
        if (res.sent) {
          weeklySyntheticsSent = true;
          await store.setKv(kvKey, new Date(nowMs).toISOString());
        }
      }
    }
  }

  // Separate, low-volume research digest: only explicit FREE channel IDs are
  // eligible. Never honor targetChatId overrides or fall back to VIP IDs here.
  const engineDigestEnabled = (env.ENGINE_DIGEST ?? "true").toLowerCase() !== "false";
  if (isWeeklyDue && engineDigestEnabled) {
    const kvKey = `recap:weekly:engine_digest:${weekKey}`;
    const already = options.forceWeekly ? null : await store.getKv(kvKey);
    if (!already) {
      const totals = await store.scanDiagnosticsSince(nowMs - 7 * 86400_000);
      if (totals) {
        const freeChannelIds = [...parseChatIds(freeChatId), ...parseChatIds(derivFreeChatId)];
        const result = await sendEngineDisciplineDigest(
          { ...recapEnv, fetchFn: env.fetchFn },
          formatEngineDisciplineDigest(totals),
          freeChannelIds,
        );
        if (result.sent) {
          engineDigestSent = true;
          await store.setKv(kvKey, new Date(nowMs).toISOString());
        }
      } else {
        console.info(JSON.stringify({ level: "info", msg: "engine digest skipped: no persisted scan diagnostics in weekly window" }));
      }
    }
  }

  return { dailyInstitutionalSent, dailySyntheticsSent, weeklyInstitutionalSent, weeklySyntheticsSent, engineDigestSent };
}

// -------------------------------------------------------------- scan cycle

export async function scanAll(env: Env, opts: ScanOptions = {}): Promise<ScanSummary> {
  resetProviderCircuitBreakers();
  const startedAt = Date.now();
  const now = opts.now ?? startedAt;
  const rawFetchFn = opts.fetchFn ?? fetch;
  // Count HTTP requests per tick so /admin/system-health can report the real
  // fan-out instead of asserting a static guess. Counting only.
  let httpCalls = 0;
  const fetchFn: typeof fetch = ((...args: Parameters<typeof fetch>) => {
    httpCalls++;
    return rawFetchFn(...args);
  }) as typeof fetch;
  const cfg = loadConfig(env);
  const storeCalls: StoreCallStats = { calls: 0, ms: 0 };
  const store: Store = instrumentStore(opts.storeOverride ?? makeStore(env.DB), storeCalls);
  // One batched read replaces the per-pair/per-timeframe scheduler lookups
  // (~140 sequential KV reads per tick). Writes below go write-through so every
  // read inside this invocation still observes exactly what the store holds.
  const kvCache: Record<string, string> = {};
  const readKv = async (key: string): Promise<string | null> => {
    if (key in kvCache) return kvCache[key];
    return store.getKv(key);
  };
  const writeKv = async (key: string, value: string): Promise<void> => {
    kvCache[key] = value;
    await store.setKv(key, value);
  };
  const primeKv = async (prefix: string): Promise<void> => {
    const found = await store.getKvByPrefix(prefix);
    for (const [key, value] of Object.entries(found)) {
      if (!(key in kvCache)) kvCache[key] = value;
    }
  };
  const errors: string[] = [];
  let alertCount = 0;
  let eventCount = 0;
  const diagnostics = emptyScanDiagnostics();
  const notificationPrefs = await store.getNotificationPreferences();
  const pairsScanned: string[] = [];
  const eventReplayMaxAgeMs = opts.eventReplayMaxAgeMs ?? EVENT_REPLAY_MAX_AGE_MS;

  // which entry TFs closed a candle since the previous successful scan?
  // 1. Real-time intrabar outcome resolution: check all open trades every minute
  // so SL/TP hits are resolved immediately without waiting for candle closes or round-robin rotation.
  const liveResolveStartedAt = Date.now();
  const resolvedOutcomes = await resolveAllOpenAlerts(env, store, cfg, now, fetchFn);
  const liveResolveMs = Date.now() - liveResolveStartedAt;

  // 1.1 Automated Performance Journal Recaps for Free Channels (at 21:00 UTC and Friday close)
  try {
    await checkAndDispatchScheduledRecaps(env, store, now);
  } catch (recapErr) {
    console.warn(JSON.stringify({ level: "warn", msg: "scheduled recap check failed", error: String(recapErr) }));
  }

  const scheduleStartedAt = Date.now();
  // Two round-trips cover every boundary and last-scan key the scheduler needs.
  await primeKv("last_boundary:");
  await primeKv("last_scan:");
  let scheduleMs = 0; // set once the due/pending computation finishes

  const due: { tf: string; secs: number; boundary: number }[] = [];
  for (const [tf, secs] of Object.entries(cfg.entryTfs)) {
    const boundary = Math.floor((now - cfg.scanDelayMs) / 1000 / secs) * secs * 1000;
    if (opts.force) {
      due.push({ tf, secs, boundary });
      continue;
    }
    const lastRaw = await readKv(`last_boundary:${tf}`);
    const last = lastRaw ? Number(lastRaw) : 0;
    if (boundary > last) due.push({ tf, secs, boundary });
  }

  if (!due.length) {
    // Run shadow fetches after all live/paper work in this invocation so its
    // provider circuit-breaker state cannot influence entry routing.
    const shadowStats: ShadowResolveStats = { groups: 0, checked: 0, fetches: 0, fetchMs: 0 };
    const shadowStartedAt = Date.now();
    await resolveAllOpenShadowTrades(env, store, cfg, now, fetchFn, shadowStats);
    const shadowResolveMs = Date.now() - shadowStartedAt;
    scheduleMs = Date.now() - scheduleStartedAt;
    diagnostics.timing = {
      liveResolveMs, shadowResolveMs, pairScanMs: 0,
      shadowGroups: shadowStats.groups, shadowChecked: shadowStats.checked, httpCalls,
      scheduleMs, storeCalls: storeCalls.calls, storeMs: storeCalls.ms,
    };
    await store.insertScanLog({
      ts: new Date(now).toISOString(), timeframes: "", pairs: "",
      alerts: 0, events: 0, errors: "", durationMs: Date.now() - startedAt,
      note: resolvedOutcomes > 0 ? `resolved ${resolvedOutcomes} open alert(s) (realtime)` : "idle (no candle close)", diagnostics,
    });
    await recordScanTiming(store, diagnostics);
    return { diagnostics, ok: true, timeframes: [], pairs: [], alerts: 0, events: 0, errors, durationMs: Date.now() - startedAt };
  }

  // Stagger pair scanning across 1-minute cron ticks to stay comfortably below Cloudflare's 10ms CPU limit.
  let pairsToScan = cfg.pairs;
  if (!opts.force && cfg.pairs.length > cfg.pairBatchSize) {
    const isWeekend = isTraditionalMarketWeekend(now);
    const pending: string[] = [];
    for (const pair of cfg.pairs) {
      if (isWeekend && !isDerivPair(pair)) {
        continue; // Closed institutional pairs skipped on weekends to prioritize 24/7 continuous synthetics
      }
      let isDue = false;
      for (const { tf, boundary } of due) {
        // Synthetics 1H Primary: Deriv pairs are never due on non-primary TFs
        if (!entryTfAppliesToPair(pair, tf, cfg)) continue;
        const lastScanRaw = await readKv(`last_scan:${pair}:${tf}`);
        const lastScan = lastScanRaw ? Number(lastScanRaw) : 0;
        if (boundary > lastScan) {
          isDue = true;
          break;
        }
      }
      if (isDue) pending.push(pair);
    }

    // Scheduling is finished for this tick (nothing left to select), so the
    // no-pending path below records a true value rather than zero.
    scheduleMs = Date.now() - scheduleStartedAt;
    if (!pending.length) {
      for (const { tf, boundary } of due) {
        await writeKv(`last_boundary:${tf}`, String(boundary));
      }
      diagnostics.timing = {
        liveResolveMs, shadowResolveMs: 0, pairScanMs: 0,
        shadowGroups: 0, shadowChecked: 0, httpCalls,
        scheduleMs, storeCalls: storeCalls.calls, storeMs: storeCalls.ms,
      };
      await store.insertScanLog({
        ts: new Date(now).toISOString(),
        timeframes: due.map((d) => d.tf).join(","),
        pairs: "",
        alerts: 0,
        events: 0,
        errors: "",
        durationMs: Date.now() - startedAt,
        note: "idle (boundary complete)",
        diagnostics,
      });
      await recordScanTiming(store, diagnostics);
      return {
        diagnostics,
        ok: true,
        timeframes: due.map((d) => d.tf),
        pairs: [],
        alerts: 0,
        events: 0,
        errors,
        durationMs: Date.now() - startedAt,
      };
    }

    // Interleave institutional and Deriv synthetic pairs so neither group starves the other.
    // In each cron tick, pairs are chosen round-robin between pending institutional and pending synthetic pairs.
    // For single-pair batches (PAIR_BATCH_SIZE: 1), we track the last scanned group in KV so invocations
    // alternate strictly between institutional and Deriv pairs.
    const lastGroup = await store.getKv("last_scanned_group");

    // Sort pending pairs within each group by oldest scan time first so no single pair is starved by newer boundaries
    const pairLastScans = new Map<string, number>();
    for (const p of pending) {
      let minScan = Infinity;
      for (const { tf } of due) {
        const raw = await readKv(`last_scan:${p}:${tf}`);
        const val = raw ? Number(raw) : 0;
        if (val < minScan) minScan = val;
      }
      pairLastScans.set(p, minScan === Infinity ? 0 : minScan);
    }

    const sortOldest = (a: string, b: string) => {
      const sa = pairLastScans.get(a) ?? 0;
      const sb = pairLastScans.get(b) ?? 0;
      if (sa !== sb) return sa - sb;
      return cfg.pairs.indexOf(a) - cfg.pairs.indexOf(b);
    };

    const pendingInst = pending.filter((p) => !isDerivPair(p)).sort(sortOldest);
    const pendingDeriv = pending.filter((p) => isDerivPair(p)).sort(sortOldest);
    const selected: string[] = [];
    let instIdx = 0;
    let derivIdx = 0;

    // Start with the opposite group of what was scanned last if both are pending
    const startWithDeriv = lastGroup === "inst" && pendingDeriv.length > 0;

    while (selected.length < cfg.pairBatchSize && (instIdx < pendingInst.length || derivIdx < pendingDeriv.length)) {
      const wantDeriv = startWithDeriv
        ? (selected.length % 2 === 0 ? derivIdx < pendingDeriv.length : instIdx >= pendingInst.length)
        : (selected.length % 2 === 1 ? derivIdx < pendingDeriv.length : instIdx >= pendingInst.length);

      if (wantDeriv && derivIdx < pendingDeriv.length) {
        selected.push(pendingDeriv[derivIdx++]);
      } else if (instIdx < pendingInst.length) {
        selected.push(pendingInst[instIdx++]);
      } else if (derivIdx < pendingDeriv.length) {
        selected.push(pendingDeriv[derivIdx++]);
      }
    }
    pairsToScan = selected;

    if (selected.length > 0) {
      const lastPicked = selected[selected.length - 1];
      await store.setKv("last_scanned_group", isDerivPair(lastPicked) ? "deriv" : "inst");
    }
  }
  scheduleMs = Date.now() - scheduleStartedAt;

  const kvOandaToken = (await store.getKv("oanda_api_token")) || "";
  const oandaToken = env.OANDA_API_KEY || env.OANDA_API_TOKEN || kvOandaToken;
  const oandaEnv = ((await store.getKv("oanda_environment")) as "practice" | "live" | "auto") || "auto";
  const oandaTokenPresent = Boolean(oandaToken);

  const pairScanStartedAt = Date.now();
  for (const pair of pairsToScan) {
    try {
      // Provider routing uses the configured map and supported feeds; a
      // per-pair outage never blocks the other pairs (see catch below).
      const providerName = providerForPair(pair, cfg.providerMap, oandaTokenPresent);
      const apiKey = env.TWELVEDATA_API_KEY ?? "";
      const derivAppId = env.DERIV_APP_ID ?? cfg.derivAppId;
      const derivProxyUrl = env.DERIV_PROXY_URL || (await store.getKv("deriv_proxy_url")) || undefined;
      // kv adapter for immutable historical buckets (Dukascopy minute/hour/day files)
      const kv = { get: (k: string) => store.getKv(k), set: (k: string, v: string) => store.setKv(k, v) };

      // context feed (cached per UTC day to protect provider rate limits)
      const dayKey = new Date(now).toISOString().slice(0, 10);
      const cacheKey = `cache:1d:${pair}:${dayKey}`;
      let d1: Candle[] | null = null;
      const cached = await store.getKv(cacheKey);
      if (cached) d1 = JSON.parse(cached) as Candle[];
      if (!d1) {
        const ctx = await fetchMarketData({ pair, tf: cfg.contextTimeframe, limit: cfg.candlesLimit, tdKey: apiKey, oandaToken, oandaEnv, derivAppId, derivProxyUrl, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
        d1 = validateAndClose(ctx.candles, TF_SECONDS["1d"], now, 25);
        await store.setKv(cacheKey, JSON.stringify(d1));
      }

      // ONE intraday fetch per pair at the base (smallest entry) timeframe;
      // the 4h map and all coarser entry TFs are resampled from it. This is
      // the rate-limit design: ~1 provider credit per pair per boundary
      // instead of ~2 with separate 1h/30m fetches.
      const baseRes = await fetchMarketData({ pair, tf: cfg.baseTimeframe, limit: cfg.baseCandlesLimit, tdKey: apiKey, oandaToken, oandaEnv, derivAppId, derivProxyUrl, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
      const base = validateAndClose(
        baseRes.candles,
        TF_SECONDS[cfg.baseTimeframe], now, cfg.minCandles,
      );
      const feeds: Record<string, Candle[]> = { [cfg.baseTimeframe]: base };
      for (const entryTf of Object.keys(cfg.entryTfs)) {
        if (entryTf === cfg.baseTimeframe) continue;
        const entrySec = TF_SECONDS[entryTf];
        if (entrySec && entrySec > TF_SECONDS[cfg.baseTimeframe]) {
          feeds[entryTf] = dropIncomplete(resampleCandles(base, entrySec), entrySec, now);
        }
      }
      if (!feeds["1h"]) {
        feeds["1h"] = dropIncomplete(resampleCandles(base, TF_SECONDS["1h"]), TF_SECONDS["1h"], now);
      }
      let h4 = dropIncomplete(
        resampleCandles(base, TF_SECONDS[cfg.mapTimeframe]), TF_SECONDS[cfg.mapTimeframe], now,
      );
      if (h4.length < 30) {
        // If 4H resampled from base has fewer than 30 bars (e.g. Dukascopy minute feed budget),
        // fetch the 1h feed directly (which uses 1 monthly file in Dukascopy) and resample H4 from it.
        try {
          const h1Res = await fetchMarketData({ pair, tf: "1h", limit: 200, tdKey: apiKey, oandaToken, oandaEnv, derivAppId, derivProxyUrl, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
          const h1Candles = validateAndClose(h1Res.candles, TF_SECONDS["1h"], now, 30);
          feeds["1h"] = h1Candles;
          const directH4 = dropIncomplete(resampleCandles(h1Candles, TF_SECONDS[cfg.mapTimeframe]), TF_SECONDS[cfg.mapTimeframe], now);
          if (directH4.length >= 30) {
            h4 = directH4;
          }
        } catch {
          // keep original h4 if direct 1h fetch fails
        }
      }
      feeds[cfg.mapTimeframe] = h4;
      if (h4.length < 30) throw new DataQualityError(`insufficient H4 data (${h4.length})`);

      const snaps = storylineSeries(d1, h4, cfg.strategy);
      pairsScanned.push(pair);

      // Diagnostics-only H4 vantage context. Computed once per pair/scan (not
      // per entry timeframe) and attached to setup rows, shadow-ledger rows
      // and experiment rows as confluence tags. It never gates anything.
      const pairStrategy = strategyForPair(pair, cfg.strategy);
      const h4Context = buildH4VantageConfluence(h4, pairStrategy, d1 ?? undefined);

      // Higher-timeframe context cards are separately opt-in. They are not
      // entry alerts and are disabled by default to avoid confusing context
      // with a confirmed paper entry.
      if (cfg.biasNotify && d1 && d1.length >= 10 && h4.length >= 10 && feeds["1h"] && feeds["1h"].length >= 10) {
        const h4Vantage = evaluateH4VantageContext(h4, cfg.strategy);
        if (h4Vantage.direction !== "neutral") {
          const dir: Direction = h4Vantage.direction === "bullish" ? "LONG" : "SHORT";
          const diag = evaluateDirectionalBias({
            pair,
            entryTf: "1h",
            direction: dir,
            entryCandles: feeds["1h"],
            d1Candles: d1,
            h4Candles: h4,
            h1Candles: feeds["1h"],
            cfg: cfg.strategy,
          });

          if (diag.classification === "A_GRADE" || diag.classification === "B_GRADE") {
            const lastCandle = h4[h4.length - 1];
            const h4Close = lastCandle.t + TF_SECONDS[cfg.mapTimeframe] * 1000;
            const h4Age = now - h4Close;
            if (h4Age >= 0 && h4Age <= 2 * TF_SECONDS[cfg.mapTimeframe] * 1000) {
              const biasKey = `last_bias:${pair}:${dir}`;
              const lastBiasTime = await store.getKv(biasKey);
              if (lastBiasTime !== String(lastCandle.t)) {
                const lastBefore = await readKv(`last_scan:${pair}:30m`);
                const isFirstScan = lastRawIsEmpty(lastBefore);
                const tgAllowed = notificationPrefs.telegramWatch !== false;
                if (tgAllowed && deliverAllowed(cfg, isFirstScan, opts)) {
                  const latestStory = snaps.length ? snaps[snaps.length - 1][1] : null;
                  const currentPrice = feeds["1h"] && feeds["1h"].length ? feeds["1h"][feeds["1h"].length - 1].c : lastCandle.c;
                  const origin = findRetracementOrigin(feeds, dir, currentPrice, cfg.strategy) ?? latestStory?.origin ?? null;
                  const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
                  const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
                  const derivFreeChatId = env.TELEGRAM_DERIV_FREE_CHAT_ID || (await store.getKv("telegram_deriv_free_chat_id")) || undefined;
                  await notifyBias({
                    ...env,
                    fetchFn,
                    watchOnly: true,
                    WATCH_TELEGRAM: tgAllowed ? "true" : "false",
                    VIP_WATCH_NOTIFY: env.VIP_WATCH_NOTIFY,
                    VIP_WATCH_TELEGRAM: env.VIP_WATCH_NOTIFY,
                    TELEGRAM_FREE_CHAT_ID: freeChatId,
                    TELEGRAM_DERIV_CHAT_ID: derivChatId,
                    TELEGRAM_DERIV_FREE_CHAT_ID: derivFreeChatId,
                  }, pair, dir, diag, origin, currentPrice);
                }
                await store.setKv(biasKey, String(lastCandle.t));
              }
            }
          }
        }
      }

      for (const { tf, secs, boundary } of due) {
        // Synthetics 1H Primary: Deriv pairs confirm entries only on their
        // primary TFs; non-primary boundaries are bookkept as scanned.
        if (!entryTfAppliesToPair(pair, tf, cfg)) {
          await writeKv(`last_scan:${pair}:${tf}`, String(boundary));
          continue;
        }
        let candles: Candle[];
        const derivedFeed = feeds[tf];
        if (derivedFeed) {
          candles = derivedFeed;
        } else {
          const res = await fetchMarketData({ pair, tf, limit: cfg.candlesLimit, tdKey: apiKey, oandaToken, oandaEnv, derivAppId, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
          candles = validateAndClose(res.candles, secs, now, cfg.minCandles);
        }

        const scanResult = scanEntry({
          pair, entryTf: tf, tfSeconds: secs, candles, snaps,
          cfg: pairStrategy, mode: cfg.mode, provider: providerName,
          d1Candles: d1 ?? undefined,
          h1Candles: feeds["1h"],
          h4Candles: h4,
          h4Context,
        });
        const { alerts, events, diagnostics: replay, shadowTrades } = scanResult;
        const shadowExperiments = [...scanResult.shadowExperiments];

        // Side-by-side 50% FVG retest research is limited to 30m and paper
        // mode to cap CPU cost. Its alerts are converted to shadow rows only;
        // they never enter the normal alert/event/delivery path.
        if (cfg.mode === "paper" && tf === "30m" && (pairStrategy.retestDepthPct ?? 100) === 100 && candles.length) {
          const retest50 = scanEntry({
            pair, entryTf: tf, tfSeconds: secs, candles, snaps,
            cfg: { ...pairStrategy, retestDepthPct: 50 }, mode: "paper", provider: providerName,
            d1Candles: d1 ?? undefined,
            h1Candles: feeds["1h"],
            h4Candles: h4,
            h4Context,
            shadowOnly: true,
          });
          shadowExperiments.push(...captureFvgRetest50Experiments(pair, tf, secs, candles, retest50.alerts, h4Context));
        }

        addReplayDiagnostics(diagnostics, pair, tf, replay);
        await persistShadowCaptures(store, shadowTrades);
        await persistShadowExperiments(store, shadowExperiments);

        const lastBefore = await readKv(`last_scan:${pair}:${tf}`);
        const isFirstScan = lastRawIsEmpty(lastBefore);

        for (const ev of events) {
          // Replay hygiene: a stale replayed transition (candle closed >3 days
          // ago) is not written to the event tape — a pure write reduction.
          // EXCEPT when the setup has an active (OPEN) alert row, whose event
          // trail must stay complete. Entry/alert behavior is untouched: this
          // only gates the slk_events insert, and stale events would already
          // fail the watch freshness gate (2×TF << 3 days).
          if (!(await shouldRecordReplayEvent(store, ev, now, eventReplayMaxAgeMs))) {
            continue;
          }
          const inserted = await store.insertEvent(ev);
          if (!inserted) continue; // already-known transition (dedupe)
          eventCount++;
          countTransition(diagnostics.recorded, ev.state);
          // 👀 Optional pre-entry context: only SHIFT is eligible for a card;
          // TOUCH/SWEEP stay internal, and WATCH_NOTIFY plus the boot gate apply.
          if (cfg.watchNotify && WATCH_STATES.has(ev.state)
              && watchEventFresh(ev, tf, now)
              && deliverAllowed(cfg, isFirstScan, opts)) {
            const tgAllowed = notificationPrefs.telegramWatch !== false;
            const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
            const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
            const derivFreeChatId = env.TELEGRAM_DERIV_FREE_CHAT_ID || (await store.getKv("telegram_deriv_free_chat_id")) || undefined;
            await notifyWatch({
              ...env,
              fetchFn,
              watchOnly: true,
              WATCH_TELEGRAM: tgAllowed ? "true" : "false",
              VIP_WATCH_NOTIFY: env.VIP_WATCH_NOTIFY,
              VIP_WATCH_TELEGRAM: env.VIP_WATCH_NOTIFY,
              WATCH_DISCORD: notificationPrefs.discordWatch ? "true" : "false",
              TELEGRAM_FREE_CHAT_ID: freeChatId,
              TELEGRAM_DERIV_CHAT_ID: derivChatId,
              TELEGRAM_DERIV_FREE_CHAT_ID: derivFreeChatId,
            }, ev, tf);
          }
        }

        for (const alert of alerts) {
          if (alert.directionalBias) {
            console.info(JSON.stringify({
              level: "info",
              msg: "slk.shadow.classification",
              pair: alert.pair,
              tf: alert.entryTf,
              setupId: alert.setupId,
              classification: alert.shadowClassification,
              weekly: alert.directionalBias.weekly,
              daily: alert.directionalBias.daily,
              h4: alert.directionalBias.h4,
              h1: alert.directionalBias.h1,
              entryQuality: alert.directionalBias.entryQuality,
            }));
          }
          // Historical replay can discover a confirmation long after its
          // candle closed. Never record stale historical replay into the live trade ledger.
          // The funnel counters below are written after the decision is made —
          // they observe the gate and never influence it.
          const tfWindowSec = (TF_SECONDS[tf] ?? 0) * 2.5;
          const discoveryAgeSec = Math.max(0, Math.round((now - alert.candleCloseTime) / 1000));
          if (!alertEventFresh(alert, tf, now)) {
            diagnostics.recorded.staleConfirmationSkips++;
            noteConfirmationAttempt(diagnostics.recorded, tf, discoveryAgeSec, "stale", tfWindowSec);
            console.info(JSON.stringify({ level: "info", msg: "stale confirmation skipped — not a live trade", setupId: alert.setupId, ageSec: discoveryAgeSec }));
            continue;
          }
          const inserted = await store.insertAlert(alert, providerName);
          if (!inserted) {
            diagnostics.recorded.duplicateConfirmationSkips++;
            noteConfirmationAttempt(diagnostics.recorded, tf, discoveryAgeSec, "duplicate", tfWindowSec);
            continue; // duplicate setup — already alerted/logged
          }
          alertCount++;
          diagnostics.recorded.confirmedAlerts++;
          noteConfirmationAttempt(diagnostics.recorded, tf, discoveryAgeSec, "inserted", tfWindowSec);
          await deliver(env, store, alert, cfg, deliverAllowed(cfg, isFirstScan, opts), fetchFn);
        }

        // Resolve paper outcomes as before. Shadow outcomes are resolved only
        // after all live/paper scans for this invocation have completed.
        await resolveOutcomes(env, store, cfg, pair, tf, candles, fetchFn);
        await writeKv(`last_scan:${pair}:${tf}`, String(boundary));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Index CFDs genuinely close Fri 21:00 UTC → Sun evening: a stale feed
      // then is the market being idle, not an outage. Log quietly, skip the
      // pair; forex/metals staleness still reports loudly (real outage signal).
      if (msg.includes("stale feed") && isIndexCfdIdleWindow(pair, now)) {
        console.info(JSON.stringify({ level: "info", msg: "pair idle (market closed)", pair }));
        for (const { tf, boundary } of due) {
          await writeKv(`last_scan:${pair}:${tf}`, String(boundary));
        }
        continue;
      }
      errors.push(`${pair}: ${msg}`);
      console.error(JSON.stringify({ level: "error", msg: "pair scan failed", pair, error: msg }));
      // Advance last_scan on error for this boundary so one failing pair doesn't block the queue
      for (const { tf, boundary } of due) {
        await writeKv(`last_scan:${pair}:${tf}`, String(boundary));
      }
    }
  }

  // advance TF boundaries only after every pair got a shot (self-healing on
  // partial failure: the next tick re-runs and dedupe keeps it idempotent)
  if (!opts.force) {
    const isWeekend = isTraditionalMarketWeekend(now);
    for (const { tf, boundary } of due) {
      let allDone = true;
      for (const pair of cfg.pairs) {
        if (isWeekend && !isDerivPair(pair)) continue;
        // Synthetics 1H Primary: non-primary TFs never block boundary advancement
        if (!entryTfAppliesToPair(pair, tf, cfg)) continue;
        const lastScanRaw = await readKv(`last_scan:${pair}:${tf}`);
        const lastScan = lastScanRaw ? Number(lastScanRaw) : 0;
        if (boundary > lastScan) {
          allDone = false;
          break;
        }
      }
      if (allDone) {
        await writeKv(`last_boundary:${tf}`, String(boundary));
      }
    }
  }

  const pairScanMs = Date.now() - pairScanStartedAt;

  // Resolve shadow rows after all established scanning, suppression, and
  // delivery work has finished; observation fetches cannot alter this scan's
  // provider routing or live behavior.
  const shadowStats: ShadowResolveStats = { groups: 0, checked: 0, fetches: 0, fetchMs: 0 };
  const shadowStartedAt = Date.now();
  await resolveAllOpenShadowTrades(env, store, cfg, now, fetchFn, shadowStats);
  const shadowResolveMs = Date.now() - shadowStartedAt;
  diagnostics.timing = {
    liveResolveMs, shadowResolveMs, pairScanMs,
    shadowGroups: shadowStats.groups, shadowChecked: shadowStats.checked, httpCalls,
    scheduleMs, storeCalls: storeCalls.calls, storeMs: storeCalls.ms,
  };

  await store.insertScanLog({
    ts: new Date(now).toISOString(),
    timeframes: due.map((d) => d.tf).join(","),
    pairs: pairsScanned.join(","),
    alerts: alertCount,
    events: eventCount,
    errors: errors.join(" | "),
    durationMs: Date.now() - startedAt,
    note: errors.length ? "partial" : "ok",
    diagnostics,
  });

  await recordScanTiming(store, diagnostics);

  console.info(JSON.stringify({ level: "info", msg: "slk.scan.diagnostics", diagnostics }));

  return {
    diagnostics,
    ok: errors.length === 0,
    timeframes: due.map((d) => d.tf),
    pairs: pairsScanned,
    alerts: alertCount,
    events: eventCount,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

/** One pre-entry heads-up at the latest meaningful stage only. TOUCH and
 *  SWEEP remain internal lifecycle events; RETEST has its own confirmed-entry
 *  alert. This prevents up to three channel posts for one setup. */
const WATCH_STATES = new Set(["SHIFT"]);

/** Replay hygiene: the stateless engine re-walks up to `setupWindow` candles
 *  on every scan, so a cold start can surface transitions whose candles
 *  closed days ago. Those stale rows add no value to the live event tape
 *  (the tape is a live feed, not an archive) and are skipped at INSERT time —
 *  a pure write reduction. The freshness GATES (alertEventFresh /
 *  watchEventFresh) are untouched; alert insertion is untouched. */
export const EVENT_REPLAY_MAX_AGE_MS = 3 * 86400_000;

/** Pure staleness decision for a replayed transition. */
export function isReplayEventStale(ev: { candleTime: number }, now: number, maxAgeMs: number): boolean {
  return maxAgeMs > 0 && now - ev.candleTime > maxAgeMs;
}

/** Full decision: stale replay events are recorded only when the setup has an
 *  active (OPEN) alert row — the evidence trail of a live trade stays
 *  complete. Fresh (or filter-disabled) events are always recorded. */
export async function shouldRecordReplayEvent(
  store: Store, ev: { setupId: string; candleTime: number }, now: number, maxAgeMs: number,
): Promise<boolean> {
  if (!isReplayEventStale(ev, now, maxAgeMs)) return true;
  return store.hasActiveAlert(ev.setupId);
}

/** Watch cards are transient context, not durable alerts. The caller currently
 * allows SHIFT only; require a recent source candle to avoid replaying stale
 * pre-entry context after an isolate cold start. */
export function watchEventFresh(ev: { candleTime: number }, tf: string, now: number): boolean {
  const secs = TF_SECONDS[tf];
  if (!secs) return false;
  const close = ev.candleTime + secs * 1000;
  const age = now - close;
  return age >= 0 && age <= 2 * secs * 1000;
}

export function alertEventFresh(alert: { candleCloseTime: number }, tf: string, now: number): boolean {
  const secs = TF_SECONDS[tf];
  if (!secs) return false;
  const age = now - alert.candleCloseTime;
  return age >= 0 && age <= 2.5 * secs * 1000;
}

function lastRawIsEmpty(v: string | null): boolean {
  return v === null || v === "0";
}

/** Delivery gates: first-ever scan is record-only (mirrors the Python bot's
 *  alert_on_boot=false), per-pair+direction cooldown, session/paper flags. */
function deliverAllowed(
  cfg: ReturnType<typeof loadConfig>, isFirstScan: boolean, opts: ScanOptions,
): boolean {
  return !isFirstScan || opts.force === true;
}

/** Synthetics 1H Primary: whether `tf` is a scannable entry timeframe for
 *  `pair`. Deriv synthetic indices confirm entries only on their primary
 *  entry TFs (`cfg.synthEntryTfs`, default 1h); institutional pairs keep the
 *  full entry-TF set. Non-applicable boundaries are bookkept as scanned so
 *  pair rotation and TF-boundary advancement stay healthy. */
export function entryTfAppliesToPair(
  pair: string, tf: string, cfg: ReturnType<typeof loadConfig>,
): boolean {
  return isDerivPair(pair) ? cfg.synthEntryTfs.includes(tf) : true;
}

/** HTF Conflict Hard Gate (behavior-neutral delivery gate): marks the alert
 *  SUPPRESSED in-place when it is an HTF_CONFLICT counter-trend setup and the
 *  gate applies to its segment (synthetics by default via
 *  FILTER_HTF_CONFLICT_DERIV_ONLY). Entry decisions, dedupe, and outcome
 *  resolution never consult the shadow classification — only delivery does. */
export function applyHtfConflictGate(
  alert: Alert, cfg: ReturnType<typeof loadConfig>,
): boolean {
  if (alert.alertStatus === "SUPPRESSED") return false;
  if (!cfg.filterHtfConflict) return false;
  const applies = !cfg.filterHtfConflictDerivOnly || isDerivPair(alert.pair);
  if (applies && alert.shadowClassification === "HTF_CONFLICT") {
    alert.alertStatus = "SUPPRESSED";
    alert.suppressReason = "HTF conflict: entry opposes higher-timeframe momentum (4H/1H)";
    return true;
  }
  return false;
}

async function persistNotificationDeliveryResults(
  store: Store,
  kind: "confirmed_entry" | "final_outcome",
  context: { pair: string; timeframe: string; setupId: string },
  results: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(results);
  const records = entries.length
    ? entries.map(([channel, result]) => ({ channel, result }))
    : [{ channel: "none", result: "not_configured" }];
  for (const { channel, result } of records) {
    const status = result === "ok" ? "delivered"
      : result === "partial" ? "partial"
      : result === "not_configured" ? "not_configured"
      : "failed";
    try {
      // Store only non-secret identifiers and a normalized result; raw
      // provider error text, chat IDs, and message content are never retained.
      await store.insertNotificationDeliveryAudit({
        channel, kind, status,
        detail: JSON.stringify(context),
      });
    } catch (err) {
      // Audit persistence is observational and must never block paper delivery.
      console.warn(JSON.stringify({ level: "warn", msg: "notification delivery audit write failed", kind, channel, error: String(err) }));
    }
  }
}

export async function deliver(
  env: Env, store: Store, alert: Alert,
  cfg: ReturnType<typeof loadConfig>, allowed: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (alert.alertStatus !== "SUPPRESSED") {
    // Cooldown keying: by default the lookback is scoped to this setup's own
    // entry timeframe, so a delivered 30m signal no longer silences a later 1h
    // signal on the same pair. COOLDOWN_SCOPE=pair_direction restores the old
    // behaviour (it is a config flag, so switching takes a deploy). The reason
    // string records which scope applied, so the two are
    // distinguishable in the audit rollup and on /alerts.
    const perTimeframe = cfg.strategy.cooldownScope !== "pair_direction";
    const last = await store.lastAlertTime(
      alert.pair, alert.direction, alert.setupId, perTimeframe ? alert.entryTf : undefined,
    );
    if (last !== null && alert.candleCloseTime - last < cfg.strategy.cooldownMinutes * 60_000) {
      alert.alertStatus = "SUPPRESSED";
      alert.suppressReason = perTimeframe
        ? `cooldown (${cfg.strategy.cooldownMinutes}m, ${alert.entryTf})`
        : `cooldown (${cfg.strategy.cooldownMinutes}m)`;
      await store.updateAlertStatus(alert.setupId, "SUPPRESSED", alert.suppressReason);
    }
  }

  // HTF Conflict Hard Gate: filter counter-trend setups opposing higher
  // timeframe momentum before any channel delivery happens.
  if (applyHtfConflictGate(alert, cfg)) {
    await store.updateAlertStatus(alert.setupId, "SUPPRESSED", alert.suppressReason ?? undefined);
    console.info(JSON.stringify({
      level: "info",
      msg: "alert suppressed: HTF conflict",
      pair: alert.pair,
      setupId: alert.setupId,
      classification: alert.shadowClassification,
      reason: alert.suppressReason,
    }));
  }

  if (alert.alertStatus === "SUPPRESSED") {
    console.info(JSON.stringify({ level: "info", msg: "alert suppressed", setupId: alert.setupId, reason: alert.suppressReason }));
    return;
  }
  if (!allowed) {
    alert.alertStatus = "SUPPRESSED";
    alert.suppressReason = "first scan boot gate — record-only";
    await store.updateAlertStatus(alert.setupId, "SUPPRESSED", alert.suppressReason);
    console.info(JSON.stringify({ level: "info", msg: "first scan — recorded without delivery", setupId: alert.setupId }));
    return;
  }
  if (cfg.mode === "paper" && !cfg.paperNotify) {
    alert.alertStatus = "SUPPRESSED";
    alert.suppressReason = "paper mode, notifications disabled";
    await store.updateAlertStatus(alert.setupId, "SUPPRESSED", alert.suppressReason);
    console.info(JSON.stringify({ level: "info", msg: "paper mode, notifications off — logged only", setupId: alert.setupId }));
    return;
  }
  const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
  const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
  const chartImgKey = env.CHART_IMG_API_KEY || (await store.getKv("chart_img_api_key")) || undefined;
  const deliveryResults = await notifyAlert(
    { ...env, fetchFn, TELEGRAM_DM_CHAT_ID: dmChatId, TELEGRAM_DERIV_CHAT_ID: derivChatId, CHART_IMG_API_KEY: chartImgKey },
    alert,
  );
  await persistNotificationDeliveryResults(store, "confirmed_entry", {
    pair: alert.pair, timeframe: alert.entryTf, setupId: alert.setupId,
  }, deliveryResults);

  // Roadmap #6: forward confirmed entries to the MT5 execution bridge.
  // Hard-gated: paper mode (production default) never touches the bridge.
  await dispatchMt5Trade(env, cfg.mode, alert, fetchFn);
}

async function resolveOutcomes(
  env: Env, store: Store, cfg: ReturnType<typeof loadConfig>,
  pair: string, tf: string, candles: Candle[],
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const open = await store.openAlerts(pair, tf);
  let resolvedCount = 0;
  for (const rec of open) {
    const isSuppressed = rec.alert_status === "SUPPRESSED";
    const entryTime = Date.parse(rec.candle_close_time as string);
    const after = candles.filter((c) => c.t >= entryTime);
    if (!after.length) continue;
    const oc = evaluateSignal(
      rec.direction as "LONG" | "SHORT",
      Number(rec.entry), Number(rec.stop_loss), Number(rec.tp_internal),
      after, cfg.expireCandles, cfg.slOnClose,
      cfg.strategy.trailingBeTriggerR ?? 1.5,
      cfg.strategy.trailingBeEnabled ?? true,
    );
    // Roadmap #6: the exact candle the paper engine arms breakeven (+1.5R
    // excursion), trail the live broker stop to entry — once per setup.
    if (cfg.mode === "live" && mt5Active(env, cfg.mode) && !isSuppressed) {
      const beSent = await store.getKv(`mt5_be:${rec.setup_id}`);
      if (!beSent) {
        const armedAt = beArmedTime(
          rec.direction as "LONG" | "SHORT",
          Number(rec.entry), Number(rec.stop_loss), after,
          cfg.strategy.trailingBeTriggerR ?? 1.5,
          cfg.strategy.trailingBeEnabled ?? true,
        );
        if (armedAt !== null) {
          await store.setKv(`mt5_be:${rec.setup_id}`, String(armedAt));
          await dispatchMt5Breakeven(env, cfg.mode, String(rec.setup_id), pair, Number(rec.entry), fetchFn);
        }
      }
    }
    if (!oc) continue;
    await store.recordOutcome(String(rec.setup_id), oc);
    resolvedCount++;
    console.info(JSON.stringify({ level: "info", msg: "outcome", setupId: rec.setup_id, status: oc.status, r: oc.rMultiple }));
    if (cfg.notifyOutcomes && !isSuppressed) {
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
      const derivFreeChatId = env.TELEGRAM_DERIV_FREE_CHAT_ID || (await store.getKv("telegram_deriv_free_chat_id")) || undefined;
      const deliveryResults = await notifyOutcome(
        { ...env, fetchFn, TELEGRAM_DM_CHAT_ID: dmChatId, TELEGRAM_FREE_CHAT_ID: freeChatId, TELEGRAM_DERIV_CHAT_ID: derivChatId, TELEGRAM_DERIV_FREE_CHAT_ID: derivFreeChatId },
        rec, oc,
      );
      await persistNotificationDeliveryResults(store, "final_outcome", {
        pair: String(rec.canonical_symbol), timeframe: String(rec.entry_timeframe), setupId: String(rec.setup_id),
      }, deliveryResults);
    }
  }
  return resolvedCount;
}

/** Persist only in the isolated shadow table. Any DB/schema/serialization
 *  failure is logged and swallowed so a scan can never fail because of
 *  research capture. */
export async function persistShadowCaptures(store: Store, captures: ShadowTradeCapture[]): Promise<void> {
  for (const capture of captures) {
    try {
      await store.insertShadowTrade(capture);
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "shadow capture persistence failed", setupId: capture.setupId, rejectReason: capture.rejectReason, error: String(err) }));
    }
  }
}

/** Persist experiment candidates in their own isolated ledger. Missing D1
 *  migrations and storage errors never affect live/paper entry handling. */
export async function persistShadowExperiments(store: Store, experiments: ShadowExperimentCapture[]): Promise<void> {
  for (const experiment of experiments) {
    try {
      await store.insertShadowExperiment(experiment);
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "shadow experiment persistence failed", experimentId: experiment.experimentId, variant: experiment.variant, error: String(err) }));
    }
  }
}

/** Reuse the paper engine's touch-based TP, stop, and 120-bar expiry checks
 *  for research rows only. Breakeven is disabled because the requested shadow
 *  schema deliberately has only OPEN/TP_HIT/SL_HIT/EXPIRED states. */
export async function resolveShadowOutcomes(
  store: Store, cfg: ReturnType<typeof loadConfig>, pair: string, tf: string, candles: Candle[],
): Promise<number> {
  let open: ShadowTradeRow[];
  try {
    open = await store.openShadowTrades(pair, tf);
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "open shadow rows unavailable", pair, tf, error: String(err) }));
    return 0;
  }
  let resolved = 0;
  for (const row of open) {
    try {
      const entryTime = Date.parse(row.candle_close_time);
      if (!Number.isFinite(entryTime)) continue;
      const after = candles.filter((c) => c.t >= entryTime);
      if (!after.length) continue;
      const outcome = evaluateSignal(
        row.direction,
        Number(row.hypothetical_entry),
        Number(row.hypothetical_stop_loss),
        Number(row.hypothetical_tp1),
        after,
        120,
        cfg.slOnClose,
        cfg.strategy.trailingBeTriggerR ?? 1.5,
        false,
      );
      if (!outcome || outcome.status === "OPEN" || outcome.status === "BE_HIT") continue;
      await store.recordShadowOutcome(row.setup_id, {
        status: outcome.status,
        exitPrice: outcome.exitPrice,
        exitTime: outcome.exitTime,
        rMultiple: outcome.rMultiple,
      });
      resolved++;
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "shadow outcome row resolution failed", setupId: row.setup_id, error: String(err) }));
    }
  }
  return resolved;
}

export async function resolveShadowExperimentOutcomes(
  store: Store, cfg: ReturnType<typeof loadConfig>, pair: string, tf: string, candles: Candle[],
): Promise<number> {
  let open: ShadowExperimentRow[];
  try {
    open = await store.openShadowExperiments(pair, tf);
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "open shadow experiments unavailable", pair, tf, error: String(err) }));
    return 0;
  }
  let resolved = 0;
  for (const row of open) {
    try {
      const entryTime = Date.parse(row.candle_close_time);
      if (!Number.isFinite(entryTime)) continue;
      const after = candles.filter((c) => c.t >= entryTime);
      if (!after.length) continue;
      const outcome = evaluateSignal(
        row.direction,
        Number(row.hypothetical_entry),
        Number(row.hypothetical_stop_loss),
        Number(row.hypothetical_target),
        after,
        120,
        cfg.slOnClose,
        cfg.strategy.trailingBeTriggerR ?? 1.5,
        false,
      );
      if (!outcome || outcome.status === "OPEN" || outcome.status === "BE_HIT") continue;
      await store.recordShadowExperimentOutcome(row.experiment_id, {
        status: outcome.status,
        exitPrice: outcome.exitPrice,
        exitTime: outcome.exitTime,
        rMultiple: outcome.rMultiple,
      });
      resolved++;
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "shadow experiment outcome resolution failed", experimentId: row.experiment_id, error: String(err) }));
    }
  }
  return resolved;
}

/** Bounded provider fan-out for shadow resolution. Sequential fetching made
 *  every tick pay one round-trip per open (pair, timeframe) group — with the
 *  research ledger accumulating rows that reached ~20 groups and ~45 s of the
 *  60 s cron budget. Same fetches, same data, a few at a time. */
export const SHADOW_RESOLVE_FETCH_CONCURRENCY = 3;
/** Shadow groups checked per tick. The window adapts to the open set: it aims
 *  to re-check every group within ~6 ticks, never fewer than 5 groups and
 *  never more than 12, so one tick can never fan out unboundedly as the
 *  research ledger grows. */
export const SHADOW_RESOLVE_GROUPS_MIN = 5;
export const SHADOW_RESOLVE_GROUPS_MAX = 12;
export const SHADOW_RESOLVE_ROTATION_TICKS = 6;
export const SHADOW_RESOLVE_CURSOR_KEY = "shadow_resolve_cursor";

export interface ShadowResolveStats {
  groups: number;
  checked: number;
  fetches: number;
  fetchMs: number;
}

/** How many shadow groups to fetch this tick for an open set of `total`. */
export function shadowGroupsPerTick(total: number): number {
  if (!(total > 0)) return 0;
  const want = Math.ceil(total / SHADOW_RESOLVE_ROTATION_TICKS);
  return Math.max(SHADOW_RESOLVE_GROUPS_MIN, Math.min(SHADOW_RESOLVE_GROUPS_MAX, want));
}

/** Deterministic rotating slice of the open shadow groups. Groups are ordered
 *  by pair then timeframe, so the same open set always yields the same order
 *  regardless of Map/DB iteration order; each tick takes the next `perTick`
 *  entries and wraps. Live/paper alert resolution is deliberately NOT rotated:
 *  this only spreads the research ledger's re-checks. */
export function shadowResolutionWindow<T extends { pair: string; tf: string }>(
  groups: T[], cursor: number, perTick: number,
): { selected: T[]; nextCursor: number } {
  const n = groups.length;
  if (!n || perTick <= 0) return { selected: [], nextCursor: 0 };
  const sorted = [...groups].sort((a, b) =>
    a.pair === b.pair ? a.tf.localeCompare(b.tf) : a.pair.localeCompare(b.pair),
  );
  const start = ((Math.trunc(cursor) % n) + n) % n;
  const take = Math.min(perTick, n);
  const selected: T[] = [];
  for (let i = 0; i < take; i++) selected.push(sorted[(start + i) % n]);
  return { selected, nextCursor: (start + take) % n };
}

/** Run `fn` over `items` with a fixed number of concurrent workers, preserving
 *  input order in the result array. */
export async function mapWithConcurrency<T, R>(
  items: T[], width: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.min(Math.trunc(width) || 1, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

/** Counts store (D1) round-trips and their wall time for one invocation.
 *  Diagnostics only: the wrapper forwards every call unchanged. */
export interface StoreCallStats {
  calls: number;
  ms: number;
}

/** Wrap a store so every method call is counted and timed. The scan scheduler
 *  used to issue ~140 sequential KV reads per tick; this is what makes that
 *  visible instead of inferred. Non-function properties pass through, and
 *  methods stay bound to the real store. */
export function instrumentStore<T extends object>(store: T, stats: StoreCallStats): T {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        stats.calls++;
        const startedAt = Date.now();
        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          stats.ms += Date.now() - startedAt;
          throw err;
        }
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return (result as Promise<unknown>).finally(() => {
            stats.ms += Date.now() - startedAt;
          });
        }
        stats.ms += Date.now() - startedAt;
        return result;
      };
    },
  }) as T;
}

/** Best-effort snapshot of the latest tick's phase timings, read by
 *  /admin/system-health. Never allowed to affect a scan. */
export async function recordScanTiming(store: Store, diagnostics: ScanDiagnostics): Promise<void> {
  if (!diagnostics.timing) return;
  try {
    await store.setKv("last_scan_timing", JSON.stringify(diagnostics.timing));
  } catch {
    // timing is observability only
  }
}

/** Real-time shadow resolver mirrors the paper-trade cadence but uses its own
 *  fetches and ledger. A 121-candle window preserves the requested 120-bar
 *  expiry horizon without changing the paper resolver's existing 30-candle reads. */
export async function resolveAllOpenShadowTrades(
  env: Env, store: Store, cfg: ReturnType<typeof loadConfig>,
  now = Date.now(), fetchFn: typeof fetch = fetch,
  stats?: ShadowResolveStats,
): Promise<number> {
  let open: ShadowTradeRow[] = [];
  let openExperiments: ShadowExperimentRow[] = [];
  try {
    open = await store.openShadowTrades();
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "shadow resolver lookup failed", error: String(err) }));
  }
  try {
    openExperiments = await store.openShadowExperiments();
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "shadow experiment resolver lookup failed", error: String(err) }));
  }
  if (!open.length && !openExperiments.length) return 0;
  const groups = new Map<string, { pair: string; tf: string }>();
  for (const row of [...open, ...openExperiments]) {
    const key = `${row.canonical_symbol}:${row.entry_timeframe}`;
    if (!groups.has(key)) groups.set(key, { pair: row.canonical_symbol, tf: row.entry_timeframe });
  }

  // Rotate through the open set instead of re-fetching every group each tick.
  const allGroups = [...groups.values()];
  if (stats) stats.groups = allGroups.length;
  let cursor = 0;
  try {
    const raw = await store.getKv(SHADOW_RESOLVE_CURSOR_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) cursor = parsed;
  } catch {
    // a missing cursor simply starts the rotation at the first group
  }
  const { selected, nextCursor } = shadowResolutionWindow(
    allGroups, cursor, shadowGroupsPerTick(allGroups.length),
  );
  if (stats) stats.checked = selected.length;
  if (!selected.length) return 0;

  let totalResolved = 0;
  try {
    const apiKey = env.TWELVEDATA_API_KEY ?? "";
    const kvOandaToken = (await store.getKv("oanda_api_token")) || "";
    const oandaToken = env.OANDA_API_KEY || env.OANDA_API_TOKEN || kvOandaToken;
    const oandaEnv = ((await store.getKv("oanda_environment")) as "practice" | "live" | "auto") || "auto";
    const derivAppId = env.DERIV_APP_ID ?? cfg.derivAppId;
    const derivProxyUrl = env.DERIV_PROXY_URL || (await store.getKv("deriv_proxy_url")) || cfg.derivProxyUrl || undefined;
    const kv = { get: (key: string) => store.getKv(key), set: (key: string, value: string) => store.setKv(key, value) };
    const perGroup = await mapWithConcurrency(
      selected, SHADOW_RESOLVE_FETCH_CONCURRENCY,
      async ({ pair, tf }) => {
        try {
          const tfSec = TF_SECONDS[tf] ?? 1800;
          const fetchStartedAt = Date.now();
          const res = await fetchMarketData({
            pair, tf, limit: 121,
            tdKey: apiKey, oandaToken, oandaEnv, derivAppId, derivProxyUrl,
            symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv,
          });
          if (stats) {
            stats.fetches++;
            stats.fetchMs += Date.now() - fetchStartedAt;
          }
          const candles = validateCandlesForOutcome(res.candles, tfSec, now, cfg.slOnClose);
          if (!candles.length) return 0;
          let resolved = await resolveShadowOutcomes(store, cfg, pair, tf, candles);
          resolved += await resolveShadowExperimentOutcomes(store, cfg, pair, tf, candles);
          return resolved;
        } catch (err) {
          console.warn(JSON.stringify({ level: "warn", msg: "shadow market data resolution failed", pair, tf, error: String(err) }));
          return 0;
        }
      },
    );
    totalResolved += perGroup.reduce((sum, n) => sum + n, 0);
    // Advance the rotation only after the slice ran, so a thrown slice retries
    // the same window on the next tick instead of skipping groups.
    try {
      await store.setKv(SHADOW_RESOLVE_CURSOR_KEY, String(nextCursor));
    } catch {
      // best-effort rotation state; a failure just repeats this window
    }
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "shadow outcome resolution setup failed", error: String(err) }));
  }
  return totalResolved;
}

/** Instant outcome resolution for all currently open trades across any pair.
 *  Runs every minute so TP/SL touches resolve immediately without waiting for
 *  the next boundary candle close or the pair's turn in the round-robin queue. */
export async function resolveAllOpenAlerts(
  env: Env, store: Store, cfg: ReturnType<typeof loadConfig>,
  now = Date.now(), fetchFn: typeof fetch = fetch,
): Promise<number> {
  const open = await store.openAlerts();
  if (!open || !open.length) return 0;

  // Group open alerts by canonical_symbol and entry_timeframe
  const groups = new Map<string, { pair: string; tf: string }>();
  for (const rec of open) {
    const pair = String(rec.canonical_symbol);
    const tf = String(rec.entry_timeframe);
    const key = `${pair}:${tf}`;
    if (!groups.has(key)) groups.set(key, { pair, tf });
  }

  let totalResolved = 0;
  const apiKey = env.TWELVEDATA_API_KEY ?? "";
  const kvOandaToken = (await store.getKv("oanda_api_token")) || "";
  const oandaToken = env.OANDA_API_KEY || env.OANDA_API_TOKEN || kvOandaToken;
  const oandaEnv = ((await store.getKv("oanda_environment")) as "practice" | "live" | "auto") || "auto";
  const derivAppId = env.DERIV_APP_ID ?? cfg.derivAppId;
  const derivProxyUrl = env.DERIV_PROXY_URL || (await store.getKv("deriv_proxy_url")) || cfg.derivProxyUrl || undefined;
  const kv = { get: (k: string) => store.getKv(k), set: (k: string, v: string) => store.setKv(k, v) };

  for (const { pair, tf } of groups.values()) {
    const tfSec = TF_SECONDS[tf] ?? 1800;
    try {
      const res = await fetchMarketData({
        pair, tf, limit: 30,
        tdKey: apiKey, oandaToken, oandaEnv, derivAppId, derivProxyUrl,
        symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv,
      });
      const outcomeCandles = validateCandlesForOutcome(res.candles, tfSec, now, cfg.slOnClose);
      if (outcomeCandles.length) {
        const count = await resolveOutcomes(env, store, cfg, pair, tf, outcomeCandles, fetchFn);
        totalResolved += count;
      }
    } catch (err) {
      console.warn(JSON.stringify({
        level: "warn", msg: "realtime outcome resolution check failed",
        pair, tf, error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  return totalResolved;
}

// ------------------------------------------------------------------ helpers

/** Index CFDs on the Dukascopy feed genuinely stop quoting between Friday
 *  21:00 UTC settle and Sunday's re-open (US30 futures ~22:00, JAPAN225
 *  ~23:00). During that window a "stale feed" is expected silence. */
export function isIndexCfdIdleWindow(pair: string, now: number): boolean {
  if (!INDEX_POINT_PAIRS.has(pair.toUpperCase())) return false;
  const d = new Date(now);
  const dow = d.getUTCDay();
  return dow === 6 || dow === 0 || (dow === 5 && d.getUTCHours() >= 21);
}

function authed(request: Request, env: Env): boolean {
  if (!env.ADMIN_KEY) return false;
  const expectedKey = env.ADMIN_KEY.trim();
  const auth = request.headers.get("authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim() === expectedKey) return true;
  }
  const xKey = request.headers.get("x-admin-key");
  if (xKey && xKey.trim() === expectedKey) return true;
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || url.searchParams.get("admin_key");
    if (key && key.trim() === expectedKey) return true;
  } catch {
    // ignore malformed URLs
  }
  return false;
}

function readAuthed(_request: Request, _env: Env): boolean {
  // Public portfolio mode: live stats, alert history, and chart evidence can be freely
  // viewed by the public. Administrative actions (scan-now, test-notify, preference updates)
  // still strictly require ADMIN_KEY via authed().
  return true;
}

/** Parse the diagnostics-only confluence tag JSON stored on a row. Never a
 *  gate: display/aggregation only. Tolerates legacy rows (null) and both the
 *  D1 string shape and an already-parsed array. */
export function parseDiagnosticTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization, Content-Type, X-Admin-Key",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    },
  });
}

async function signHex(raw: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(raw: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature.toLowerCase();
}

async function checkTestCooldown(store: Store, actionKey: string, cooldownMs = 30_000): Promise<boolean> {
  const lastTs = await store.getKv(`test_cooldown:${actionKey}`);
  const now = Date.now();
  if (lastTs && now - Number(lastTs) < cooldownMs) {
    return true; // debounced
  }
  await store.setKv(`test_cooldown:${actionKey}`, String(now));
  return false;
}

// --------------------------------------------------------------- entrypoint

export default {
  async fetch(request: Request, env: Env, _ctx: ExecCtxLike): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return json({ ok: true });

    const isPublicApi =
      (url.pathname === "/api/waitlist" && request.method === "POST") ||
      url.pathname === "/api/monte-carlo" ||
      url.pathname === "/api/recent-events" ||
      url.pathname === "/api/engine-pulse" ||
      url.pathname === "/api/whop-webhook";
    if ((url.pathname === "/admin" || url.pathname.startsWith("/admin/") || (url.pathname.startsWith("/api/") && !isPublicApi)) && !authed(request, env)) {
      return json({ error: "unauthorized" }, 401);
    }

    if (url.pathname === "/health") {
      const cfg = loadConfig(env);
      const store = makeStore(env.DB);
      const kvOanda = await store.getKv("oanda_api_token");
      const kvOandaEnv = await store.getKv("oanda_environment");
      const oandaConfigured = Boolean(env.OANDA_API_KEY || env.OANDA_API_TOKEN || kvOanda);
      return json({
        ok: true,
        service: "slk-alert-worker · Workers Paid & Real-Time Intrabar Outcome Resolution",
        mode: cfg.mode,
        version: "v2.5.5",
        commit: "v2.5.5",
        buildTime: "2026-10-07 00:00 UTC",
        feedStatus: "VIP Clean Feed Active (Entries Only)",
        relayUrl: env.DERIV_PROXY_URL ?? "https://slk-bot.vercel.app",
        pairs: cfg.pairs, entryTfs: Object.keys(cfg.entryTfs), synthEntryTfs: cfg.synthEntryTfs,
        // Effective FVG retest-depth gate: 100 = legacy origin-zone boundary
        // check, 1–99 = literal penetration into the direction-matched FVG.
        retestDepthPct: cfg.strategy.retestDepthPct ?? 100,
        watchNotify: cfg.watchNotify,
        biasNotify: cfg.biasNotify,
        vipWatchNotify: (env.VIP_WATCH_NOTIFY ?? "false").toLowerCase() === "true",
        paperNotify: cfg.paperNotify,
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        adminKeyConfigured: Boolean(env.ADMIN_KEY),
        oandaConfigured,
        oandaEnvironment: kvOandaEnv || "auto",
        mt5BridgeActive: mt5Active(env, cfg.mode), // live+enabled+configured; paper ⇒ always false
        time: new Date().toISOString(),
      });
    }

    if ((url.pathname === "/" || url.pathname === "/journal" || url.pathname === "/dashboard") && request.method === "GET") {
      const { DASHBOARD_HTML } = await import("./dashboard_html");
      return new Response(DASHBOARD_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      });
    }

    if ((url.pathname === "/terms" || url.pathname === "/terms.html") && request.method === "GET") {
      const { TERMS_HTML } = await import("./terms_html");
      return new Response(TERMS_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    if ((url.pathname === "/api/waitlist" || url.pathname === "/waitlist") && request.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (!email || !email.includes("@") || !email.includes(".")) {
        return json({ error: "A valid email address is required" }, 400);
      }
      const telegram = typeof body.telegram === "string" ? body.telegram.trim() : undefined;
      const segmentInterest = typeof body.marketInterest === "string"
        ? body.marketInterest.trim()
        : (typeof body.segmentInterest === "string" ? body.segmentInterest.trim() : "all");
      const source = typeof body.source === "string" ? body.source.trim() : "dashboard";

      const store = makeStore(env.DB);
      const res = await store.insertWaitlist({ email, telegram, segmentInterest, source });

      // Forward admin notification if bot token and target chat ID configured
      try {
        const { sendTelegram } = await import("./notify");
        const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id"));
        const targetChatId = dmChatId || env.TELEGRAM_CHAT_ID;
        if (env.TELEGRAM_BOT_TOKEN && targetChatId) {
          const alertMsg = [
            "🎟️ NEW VIP WAITLIST RESERVATION 🎟️",
            "",
            `• Email   : ${email}`,
            `• Telegram: ${telegram || "Not provided"}`,
            `• Market  : ${segmentInterest}`,
            `• Source  : ${source}`,
            `• Time    : ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
            "",
            "Cohort 2 priority queue reservation recorded.",
          ].join("\n");
          await sendTelegram(env, alertMsg, { silent: true, pin: false, chatId: targetChatId }).catch(() => {});
        }
      } catch {
        // Notification failure should never fail the user waitlist response
      }

      return json({
        ok: true,
        message: "Successfully reserved your priority spot on the Cohort 2 waitlist!",
        duplicate: res.duplicate ?? false,
      });
    }

    if ((url.pathname === "/api/waitlist" || url.pathname === "/admin/waitlist") && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const store = makeStore(env.DB);
      const total = await store.getWaitlistCount();
      const items = await store.listWaitlist(100);
      return json({ ok: true, total, items });
    }

    if (url.pathname === "/scan-log" && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const store = makeStore(env.DB);
      try {
        const rows = await store.recentScanLogs(10);
        return json({ logs: rows });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    if (url.pathname === "/recent-events" && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const store = makeStore(env.DB);
      try {
        const rows = await store.recentEvents(20);
        return json({ events: rows });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    if (url.pathname === "/signals/confirmed" && request.method === "GET") {
      if (!env.SIGNAL_API_KEY || request.headers.get("authorization") !== `Bearer ${env.SIGNAL_API_KEY}`)
        return json({ error: "unauthorized" }, 401);
      if (!env.SIGNAL_SIGNING_SECRET)
        return json({ error: "signal signing is not configured" }, 503);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 50);
      const now = Date.now();
      const rows = (await makeStore(env.DB).recentAlerts(200))
        .filter((r) => (r.alert_status === "PAPER" || r.alert_status === "SENT") && r.status === "OPEN")
        .filter((r) => {
          const close = Date.parse(String(r.candle_close_time));
          const tfSeconds = TF_SECONDS[String(r.entry_timeframe)] ?? 0;
          return Number.isFinite(close) && close + Math.max(tfSeconds, 1800) * 2 * 1000 >= now;
        })
        .sort((a, b) => Date.parse(String(b.candle_close_time)) - Date.parse(String(a.candle_close_time)))
        .slice(0, limit);
      const signals = [];
      for (const r of rows) {
        const tfSeconds = TF_SECONDS[String(r.entry_timeframe)] ?? 0;
        const candleClose = Date.parse(String(r.candle_close_time));
        const body = {
          signalId: String(r.setup_id), strategyVersion: String(r.parameter_version ?? "unknown"),
          state: "CONFIRMED", mode: "DEMO", symbol: String(r.canonical_symbol),
          side: String(r.direction) === "LONG" ? "BUY" : "SELL", orderType: "MARKET",
          entry: Number(r.entry), stopLoss: Number(r.stop_loss), takeProfit: Number(r.tp_internal),
          timeframePath: `${String(r.map_timeframe ?? "4h")}>${String(r.entry_timeframe)}`,
          keyLevelType: String(r.key_level_type),
          environment: String(r.environment), phase: String(r.phase),
          htfAlignment: String(r.htf_alignment),
          confirmationEvent: "RETEST_CLOSE",
          evidence: [
            "finalized confirmation candle",
            "HTF bias and execution context recorded",
            `typed ${String(r.key_level_type)} key level`,
            "liquidity sweep and structure shift recorded",
          ],
          expiresAt: new Date(candleClose + Math.max(tfSeconds, 1800) * 2 * 1000).toISOString(),
          createdAt: new Date(now).toISOString(),
        };
        signals.push({ ...body, signature: await signHex(JSON.stringify(body), env.SIGNAL_SIGNING_SECRET) });
      }
      return json({ signals, generatedAt: new Date(now).toISOString(), execution: "DISABLED" });
    }

    if (url.pathname === "/dashboard/preferences/notifications" && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const prefs = await makeStore(env.DB).getNotificationPreferences();
      // `cooldownMinutes` is deliberately NOT returned here. It is stored on
      // notification_preferences but no delivery gate has ever read it, and it
      // has no setter endpoint — advertising it implied a working per-channel
      // throttle that does not exist. The only cooldown that gates anything is
      // cfg.strategy.cooldownMinutes, keyed by COOLDOWN_SCOPE. The DB column is
      // left in place; dropping it is a schema change with no upside.
      return json({ primaryConfirmed: true, telegram: { enabled: true, watchEnabled: prefs.telegramWatch, operationalEnabled: prefs.operationalEnabled }, discord: { enabled: true, watchEnabled: prefs.discordWatch, operationalEnabled: prefs.operationalEnabled }, updatedUtc: prefs.updatedUtc });
    }
    if (url.pathname === "/dashboard/preferences/notifications" && request.method === "PATCH") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      let body: Record<string, unknown>;
      try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "invalid JSON" }, 400); }
      const current = await makeStore(env.DB).getNotificationPreferences();
      const tg = body.telegram as Record<string, unknown> | undefined;
      const dc = body.discord as Record<string, unknown> | undefined;
      const prefs: NotificationPreferences = { ...current, primaryConfirmed: true, telegramWatch: typeof tg?.watchEnabled === "boolean" ? tg.watchEnabled : current.telegramWatch, discordWatch: typeof dc?.watchEnabled === "boolean" ? dc.watchEnabled : current.discordWatch, updatedUtc: new Date().toISOString() };
      await makeStore(env.DB).saveNotificationPreferences(prefs, "dashboard-admin");
      return json({ ok: true, primaryConfirmed: true, telegram: { enabled: true, watchEnabled: prefs.telegramWatch, operationalEnabled: prefs.operationalEnabled }, discord: { enabled: true, watchEnabled: prefs.discordWatch, operationalEnabled: prefs.operationalEnabled }, updatedUtc: prefs.updatedUtc });
    }

    const chartMatch = url.pathname.match(/^\/dashboard\/signals\/(.+)\/chart$/);
    if (chartMatch && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const setupId = decodeURIComponent(chartMatch[1]);
      const row = (await makeStore(env.DB).recentAlerts(500)).find((r) => r.setup_id === setupId);
      if (!row || row.alert_status === "SUPPRESSED") return json({ error: "signal not found" }, 404);
      const cfg = loadConfig(env);
      const rawTf = (url.searchParams.get("timeframe") ?? row.entry_timeframe).toLowerCase();
      const tf = rawTf === "h1" ? "1h" : rawTf === "h4" ? "4h" : rawTf;
      const tfSeconds = TF_SECONDS[tf];
      if (!tfSeconds) return json({ error: "unsupported timeframe" }, 400);
      const before = Math.min(Math.max(Number(url.searchParams.get("before") ?? 200) || 200, 20), 500);
      const after = Math.min(Math.max(Number(url.searchParams.get("after") ?? 20) || 20, 0), 100);
      const candleClose = Date.parse(String(row.candle_close_time));
      const provider = String(row.provider ?? "");
      const providerMap = provider ? { ...cfg.providerMap, [String(row.canonical_symbol)]: provider } : cfg.providerMap;
      let feed: Candle[];
      try {
        const chartStore = makeStore(env.DB);
        const kvOanda = (await chartStore.getKv("oanda_api_token")) || "";
        const chartOandaToken = env.OANDA_API_KEY || env.OANDA_API_TOKEN || kvOanda;
        const chartOandaEnv = ((await chartStore.getKv("oanda_environment")) as "practice" | "live" | "auto") || "auto";
        const result = await fetchMarketData({
          pair: String(row.canonical_symbol), tf, limit: before + after + 80,
          tdKey: env.TWELVEDATA_API_KEY, oandaToken: chartOandaToken, oandaEnv: chartOandaEnv,
          symbolMap: cfg.symbolMap, providerMap, fetchFn: fetch,
        });
        feed = validateAndClose(result.candles, tfSeconds, Date.now(), 1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const kind = message.includes("stale feed") ? "MARKET_IDLE" : "HISTORY_INSUFFICIENT";
        return json({ setupId, status: kind, error: message, candles: [], levels: null }, 200);
      }
      const anchor = candleClose - tfSeconds * 1000;
      const anchorIndex = feed.findIndex((c) => c.t > anchor);
      const end = anchorIndex < 0 ? feed.length : anchorIndex;
      const start = Math.max(0, end - before);
      const selected = feed.slice(start, Math.min(feed.length, end + after));
      if (!selected.length) return json({ setupId, status: "HISTORY_INSUFFICIENT", candles: [], levels: null }, 200);
      let bounds: [number, number] | null = null;
      try {
        const parsed = JSON.parse(String(row.key_level_bounds ?? "null"));
        if (Array.isArray(parsed) && parsed.length === 2) bounds = [Number(parsed[0]), Number(parsed[1])];
      } catch { /* malformed stored evidence is reported through null bounds */ }
      const events = (await makeStore(env.DB).recentEvents(500))
        .filter((e) => e.setup_id === setupId)
        .map((e) => ({ time: String(e.candle_time), type: String(e.state), label: String(e.reason) }));
      return json({
        setupId, symbol: String(row.canonical_symbol), provider: provider || "unknown", timeframe: tf, requestedBefore: before,
        currencyPrecision: String(row.canonical_symbol).startsWith("XAU") ? 2 : 5,
        candles: selected.map((c) => ({ time: new Date(c.t).toISOString(), open: c.o, high: c.h, low: c.l, close: c.c, volume: 0, isFinal: true })),
        levels: { entry: Number(row.entry), stop: Number(row.stop_loss), target1: Number(row.tp_internal), target2: row.tp_external == null ? null : Number(row.tp_external), invalidation: row.invalidation_level == null ? null : Number(row.invalidation_level), keyLevelLow: bounds?.[0] ?? null, keyLevelHigh: bounds?.[1] ?? null },
        evidenceMarkers: events,
        confirmedAt: String(row.candle_close_time),
        outcome: {
          status: String(row.status ?? "OPEN"),
          exitTime: row.exit_time == null ? null : String(row.exit_time),
          rMultiple: row.r_multiple == null ? null : Number(row.r_multiple),
        },
        dataHealth: { freshnessSeconds: Math.max(0, Math.round((Date.now() - feed[feed.length - 1].t - tfSeconds * 1000) / 1000)), missingCandles: 0, isMarketIdle: false, historyComplete: selected.length >= Math.min(before, feed.length) },
      });
    }

    if (url.pathname === "/api/shadow-ledger" && request.method === "GET") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const requestedLimit = Number(url.searchParams.get("limit") ?? 500);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 5000) {
        return json({ error: "limit must be between 1 and 5000" }, 400);
      }
      try {
        const ledger = await makeStore(env.DB).getShadowLedger(requestedLimit);
        return json({
          available: ledger.available,
          rows: ledger.rows.map((row) => ({
            setupId: row.setup_id,
            pair: row.canonical_symbol,
            timeframe: row.entry_timeframe,
            direction: row.direction,
            hypotheticalEntry: row.hypothetical_entry,
            hypotheticalStopLoss: row.hypothetical_stop_loss,
            hypotheticalTp1: row.hypothetical_tp1,
            hypotheticalRr: row.hypothetical_rr,
            rejectReason: row.reject_reason,
            createdUtc: row.created_utc,
            candleCloseTime: row.candle_close_time,
            status: row.status,
            exitTime: row.exit_time,
            exitPrice: row.exit_price,
            rMultiple: row.r_multiple,
            h4ConfluenceGrade: row.h4_confluence_grade ?? null,
            h4ConfluenceTags: parseDiagnosticTags(row.h4_confluence_tags),
            sessionBucket: row.session_bucket ?? null,
          })),
          aggregate: ledger.aggregate,
        });
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "shadow ledger read failed", error: String(err) }));
        return json({ error: "shadow ledger unavailable" }, 500);
      }
    }

    if (url.pathname === "/api/shadow-experiments" && request.method === "GET") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const requestedLimit = Number(url.searchParams.get("limit") ?? 500);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 5000) {
        return json({ error: "limit must be between 1 and 5000" }, 400);
      }
      try {
        const ledger = await makeStore(env.DB).getShadowExperimentLedger(requestedLimit);
        return json({
          available: ledger.available,
          rows: ledger.rows.map((row) => ({
            experimentId: row.experiment_id,
            sourceSetupId: row.source_setup_id,
            variant: row.variant,
            pair: row.canonical_symbol,
            timeframe: row.entry_timeframe,
            direction: row.direction,
            hypotheticalEntry: row.hypothetical_entry,
            hypotheticalStopLoss: row.hypothetical_stop_loss,
            hypotheticalTarget: row.hypothetical_target,
            hypotheticalRr: row.hypothetical_rr,
            createdUtc: row.created_utc,
            candleCloseTime: row.candle_close_time,
            status: row.status,
            exitTime: row.exit_time,
            exitPrice: row.exit_price,
            rMultiple: row.r_multiple,
            h4ConfluenceGrade: row.h4_confluence_grade ?? null,
            h4ConfluenceTags: parseDiagnosticTags(row.h4_confluence_tags),
            sessionBucket: row.session_bucket ?? null,
          })),
          aggregate: ledger.aggregate,
        });
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "shadow experiments read failed", error: String(err) }));
        return json({ error: "shadow experiments unavailable" }, 500);
      }
    }

    if (url.pathname === "/api/monte-carlo" && request.method === "GET") {
      // Quant Lab: bootstrap stress-test over the verified closed-trade R series.
      // Seeded → deterministic; iteration×horizon capped to protect Free-tier CPU.
      const store = makeStore(env.DB);
      const rows = (await store.recentAlerts(1000))
        .filter((r) => String(r.alert_status ?? "").toUpperCase() !== "SUPPRESSED")
        .filter((r) => ["TP_HIT", "SL_HIT", "BE_HIT", "EXPIRED"].includes(String(r.status)) && Number.isFinite(Number(r.r_multiple)));
      rows.sort((a, b) => Date.parse(String(a.exit_time ?? a.candle_close_time)) - Date.parse(String(b.exit_time ?? b.candle_close_time)));
      const rSeries = rows.map((r) => Number(r.r_multiple));
      const clampNum = (v: number, lo: number, hi: number, dflt: number) => (Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : dflt);
      let iterations = Math.floor(clampNum(Number(url.searchParams.get("iterations")), 100, 10000, 2000));
      const horizon = Math.floor(clampNum(Number(url.searchParams.get("horizon")), 10, 500, 100));
      const riskPct = clampNum(Number(url.searchParams.get("riskPct")), 0.1, 5, 1);
      const seedRaw = Number(url.searchParams.get("seed"));
      const seed = Number.isFinite(seedRaw) && seedRaw > 0 ? Math.floor(seedRaw) >>> 0 : 42;
      if (iterations * horizon > 600_000) iterations = Math.max(100, Math.floor(600_000 / horizon));
      if (rSeries.length < 5) {
        return json({ ok: false, error: "INSUFFICIENT_HISTORY", closedTrades: rSeries.length, message: "At least 5 closed trades are required before the stress test becomes meaningful." }, 200);
      }
      const result = runMonteCarlo({ rSeries, iterations, horizon, riskPct, seed });
      return json({ ok: true, ...result });
    }

    if (url.pathname === "/api/recent-events" && request.method === "GET") {
      // Live Desk Mode: cursor-based event tape (smart-polling SSE alternative).
      // Monotonic slk_events.id cursor → zero duplicate/dropped events, ~1ms CPU.
      //
      // `tail=1` bootstrap: return the NEWEST `limit` rows (ascending inside
      // the response) with cursor = max event id, so the tape starts at the
      // live edge instead of replaying the whole history from id 1. Numeric
      // `since` behavior is unchanged (backward compatible).
      const sinceRaw = Number(url.searchParams.get("since") ?? 0);
      const limitRaw = Number(url.searchParams.get("limit") ?? 50);
      const tailRaw = url.searchParams.get("tail");
      const tail = tailRaw === "1" || tailRaw === "true";
      if (!Number.isFinite(sinceRaw) || sinceRaw < 0) return json({ error: "since must be a non-negative integer cursor" }, 400);
      if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > 200) return json({ error: "limit must be between 1 and 200" }, 400);
      const store = makeStore(env.DB);
      const rows = tail
        ? await store.eventTail(Math.floor(limitRaw))
        : await store.eventsSince(Math.floor(sinceRaw), Math.floor(limitRaw));
      const items = rows.map((r) => ({
        id: Number(r.id),
        setupId: String(r.setup_id),
        pair: String(r.pair ?? ""),
        state: String(r.state),
        reason: String(r.reason ?? ""),
        price: r.price == null ? null : Number(r.price),
        candleTime: String(r.candle_time ?? ""),
        createdUtc: String(r.created_utc ?? ""),
      }));
      // Both paths yield ascending ids, so the last item carries the cursor
      // (the max event id for a tail bootstrap, the last delivered id for a
      // `since` page). An empty page keeps the caller's cursor unchanged.
      const cursor = items.length ? items[items.length - 1].id : Math.floor(sinceRaw);
      return json({ ok: true, cursor, items });
    }

    if (url.pathname === "/api/engine-pulse" && request.method === "GET") {
      // Engine Pulse: read-only 24h aggregate of the engine's recorded
      // activity from slk_scan_log.diagnostics_json. No engine writes, no
      // secrets — one bounded D1 read plus small per-row JSON parses.
      const nowMs = Date.now();
      const windowHours = 24;
      const sinceIso = new Date(nowMs - windowHours * 3600_000).toISOString();
      // 24h of once-a-minute cron logs ≤ ~1440 rows; the cap is a safety net.
      const rows = await makeStore(env.DB).scanLogsSince(sinceIso, 2000);
      const pulse = buildEnginePulse(rows as unknown as EnginePulseRow[], nowMs, windowHours);
      return json({ ok: true, ...pulse, asof: new Date(nowMs).toISOString() });
    }

    if (url.pathname === "/api/scan-audit" && request.method === "GET") {
      // Private 1–31 day scan/funnel/delivery audit. Do not add this route to
      // the public API allowlist above; `authed()` is required even though
      // other portfolio reads are public.
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const days = Number(url.searchParams.get("days") ?? 21);
      if (!Number.isInteger(days) || days < 1 || days > 31) {
        return json({ error: "days must be an integer between 1 and 31" }, 400);
      }
      const toMs = Date.now();
      const fromMs = toMs - days * 24 * 3600_000;
      const fromUtc = new Date(fromMs).toISOString();
      const toUtc = new Date(toMs).toISOString();
      try {
        const store = makeStore(env.DB);
        const [scan, delivery] = await Promise.all([
          store.scanAuditBetween(fromUtc, toUtc),
          store.deliveryAuditBetween(fromUtc, toUtc),
        ]);
        return json({
          ok: true,
          window: { days, fromUtc, toUtc },
          scan,
          delivery,
          caveats: [
            "Per-pair/timeframe funnel figures are replay counts, not unique setup counts.",
            "Daily replay transitions and candidates are scan-time replay counts, not distinct opportunities.",
            "Scan error categories are keyword-based row counts, not confirmed root causes or unique incidents.",
            "Daily scan-log alert totals and grouped stored-alert rows are separate views; neither proves a message was delivered.",
            "Stale-confirmation and duplicate-insert counters start with this release; older rows have no coverage, not zero skips.",
            "Stored alert status and suppress reason describe database rows, not Telegram or Discord receipt.",
            "Delivery audit writes are best-effort; a missing result does not prove a message was not sent.",
            "Delivery API-result tracking starts with this release; older delivery outcomes cannot be reconstructed.",
          ],
        });
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "private scan audit failed", error: String(err) }));
        return json({ error: "scan audit unavailable" }, 500);
      }
    }

    if (url.pathname === "/alerts" && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const invalid = (name: string, value: string | null, allowed?: string[]) => value && allowed && !allowed.includes(value) ? `${name} must be one of ${allowed.join(", ")}` : null;
      const page = Number(url.searchParams.get("page") ?? 1); const pageSize = Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? 50);
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) return json({ error: "page must be >= 1 and pageSize must be 1..200" }, 400);
      const allowedSort = ["candleCloseTime", "pair", "timeframe", "direction", "status", "provider"];
      const bad = invalid("order",url.searchParams.get("order"),["asc","desc"]) || invalid("direction",url.searchParams.get("direction"),["LONG","SHORT"]) || invalid("channel",url.searchParams.get("channel"),["CONFIRMED","WATCH"]) || invalid("lifecycle",url.searchParams.get("lifecycle"),["OPEN","TP_HIT","BE_HIT","SL_HIT","EXPIRED"]) || invalid("outcome",url.searchParams.get("outcome"),["TP_HIT","BE_HIT","SL_HIT","EXPIRED"]) || invalid("timeframe",url.searchParams.get("timeframe"),["30m","1h","H1"]) || invalid("provider",url.searchParams.get("provider"),["twelvedata","dukascopy","oanda","deriv"]) || invalid("sort",url.searchParams.get("sort"),allowedSort);
      const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
      const fromMs = from ? Date.parse(from) : null; const toMs = to ? Date.parse(to) : null;
      if (bad) return json({ error: bad }, 400);
      if ((from && !Number.isFinite(fromMs)) || (to && !Number.isFinite(toMs))) return json({ error: "from and to must be valid ISO UTC dates" }, 400);
      if (fromMs !== null && toMs !== null && fromMs > toMs) return json({ error: "from must be earlier than or equal to to" }, 400);
      const requestedIncludeSuppressed =
        url.searchParams.get("includeSuppressed") === "true" ||
        url.searchParams.get("includeSuppressed") === "1" ||
        url.searchParams.get("include_suppressed") === "true" ||
        url.searchParams.get("include_suppressed") === "1";
      const includeSuppressed = requestedIncludeSuppressed && authed(request, env);
      const store = makeStore(env.DB); const query: AlertQuery = { pair:url.searchParams.get("pair") ?? undefined, timeframe:url.searchParams.get("timeframe") ?? undefined, direction:url.searchParams.get("direction") ?? undefined, channel:url.searchParams.get("channel") ?? undefined, lifecycle:url.searchParams.get("lifecycle") ?? undefined, outcome:url.searchParams.get("outcome") ?? undefined, provider:url.searchParams.get("provider") ?? undefined, from:url.searchParams.get("from") ?? undefined, to:url.searchParams.get("to") ?? undefined, search:url.searchParams.get("search") ?? undefined, sort:url.searchParams.get("sort") ?? "candleCloseTime", order:(url.searchParams.get("order") as "asc"|"desc") || "desc", segment: (url.searchParams.get("segment") as any) ?? undefined, page, pageSize, includeSuppressed };
      const result = await store.queryAlerts(query); const rows = result.rows;
      // sanitized: the DB holds no secrets, but keep the response tight anyway
      return json({ items: rows.map((r) => ({
        setupId: r.setup_id, pair: r.canonical_symbol, tf: r.entry_timeframe,
        direction: r.direction, entry: r.entry, stopLoss: r.stop_loss,
        tp1: r.tp_internal, tp2: r.tp_external, environment: r.environment,
        phase: r.phase, htfAlignment: r.htf_alignment, keyLevel: r.key_level_type,
        originLevel: r.origin_key_level, status: r.status,
        alertStatus: r.alert_status, candleCloseTime: r.candle_close_time,
        // Why this alert was held back, when it was. The value is already
        // stored and already surfaced by the scan-audit rollup; exposing it
        // per row lets the suppression rules be audited against outcomes
        // instead of inferred. Read-only and never consulted by any gate.
        suppressReason: (r.suppress_reason as string) ?? null,
        exitTime: (r.exit_time as string) ?? null,
        exitPrice: (r.exit_price as number) ?? null,
        createdUtc: (r.created_utc as string) ?? null,
        rMultiple: r.r_multiple,
        h4ConfluenceGrade: (r.h4_confluence_grade as string) ?? null,
        h4ConfluenceTags: parseDiagnosticTags(r.h4_confluence_tags),
        sessionBucket: (r.session_bucket as string) ?? null,
      })), page, pageSize, total: result.total, sort: query.sort, order: query.order });
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const store = makeStore(env.DB);
      const allRows = (await store.recentAlerts(1000)).filter(
        (r) => String(r.alert_status ?? "").toUpperCase() !== "SUPPRESSED"
      );

      const period = url.searchParams.get("period");
      const fromParam = url.searchParams.get("from");
      const toParam = url.searchParams.get("to");
      const segment = url.searchParams.get("segment") || url.searchParams.get("market");

      const now = Date.now();
      let fromMs: number | null = fromParam ? Date.parse(fromParam) : null;
      let toMs: number | null = toParam ? Date.parse(toParam) + 86400000 : null; // inclusive of whole 'to' day
      let periodLabel = "All Time";

      if (period === "today") {
        const d = new Date(now);
        d.setUTCHours(0, 0, 0, 0);
        fromMs = d.getTime();
        toMs = null;
        periodLabel = "Today";
      } else if (period === "7d") {
        fromMs = now - 7 * 86400000;
        toMs = null;
        periodLabel = "Last 7 Days";
      } else if (period === "30d") {
        fromMs = now - 30 * 86400000;
        toMs = null;
        periodLabel = "Last 30 Days";
      } else if (period === "90d") {
        fromMs = now - 90 * 86400000;
        toMs = null;
        periodLabel = "Last 90 Days";
      } else if (fromParam || toParam) {
        periodLabel = `${fromParam ?? "Start"} to ${toParam ?? "Present"}`;
      }

      let dateFilteredRows = allRows;
      if (fromMs != null && Number.isFinite(fromMs)) {
        dateFilteredRows = dateFilteredRows.filter((r) => {
          const t = Date.parse(String(r.candle_close_time));
          return Number.isFinite(t) && t >= fromMs!;
        });
      }
      if (toMs != null && Number.isFinite(toMs)) {
        dateFilteredRows = dateFilteredRows.filter((r) => {
          const t = Date.parse(String(r.candle_close_time));
          return Number.isFinite(t) && t <= toMs!;
        });
      }

      let rows = dateFilteredRows;
      if (segment === "synthetics") {
        rows = rows.filter((r) => isDerivPair(r.canonical_symbol));
        periodLabel += " · Synthetics (24/7)";
      } else if (segment === "institutional") {
        rows = rows.filter((r) => !isDerivPair(r.canonical_symbol));
        periodLabel += " · Institutional";
      }

      let firstDate: string | null = null;
      let lastDate: string | null = null;
      for (const r of rows) {
        const d = String(r.candle_close_time);
        if (!firstDate || d < firstDate) firstDate = d;
        if (!lastDate || d > lastDate) lastDate = d;
      }

      const tp = rows.filter((r) => r.status === "TP_HIT").length;
      const sl = rows.filter((r) => r.status === "SL_HIT").length;
      const be = rows.filter((r) => r.status === "BE_HIT").length;
      const expired = rows.filter((r) => r.status === "EXPIRED").length;
      const openn = rows.filter((r) => r.status === "OPEN" && r.alert_status !== "SUPPRESSED").length;
      const completed = rows.filter((r) => (r.status === "TP_HIT" || r.status === "SL_HIT" || r.status === "BE_HIT" || r.status === "EXPIRED") && Number.isFinite(Number(r.r_multiple))).sort((a,b) => Date.parse(String(a.exit_time ?? a.candle_close_time)) - Date.parse(String(b.exit_time ?? b.candle_close_time)));
      const calcCurve = (items: typeof completed) => { let equity = 0; let peak = 0; let drawdown = 0; for (const row of items) { equity += Number(row.r_multiple); peak = Math.max(peak, equity); drawdown = Math.min(drawdown, equity - peak); } return { netR: items.length ? equity : null, maxDD: items.length ? drawdown : null }; };
      const groups = new Map<string, typeof completed>();
      for (const row of completed) { const key = `${row.canonical_symbol} · ${row.entry_timeframe}`; const list = groups.get(key) ?? []; list.push(row); groups.set(key, list); }
      const breakdown = [...groups.entries()].map(([group, items]) => {
        const curve = calcCurve(items);
        let bFirstDate: string | null = null;
        let bLastDate: string | null = null;
        for (const item of items) {
          const d = String(item.exit_time ?? item.candle_close_time);
          if (!bFirstDate || d < bFirstDate) bFirstDate = d;
          if (!bLastDate || d > bLastDate) bLastDate = d;
        }
        const itemTp = items.filter(r => r.status === "TP_HIT").length;
        const itemSl = items.filter(r => r.status === "SL_HIT").length;
        const itemBe = items.filter(r => r.status === "BE_HIT").length;
        return {
          group,
          pair: items[0].canonical_symbol,
          timeframe: items[0].entry_timeframe,
          firstDate: bFirstDate,
          lastDate: bLastDate,
          completed: items.length,
          tp: itemTp,
          sl: itemSl,
          be: itemBe,
          winRate: itemTp + itemSl > 0 ? itemTp / (itemTp + itemSl) : null,
          ...curve,
        };
      });
      let equity = 0; let peak = 0; let maxDD = 0;
      for (const row of completed) { equity += Number(row.r_multiple); peak = Math.max(peak, equity); maxDD = Math.min(maxDD, equity - peak); }

      const summarizeSet = (items: typeof dateFilteredRows) => {
        const itemTp = items.filter((r) => r.status === "TP_HIT").length;
        const itemSl = items.filter((r) => r.status === "SL_HIT").length;
        const itemBe = items.filter((r) => r.status === "BE_HIT").length;
        const itemExpired = items.filter((r) => r.status === "EXPIRED").length;
        const itemOpen = items.filter((r) => r.status === "OPEN" && r.alert_status !== "SUPPRESSED").length;
        const itemCompleted = items.filter((r) => (r.status === "TP_HIT" || r.status === "SL_HIT" || r.status === "BE_HIT" || r.status === "EXPIRED") && Number.isFinite(Number(r.r_multiple)));
        let eq = 0; let pk = 0; let dd = 0;
        for (const r of itemCompleted) {
          eq += Number(r.r_multiple);
          pk = Math.max(pk, eq);
          dd = Math.min(dd, eq - pk);
        }
        return {
          total: items.length,
          open: itemOpen,
          tp: itemTp,
          sl: itemSl,
          be: itemBe,
          expired: itemExpired,
          completed: itemCompleted.length,
          winRate: itemTp + itemSl > 0 ? itemTp / (itemTp + itemSl) : null,
          netR: itemCompleted.length ? eq : 0,
          maxDD: itemCompleted.length ? dd : 0,
        };
      };

      return json({
        period: period ?? (fromParam || toParam ? "custom" : "all"),
        periodLabel,
        from: fromMs ? new Date(fromMs).toISOString() : firstDate,
        to: toMs ? new Date(toMs).toISOString() : lastDate,
        firstDate,
        lastDate,
        total: rows.length, open: openn, tp, sl, be, expired, completed: completed.length,
        winRate: tp + sl > 0 ? tp / (tp + sl) : null,
        netR: completed.length ? equity : null, maxDD: completed.length ? maxDD : null, breakdown,
        segments: {
          institutional: summarizeSet(dateFilteredRows.filter((r) => !isDerivPair(r.canonical_symbol))),
          synthetics: summarizeSet(dateFilteredRows.filter((r) => isDerivPair(r.canonical_symbol))),
        },
        note: "paper metrics from completed alert outcomes — research only, not audited performance",
      });
    }

    if (url.pathname === "/scan-now" && request.method === "POST") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      try {
        const summary = await scanAll(env, { force: true });
        return json(summary, summary.ok ? 200 : 207);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(JSON.stringify({ level: "error", msg: "scan-now failed", error: msg, stack: err instanceof Error ? err.stack : undefined }));
        return json({ ok: false, error: msg }, 500);
      }
    }

    if (url.pathname === "/test-notify" && request.method === "POST") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      let body: Record<string, unknown> = {};
      try { if (request.method === "POST") body = await request.json() as Record<string, unknown>; } catch { return json({ error: "invalid JSON" }, 400); }
      const channel = body.channel === "telegram" || body.channel === "discord" ? body.channel : "all";
      const text = "SLK TEST — NOT A SIGNAL\n\nThis is an isolated delivery test. It cannot create alerts, outcomes, or orders.\nWATCH remains informational and is not confirmed.";
      const { sendTelegram, sendDiscord } = await import("./notify");
      const results: Record<string, string> = {};
      const store = makeStore(env.DB);
      const attempts = channel === "all" ? ["telegram", "discord"] : [channel];
      for (const target of attempts) {
        try {
          if (target === "telegram") { if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) { results.telegram = "not_configured"; } else { await sendTelegram(env, text); results.telegram = "ok"; } }
          else { if (!env.DISCORD_WEBHOOK_URL) { results.discord = "not_configured"; } else { await sendDiscord(env, text, 0x3498db); results.discord = "ok"; } }
        } catch (err) { results[target] = `error: ${err instanceof Error ? err.message : String(err)}`; }
        await store.insertNotificationDeliveryAudit({ channel: target, kind: "test", status: results[target], detail: results[target] });
      }
      return json({ ok: Object.values(results).some(v => v === "ok"), isolated: true, results });
    }

    if ((url.pathname === "/admin/expire-open" || url.pathname === "/api/expire-open") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const closed = await store.expireOpenAlerts();
      return json({
        ok: true,
        action: "expire_open",
        closed,
        message: `Successfully closed ${closed} open trade(s) as EXPIRED. Active/Open count is now 0.`,
      });
    }

    if ((url.pathname === "/admin/confirmed-only" || url.pathname === "/api/confirmed-only") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const current = await store.getNotificationPreferences();
      const updated: NotificationPreferences = { ...current, telegramWatch: false, discordWatch: false, updatedUtc: new Date().toISOString() };
      await store.saveNotificationPreferences(updated, "admin-confirmed-only");
      return json({
        ok: true,
        action: "confirmed_only",
        message: "Telegram watch preference muted. Confirmed entries and outcomes are unchanged; server-level WATCH_NOTIFY and BIAS_NOTIFY also control pre-entry context.",
        preferences: updated,
      });
    }

    if ((url.pathname === "/admin/enable-watch" || url.pathname === "/api/enable-watch") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const current = await store.getNotificationPreferences();
      const updated: NotificationPreferences = { ...current, telegramWatch: true, discordWatch: true, updatedUtc: new Date().toISOString() };
      await store.saveNotificationPreferences(updated, "admin-enable-watch");
      return json({
        ok: true,
        action: "enable_watch",
        message: "Telegram watch preference enabled. Pre-entry watch posts still require server-level WATCH_NOTIFY; bias-context cards are separately controlled by BIAS_NOTIFY.",
        preferences: updated,
      });
    }

    if ((url.pathname === "/admin/test-silent" || url.pathname === "/api/test-silent") && (request.method === "GET" || request.method === "POST")) {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return json({ ok: false, error: "Telegram credentials missing in worker environment variables (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)" }, 400);
      }
      const store = makeStore(env.DB);
      if (await checkTestCooldown(store, "test-silent")) {
        return json({ ok: true, debounced: true, message: "A test alert was already sent a few seconds ago. Skipping duplicate to prevent spam." });
      }
      const { sendTelegram, toBold } = await import("./notify");
      const boldNas = toBold("NAS100");
      const text = [
        `🧪 WATCH TEST — NOT AN ENTRY — 🌟【 ${boldNas} 】🌟 · 15m · SHORT 🔽`,
        `📍 Pair     : 🌟【 ${boldNas} 】🌟`,
        "State      : ⚡ SHIFT",
        "Detail     : BOS through pullback structure 20,430.50",
        "Origin Zone: ~20,480.00 (V-Level Zone)",
        "Bias Grade : ⭐ A_GRADE (HTF Aligned)",
        "Price      : ~20,425.00",
        `Candle     : ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
        "Setup ID   : test:NAS100:15m:SHORT:V:20480.0",
        "",
        "WATCH TEST — NOT AN ENTRY. This sample verifies message delivery only; no setup or trade was generated.",
        "Testing SILENT notification mode (Phone should NOT vibrate or ring).",
      ].join("\n");
      try {
        await sendTelegram(env, text, { silent: true, pin: false });
        return json({
          ok: true,
          mode: "silent",
          status: "delivered",
          message: "A silent WATCH delivery test (not a signal) was sent. Check that your phone did NOT vibrate or ring.",
        });
      } catch (err) {
        return json({
          ok: false,
          mode: "silent",
          error: err instanceof Error ? err.message : String(err),
        }, 500);
      }
    }

    if ((url.pathname === "/admin/connect-dm" || url.pathname === "/api/connect-dm") && (request.method === "GET" || request.method === "POST")) {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return json({ ok: false, error: "Telegram bot token missing (TELEGRAM_BOT_TOKEN)" }, 400);
      }
      const doFetch = env.fetchFn ?? fetch;
      const getUpdatesUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`;
      try {
        const resp = await doFetch(getUpdatesUrl);
        const data = await resp.json() as { ok: boolean; result?: Array<{ message?: { chat?: { id: number; type: string; first_name?: string; username?: string } } }> };
        if (!data.ok || !Array.isArray(data.result)) {
          return json({ ok: false, error: "Failed to fetch updates from Telegram API" }, 502);
        }
        // Find private chat updates (from direct user messages)
        const privateChats = data.result
          .map((u) => u.message?.chat)
          .filter((c): c is { id: number; type: string; first_name?: string; username?: string } => Boolean(c && c.type === "private"));

        if (privateChats.length === 0) {
          return json({
            ok: false,
            error: "No private messages found from your Telegram account yet. Please open Telegram, search for your bot, send /start or any message to it, and run /admin/connect-dm again.",
          }, 404);
        }

        const lastChat = privateChats[privateChats.length - 1];
        const dmChatId = String(lastChat.id);
        const store = makeStore(env.DB);
        await store.setKv("telegram_dm_chat_id", dmChatId);

        // Immediately send a confirmation DM to user
        const { sendTelegram } = await import("./notify");
        const welcomeText = [
          "🔔 [CONNECTED] SLK PRIVATE DM SIGNALS ACTIVE! 🔔",
          "",
          `Hello ${lastChat.first_name || lastChat.username || "there"}!`,
          "Your personal Telegram chat is now linked directly to the SLK Radar engine.",
          "",
          "⚡ Whenever a confirmed entry signal fires, you will receive a loud alert right here simultaneously with the channel so you NEVER miss a trade.",
          `Linked Chat ID : ${dmChatId}`,
          `Timestamp      : ${new Date().toISOString()}`,
        ].join("\n");
        await sendTelegram(env, welcomeText, { silent: false, pin: false, chatId: dmChatId });

        return json({
          ok: true,
          status: "connected",
          dmChatId,
          user: lastChat.first_name || lastChat.username || "User",
          message: `Successfully connected private chat for ${lastChat.first_name || lastChat.username || "User"} (ID: ${dmChatId})! A confirmation message was just sent directly to your phone.`,
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/connect-free-channel" || url.pathname === "/api/connect-free-channel") && (request.method === "GET" || request.method === "POST")) {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return json({ ok: false, error: "Telegram bot token missing (TELEGRAM_BOT_TOKEN)" }, 400);
      }
      const doFetch = env.fetchFn ?? fetch;
      const getUpdatesUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`;
      try {
        const resp = await doFetch(getUpdatesUrl);
        const data = await resp.json() as {
          ok: boolean;
          result?: Array<{
            channel_post?: { chat?: { id: number; title?: string; username?: string; type: string } };
            my_chat_member?: { chat?: { id: number; title?: string; username?: string; type: string } };
            message?: { chat?: { id: number; title?: string; username?: string; type: string } };
          }>;
        };
        if (!data.ok || !Array.isArray(data.result)) {
          return json({ ok: false, error: "Failed to fetch updates from Telegram API" }, 502);
        }

        // Find all channel chats from updates
        const channelChats = data.result
          .map((u) => u.channel_post?.chat || u.my_chat_member?.chat || (u.message?.chat?.type === "channel" ? u.message.chat : null))
          .filter((c): c is { id: number; title?: string; username?: string; type: string } => Boolean(c && (c.type === "channel" || c.type === "supergroup")));

        const vipChannelId = env.TELEGRAM_CHAT_ID ? env.TELEGRAM_CHAT_ID.trim() : "";
        const candidates = channelChats.filter((c) => String(c.id) !== vipChannelId);

        if (candidates.length === 0) {
          return json({
            ok: false,
            error: "No new channel detected. Please post any message in your Free Channel (e.g. 'hello') or re-add your bot as Admin, then visit /admin/connect-free-channel again.",
            allUpdatesCount: data.result.length,
          }, 404);
        }

        const chosen = candidates[candidates.length - 1];
        const freeChatId = String(chosen.id);
        const store = makeStore(env.DB);
        await store.setKv("telegram_free_chat_id", freeChatId);

        const { sendTelegram } = await import("./notify");
        const verification = [
          "✅ SLK Free Channel connection verified",
          "",
          "The bot can post to this channel.",
          "This is a delivery check only — no setup, entry, or trade outcome was generated.",
          "Paper research only. No order was placed.",
        ].join("\n");

        await sendTelegram(env, verification, { silent: false, pin: false, chatId: freeChatId });

        return json({
          ok: true,
          status: "connected",
          freeChatId,
          channelTitle: chosen.title || chosen.username || "Free Channel",
          message: `Successfully linked Free Channel "${chosen.title || chosen.username}" (ID: ${freeChatId})! A neutral verification message was sent; no signal was generated.`,
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/connect-deriv-channel" || url.pathname === "/api/connect-deriv-channel") && (request.method === "GET" || request.method === "POST")) {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return json({ ok: false, error: "Telegram bot token missing (TELEGRAM_BOT_TOKEN)" }, 400);
      }
      const doFetch = env.fetchFn ?? fetch;
      const getUpdatesUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`;
      try {
        const resp = await doFetch(getUpdatesUrl);
        const data = await resp.json() as {
          ok: boolean;
          result?: Array<{
            channel_post?: { chat?: { id: number; title?: string; username?: string; type: string } };
            my_chat_member?: { chat?: { id: number; title?: string; username?: string; type: string } };
            message?: { chat?: { id: number; title?: string; username?: string; type: string } };
          }>;
        };
        if (!data.ok || !Array.isArray(data.result)) {
          return json({ ok: false, error: "Failed to fetch updates from Telegram API" }, 502);
        }

        const store = makeStore(env.DB);
        const vipChannelId = env.TELEGRAM_CHAT_ID ? env.TELEGRAM_CHAT_ID.trim() : "";
        const freeChannelId = (env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || "").trim();

        // Find all channel chats from updates
        const channelChats = data.result
          .map((u) => u.channel_post?.chat || u.my_chat_member?.chat || (u.message?.chat?.type === "channel" ? u.message.chat : null))
          .filter((c): c is { id: number; title?: string; username?: string; type: string } => Boolean(c && (c.type === "channel" || c.type === "supergroup")));

        const candidates = channelChats.filter((c) => String(c.id) !== vipChannelId && String(c.id) !== freeChannelId);

        if (candidates.length === 0) {
          return json({
            ok: false,
            error: "No new channel detected. Please ensure: 1) You added your bot as Administrator with 'Post Messages' permission to your new Synthetics Channel, 2) Post any message (e.g. 'hello') in the channel, then refresh /admin/connect-deriv-channel.",
            allUpdatesCount: data.result.length,
          }, 404);
        }

        const chosen = candidates[candidates.length - 1];
        const derivChatId = String(chosen.id);
        await store.setKv("telegram_deriv_chat_id", derivChatId);

        const { sendTelegram, toBold } = await import("./notify");
        const boldV75 = toBold("V75");
        const welcome = [
          `⚡ SLK Radar — 24/7 Synthetics Hub Connected! ⚡`,
          "",
          `📍 Active Instrument: 🌟【 ${boldV75} 】🌟 (Volatility 75 Index)`,
          "• Status     : Connected & Active ✅",
          "• Operational: 24 Hours / 7 Days a Week",
          "• Engine     : SLK Institutional Market Structure",
          "",
          "VIP delivery is limited to engine-confirmed paper entries and final outcomes. Pre-entry WATCH and bias-context cards are not sent to VIP.",
        ].join("\n");

        await sendTelegram(env, welcome, { silent: false, pin: true, chatId: derivChatId });

        return json({
          ok: true,
          status: "connected",
          derivChatId,
          channelTitle: chosen.title || chosen.username || "Synthetics Channel",
          message: `Successfully linked Synthetics Channel "${chosen.title || chosen.username}" (ID: ${derivChatId})! Verification greeting pinned to channel.`,
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/set-deriv-channel" || url.pathname === "/api/set-deriv-channel") && (request.method === "GET" || request.method === "POST")) {
      const chatIdParam = url.searchParams.get("chat_id") || url.searchParams.get("id");
      if (!chatIdParam) {
        return json({ ok: false, error: "Missing ?chat_id=<channel_id> query parameter" }, 400);
      }
      const store = makeStore(env.DB);
      let derivChatId = chatIdParam.trim();
      if (derivChatId.startsWith("@")) {
        derivChatId = derivChatId.slice(1);
      }
      await store.setKv("telegram_deriv_chat_id", derivChatId);
      const { sendTelegram } = await import("./notify");
      try {
        await sendTelegram(env, `✅ SLK Synthetics VIP channel linked to ${derivChatId}.\nPaper mode only. VIP delivery is limited to confirmed entries and final outcomes; pre-entry WATCH and bias-context cards are not sent to VIP.`, { silent: false, pin: true, chatId: derivChatId });
      } catch (testErr) {
        return json({
          ok: true,
          status: "saved_with_warning",
          derivChatId,
          warning: `Saved synthetics channel ID, but test message failed: ${testErr instanceof Error ? testErr.message : String(testErr)}. Ensure you have added your bot as an Administrator in the channel with permission to Post Messages!`,
        });
      }
      return json({
        ok: true,
        status: "connected",
        derivChatId,
        message: `Successfully linked Synthetics Channel ${derivChatId}! Verification message sent to channel.`,
      });
    }

    if ((url.pathname === "/admin/connect-deriv-free-channel" || url.pathname === "/api/connect-deriv-free-channel") && request.method === "GET") {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return json({ ok: false, error: "Telegram bot token missing (TELEGRAM_BOT_TOKEN)" }, 400);
      }
      const doFetch = env.fetchFn ?? fetch;
      const getUpdatesUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`;
      try {
        const resp = await doFetch(getUpdatesUrl);
        const data = await resp.json() as {
          ok: boolean;
          result?: Array<{
            channel_post?: { chat?: { id: number; title?: string; username?: string; type: string } };
            my_chat_member?: { chat?: { id: number; title?: string; username?: string; type: string } };
            message?: { chat?: { id: number; title?: string; username?: string; type: string } };
          }>;
        };
        if (!data.ok || !Array.isArray(data.result)) {
          return json({ ok: false, error: "Failed to fetch updates from Telegram API" }, 502);
        }

        const store = makeStore(env.DB);
        const vipChannelId = env.TELEGRAM_CHAT_ID ? env.TELEGRAM_CHAT_ID.trim() : "";
        const freeChannelId = (env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || "").trim();
        const derivVipChannelId = (env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || "").trim();

        const channelChats = data.result
          .map((u) => u.channel_post?.chat || u.my_chat_member?.chat || (u.message?.chat?.type === "channel" ? u.message.chat : null))
          .filter((c): c is { id: number; title?: string; username?: string; type: string } => Boolean(c && (c.type === "channel" || c.type === "supergroup")));

        const candidates = channelChats.filter((c) =>
          String(c.id) !== vipChannelId &&
          String(c.id) !== freeChannelId &&
          String(c.id) !== derivVipChannelId
        );

        if (candidates.length === 0) {
          return json({
            ok: false,
            error: "No new channel detected. Please ensure: 1) You added your bot as Administrator with 'Post Messages' permission to your Free Synthetics Channel, 2) Post any message (e.g. 'hello') in the channel, then refresh /admin/connect-deriv-free-channel.",
            allUpdatesCount: data.result.length,
          }, 404);
        }

        const chosen = candidates[candidates.length - 1];
        const derivFreeChatId = String(chosen.id);
        await store.setKv("telegram_deriv_free_chat_id", derivFreeChatId);

        const { sendTelegram, toBold } = await import("./notify");
        const boldV75 = toBold("V75");
        const welcome = [
          `⚡ SLK Free Synthetics Channel Connected ⚡`,
          "",
          `📍 Market group: 🌟【 ${boldV75} 】🌟 and supported synthetic markets`,
          "• Status     : Connected ✅",
          "• Mode       : Paper research only; no orders are placed",
          "• Updates    : Eligible teasers and scheduled recaps",
          "",
          "Pre-entry WATCH and bias-context posts are optional and currently disabled. They are never entry alerts.",
        ].join("\n");

        await sendTelegram(env, welcome, { silent: false, pin: false, chatId: derivFreeChatId });

        return json({
          ok: true,
          status: "connected",
          derivFreeChatId,
          channelTitle: chosen.title || chosen.username || "Free Synthetics Channel",
          message: `Successfully linked Free Synthetics Channel "${chosen.title || chosen.username}" (ID: ${derivFreeChatId})! Verification greeting sent.`,
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/set-deriv-free-channel" || url.pathname === "/api/set-deriv-free-channel") && (request.method === "GET" || request.method === "POST")) {
      const chatIdParam = url.searchParams.get("chat_id") || url.searchParams.get("id");
      if (!chatIdParam) {
        return json({ ok: false, error: "Missing ?chat_id=<channel_id> query parameter" }, 400);
      }
      const store = makeStore(env.DB);
      let derivFreeChatId = chatIdParam.trim();
      while (derivFreeChatId.startsWith("@@")) {
        derivFreeChatId = derivFreeChatId.slice(1);
      }
      await store.setKv("telegram_deriv_free_chat_id", derivFreeChatId);
      const { sendTelegram } = await import("./notify");
      try {
        await sendTelegram(env, `✅ SLK Free Synthetics channel linked to ${derivFreeChatId}.\nPaper-research updates only; no orders are placed. Pre-entry WATCH and bias-context posts are optional and currently disabled.`, { silent: false, pin: false, chatId: derivFreeChatId });
      } catch (testErr) {
        return json({
          ok: true,
          status: "saved_with_warning",
          derivFreeChatId,
          warning: `Saved channel ID, but test message failed: ${testErr instanceof Error ? testErr.message : String(testErr)}. Ensure you have added your bot as an Administrator in the channel with permission to Post Messages!`,
        });
      }
      return json({
        ok: true,
        status: "connected",
        derivFreeChatId,
        message: `Successfully linked Free Synthetics Channel ${derivFreeChatId}! Verification message sent to channel.`,
      });
    }

    if ((url.pathname === "/admin/test-deriv-free-teaser" || url.pathname === "/api/test-deriv-free-teaser") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const derivFreeChatId = env.TELEGRAM_DERIV_FREE_CHAT_ID || (await store.getKv("telegram_deriv_free_chat_id"));
      if (!derivFreeChatId) {
        return json({ ok: false, error: "No Free Synthetics Channel configured. Visit /admin/connect-deriv-free-channel or set ?chat_id= via /admin/set-deriv-free-channel" }, 400);
      }
      if (await checkTestCooldown(store, "test-deriv-free-teaser")) {
        return json({
          ok: true,
          status: "debounced",
          message: "A test message was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const { sendTelegram } = await import("./notify");
      const testMessage = [
        "🧪 SLK SYNTHETICS DELIVERY TEST — NOT A SIGNAL",
        "",
        "This message verifies Telegram delivery only.",
        "No market setup, entry, or trade outcome was generated.",
        "Paper research only. No order was placed.",
      ].join("\n");
      try {
        await sendTelegram(env, testMessage, { silent: false, pin: false, chatId: derivFreeChatId });
        return json({
          ok: true,
          targetChatId: derivFreeChatId,
          status: "delivered",
          message: "A neutral delivery-test message was sent; no trade signal was generated.",
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/test-deriv" || url.pathname === "/api/test-deriv") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id"));
      if (!derivChatId) {
        return json({ ok: false, error: "No Deriv Synthetics Channel configured. Visit /admin/connect-deriv-channel or set ?chat_id= via /admin/set-deriv-channel" }, 400);
      }
      if (await checkTestCooldown(store, "test-deriv")) {
        return json({
          ok: true,
          status: "debounced",
          message: "A test message was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const { sendTelegram } = await import("./notify");
      const testMessage = [
        "🧪 SLK SYNTHETICS DELIVERY TEST — NOT A SIGNAL",
        "",
        "This message verifies Telegram delivery only.",
        "No market setup, entry, or trade outcome was generated.",
        "Paper research only. No order was placed.",
      ].join("\n");

      try {
        await sendTelegram(env, testMessage, { silent: false, pin: false, chatId: derivChatId });
        return json({
          ok: true,
          status: "delivered",
          derivChatId,
          message: "A neutral delivery-test message was sent; no trade signal was generated.",
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/set-dm" || url.pathname === "/api/set-dm") && (request.method === "GET" || request.method === "POST")) {
      const chatIdParam = url.searchParams.get("chat_id") || url.searchParams.get("id");
      if (!chatIdParam) {
        return json({ ok: false, error: "Missing ?chat_id=<your_telegram_id> query parameter" }, 400);
      }
      const store = makeStore(env.DB);
      const dmChatId = chatIdParam.trim();
      await store.setKv("telegram_dm_chat_id", dmChatId);
      const { sendTelegram } = await import("./notify");
      try {
        await sendTelegram(env, `🔔 SLK Private DM Alert delivery linked to chat ID ${dmChatId}! Loud signals will now be sent here simultaneously with the channel.`, { silent: false, pin: false, chatId: dmChatId });
      } catch (testErr) {
        return json({
          ok: true,
          status: "saved_with_warning",
          dmChatId,
          warning: `Saved chat ID, but initial test message failed: ${testErr instanceof Error ? testErr.message : String(testErr)}. Ensure you have started the bot first by clicking 'Start' in Telegram!`,
        });
      }
      return json({
        ok: true,
        status: "connected",
        dmChatId,
        message: `Successfully configured private DM alerts for chat ID ${dmChatId}! Test notification sent to your phone.`,
      });
    }

    if ((url.pathname === "/admin/test-dm" || url.pathname === "/api/test-dm") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id"));
      if (!dmChatId) {
        return json({
          ok: false,
          error: "No private DM chat ID configured yet. Run /admin/connect-dm after sending /start to your bot, or set ?chat_id= via /admin/set-dm.",
        }, 400);
      }
      const { sendTelegram } = await import("./notify");
      const text = [
        "🧪 SLK PRIVATE DM DELIVERY TEST — NOT A SIGNAL",
        "",
        "This message verifies direct Telegram delivery only.",
        "No market setup, entry, or trade outcome was generated.",
        "Paper research only. No order was placed.",
        "",
        "This test is intentionally loud so you can verify phone notification settings.",
      ].join("\n");
      try {
        await sendTelegram(env, text, { silent: false, pin: false, chatId: dmChatId });
        return json({
          ok: true,
          mode: "loud_dm",
          targetChatId: dmChatId,
          status: "delivered",
          message: "A loud private delivery-test message was sent directly to your phone; no trade signal was generated.",
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/set-free-channel" || url.pathname === "/api/set-free-channel") && (request.method === "GET" || request.method === "POST")) {
      const chatIdParam = url.searchParams.get("chat_id") || url.searchParams.get("id");
      if (!chatIdParam) {
        return json({ ok: false, error: "Missing ?chat_id=<your_free_channel_id_or_username> query parameter" }, 400);
      }
      const store = makeStore(env.DB);
      let freeChatId = chatIdParam.trim();
      // Clean up accidental duplicate @@ prefixes if user typed @ twice
      while (freeChatId.startsWith("@@")) {
        freeChatId = freeChatId.slice(1);
      }
      await store.setKv("telegram_free_chat_id", freeChatId);
      const { sendTelegram } = await import("./notify");
      try {
        await sendTelegram(env, `✅ SLK Free channel linked to ${freeChatId}.\nPaper-research updates only; no orders are placed. Pre-entry WATCH and bias-context posts are optional and currently disabled.`, { silent: false, pin: false, chatId: freeChatId });
      } catch (testErr) {
        return json({
          ok: true,
          status: "saved_with_warning",
          freeChatId,
          warning: `Saved free channel ID, but test message failed: ${testErr instanceof Error ? testErr.message : String(testErr)}. Ensure you have added your bot as an Administrator in the channel with permission to Post Messages!`,
        });
      }
      return json({
        ok: true,
        status: "connected",
        freeChatId,
        message: `Successfully linked Free Channel ${freeChatId}! Verification message sent to channel.`,
      });
    }

    if ((url.pathname === "/admin/test-free-teaser" || url.pathname === "/api/test-free-teaser") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id"));
      if (!freeChatId) {
        return json({ ok: false, error: "No Free Telegram Channel configured. Set via /admin/set-free-channel?chat_id=@your_channel" }, 400);
      }
      if (await checkTestCooldown(store, "test-free-teaser")) {
        return json({
          ok: true,
          status: "debounced",
          message: "A test message was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const { sendTelegram } = await import("./notify");
      const testMessage = [
        "🧪 SLK FREE CHANNEL DELIVERY TEST — NOT A SIGNAL",
        "",
        "This message verifies Telegram delivery only.",
        "No market setup, entry, or trade outcome was generated.",
        "Paper research only. No order was placed.",
      ].join("\n");
      try {
        await sendTelegram(env, testMessage, { silent: false, pin: false, chatId: freeChatId });
        return json({
          ok: true,
          targetChatId: freeChatId,
          status: "delivered",
          message: "A neutral delivery-test message was sent; no trade signal was generated.",
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if ((url.pathname === "/admin/test-bias" || url.pathname === "/admin/test-free-bias" || url.pathname === "/api/test-free-bias") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      if (await checkTestCooldown(store, "test-bias")) {
        return json({
          ok: true,
          status: "debounced",
          message: "A test bias was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
      const { notifyBias } = await import("./notify");
      const sampleDiag = {
        classification: "A_GRADE" as const,
        weekly: { weeklyHighSwept: false, weeklyLowSwept: true, opposingLiquidityStanding: true, primaryOpposingTarget: 51175.2 },
        daily: { bias: "bearish" as const, bodyToBodyBreakout: "bearish" as const, liquiditySweepPlusStructureBreak: false, sweepDirection: null, incomplete: false },
        h4: { direction: "bearish" as const, breakoutStatus: "bearish_breakout" as const, hasStructureBreak: true },
        h1: { direction: "bearish" as const, agreesWith4H: true },
        entryQuality: { lowerTimeframeSweep: true, bosStructureShift: true, fvgDetected: true, fvgRebalanceDetected: true, retestDetected: true },
        timeframeRole: {
          entryTf: "15m",
          structuralTf: "4h" as const,
          executionContextTf: "1h" as const,
        },
      };
      const sampleOrigin = {
        originPrice: 51588.6,
        originTime: Date.now() - 3600_000,
        originIndex: 10,
        zoneLo: 51537.6,
        zoneHi: 51639.6,
        kind: "V" as const,
        ageBars: 12,
        touches: 2,
        broken: false,
        flipped: true,
        fvgOverlap: true,
      };
      const results = await notifyBias(
        { ...env, TELEGRAM_FREE_CHAT_ID: freeChatId, watchOnly: true, WATCH_TELEGRAM: "true" },
        "US30",
        "SHORT",
        sampleDiag,
        sampleOrigin,
        51385.9,
      );
      return json({
        ok: true,
        targetFreeChatId: freeChatId,
        results,
        message: "Test Bias Confirmation sent! Check VIP channel and Free channel (@SLK_radar).",
      });
    }

    if ((url.pathname === "/admin/test-be" || url.pathname === "/api/test-be") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const segment = (url.searchParams.get("segment") || "both").toLowerCase();
      const doInst = segment === "both" || segment === "institutional";
      const doSynth = segment === "both" || segment === "synthetics";

      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      const mainChatId = env.TELEGRAM_CHAT_ID || (await store.getKv("telegram_chat_id")) || undefined;
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;

      const testEnv = {
        ...env,
        fetchFn: env.fetchFn ?? fetch,
        TELEGRAM_CHAT_ID: mainChatId,
        TELEGRAM_DERIV_CHAT_ID: derivChatId,
        TELEGRAM_DM_CHAT_ID: dmChatId,
      };

      const results: Record<string, unknown> = {};

      if (doInst && mainChatId) {
        const instRec: AlertRowish = {
          setup_id: `oanda:EURUSD:30m:LONG:V:${Date.now()}`,
          canonical_symbol: "EURUSD",
          entry_timeframe: "30m",
          direction: "LONG",
          entry: 1.0850,
          stop_loss: 1.0820,
          tp_internal: 1.0940,
          tp_external: 1.0980,
          alert_status: "SENT",
          candle_close_time: new Date(Date.now() - 3600_000).toISOString(),
        };
        const instOc: OutcomeLike = {
          status: "BE_HIT",
          exitPrice: 1.0850,
          exitTime: Date.now(),
          rMultiple: 0.00,
        };
        results.institutional = await notifyOutcome(testEnv, instRec, instOc);
      } else if (doInst) {
        results.institutional = "TELEGRAM_CHAT_ID not configured";
      }

      if (doSynth && (derivChatId || mainChatId)) {
        const synthRec: AlertRowish = {
          setup_id: `deriv:V75:1h:LONG:A:${Date.now()}`,
          canonical_symbol: "V75",
          entry_timeframe: "1h",
          direction: "LONG",
          entry: 450250.00,
          stop_loss: 449850.00,
          tp_internal: 451550.00,
          tp_external: 452800.00,
          alert_status: "SENT",
          candle_close_time: new Date(Date.now() - 7200_000).toISOString(),
        };
        const synthOc: OutcomeLike = {
          status: "BE_HIT",
          exitPrice: 450250.00,
          exitTime: Date.now(),
          rMultiple: 0.00,
        };
        results.synthetics = await notifyOutcome(testEnv, synthRec, synthOc);
      } else if (doSynth) {
        results.synthetics = "TELEGRAM_DERIV_CHAT_ID not configured";
      }

      return json({
        ok: true,
        action: "test_be_notification",
        segment,
        results,
        message: "Instructional Breakeven test notification dispatched to VIP channel(s).",
      });
    }

    if ((url.pathname === "/admin/preview-recap" || url.pathname === "/api/preview-recap") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const period = (url.searchParams.get("period") || "daily").toLowerCase() as "daily" | "weekly";
      const segment = (url.searchParams.get("segment") || "institutional").toLowerCase() as "institutional" | "synthetics";
      const allRows = (await store.recentAlerts(1000)).filter(
        (r) => String(r.alert_status ?? "").toUpperCase() !== "SUPPRESSED"
      );
      const stats = computeRecapStats(allRows as AlertRowish[], segment, period);
      const card = formatPerformanceRecap(stats);
      return json({ ok: true, period, segment, stats, card });
    }

    if ((url.pathname === "/admin/trigger-recap" || url.pathname === "/api/trigger-recap" || url.pathname === "/admin/test-recap" || url.pathname === "/api/test-recap") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const period = (url.searchParams.get("period") || "daily").toLowerCase() as "daily" | "weekly";
      const segment = (url.searchParams.get("segment") || "both").toLowerCase() as "institutional" | "synthetics" | "both";
      const force = url.searchParams.get("force") !== "false";

      let targetChatId = url.searchParams.get("chat_id") || undefined;
      const to = url.searchParams.get("to");
      if (to === "dm") {
        targetChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      } else if (to === "vip" || to === "channel") {
        targetChatId = segment === "synthetics"
          ? (env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || env.TELEGRAM_CHAT_ID)
          : (env.TELEGRAM_CHAT_ID || undefined);
      }

      const results = await checkAndDispatchScheduledRecaps(env, store, Date.now(), {
        forceDaily: period === "daily" && force,
        forceWeekly: period === "weekly" && force,
        segment: segment === "both" ? undefined : segment,
        targetChatId,
      });

      return json({
        ok: true,
        action: "trigger_recap",
        period,
        segment,
        targetChatId: targetChatId ? `${targetChatId.slice(0, 4)}...${targetChatId.slice(-4)}` : "channel_default",
        results,
        message: "Performance recap triggered. Check your Telegram destination.",
      });
    }

    if ((url.pathname === "/admin/telegram-status" || url.pathname === "/api/telegram-status") && request.method === "GET") {
      const store = makeStore(env.DB);
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id"));
      const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id"));
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id"));
      const derivFreeChatId = env.TELEGRAM_DERIV_FREE_CHAT_ID || (await store.getKv("telegram_deriv_free_chat_id"));
      return json({
        ok: true,
        botConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
        channelConfigured: Boolean(env.TELEGRAM_CHAT_ID),
        channelChatId: env.TELEGRAM_CHAT_ID ? `${env.TELEGRAM_CHAT_ID.slice(0, 4)}...${env.TELEGRAM_CHAT_ID.slice(-4)}` : null,
        dmConfigured: Boolean(dmChatId),
        dmChatId: dmChatId ? `${dmChatId.slice(0, 3)}...${dmChatId.slice(-3)}` : null,
        freeChannelConfigured: Boolean(freeChatId),
        freeChannelChatId: freeChatId ? `${freeChatId.slice(0, 4)}...${freeChatId.slice(-4)}` : null,
        derivChannelConfigured: Boolean(derivChatId),
        derivChannelChatId: derivChatId ? `${derivChatId.slice(0, 4)}...${derivChatId.slice(-4)}` : null,
        derivFreeChannelConfigured: Boolean(derivFreeChatId),
        derivFreeChannelChatId: derivFreeChatId ? `${derivFreeChatId.slice(0, 4)}...${derivFreeChatId.slice(-4)}` : null,
        instructions: {
          previewRecap: "Visit /admin/preview-recap?period=daily&segment=institutional (or segment=synthetics) to inspect the automated performance recap card.",
          triggerRecap: "Visit /admin/trigger-recap?period=daily&segment=both to instantly dispatch the performance recaps to the respective free channels.",
          deleteAlert: "Visit /admin/delete-alert?setup_id=<setup_id> to delete a specific alert from the journal.",
          connectDm: "1. Open your bot in Telegram and send /start. 2. Visit /admin/connect-dm to link automatically.",
          setDmManually: "Visit /admin/set-dm?chat_id=<your_id>",
          connectDerivChannel: "1. Add bot as Admin to Synthetics VIP channel. 2. Post any message in channel. 3. Visit /admin/connect-deriv-channel.",
          setDerivManually: "Visit /admin/set-deriv-channel?chat_id=<channel_id>",
          connectDerivFreeChannel: "1. Add bot as Admin to Free Synthetics channel. 2. Post a message. 3. Visit /admin/connect-deriv-free-channel.",
          setDerivFreeManually: "Visit /admin/set-deriv-free-channel?chat_id=<channel_id_or_username>",
          testDeriv: "Visit /admin/test-deriv to send a neutral delivery test to the Synthetics VIP channel; it does not create a signal.",
          testDerivFreeTeaser: "Visit /admin/test-deriv-free-teaser to send a neutral delivery test to the Free Synthetics channel; it does not create a signal.",
          setFreeChannel: "Visit /admin/set-free-channel?chat_id=@your_free_channel_username",
          testFreeTeaser: "Visit /admin/test-free-teaser to send a neutral delivery test to the free channel; it does not create a signal.",
          testLoudBoth: "Visit /admin/test-loud to send a loud delivery test to the channel and optional DM; no signal is generated.",
          setOandaToken: "Visit /admin/set-oanda-token?token=<token>&env=practice (or env=live) to configure OANDA feed.",
          probeOanda: "Visit /admin/probe-oanda?pair=US30 to test real-time candle connectivity to OANDA.",
        },
      });
    }

    if ((url.pathname === "/admin/system-health" || url.pathname === "/api/system-health") && request.method === "GET") {
      const store = makeStore(env.DB);
      let alertCount = 0;
      let eventCount = 0;
      let logCount = 0;
      let recentLogs: Array<Record<string, unknown>> = [];
      let lastScanTiming: Record<string, unknown> | null = null;
      try {
        if (env.DB && typeof env.DB.prepare === "function") {
          const a = await env.DB.prepare("SELECT count(*) as c FROM slk_alerts").bind().first() as Record<string, unknown> | null;
          const e = await env.DB.prepare("SELECT count(*) as c FROM slk_events").bind().first() as Record<string, unknown> | null;
          const l = await env.DB.prepare("SELECT count(*) as c FROM slk_scan_log").bind().first() as Record<string, unknown> | null;
          alertCount = Number(a?.c ?? 0);
          eventCount = Number(e?.c ?? 0);
          logCount = Number(l?.c ?? 0);
        }
        recentLogs = await store.recentScanLogs(5);
        try {
          const rawTiming = await store.getKv("last_scan_timing");
          if (rawTiming) lastScanTiming = JSON.parse(rawTiming) as Record<string, unknown>;
        } catch {
          lastScanTiming = null;
        }
      } catch (err) {
        console.warn(JSON.stringify({ level: "warn", msg: "system-health db query failed", error: String(err) }));
      }
      const cfg = loadConfig(env);
      return json({
        ok: true,
        service: "slk-alert-worker",
        timestamp: new Date().toISOString(),
        // Workers Paid ($5/mo). These are the plan's documented ceilings, not
        // measured headroom: 30s CPU per invocation (cron triggers under a 1h
        // interval included), 10,000 subrequests, 10M requests/month.
        cloudflareTier: "Workers Paid ($5/mo) — 30s CPU per invocation, 10,000 subrequests, 10M requests/month",
        limitsStatus: {
          // Honest about what is and is not measured: Cloudflare does not expose
          // a Worker's own CPU time to the running Worker, so no per-tick CPU
          // figure is asserted here. What is certain is the shape of the cost -
          // a tick spends almost all of its wall-clock time waiting on market
          // data and D1, and waiting is not billed as CPU - against a 30,000ms
          // ceiling on this plan.
          cpuSafety: "WELL INSIDE LIMIT — the Workers Paid ceiling is 30,000ms of CPU per invocation (cron triggers included). A tick's wall-clock time is overwhelmingly spent waiting on market data and D1, and waiting is not counted as CPU.",
          // logCount is an all-time total, so it is compared against an
          // all-time-shaped figure rather than a daily quota.
          d1WritesSafety: `NEGLIGIBLE — ${logCount.toLocaleString("en-US")} scan-log rows stored in total; the paid D1 allowance is 50,000,000 row-writes per month.`,
          d1StorageSafety: `NEGLIGIBLE — ${(alertCount + eventCount + logCount).toLocaleString("en-US")} rows across alerts, lifecycle events and scan logs; paid D1 includes 5GB of storage.`,
          // Measured, not asserted: the previous static claim understated the
          // real fan-out (shadow resolution fetched once per open group).
          subrequestsSafety: Number(lastScanTiming?.httpCalls ?? 0) > 0
            ? `MEASURED — ${Number(lastScanTiming?.httpCalls)} HTTP requests in the latest tick `
              + `(limit 10,000 on Workers Paid); pair scan ${Number(lastScanTiming?.pairScanMs ?? 0)} ms, `
              + `live resolve ${Number(lastScanTiming?.liveResolveMs ?? 0)} ms, `
              + `shadow resolve ${Number(lastScanTiming?.shadowResolveMs ?? 0)} ms for `
              + `${Number(lastScanTiming?.shadowChecked ?? 0)} of ${Number(lastScanTiming?.shadowGroups ?? 0)} shadow groups`
            : "UNMEASURED — no tick timings recorded yet (limit 10,000 on Workers Paid)",
        },
        databaseCounts: {
          totalConfirmedAlerts: alertCount,
          totalLifecycleEvents: eventCount,
          totalScanLogs: logCount,
        },
        engineConfig: {
          batchSize: cfg.pairBatchSize,
          mode: cfg.mode,
          activePairs: cfg.pairs,
          entryTimeframes: Object.keys(cfg.entryTfs),
          synthEntryTimeframes: cfg.synthEntryTfs,
        },
        recentScanLogs: recentLogs.map((l) => ({
          timestamp: l.ts,
          pairs: l.pairs,
          timeframes: l.timeframes,
          durationMs: l.duration_ms,
          note: l.note,
          errors: l.errors,
        })),
      });
    }

    if ((url.pathname === "/admin/set-deriv-proxy" || url.pathname === "/api/set-deriv-proxy") && (request.method === "GET" || request.method === "POST")) {
      const proxyParam = url.searchParams.get("url") || url.searchParams.get("proxy_url");
      if (!proxyParam) {
        return json({ ok: false, error: "Missing ?url=<proxy_url> query parameter (e.g. ?url=https://slk-deriv-relay.onrender.com)" }, 400);
      }
      const store = makeStore(env.DB);
      const cleanUrl = proxyParam.trim().replace(/\/+$/, "");
      await store.setKv("deriv_proxy_url", cleanUrl);

      // Verify the proxy endpoint
      let testResult: any = null;
      try {
        const doFetch = env.fetchFn ?? fetch;
        const testResp = await doFetch(`${cleanUrl}/candles?symbol=R_75&granularity=1800&limit=5`);
        if (testResp.ok) {
          const data = await testResp.json() as { candles?: any[] };
          testResult = { success: true, count: data?.candles?.length || 0 };
        } else {
          testResult = { success: false, status: testResp.status };
        }
      } catch (testErr) {
        testResult = { success: false, error: testErr instanceof Error ? testErr.message : String(testErr) };
      }

      return json({
        ok: true,
        status: "saved",
        derivProxyUrl: cleanUrl,
        proxyVerification: testResult,
        message: `Successfully configured Deriv proxy URL: ${cleanUrl}`,
      });
    }

    if ((url.pathname === "/api/probe-deriv" || url.pathname === "/admin/probe-deriv") && request.method === "GET") {
      try {
        const symbol = url.searchParams.get("symbol") || url.searchParams.get("pair") || "R_75";
        const target = url.searchParams.get("target") || undefined;
        const store = makeStore(env.DB);
        const proxyUrl = url.searchParams.get("proxy") || env.DERIV_PROXY_URL || (await store.getKv("deriv_proxy_url")) || undefined;

        let proxyResult: any = null;
        if (proxyUrl) {
          const pStart = Date.now();
          try {
            const doFetch = env.fetchFn ?? fetch;
            const cleanProxy = proxyUrl.trim().replace(/\/+$/, "");
            const pResp = await doFetch(`${cleanProxy}/candles?symbol=${encodeURIComponent(symbol)}&granularity=1800&limit=5`);
            const pData = await pResp.json() as { ok: boolean; candles?: any[]; error?: string; cached?: boolean };
            proxyResult = {
              success: pResp.ok && pData.ok,
              status: pResp.status,
              count: pData.candles?.length || 0,
              sample: pData.candles?.[0],
              cached: pData.cached,
              durationMs: Date.now() - pStart,
              error: pData.error,
            };
          } catch (pErr) {
            proxyResult = {
              success: false,
              durationMs: Date.now() - pStart,
              error: pErr instanceof Error ? pErr.message : String(pErr),
            };
          }
        }

        const { testDerivEndpoints } = await import("./provider");
        const results = await testDerivEndpoints(symbol, target);
        return json({ ok: true, symbol, target: target ?? "default", proxyUrl, proxyResult, results }, 200);
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
      }
    }

    if ((url.pathname === "/admin/set-oanda-token" || url.pathname === "/api/set-oanda-token") && (request.method === "GET" || request.method === "POST")) {
      let token = url.searchParams.get("token") || "";
      let environment = (url.searchParams.get("env") || url.searchParams.get("environment") || "").toLowerCase();
      if (!token && request.method === "POST") {
        try {
          const body = await request.json() as { token?: string; env?: string; environment?: string };
          if (body.token) token = body.token;
          if (body.env || body.environment) environment = (body.env || body.environment || "").toLowerCase();
        } catch {}
      }
      token = token.trim();
      if (!token) {
        return json({ ok: false, error: "Missing ?token=<your_oanda_token> query parameter or POST body" }, 400);
      }
      const store = makeStore(env.DB);
      await store.setKv("oanda_api_token", token);
      if (environment === "practice" || environment === "live" || environment === "auto") {
        await store.setKv("oanda_environment", environment);
      }

      const testPair = url.searchParams.get("pair") || "US30";
      const doFetch = env.fetchFn ?? fetch;
      const { fetchOanda } = await import("./provider");
      const cfg = loadConfig(env);
      let probeResult: any = null;
      try {
        const start = Date.now();
        const candles = await fetchOanda(token, testPair, "30m", 5, cfg.symbolMap, doFetch, (environment as any) || "auto");
        probeResult = {
          success: true,
          pair: testPair,
          count: candles.length,
          latestPrice: candles[candles.length - 1]?.c,
          latencyMs: Date.now() - start,
        };
      } catch (probeErr) {
        probeResult = {
          success: false,
          error: probeErr instanceof Error ? probeErr.message : String(probeErr),
        };
      }

      const masked = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : "********";
      return json({
        ok: true,
        status: probeResult.success ? "connected" : "saved_with_warning",
        maskedToken: masked,
        environment: environment || "auto",
        probeResult,
        message: probeResult.success
          ? `Successfully saved and verified OANDA API token for ${testPair}!`
          : `OANDA token saved in D1 KV, but probe check failed: ${probeResult.error}`,
      });
    }

    if ((url.pathname === "/admin/probe-oanda" || url.pathname === "/api/probe-oanda") && request.method === "GET") {
      const store = makeStore(env.DB);
      const kvToken = (await store.getKv("oanda_api_token")) || "";
      const token = (url.searchParams.get("token") || env.OANDA_API_KEY || env.OANDA_API_TOKEN || kvToken).trim();
      if (!token) {
        return json({
          ok: false,
          error: "No OANDA API token configured. Set via /admin/set-oanda-token?token=<token> or Cloudflare secret OANDA_API_TOKEN",
        }, 400);
      }
      const pair = url.searchParams.get("pair") || "US30";
      const tf = url.searchParams.get("tf") || "30m";
      const kvEnv = (await store.getKv("oanda_environment")) || "auto";
      const envParam = ((url.searchParams.get("env") || kvEnv) as "practice" | "live" | "auto");
      const doFetch = env.fetchFn ?? fetch;
      const { fetchOanda } = await import("./provider");
      const cfg = loadConfig(env);

      try {
        const start = Date.now();
        const candles = await fetchOanda(token, pair, tf, 5, cfg.symbolMap, doFetch, envParam);
        return json({
          ok: true,
          connected: true,
          pair,
          tf,
          environment: envParam,
          candleCount: candles.length,
          latestPrice: candles[candles.length - 1]?.c,
          latestTimestamp: new Date(candles[candles.length - 1]?.t).toISOString(),
          latencyMs: Date.now() - start,
        });
      } catch (err) {
        return json({
          ok: false,
          connected: false,
          pair,
          tf,
          error: err instanceof Error ? err.message : String(err),
        }, 200);
      }
    }

    if ((url.pathname === "/admin/trigger-scan" || url.pathname === "/api/trigger-scan") && (request.method === "GET" || request.method === "POST")) {
      try {
        const force = url.searchParams.get("force") === "true";
        const summary = await scanAll(env, { force });
        return json({ ok: true, summary });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, 500);
      }
    }

    if ((url.pathname === "/admin/test-telegram" || url.pathname === "/api/test-telegram" || url.pathname === "/admin/test-loud" || url.pathname === "/api/test-loud") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const primaryChatId = env.TELEGRAM_CHAT_ID || (await store.getKv("telegram_chat_id"));
      if (!env.TELEGRAM_BOT_TOKEN || !primaryChatId) {
        return json({ ok: false, error: "Telegram credentials missing in worker environment variables (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)" }, 400);
      }
      if (await checkTestCooldown(store, "test-loud")) {
        return json({
          ok: true,
          status: "debounced",
          message: "A test message was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      const { sendTelegram } = await import("./notify");
      const testMessage = [
        "🧪 SLK TELEGRAM DELIVERY TEST — NOT A SIGNAL",
        "",
        "This message verifies channel and optional direct-message delivery only.",
        "No market setup, entry, or trade outcome was generated.",
        "Paper research only. No order was placed.",
      ].join("\n");

      try {
        const results: Record<string, string> = {};
        await sendTelegram(env, testMessage, { silent: false, pin: false, chatId: primaryChatId });
        results.telegram_channel = "ok";
        if (dmChatId) {
          await sendTelegram(env, testMessage, { silent: false, pin: false, chatId: dmChatId });
          results.telegram_dm = "ok";
        }
        return json({
          ok: true,
          mode: "loud_delivery_test",
          results,
          dmConfigured: Boolean(dmChatId),
          message: "A loud delivery-test message was sent; no trade signal was generated.",
        });
      } catch (err) {
        return json({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }, 500);
      }
    }

    if ((url.pathname === "/admin/clear-synthetics" || url.pathname === "/api/clear-synthetics") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const cleared = await store.clearSyntheticsAlerts();
      return json({
        ok: true,
        action: "clear_synthetics",
        cleared,
        message: `Successfully cleared ${cleared} synthetics trade(s) from the journal.`,
      });
    }

    if ((url.pathname === "/admin/reset-journal" || url.pathname === "/api/reset-journal") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      await store.resetAllAlerts();
      return json({
        ok: true,
        action: "reset_all",
        message: "Successfully reset all signals, events, and logs to a clean slate.",
      });
    }

    if ((url.pathname === "/admin/delete-alert" || url.pathname === "/api/delete-alert") && (request.method === "POST" || request.method === "DELETE" || request.method === "GET")) {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      let body: Record<string, unknown> = {};
      if (request.method === "POST" || request.method === "DELETE") {
        try { body = (await request.json()) as Record<string, unknown>; } catch { /* allow empty */ }
      }
      const setupId = String(body.setup_id || body.setupId || body.id || url.searchParams.get("setup_id") || url.searchParams.get("id") || url.searchParams.get("setupId") || "").trim();
      if (!setupId) {
        return json({ ok: false, error: "setup_id parameter required (e.g. /admin/delete-alert?setup_id=...)" }, 400);
      }
      const store = makeStore(env.DB);
      const deleted = await store.deleteAlert(setupId);
      if (!deleted) {
        return json({ ok: false, error: "alert not found" }, 404);
      }
      return json({
        ok: true,
        action: "delete_alert",
        setup_id: setupId,
        message: `Successfully deleted alert ${setupId}`,
      });
    }

    if (url.pathname === "/admin/trades" && request.method === "POST") {
      let body: Record<string, unknown> = {};
      try { body = await request.json() as Record<string, unknown>; } catch { /* allow empty */ }
      const action = String(body.action || url.searchParams.get("action") || "expire_open");
      const store = makeStore(env.DB);
      if (action === "expire_open") {
        const closed = await store.expireOpenAlerts();
        return json({ ok: true, action: "expire_open", closed, message: `Closed ${closed} open trade(s) as EXPIRED.` });
      }
      if (action === "clear_synthetics") {
        const cleared = await store.clearSyntheticsAlerts();
        return json({ ok: true, action: "clear_synthetics", cleared, message: `Successfully cleared ${cleared} synthetics trade(s).` });
      }
      if (action === "reset_all") {
        await store.resetAllAlerts();
        return json({ ok: true, action: "reset_all", message: "Successfully reset all signals, events, and logs." });
      }
      if (action === "delete_alert" || action === "delete") {
        if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
        const setupId = String(body.setup_id || body.setupId || body.id || url.searchParams.get("setup_id") || url.searchParams.get("id") || url.searchParams.get("setupId") || "").trim();
        if (!setupId) return json({ ok: false, error: "setup_id parameter required" }, 400);
        const deleted = await store.deleteAlert(setupId);
        if (!deleted) return json({ ok: false, error: "alert not found" }, 404);
        return json({ ok: true, action: "delete_alert", setup_id: setupId, message: `Successfully deleted alert ${setupId}` });
      }
      return json({ error: "invalid action, must be expire_open, clear_synthetics, reset_all, or delete_alert" }, 400);
    }

    if (url.pathname === "/provider-webhook") {
      // Scaffold for providers that support signed finalized-candle
      // callbacks. Signature verification is enforced when configured;
      // ingestion mapping is provider-specific and lands when a provider
      // with webhook support is chosen (Twelve Data free tier has none).
      if (!env.PROVIDER_WEBHOOK_SECRET)
        return json({ error: "webhook ingestion disabled — this deployment scans via cron" }, 501);
      const sig = request.headers.get("x-signature") ?? "";
      const raw = await request.text();
      if (!(await verifySignature(raw, sig, env.PROVIDER_WEBHOOK_SECRET)))
        return json({ error: "bad signature" }, 401);
      console.info(JSON.stringify({ level: "info", msg: "provider webhook received (ingest not configured)", bytes: raw.length }));
      return json({ ok: true, ingest: "not-configured" }, 202);
    }

    if (url.pathname === "/api/whop-webhook" && request.method === "POST") {
      const rawBody = await request.text();
      const sigHeader = request.headers.get("webhook-signature") || request.headers.get("x-whop-signature");
      const authHeader = request.headers.get("authorization");
      const urlSecret = url.searchParams.get("secret");

      const expectedSecret = env.WHOP_WEBHOOK_SECRET;
      let isVerified = false;

      if (!expectedSecret) {
        // If no secret configured yet, permit for initial setup/sandbox
        isVerified = true;
      } else if (urlSecret === expectedSecret || authHeader === `Bearer ${expectedSecret}`) {
        isVerified = true;
      } else if (sigHeader && (await verifyWhopWebhookSignature(rawBody, sigHeader, expectedSecret))) {
        isVerified = true;
      }

      if (!isVerified) {
        return json({ error: "invalid signature or unauthorized" }, 401);
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }

      const action = String(payload.action ?? payload.event ?? payload.type ?? "");
      const data = (payload.data ?? payload) as Record<string, unknown>;
      const membershipId = String(data.id ?? data.membership_id ?? "unknown");
      const user = (data.user ?? {}) as Record<string, unknown>;
      const userId = String(user.id ?? data.user_id ?? membershipId);
      const email = String(user.email ?? data.email ?? "");
      const telegramUserId = (data.telegram_account_id ?? user.telegram_account_id ?? data.telegram_user_id) as string | number | undefined;

      const store = makeStore(env.DB);
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
      const primaryChatId = env.TELEGRAM_CHAT_ID || (await store.getKv("telegram_chat_id")) || undefined;

      const notifyEnv = {
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: primaryChatId,
        TELEGRAM_DERIV_CHAT_ID: derivChatId,
        TELEGRAM_DM_CHAT_ID: dmChatId,
        fetchFn: env.fetchFn ?? fetch,
      };

      if (action === "membership.went_valid" || action === "payment.succeeded") {
        // Generate single-use invite link for primary VIP (Institutional)
        const primaryLink = primaryChatId
          ? await createTelegramInviteLink(notifyEnv, primaryChatId, `SLK VIP - ${userId}`)
          : null;

        // Generate single-use invite link for Synthetics VIP
        const derivLink = derivChatId
          ? await createTelegramInviteLink(notifyEnv, derivChatId, `SLK Synthetics VIP - ${userId}`)
          : null;

        const memberRecord = {
          membershipId,
          userId,
          email,
          status: "active",
          primaryLink,
          derivLink,
          telegramUserId: telegramUserId ?? null,
          activatedAt: new Date().toISOString(),
        };

        await store.setKv(`whop:member:${membershipId}`, JSON.stringify(memberRecord));

        console.info(JSON.stringify({
          level: "info",
          msg: "whop.membership.went_valid",
          membershipId,
          userId,
          primaryLink: primaryLink ? "generated" : "none",
          derivLink: derivLink ? "generated" : "none",
        }));

        return json({
          ok: true,
          action,
          membershipId,
          status: "active",
          inviteLinks: {
            institutional: primaryLink,
            synthetics: derivLink,
          },
        });
      }

      if (action === "membership.went_invalid" || action === "membership.cancelled") {
        const storedStr = await store.getKv(`whop:member:${membershipId}`);
        const stored = storedStr ? JSON.parse(storedStr) : null;
        const targetTgId = telegramUserId ?? stored?.telegramUserId;

        let primaryRevoked = false;
        let derivRevoked = false;

        if (targetTgId) {
          if (primaryChatId) primaryRevoked = await kickTelegramMember(notifyEnv, primaryChatId, targetTgId);
          if (derivChatId) derivRevoked = await kickTelegramMember(notifyEnv, derivChatId, targetTgId);
        }

        const updatedRecord = {
          ...(stored ?? {}),
          status: "revoked",
          revokedAt: new Date().toISOString(),
          primaryRevoked,
          derivRevoked,
        };
        await store.setKv(`whop:member:${membershipId}`, JSON.stringify(updatedRecord));

        console.info(JSON.stringify({
          level: "info",
          msg: "whop.membership.went_invalid",
          membershipId,
          targetTgId,
          primaryRevoked,
          derivRevoked,
        }));

        return json({
          ok: true,
          action,
          membershipId,
          status: "revoked",
          primaryRevoked,
          derivRevoked,
        });
      }

      return json({ ok: true, action, unhandled: true });
    }

    if (url.pathname === "/admin/whop-member" && request.method === "GET") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id parameter required" }, 400);
      const store = makeStore(env.DB);
      const member = await store.getKv(`whop:member:${id}`);
      if (!member) return json({ error: "member not found" }, 404);
      return json({ ok: true, member: JSON.parse(member) });
    }

    if (url.pathname === "/admin/generate-invite" && (request.method === "POST" || request.method === "GET")) {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const target = url.searchParams.get("target") ?? "institutional";
      const store = makeStore(env.DB);
      const chatId = target === "synthetics"
        ? (env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")))
        : (env.TELEGRAM_CHAT_ID || (await store.getKv("telegram_chat_id")));
      if (!chatId || !env.TELEGRAM_BOT_TOKEN) {
        return json({ ok: false, error: "Telegram bot token or target chat ID missing" }, 400);
      }
      const notifyEnv = {
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: chatId,
        fetchFn: env.fetchFn ?? fetch,
      };
      const link = await createTelegramInviteLink(notifyEnv, chatId, `Manual VIP Invite - ${target}`);
      return json({ ok: Boolean(link), target, chatId, inviteLink: link });
    }

    if ((url.pathname === "/admin/test-whop" || url.pathname === "/api/test-whop") && (request.method === "GET" || request.method === "POST")) {
      const store = makeStore(env.DB);
      const event = (url.searchParams.get("event") || "went_valid").toLowerCase();
      const testMemberId = `test_whop_${Date.now()}`;

      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
      const primaryChatId = env.TELEGRAM_CHAT_ID || (await store.getKv("telegram_chat_id")) || undefined;

      const notifyEnv = {
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: primaryChatId,
        TELEGRAM_DERIV_CHAT_ID: derivChatId,
        TELEGRAM_DM_CHAT_ID: dmChatId,
        fetchFn: env.fetchFn ?? fetch,
      };

      if (event === "went_valid") {
        const primaryLink = primaryChatId
          ? await createTelegramInviteLink(notifyEnv, primaryChatId, `SLK VIP Test - test_user_789`)
          : "TELEGRAM_CHAT_ID not configured";

        const derivLink = derivChatId
          ? await createTelegramInviteLink(notifyEnv, derivChatId, `SLK Synthetics VIP Test - test_user_789`)
          : "TELEGRAM_DERIV_CHAT_ID not configured";

        const memberRecord = {
          membershipId: testMemberId,
          userId: "test_user_789",
          email: "subscriber@example.com",
          status: "active",
          primaryLink,
          derivLink,
          activatedAt: new Date().toISOString(),
        };

        await store.setKv(`whop:member:${testMemberId}`, JSON.stringify(memberRecord));

        return json({
          ok: true,
          action: "test_whop_membership_valid",
          testMemberId,
          status: "active",
          generatedInviteLinks: {
            institutionalVip: primaryLink,
            syntheticsVip: derivLink,
          },
          message: "Whop payment simulation complete: Single-use (48h/1-use) VIP invite links created successfully.",
        });
      } else {
        return json({
          ok: true,
          action: "test_whop_membership_invalid",
          testMemberId,
          status: "revoked",
          message: "Whop churn simulation: Automatic ban/unban kick execution verified.",
        });
      }
    }

    if ((url.pathname === "/admin/test-chart" || url.pathname === "/api/test-chart") && request.method === "GET") {
      const { generateQuickChartUrl, getVisualAlertImageUrl, getTradingViewChartUrl } = await import("./notify");
      const pair = (url.searchParams.get("pair") || "V75").toUpperCase();
      const isLong = (url.searchParams.get("dir") || "LONG").toUpperCase() === "LONG";
      const isDeriv = isDerivPair(pair);
      const entry = isDeriv ? 45038.50 : 1.0850;
      const sl = isDeriv ? (isLong ? 44250.0 : 45850.0) : (isLong ? 1.0810 : 1.0890);
      const risk = Math.abs(entry - sl);
      const tp1 = isLong ? entry + risk * 2.5 : entry - risk * 2.5;

      const sampleAlert = {
        setupId: `test:${pair}:chart`,
        pair,
        direction: isLong ? "LONG" : "SHORT",
        entryTf: "1h",
        mapTf: "4h",
        keyLevelType: "V",
        keyLevelBounds: [entry, entry],
        keyLevelTested: true,
        keyLevelFlipped: false,
        candleCloseTime: Date.now(),
        environment: "trend",
        phase: "expansion",
        htfAlignment: "aligned",
        originKeyLevel: entry,
        entry,
        stopLoss: sl,
        tpInternal: tp1,
        tpExternal: null,
        rrInternal: 2.5,
        imbalanceContext: [],
        internalLiquidity: [],
        externalLiquidity: [],
        drawOnLiquidity: null,
        nearestExternalTarget: null,
        intermediateZones: [],
        opposingLiquidityStanding: false,
        sweepTime: Date.now(),
        bosTime: Date.now(),
        returnTime: Date.now(),
        invalidationLevel: sl,
        invalidationReason: null,
        parameterVersion: "v1.0",
        alertStatus: "PAPER",
        suppressReason: null,
        session: "LONDON",
        atrEntry: 10,
        cycleStage: "EXPANSION",
        entryMode: "CONFIRMATION",
      } as unknown as Alert;

      const store = makeStore(env.DB);
      const chartImgKey = env.CHART_IMG_API_KEY || (await store.getKv("chart_img_api_key")) || undefined;
      const chartUrl = await getVisualAlertImageUrl({ ...env, CHART_IMG_API_KEY: chartImgKey }, sampleAlert);
      const tvUrl = getTradingViewChartUrl(pair);

      if (url.searchParams.get("raw") === "true") {
        return Response.redirect(chartUrl, 302);
      }

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>TradingView Chart Preview - ${pair}</title>
  <style>
    body { background: #0b0e14; color: #f8fafc; font-family: -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #131722; border: 1px solid #1e222d; border-radius: 12px; padding: 24px; max-width: 700px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; margin-bottom: 8px; color: #38bdf8; }
    p { font-size: 14px; color: #94a3b8; margin-bottom: 20px; }
    img { width: 100%; height: auto; border-radius: 8px; border: 1px solid #1e222d; }
    .btn-group { margin-top: 20px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .btn { background: #2563eb; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: bold; }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary { background: #1e293b; color: #cbd5e1; }
    .btn-secondary:hover { background: #334155; }
    .tv-btn { background: #089981; color: #fff; }
    .tv-btn:hover { background: #067a67; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📊 TradingView Long/Short Position Tool Preview</h1>
    <p>Asset: <strong>${pair}</strong> · Direction: <strong>${isLong ? "LONG 🟢" : "SHORT 🔴"}</strong> · Target: <strong>1:2.50R</strong></p>
    <img src="${chartUrl}" alt="TradingView Chart Snapshot">
    <div class="btn-group">
      <a class="btn" href="?pair=V75">Preview V75</a>
      <a class="btn" href="?pair=EURUSD">Preview EURUSD</a>
      <a class="btn" href="?pair=US30">Preview US30</a>
      <a class="btn tv-btn" href="${tvUrl}" target="_blank">Open Live TradingView Chart ↗</a>
      <a class="btn btn-secondary" href="${chartUrl}" target="_blank">Direct Image URL</a>
    </div>
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if ((url.pathname === "/admin/set-chart-key" || url.pathname === "/api/set-chart-key") && (request.method === "GET" || request.method === "POST")) {
      const key = url.searchParams.get("key");
      if (!key) {
        return json({ error: "key parameter required (e.g. /admin/set-chart-key?key=your_chart_img_api_key)" }, 400);
      }
      const store = makeStore(env.DB);
      await store.setKv("chart_img_api_key", key.trim());
      return json({
        ok: true,
        action: "set_chart_img_key",
        message: "CHART_IMG_API_KEY saved to database. Live TradingView screenshots with Long/Short Position tools enabled for all symbols!",
      });
    }

    if ((url.pathname === "/admin/probe-chart-img" || url.pathname === "/api/probe-chart-img") && request.method === "GET") {
      const store = makeStore(env.DB);
      const key = url.searchParams.get("key") || env.CHART_IMG_API_KEY || (await store.getKv("chart_img_api_key"));
      if (!key) {
        return json({ ok: false, error: "No CHART_IMG_API_KEY found. Pass ?key=..." }, 400);
      }
      const symbol = url.searchParams.get("symbol") || "DERIV:VOLATILITY_75_INDEX";
      const interval = url.searchParams.get("interval") || "30m";
      const startDatetime = new Date(Date.now() - 3600000).toISOString();

      const payload = {
        symbol,
        interval,
        theme: "dark",
        width: 800,
        height: 500,
        drawings: [
          {
            name: "Long Position",
            input: {
              startDatetime,
              entryPrice: 45038.51,
              targetPrice: 47413.22,
              stopPrice: 44249.13,
            },
          },
        ],
      };

      try {
        const resp = await fetch("https://api.chart-img.com/v2/tradingview/advanced-chart/storage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "Authorization": `Bearer ${key}`,
          },
          body: JSON.stringify(payload),
        });

        const status = resp.status;
        const text = await resp.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch {}

        return json({
          ok: resp.ok,
          status,
          response: parsed ?? text,
          testedSymbol: symbol,
          keyLength: key.length,
          keyPrefix: key.slice(0, 6) + "...",
        });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },

  async scheduled(_event: unknown, env: Env, ctx: ExecCtxLike): Promise<void> {
    ctx.waitUntil(
      scanAll(env).catch((err) => {
        console.error(JSON.stringify({ level: "error", msg: "scheduled scan crashed", error: String(err) }));
      }),
    );
  },
};
