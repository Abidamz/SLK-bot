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
import { loadConfig, TF_SECONDS, INDEX_POINT_PAIRS } from "./config";
import { scanEntry } from "./engine";
import { evaluateSignal } from "./outcomes";
import { notifyAlert, notifyOutcome } from "./notify";
import { fetchMarketData, providerForPair, validateAndClose, DataQualityError } from "./provider";
import { resampleCandles, dropIncomplete } from "./features";
import { storylineSeries } from "./storyline";
import { makeStore, type D1Like, type Store } from "./store";
import type { Alert, Candle } from "./types";

export interface Env {
  DB?: D1Like;
  TWELVEDATA_API_KEY?: string;
  OANDA_API_KEY?: string;
  OANDA_API_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
  ADMIN_KEY?: string;
  PROVIDER_WEBHOOK_SECRET?: string;
  PAIRS?: string;
  ENTRY_TFS?: string;
  MODE?: string;
  PAPER_NOTIFY?: string;
  SYMBOL_MAP?: string;
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
  ok: boolean;
  timeframes: string[];
  pairs: string[];
  alerts: number;
  events: number;
  errors: string[];
  durationMs: number;
}

// -------------------------------------------------------------- scan cycle

export async function scanAll(env: Env, opts: ScanOptions = {}): Promise<ScanSummary> {
  const startedAt = Date.now();
  const now = opts.now ?? startedAt;
  const fetchFn = opts.fetchFn ?? fetch;
  const cfg = loadConfig(env);
  const store: Store = opts.storeOverride ?? makeStore(env.DB);
  const errors: string[] = [];
  let alertCount = 0;
  let eventCount = 0;
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
      note: "idle (no candle close)",
    });
    return { ok: true, timeframes: [], pairs: [], alerts: 0, events: 0, errors, durationMs: Date.now() - startedAt };
  }

  for (const pair of cfg.pairs) {
    try {
      // provider routing: forex/metals → Twelve Data, index CFDs → OANDA
      // (if its token exists) → Dukascopy public feed → Yahoo last resort
      // (a per-pair outage never blocks the other pairs — see catch below)
      const providerName = providerForPair(pair, cfg.providerMap, Boolean(env.OANDA_API_KEY ?? env.OANDA_API_TOKEN));
      const apiKey = env.TWELVEDATA_API_KEY ?? "";
      const oandaToken = env.OANDA_API_KEY ?? env.OANDA_API_TOKEN ?? "";
      // kv adapter for immutable historical buckets (Dukascopy minute/hour/day files)
      const kv = { get: (k: string) => store.getKv(k), set: (k: string, v: string) => store.setKv(k, v) };

      // context feed (cached per UTC day to protect provider rate limits)
      const dayKey = new Date(now).toISOString().slice(0, 10);
      const cacheKey = `cache:1d:${pair}:${dayKey}`;
      let d1: Candle[] | null = null;
      const cached = await store.getKv(cacheKey);
      if (cached) d1 = JSON.parse(cached) as Candle[];
      if (!d1) {
        const ctx = await fetchMarketData({ pair, tf: cfg.contextTimeframe, limit: cfg.candlesLimit, tdKey: apiKey, oandaToken, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
        d1 = validateAndClose(ctx.candles, TF_SECONDS["1d"], now, 25);
        await store.setKv(cacheKey, JSON.stringify(d1));
      }

      // ONE intraday fetch per pair at the base (smallest entry) timeframe;
      // the 4h map and all coarser entry TFs are resampled from it. This is
      // the rate-limit design: ~1 provider credit per pair per boundary
      // instead of ~2 with separate 1h/30m fetches.
      const baseRes = await fetchMarketData({ pair, tf: cfg.baseTimeframe, limit: cfg.baseCandlesLimit, tdKey: apiKey, oandaToken, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
      const base = validateAndClose(
        baseRes.candles,
        TF_SECONDS[cfg.baseTimeframe], now, cfg.minCandles,
      );
      const feeds: Record<string, Candle[]> = { [cfg.baseTimeframe]: base };
      feeds["1h"] = dropIncomplete(resampleCandles(base, TF_SECONDS["1h"]), TF_SECONDS["1h"], now);
      const h4 = dropIncomplete(
        resampleCandles(base, TF_SECONDS[cfg.mapTimeframe]), TF_SECONDS[cfg.mapTimeframe], now,
      );
      feeds[cfg.mapTimeframe] = h4;
      if (h4.length < 30) throw new DataQualityError(`insufficient H4 data (${h4.length})`);

      const snaps = storylineSeries(d1, h4, cfg.strategy);
      pairsScanned.push(pair);

      for (const { tf, secs, boundary } of due) {
        let candles: Candle[];
        const derivedFeed = feeds[tf];
        if (derivedFeed) {
          candles = derivedFeed;
        } else {
          const res = await fetchMarketData({ pair, tf, limit: cfg.candlesLimit, tdKey: apiKey, oandaToken, symbolMap: cfg.symbolMap, providerMap: cfg.providerMap, fetchFn, kv });
          candles = validateAndClose(res.candles, secs, now, cfg.minCandles);
        }

        const { alerts, events } = scanEntry({
          pair, entryTf: tf, tfSeconds: secs, candles, snaps,
          cfg: cfg.strategy, mode: cfg.mode, provider: providerName,
        });

        for (const ev of events) {
          if (await store.insertEvent(ev)) eventCount++;
        }

        const lastBefore = await store.getKv(`last_scan:${pair}:${tf}`);
        const isFirstScan = lastRawIsEmpty(lastBefore);

        for (const alert of alerts) {
          const inserted = await store.insertAlert(alert, providerName);
          if (!inserted) continue; // duplicate setup — already alerted/logged
          alertCount++;
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
        continue;
      }
      errors.push(`${pair}: ${msg}`);
      console.error(JSON.stringify({ level: "error", msg: "pair scan failed", pair, error: msg }));
    }
  }

  // advance TF boundaries only after every pair got a shot (self-healing on
  // partial failure: the next tick re-runs and dedupe keeps it idempotent)
  if (!opts.force) {
    for (const { tf, boundary } of due) {
      await store.setKv(`last_boundary:${tf}`, String(boundary));
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
  });

  return {
    ok: errors.length === 0,
    timeframes: due.map((d) => d.tf),
    pairs: pairsScanned,
    alerts: alertCount,
    events: eventCount,
    errors,
    durationMs: Date.now() - startedAt,
  };
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
    console.info(JSON.stringify({ level: "info", msg: "first scan — recorded without delivery", setupId: alert.setupId }));
    return;
  }
  if (cfg.mode === "paper" && !cfg.paperNotify) {
    console.info(JSON.stringify({ level: "info", msg: "paper mode, notifications off — logged only", setupId: alert.setupId }));
    return;
  }
  await notifyAlert({ ...env, fetchFn }, alert);
}

async function resolveOutcomes(
  env: Env, store: Store, cfg: ReturnType<typeof loadConfig>,
  pair: string, tf: string, candles: Candle[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const open = await store.openAlerts(pair, tf);
  for (const rec of open) {
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
    if (cfg.notifyOutcomes) await notifyOutcome({ ...env, fetchFn }, rec, oc);
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
  return request.headers.get("authorization") === `Bearer ${env.ADMIN_KEY}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
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

// --------------------------------------------------------------- entrypoint

export default {
  async fetch(request: Request, env: Env, _ctx: ExecCtxLike): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const cfg = loadConfig(env);
      return json({
        ok: true, service: "slk-alert-worker", mode: cfg.mode,
        pairs: cfg.pairs, entryTfs: Object.keys(cfg.entryTfs),
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/alerts" && request.method === "GET") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
      const store = makeStore(env.DB);
      const rows = await store.recentAlerts(limit);
      // sanitized: the DB holds no secrets, but keep the response tight anyway
      return json(rows.map((r) => ({
        setupId: r.setup_id, pair: r.canonical_symbol, tf: r.entry_timeframe,
        direction: r.direction, entry: r.entry, stopLoss: r.stop_loss,
        tp1: r.tp_internal, tp2: r.tp_external, environment: r.environment,
        phase: r.phase, htfAlignment: r.htf_alignment, keyLevel: r.key_level_type,
        originLevel: r.origin_key_level, status: r.status,
        alertStatus: r.alert_status, candleCloseTime: r.candle_close_time,
      })));
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const store = makeStore(env.DB);
      const rows = await store.recentAlerts(500);
      const tp = rows.filter((r) => r.status === "TP_HIT").length;
      const sl = rows.filter((r) => r.status === "SL_HIT").length;
      const expired = rows.filter((r) => r.status === "EXPIRED").length;
      const openn = rows.filter((r) => r.status === "OPEN").length;
      return json({
        total: rows.length, open: openn, tp, sl, expired,
        winRate: tp + sl > 0 ? tp / (tp + sl) : null,
        note: "paper metrics from alert outcomes — research only, not audited performance",
      });
    }

    if (url.pathname === "/scan-now" && request.method === "POST") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const summary = await scanAll(env, { force: true });
      return json(summary, summary.ok ? 200 : 207);
    }

    if (url.pathname === "/test-notify" && request.method === "POST") {
      if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
      const { broadcast } = await import("./notify");
      const results = await broadcast(env, "✅ SLK worker test — notification channels are wired up correctly.", 0x3498db);
      return json({ results });
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
