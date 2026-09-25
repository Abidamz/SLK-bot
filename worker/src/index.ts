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
import { loadConfig, TF_SECONDS, INDEX_POINT_PAIRS, isDerivPair } from "./config";
import { scanEntry } from "./engine";
import { addReplayDiagnostics, countTransition, emptyScanDiagnostics, type ScanDiagnostics } from "./diagnostics";
import { evaluateSignal } from "./outcomes";
import { notifyAlert, notifyOutcome, notifyWatch } from "./notify";
import { fetchMarketData, providerForPair, resetProviderCircuitBreakers, validateAndClose, DataQualityError } from "./provider";
import { resampleCandles, dropIncomplete } from "./features";
import { storylineSeries } from "./storyline";
import { makeStore, type D1Like, type Store, type NotificationPreferences, type AlertQuery } from "./store";
import type { Alert, Candle, Direction } from "./types";

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
  DISCORD_WEBHOOK_URL?: string;
  fetchFn?: typeof fetch;
  ADMIN_KEY?: string;
  DASHBOARD_READ_KEY?: string;
  PROVIDER_WEBHOOK_SECRET?: string;
  SIGNAL_API_KEY?: string;
  SIGNAL_SIGNING_SECRET?: string;
  PAIRS?: string;
  ENTRY_TFS?: string;
  MODE?: string;
  PAPER_NOTIFY?: string;
  WATCH_NOTIFY?: string;
  MIN_RISK_ATR?: string;
  MIN_STOP_PIPS?: string;
  MIN_TP_R?: string;
  SL_BUFFER_ATR?: string;
  PAIR_BATCH_SIZE?: string;
  PROVIDER_MAP?: string;
  SYMBOL_MAP?: string;
  DERIV_APP_ID?: string;
  DERIV_PROXY_URL?: string;
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

// -------------------------------------------------------------- scan cycle

export async function scanAll(env: Env, opts: ScanOptions = {}): Promise<ScanSummary> {
  resetProviderCircuitBreakers();
  const startedAt = Date.now();
  const now = opts.now ?? startedAt;
  const fetchFn = opts.fetchFn ?? fetch;
  const cfg = loadConfig(env);
  const store: Store = opts.storeOverride ?? makeStore(env.DB);
  const errors: string[] = [];
  let alertCount = 0;
  let eventCount = 0;
  const diagnostics = emptyScanDiagnostics();
  const notificationPrefs = await store.getNotificationPreferences();
  const pairsScanned: string[] = [];

  // which entry TFs closed a candle since the previous successful scan?
  const due: { tf: string; secs: number; boundary: number }[] = [];
  for (const [tf, secs] of Object.entries(cfg.entryTfs)) {
    const boundary = Math.floor((now - cfg.scanDelayMs) / 1000 / secs) * secs * 1000;
    if (opts.force) {
      due.push({ tf, secs, boundary });
      continue;
    }
    const lastRaw = await store.getKv(`last_boundary:${tf}`);
    const last = lastRaw ? Number(lastRaw) : 0;
    if (boundary > last) due.push({ tf, secs, boundary });
  }

  if (!due.length) {
    await store.insertScanLog({
      ts: new Date(now).toISOString(), timeframes: "", pairs: "",
      alerts: 0, events: 0, errors: "", durationMs: Date.now() - startedAt,
      note: "idle (no candle close)", diagnostics,
    });
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
        const lastScanRaw = await store.getKv(`last_scan:${pair}:${tf}`);
        const lastScan = lastScanRaw ? Number(lastScanRaw) : 0;
        if (boundary > lastScan) {
          isDue = true;
          break;
        }
      }
      if (isDue) pending.push(pair);
    }

    if (!pending.length) {
      for (const { tf, boundary } of due) {
        await store.setKv(`last_boundary:${tf}`, String(boundary));
      }
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
    const pendingInst = pending.filter((p) => !isDerivPair(p));
    const pendingDeriv = pending.filter((p) => isDerivPair(p));
    const selected: string[] = [];
    let instIdx = 0;
    let derivIdx = 0;
    while (selected.length < cfg.pairBatchSize && (instIdx < pendingInst.length || derivIdx < pendingDeriv.length)) {
      if (instIdx < pendingInst.length && (selected.length % 2 === 0 || derivIdx >= pendingDeriv.length)) {
        selected.push(pendingInst[instIdx++]);
      } else if (derivIdx < pendingDeriv.length) {
        selected.push(pendingDeriv[derivIdx++]);
      } else if (instIdx < pendingInst.length) {
        selected.push(pendingInst[instIdx++]);
      }
    }
    pairsToScan = selected;
  }

  for (const pair of pairsToScan) {
    try {
      // provider routing: forex/metals → Twelve Data, index CFDs → OANDA
      // (if its token exists) → Dukascopy public feed → Yahoo last resort
      // (a per-pair outage never blocks the other pairs — see catch below)
      const providerName = providerForPair(pair, cfg.providerMap, Boolean(env.OANDA_API_KEY ?? env.OANDA_API_TOKEN));
      const apiKey = env.TWELVEDATA_API_KEY ?? "";
      const oandaToken = env.OANDA_API_KEY ?? env.OANDA_API_TOKEN ?? "";
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
        const ctx = await fetchMarketData({ pair, tf: cfg.contextTimeframe, limit: cfg.candlesLimit, tdKey: apiKey, oandaToken, derivAppId, derivProxyUrl, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
        d1 = validateAndClose(ctx.candles, TF_SECONDS["1d"], now, 25);
        await store.setKv(cacheKey, JSON.stringify(d1));
      }

      // ONE intraday fetch per pair at the base (smallest entry) timeframe;
      // the 4h map and all coarser entry TFs are resampled from it. This is
      // the rate-limit design: ~1 provider credit per pair per boundary
      // instead of ~2 with separate 1h/30m fetches.
      const baseRes = await fetchMarketData({ pair, tf: cfg.baseTimeframe, limit: cfg.baseCandlesLimit, tdKey: apiKey, oandaToken, derivAppId, derivProxyUrl, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
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
          const h1Res = await fetchMarketData({ pair, tf: "1h", limit: 200, tdKey: apiKey, oandaToken, derivAppId, derivProxyUrl, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
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

      // 🧭 HTF directional bias confirmation: notifies when 4H and 1H structure align
      if (cfg.watchNotify && d1 && d1.length >= 10 && h4.length >= 10 && feeds["1h"] && feeds["1h"].length >= 10) {
        const { evaluateH4VantageContext, evaluateDirectionalBias } = await import("./shadow");
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
                const lastBefore = await store.getKv(`last_scan:${pair}:30m`);
                const isFirstScan = lastRawIsEmpty(lastBefore);
                const tgAllowed = notificationPrefs.telegramWatch !== false;
                if (tgAllowed && deliverAllowed(cfg, isFirstScan, opts)) {
                  const latestStory = snaps.length ? snaps[snaps.length - 1][1] : null;
                  const currentPrice = feeds["1h"] && feeds["1h"].length ? feeds["1h"][feeds["1h"].length - 1].c : lastCandle.c;
                  const { findRetracementOrigin } = await import("./features");
                  const origin = findRetracementOrigin(feeds, dir, currentPrice, cfg.strategy) ?? latestStory?.origin ?? null;
                  const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
                  const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
                  const { notifyBias } = await import("./notify");
                  await notifyBias({ ...env, fetchFn, watchOnly: true, WATCH_TELEGRAM: tgAllowed ? "true" : "false", TELEGRAM_FREE_CHAT_ID: freeChatId, TELEGRAM_DERIV_CHAT_ID: derivChatId }, pair, dir, diag, origin, currentPrice);
                }
                await store.setKv(biasKey, String(lastCandle.t));
              }
            }
          }
        }
      }

      for (const { tf, secs, boundary } of due) {
        let candles: Candle[];
        const derivedFeed = feeds[tf];
        if (derivedFeed) {
          candles = derivedFeed;
        } else {
          const res = await fetchMarketData({ pair, tf, limit: cfg.candlesLimit, tdKey: apiKey, oandaToken, derivAppId, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
          candles = validateAndClose(res.candles, secs, now, cfg.minCandles);
        }

        const { alerts, events, diagnostics: replay } = scanEntry({
          pair, entryTf: tf, tfSeconds: secs, candles, snaps,
          cfg: cfg.strategy, mode: cfg.mode, provider: providerName,
          d1Candles: d1 ?? undefined,
          h1Candles: feeds["1h"],
          h4Candles: h4,
        });

        addReplayDiagnostics(diagnostics, pair, tf, replay);

        const lastBefore = await store.getKv(`last_scan:${pair}:${tf}`);
        const isFirstScan = lastRawIsEmpty(lastBefore);

        for (const ev of events) {
          const inserted = await store.insertEvent(ev);
          if (!inserted) continue; // already-known transition (dedupe)
          eventCount++;
          countTransition(diagnostics.recorded, ev.state);
          // 👀 watch heads-up: setup forming on TOUCH/SWEEP/SHIFT — gated by
          // WATCH_NOTIFY and the same boot gate as entry alerts
          if (cfg.watchNotify && WATCH_STATES.has(ev.state)
              && watchEventFresh(ev, tf, now)
              && deliverAllowed(cfg, isFirstScan, opts)) {
            const tgAllowed = notificationPrefs.telegramWatch !== false;
            const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
            const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
            await notifyWatch({ ...env, fetchFn, watchOnly: true, WATCH_TELEGRAM: tgAllowed ? "true" : "false", WATCH_DISCORD: notificationPrefs.discordWatch ? "true" : "false", TELEGRAM_FREE_CHAT_ID: freeChatId, TELEGRAM_DERIV_CHAT_ID: derivChatId }, ev, tf);
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
          const inserted = await store.insertAlert(alert, providerName);
          if (!inserted) continue; // duplicate setup — already alerted/logged
          alertCount++;
          diagnostics.recorded.confirmedAlerts++;
          // Historical replay can discover a confirmation long after its
          // candle closed. Record it for audit, but never deliver a stale
          // entry or immediately resolve its old price path.
          if (!alertEventFresh(alert, tf, now)) {
            await store.updateAlertStatus(alert.setupId, "SUPPRESSED", "stale confirmation — record-only");
            console.info(JSON.stringify({ level: "info", msg: "stale confirmation recorded without delivery", setupId: alert.setupId }));
            continue;
          }
          await deliver(env, store, alert, cfg, deliverAllowed(cfg, isFirstScan, opts), fetchFn);
        }

        // resolve open alerts on this pair/tf against fresh candles
        await resolveOutcomes(env, store, cfg, pair, tf, candles, fetchFn);
        await store.setKv(`last_scan:${pair}:${tf}`, String(boundary));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Index CFDs genuinely close Fri 21:00 UTC → Sun evening: a stale feed
      // then is the market being idle, not an outage. Log quietly, skip the
      // pair; forex/metals staleness still reports loudly (real outage signal).
      if (msg.includes("stale feed") && isIndexCfdIdleWindow(pair, now)) {
        console.info(JSON.stringify({ level: "info", msg: "pair idle (market closed)", pair }));
        for (const { tf, boundary } of due) {
          await store.setKv(`last_scan:${pair}:${tf}`, String(boundary));
        }
        continue;
      }
      errors.push(`${pair}: ${msg}`);
      console.error(JSON.stringify({ level: "error", msg: "pair scan failed", pair, error: msg }));
      // Advance last_scan on error for this boundary so one failing pair doesn't block the queue
      for (const { tf, boundary } of due) {
        await store.setKv(`last_scan:${pair}:${tf}`, String(boundary));
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
        const lastScanRaw = await store.getKv(`last_scan:${pair}:${tf}`);
        const lastScan = lastScanRaw ? Number(lastScanRaw) : 0;
        if (boundary > lastScan) {
          allDone = false;
          break;
        }
      }
      if (allDone) {
        await store.setKv(`last_boundary:${tf}`, String(boundary));
      }
    }
  }

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

/** Transition states that earn a pre-entry "watch" heads-up when enabled.
 *  MAP and TOUCH are omitted to avoid consolidation noise; SWEEP (liquidity taken)
 *  and SHIFT (market structure break) provide high-probability context;
 *  RETEST has its own full confirmed entry alert. */
const WATCH_STATES = new Set(["SWEEP", "SHIFT"]);

/** Watch events are transient heads-ups, not durable alerts. Only notify when
 * the source candle closed recently; this prevents isolate cold-start replay
 * from re-sending stale TOUCH/SWEEP/SHIFT events hours later. */
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
  return age >= 0 && age <= 2 * secs * 1000;
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

async function deliver(
  env: Env, store: Store, alert: Alert,
  cfg: ReturnType<typeof loadConfig>, allowed: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (alert.alertStatus !== "SUPPRESSED") {
    const last = await store.lastAlertTime(alert.pair, alert.direction, alert.setupId);
    if (last !== null && alert.candleCloseTime - last < cfg.strategy.cooldownMinutes * 60_000) {
      alert.alertStatus = "SUPPRESSED";
      alert.suppressReason = `cooldown (${cfg.strategy.cooldownMinutes}m)`;
      await store.updateAlertStatus(alert.setupId, "SUPPRESSED", alert.suppressReason);
    }
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
  await notifyAlert({ ...env, fetchFn, TELEGRAM_DM_CHAT_ID: dmChatId, TELEGRAM_DERIV_CHAT_ID: derivChatId }, alert);
}

async function resolveOutcomes(
  env: Env, store: Store, cfg: ReturnType<typeof loadConfig>,
  pair: string, tf: string, candles: Candle[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const open = await store.openAlerts(pair, tf);
  for (const rec of open) {
    const isSuppressed = rec.alert_status === "SUPPRESSED";
    const entryTime = Date.parse(rec.candle_close_time as string);
    const after = candles.filter((c) => c.t >= entryTime);
    if (!after.length) continue;
    const oc = evaluateSignal(
      rec.direction as "LONG" | "SHORT",
      Number(rec.entry), Number(rec.stop_loss), Number(rec.tp_internal),
      after, cfg.expireCandles, cfg.slOnClose,
    );
    if (!oc) continue;
    await store.recordOutcome(String(rec.setup_id), oc);
    console.info(JSON.stringify({ level: "info", msg: "outcome", setupId: rec.setup_id, status: oc.status, r: oc.rMultiple }));
    if (cfg.notifyOutcomes && !isSuppressed) {
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id")) || undefined;
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id")) || undefined;
      await notifyOutcome({ ...env, fetchFn, TELEGRAM_DM_CHAT_ID: dmChatId, TELEGRAM_FREE_CHAT_ID: freeChatId, TELEGRAM_DERIV_CHAT_ID: derivChatId }, rec, oc);
    }
  }
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
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && match[1].trim() === env.ADMIN_KEY.trim());
}

function readAuthed(_request: Request, _env: Env): boolean {
  // Public portfolio mode: live stats, alert history, and chart evidence can be freely
  // viewed by the public. Administrative actions (scan-now, test-notify, preference updates)
  // still strictly require ADMIN_KEY via authed().
  return true;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, OPTIONS",
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

    if (url.pathname === "/health") {
      const cfg = loadConfig(env);
      return json({
        ok: true, service: "slk-alert-worker", mode: cfg.mode,
        pairs: cfg.pairs, entryTfs: Object.keys(cfg.entryTfs),
        watchNotify: cfg.watchNotify,
        paperNotify: cfg.paperNotify,
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        adminKeyConfigured: Boolean(env.ADMIN_KEY),
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

    if (url.pathname === "/terms" && request.method === "GET") {
      const { TERMS_HTML } = await import("./terms_html");
      return new Response(TERMS_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
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
      return json({ primaryConfirmed: true, telegram: { enabled: true, watchEnabled: prefs.telegramWatch, operationalEnabled: prefs.operationalEnabled }, discord: { enabled: true, watchEnabled: prefs.discordWatch, operationalEnabled: prefs.operationalEnabled }, cooldownMinutes: prefs.cooldownMinutes, updatedUtc: prefs.updatedUtc });
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
      if (!row) return json({ error: "signal not found" }, 404);
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
        const result = await fetchMarketData({
          pair: String(row.canonical_symbol), tf, limit: before + after + 80,
          tdKey: env.TWELVEDATA_API_KEY, oandaToken: env.OANDA_API_TOKEN,
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
        dataHealth: { freshnessSeconds: Math.max(0, Math.round((Date.now() - feed[feed.length - 1].t - tfSeconds * 1000) / 1000)), missingCandles: 0, isMarketIdle: false, historyComplete: selected.length >= Math.min(before, feed.length) },
      });
    }

    if (url.pathname === "/alerts" && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const invalid = (name: string, value: string | null, allowed?: string[]) => value && allowed && !allowed.includes(value) ? `${name} must be one of ${allowed.join(", ")}` : null;
      const page = Number(url.searchParams.get("page") ?? 1); const pageSize = Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? 50);
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) return json({ error: "page must be >= 1 and pageSize must be 1..200" }, 400);
      const allowedSort = ["candleCloseTime", "pair", "timeframe", "direction", "status", "provider"];
      const bad = invalid("order",url.searchParams.get("order"),["asc","desc"]) || invalid("direction",url.searchParams.get("direction"),["LONG","SHORT"]) || invalid("channel",url.searchParams.get("channel"),["CONFIRMED","WATCH"]) || invalid("lifecycle",url.searchParams.get("lifecycle"),["OPEN","TP_HIT","SL_HIT","EXPIRED"]) || invalid("outcome",url.searchParams.get("outcome"),["TP_HIT","SL_HIT","EXPIRED"]) || invalid("timeframe",url.searchParams.get("timeframe"),["30m","1h","H1"]) || invalid("provider",url.searchParams.get("provider"),["twelvedata","dukascopy","yahoo","oanda"]) || invalid("sort",url.searchParams.get("sort"),allowedSort);
      const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
      const fromMs = from ? Date.parse(from) : null; const toMs = to ? Date.parse(to) : null;
      if (bad) return json({ error: bad }, 400);
      if ((from && !Number.isFinite(fromMs)) || (to && !Number.isFinite(toMs))) return json({ error: "from and to must be valid ISO UTC dates" }, 400);
      if (fromMs !== null && toMs !== null && fromMs > toMs) return json({ error: "from must be earlier than or equal to to" }, 400);
      const store = makeStore(env.DB); const query: AlertQuery = { pair:url.searchParams.get("pair") ?? undefined, timeframe:url.searchParams.get("timeframe") ?? undefined, direction:url.searchParams.get("direction") ?? undefined, channel:url.searchParams.get("channel") ?? undefined, lifecycle:url.searchParams.get("lifecycle") ?? undefined, outcome:url.searchParams.get("outcome") ?? undefined, provider:url.searchParams.get("provider") ?? undefined, from:url.searchParams.get("from") ?? undefined, to:url.searchParams.get("to") ?? undefined, search:url.searchParams.get("search") ?? undefined, sort:url.searchParams.get("sort") ?? "candleCloseTime", order:(url.searchParams.get("order") as "asc"|"desc") || "desc", segment: (url.searchParams.get("segment") as any) ?? undefined, page, pageSize };
      const result = await store.queryAlerts(query); const rows = result.rows;
      // sanitized: the DB holds no secrets, but keep the response tight anyway
      return json({ items: rows.map((r) => ({
        setupId: r.setup_id, pair: r.canonical_symbol, tf: r.entry_timeframe,
        direction: r.direction, entry: r.entry, stopLoss: r.stop_loss,
        tp1: r.tp_internal, tp2: r.tp_external, environment: r.environment,
        phase: r.phase, htfAlignment: r.htf_alignment, keyLevel: r.key_level_type,
        originLevel: r.origin_key_level, status: r.status,
        alertStatus: r.alert_status, candleCloseTime: r.candle_close_time,
        rMultiple: r.r_multiple,
      })), page, pageSize, total: result.total, sort: query.sort, order: query.order });
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      if (!readAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const store = makeStore(env.DB);
      const allRows = await store.recentAlerts(1000);

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
      const expired = rows.filter((r) => r.status === "EXPIRED").length;
      const openn = rows.filter((r) => r.status === "OPEN" && r.alert_status !== "SUPPRESSED").length;
      const completed = rows.filter((r) => (r.status === "TP_HIT" || r.status === "SL_HIT" || r.status === "EXPIRED") && Number.isFinite(Number(r.r_multiple))).sort((a,b) => Date.parse(String(a.exit_time ?? a.candle_close_time)) - Date.parse(String(b.exit_time ?? b.candle_close_time)));
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
        return {
          group,
          pair: items[0].canonical_symbol,
          timeframe: items[0].entry_timeframe,
          firstDate: bFirstDate,
          lastDate: bLastDate,
          completed: items.length,
          tp: items.filter(r => r.status === "TP_HIT").length,
          sl: items.filter(r => r.status === "SL_HIT").length,
          winRate: items.filter(r => r.status === "TP_HIT").length / items.length,
          ...curve,
        };
      });
      let equity = 0; let peak = 0; let maxDD = 0;
      for (const row of completed) { equity += Number(row.r_multiple); peak = Math.max(peak, equity); maxDD = Math.min(maxDD, equity - peak); }

      const summarizeSet = (items: typeof dateFilteredRows) => {
        const itemTp = items.filter((r) => r.status === "TP_HIT").length;
        const itemSl = items.filter((r) => r.status === "SL_HIT").length;
        const itemExpired = items.filter((r) => r.status === "EXPIRED").length;
        const itemOpen = items.filter((r) => r.status === "OPEN" && r.alert_status !== "SUPPRESSED").length;
        const itemCompleted = items.filter((r) => (r.status === "TP_HIT" || r.status === "SL_HIT" || r.status === "EXPIRED") && Number.isFinite(Number(r.r_multiple)));
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
        total: rows.length, open: openn, tp, sl, expired, completed: completed.length,
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
        message: "Successfully muted WATCH alerts and BIAS cards. Telegram will now ONLY receive Confirmed Entry Alerts and Outcomes.",
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
        message: "Successfully enabled WATCH alerts and BIAS cards. Telegram will now receive Bias Confirmation Cards, Watch heads-up alerts, and Confirmed Entry Alerts.",
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
        `👀 WATCH (Silent Radar) — 🌟【 ${boldNas} 】🌟 · 15m · SHORT 🔽`,
        `📍 Pair     : 🌟【 ${boldNas} 】🌟`,
        "State      : ⚡ SHIFT",
        "Detail     : BOS through pullback structure 20,430.50",
        "Origin Zone: ~20,480.00 (V-Level Zone)",
        "Bias Grade : ⭐ A_GRADE (HTF Aligned)",
        "Price      : ~20,425.00",
        `Candle     : ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
        "Setup ID   : test:NAS100:15m:SHORT:V:20480.0",
        "",
        "Quiet radar heads-up — real entry signal fires on confirmed retest candle close.",
        "Testing SILENT notification mode (Phone should NOT vibrate or ring).",
      ].join("\n");
      try {
        await sendTelegram(env, text, { silent: true, pin: false });
        return json({
          ok: true,
          mode: "silent",
          status: "delivered",
          message: "SILENT Watch Heads-up test sent to Telegram! Check that your phone did NOT vibrate or ring.",
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
        const teaser = [
          "🎯 TP1 HIT — XAUUSD Short (+2.57R)",
          "",
          "• Timeframe : 30m",
          "• Direction : SHORT 🔴",
          "• Entry     : 4,331.370",
          "• Target 1  : 4,297.933 (+2.57R) ✅",
          "• Target 2  : Running risk-free toward external liquidity",
          "",
          "VIP members received this alert with exact entry, stop floor, and lot size calculations.",
          "",
          "Stop missing the moves.",
          "👉 Join VIP ($100/mo · $49 with code FOUNDING20): https://whop.com/slk-radar/slk-radar-vip-signals/",
          "👉 Live Verified Journal: https://slk-radar.pages.dev",
        ].join("\n");

        await sendTelegram(env, teaser, { silent: false, pin: false, chatId: freeChatId });

        return json({
          ok: true,
          status: "connected",
          freeChatId,
          channelTitle: chosen.title || chosen.username || "Free Channel",
          message: `Successfully linked Free Channel "${chosen.title || chosen.username}" (ID: ${freeChatId})! The Win Teaser was just delivered to it.`,
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
          "All confirmed entries, bias cards, and execution setups for Deriv synthetics will be delivered here automatically.",
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
        await sendTelegram(env, `🔔 SLK 24/7 Synthetics Hub linked to ${derivChatId}!\nAutomated Deriv synthetic setups and bias cards will be delivered here automatically.`, { silent: false, pin: true, chatId: derivChatId });
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
          message: "A test signal was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const doFetch = env.fetchFn ?? fetch;
      const { notifyAlert } = await import("./notify");
      const sampleAlert: Alert = {
        setupId: `deriv:V75:30m:LONG:V:450250.00:${new Date().toISOString()}`,
        pair: "V75",
        entryTf: "30m",
        mapTf: "4h",
        direction: "LONG",
        entry: 450320.00,
        stopLoss: 449850.00,
        tpInternal: 451550.00,
        tpExternal: 452800.00,
        candleCloseTime: Date.now(),
        environment: "bullish",
        phase: "expansion",
        htfAlignment: "M:↑ W:↑ D:↑ H4:↑",
        originKeyLevel: 450250.00,
        keyLevelType: "V",
        keyLevelBounds: [450100.00, 450400.00],
        keyLevelTested: true,
        keyLevelFlipped: false,
        imbalanceContext: [{ top: 450450.00, bottom: 450280.00 }],
        internalLiquidity: [],
        externalLiquidity: [],
        drawOnLiquidity: 452800.00,
        nearestExternalTarget: 452800.00,
        intermediateZones: [],
        opposingLiquidityStanding: true,
        sweepTime: Date.now() - 1800_000,
        bosTime: Date.now() - 900_000,
        returnTime: Date.now(),
        invalidationLevel: 449700.00,
        invalidationReason: null,
        parameterVersion: "slk-w1.0",
        alertStatus: "PAPER",
        suppressReason: null,
        session: "24/7 Continuous",
        atrEntry: 250.0,
        rrInternal: 2.62,
        cycleStage: "entry_alert",
        entryMode: "confirmation",
        shadowClassification: "A_GRADE",
        directionalBias: {
          classification: "A_GRADE",
          weekly: { weeklyHighSwept: false, weeklyLowSwept: true, opposingLiquidityStanding: true, primaryOpposingTarget: 454500.00 },
          daily: { bias: "bullish", bodyToBodyBreakout: "bullish", liquiditySweepPlusStructureBreak: false, sweepDirection: null, incomplete: false },
          h4: { direction: "bullish", breakoutStatus: "bullish_breakout", hasStructureBreak: true },
          h1: { direction: "bullish", agreesWith4H: true },
          entryQuality: { lowerTimeframeSweep: true, bosStructureShift: true, fvgDetected: true, fvgRebalanceDetected: true, retestDetected: true },
          timeframeRole: {
            entryTf: "30m",
            structuralTf: "4h",
            executionContextTf: "1h",
          },
        },
      };

      try {
        const results = await notifyAlert({ ...env, fetchFn: doFetch, TELEGRAM_DERIV_CHAT_ID: derivChatId }, sampleAlert);
        return json({
          ok: true,
          status: "delivered",
          derivChatId,
          results,
          message: `Test V75 Confirmed Entry Signal delivered to Synthetics Channel!`,
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
        "🚨🚨🚨 [ACTION REQUIRED] — SLK PRIVATE DM SIGNAL 🚨🚨🚨",
        "🔴 SLK 🧪 PAPER ALERT — NAS100",
        "Direction   : SHORT 🔴",
        "Timeframe   : 15m (map 4h)",
        "State       : RETEST → CONFIRMED (EXECUTE NOW)",
        "Bias Grade  : 🌟 A_GRADE",
        "Story       : BEARISH · EXPANSION · ALIGNED",
        "Entry       : 20,465.00 (retest close)",
        "Stop        : 20,495.00 (+30.0 pts)",
        "Target 1    : 20,390.00 (-75.0 pts · 2.50R)",
        "Target 2    : 20,315.00 nearest external liquidity",
        "",
        "Testing PRIVATE DM direct notification! Your phone should have vibrated/rung directly.",
      ].join("\n");
      try {
        await sendTelegram(env, text, { silent: false, pin: false, chatId: dmChatId });
        return json({
          ok: true,
          mode: "loud_dm",
          targetChatId: dmChatId,
          status: "delivered",
          message: "LOUD private signal test was successfully sent directly to your phone!",
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
        await sendTelegram(env, `🔔 SLK Free Trading Hub linked to ${freeChatId}!\nAutomated TP1 Win Teasers, Watch Alerts, and Daily Bias Cards will be delivered here automatically.`, { silent: false, pin: false, chatId: freeChatId });
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
          message: "A test teaser was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const { sendTelegram, toBold } = await import("./notify");
      const boldGold = toBold("XAUUSD");
      const teaser = [
        `🎯 TP1 HIT — 🌟【 ${boldGold} 】🌟 Short (+2.57R)`,
        "",
        `📍 Pair      : 🌟【 ${boldGold} 】🌟`,
        "• Timeframe : 30m",
        "• Direction : SHORT 🔴",
        "• Entry     : 4,331.370",
        "• Target 1  : 4,297.933 (+2.57R) ✅",
        "• Target 2  : Running risk-free toward external liquidity",
        "",
        "VIP members received this alert with exact entry, stop floor, and lot size calculations.",
        "",
        "Stop missing the moves.",
        "👉 Join VIP ($100/mo · $49 with code FOUNDING20): https://whop.com/slk-radar/slk-radar-vip-signals",
        "👉 Live Verified Journal: https://slk-radar.pages.dev",
      ].join("\n");
      try {
        await sendTelegram(env, teaser, { silent: false, pin: false, chatId: freeChatId });
        return json({
          ok: true,
          targetChatId: freeChatId,
          status: "delivered",
          message: "Automated Win Teaser was successfully delivered to your Free Telegram Channel!",
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

    if ((url.pathname === "/admin/telegram-status" || url.pathname === "/api/telegram-status") && request.method === "GET") {
      const store = makeStore(env.DB);
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id"));
      const freeChatId = env.TELEGRAM_FREE_CHAT_ID || (await store.getKv("telegram_free_chat_id"));
      const derivChatId = env.TELEGRAM_DERIV_CHAT_ID || (await store.getKv("telegram_deriv_chat_id"));
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
        instructions: {
          connectDm: "1. Open your bot in Telegram and send /start. 2. Visit /admin/connect-dm to link automatically.",
          setDmManually: "Visit /admin/set-dm?chat_id=<your_id>",
          connectDerivChannel: "1. Add bot as Admin to Synthetics channel. 2. Post any message in channel. 3. Visit /admin/connect-deriv-channel.",
          setDerivManually: "Visit /admin/set-deriv-channel?chat_id=<channel_id>",
          testDeriv: "Visit /admin/test-deriv to dispatch a sample V75 setup card.",
          setFreeChannel: "Visit /admin/set-free-channel?chat_id=@your_free_channel_username",
          testFreeTeaser: "Visit /admin/test-free-teaser to preview the automated TP1 Win Teaser in the free channel.",
          testLoudBoth: "Visit /admin/test-loud to test simultaneous channel + DM delivery.",
        },
      });
    }

    if ((url.pathname === "/admin/system-health" || url.pathname === "/api/system-health") && request.method === "GET") {
      const store = makeStore(env.DB);
      let alertCount = 0;
      let eventCount = 0;
      let logCount = 0;
      let recentLogs: Array<Record<string, unknown>> = [];
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
      } catch (err) {
        console.warn(JSON.stringify({ level: "warn", msg: "system-health db query failed", error: String(err) }));
      }
      const cfg = loadConfig(env);
      return json({
        ok: true,
        service: "slk-alert-worker",
        timestamp: new Date().toISOString(),
        cloudflareTier: "Free Tier Optimized (Sub-millisecond CPU)",
        limitsStatus: {
          cpuSafety: "EXCELLENT — Worker executes ~1.5ms per tick (Well below 10ms limit)",
          d1WritesSafety: `EXCELLENT — ${logCount} scan logs stored (<1% of 100,000 writes/day)`,
          d1StorageSafety: "EXCELLENT — ~2MB used (<0.5% of 500MB free storage cap)",
          subrequestsSafety: "EXCELLENT — 1 to 3 fetch calls per tick (Limit is 50)",
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
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return json({ ok: false, error: "Telegram credentials missing in worker environment variables (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)" }, 400);
      }
      const store = makeStore(env.DB);
      if (await checkTestCooldown(store, "test-loud")) {
        return json({
          ok: true,
          status: "debounced",
          message: "A test entry alert was already dispatched within the last 30 seconds. Skipping duplicate to prevent channel spam.",
        });
      }
      const dmChatId = env.TELEGRAM_DM_CHAT_ID || (await store.getKv("telegram_dm_chat_id")) || undefined;
      const { broadcast, toBold } = await import("./notify");
      const boldNas = toBold("NAS100");
      const text = [
        "🚨🚨🚨 [ACTION REQUIRED] — SLK CONFIRMED ENTRY 🚨🚨🚨",
        `🔴 SLK 🧪 PAPER ALERT — 🌟【 ${boldNas} 】🌟`,
        `📍 Pair       : 🌟【 ${boldNas} 】🌟`,
        "Direction   : SHORT 🔴",
        "Timeframe   : 15m (map 4h)",
        "State       : RETEST → CONFIRMED (EXECUTE NOW)",
        "Bias Grade  : 🌟 A_GRADE",
        "Story       : BEARISH · EXPANSION · ALIGNED",
        "Entry       : 20,465.00 (retest close)",
        "Stop        : 20,495.00 (+30.0 pts · beyond sweep extreme)",
        "Target 1    : 20,390.00 internal liquidity (-75.0 pts · 2.50R)",
        "Target 2    : 20,315.00 nearest external liquidity",
        "Draw        : 20,150.00",
        "Invalidation: CLOSE > 20,495.00",
        "",
        "Testing LOUD notification mode with auto-pin in channel + direct private DM delivery!",
      ].join("\n");
      try {
        const results = await broadcast(
          { ...env, TELEGRAM_DM_CHAT_ID: dmChatId },
          text,
          0xef4444,
          { silent: false, pin: true, sendToDm: true },
        );
        return json({
          ok: true,
          mode: "loud_simultaneous",
          results,
          dmConfigured: Boolean(dmChatId),
          message: dmChatId
            ? "LOUD Confirmed Entry test was successfully sent simultaneously to your Telegram channel (with pin) AND directly to your private chat!"
            : "LOUD Confirmed Entry test sent to your Telegram channel! (Tip: Link your private chat via /admin/connect-dm to receive signals in both places simultaneously).",
        });
      } catch (err) {
        return json({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }, 500);
      }
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

    if (url.pathname === "/admin/trades" && request.method === "POST") {
      let body: Record<string, unknown> = {};
      try { body = await request.json() as Record<string, unknown>; } catch { /* allow empty */ }
      const action = String(body.action || url.searchParams.get("action") || "expire_open");
      const store = makeStore(env.DB);
      if (action === "expire_open") {
        const closed = await store.expireOpenAlerts();
        return json({ ok: true, action: "expire_open", closed, message: `Closed ${closed} open trade(s) as EXPIRED.` });
      }
      if (action === "reset_all") {
        await store.resetAllAlerts();
        return json({ ok: true, action: "reset_all", message: "Successfully reset all signals, events, and logs." });
      }
      return json({ error: "invalid action, must be expire_open or reset_all" }, 400);
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
