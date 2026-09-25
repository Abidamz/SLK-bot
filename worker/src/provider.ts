/** Market data: Twelve Data REST (fetch-based, Workers-compatible) plus a
 *  Yahoo Finance fallback for index CFDs, plus data-quality validation.
 *  Canonical symbol mapping is explicit: the research requires normalized
 *  symbols per provider. */
import type { Candle } from "./types";
import { INDEX_POINT_PAIRS, TF_SECONDS, isDerivPair } from "./config";
import { resampleCandles } from "./features";

const TD_INTERVALS: Record<string, string> = {
  "5m": "5min", "15m": "15min", "30m": "30min", "45m": "45min",
  "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1day",
};

export function symbolFor(pair: string, symbolMap: Record<string, string>): string {
  if (symbolMap[pair]) return symbolMap[pair];
  if (pair.length === 6) return `${pair.slice(0, 3)}/${pair.slice(3)}`; // EURUSD → EUR/USD
  return pair;
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export async function fetchTwelveData(
  apiKey: string,
  pair: string,
  tf: string,
  limit: number,
  symbolMap: Record<string, string> = {},
  fetchFn: FetchLike = fetch,
): Promise<Candle[]> {
  const interval = TD_INTERVALS[tf];
  if (!interval) throw new Error(`unsupported timeframe ${tf}`);
  if (!apiKey) throw new Error("TWELVEDATA_API_KEY is not set");
  const params = new URLSearchParams({
    symbol: symbolFor(pair, symbolMap),
    interval,
    outputsize: String(Math.min(limit, 5000)),
    apikey: apiKey,
    order: "ASC",
    timezone: "UTC",
    format: "JSON",
  });
  const resp = await fetchFn(`https://api.twelvedata.com/time_series?${params}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await resp.json()) as {
    values?: { datetime: string; open: string; high: string; low: string; close: string }[];
    message?: string;
  };
  if (!data.values) {
    throw new Error(`Twelve Data error for ${symbolFor(pair, symbolMap)} ${interval}: ${data.message ?? "no values"}`);
  }
  return data.values.map((row) => ({
    t: Date.parse(row.datetime.replace(" ", "T") + "Z"),
    o: Number(row.open),
    h: Number(row.high),
    l: Number(row.low),
    c: Number(row.close),
  }));
}

// ---------------------------------------------------------------- Yahoo Finance
// Fallback source for instruments Twelve Data's free plan lacks (index CFDs).
// Unofficial free endpoint — can lag the broker or drop sessions; alerts from
// this provider are research-grade, never broker-exact prices.

/** Yahoo symbols for our canonical index names. */
const YAHOO_INDEX_SYMBOLS: Record<string, string> = {
  US30: "^DJI", GER40: "^GDAXI", DE40: "^GDAXI",
  JAPAN225: "^N225", JP225: "^N225", N225: "^N225",
  NAS100: "^NDX", US100: "^NDX", SPX500: "^GSPC", US500: "^GSPC", UK100: "^FTSE",
};

export function yahooSymbolFor(pair: string, symbolMap: Record<string, string> = {}): string {
  if (symbolMap[pair]) return symbolMap[pair];
  const p = pair.toUpperCase();
  if (YAHOO_INDEX_SYMBOLS[p]) return YAHOO_INDEX_SYMBOLS[p];
  if (p === "XAUUSD") return "GC=F";
  if (p === "XAGUSD") return "SI=F";
  if (p.length === 6) return `${p}=X`;
  return p;
}

// --------------------------------------------------------------------- OANDA
// Practice-account v3 REST — free signup, official API, broker-grade live
// quotes, no per-credit counting. Primary source for index CFDs
// (US30_USD / DE40_EUR / JP225_USD) and eligible for forex+metals too.

/** OANDA instrument names for our canonical pairs. */
const OANDA_INSTRUMENTS: Record<string, string> = {
  US30: "US30_USD", GER40: "DE40_EUR", DE40: "DE40_EUR",
  JAPAN225: "JP225_USD", JP225: "JP225_USD",
  NAS100: "NAS100_USD", US100: "NAS100_USD", SPX500: "SPX500_USD", US500: "SPX500_USD",
  UK100: "UK100_GBP", XAUUSD: "XAU_USD", XAGUSD: "XAG_USD",
};

const OANDA_GRANULARITIES: Record<string, string> = {
  "5m": "M5", "15m": "M15", "30m": "M30", "45m": "M45", "1h": "H1", "2h": "H2", "4h": "H4", "1d": "D",
};

export async function fetchOanda(
  apiToken: string,
  pair: string,
  tf: string,
  limit: number,
  symbolMap: Record<string, string> = {},
  fetchFn: FetchLike = fetch,
): Promise<Candle[]> {
  if (!apiToken) throw new Error("OANDA_API_TOKEN is not set");
  const gran = OANDA_GRANULARITIES[tf];
  if (!gran) throw new Error(`unsupported timeframe ${tf} for OANDA`);
  const instrument =
    OANDA_INSTRUMENTS[pair.toUpperCase()]
    ?? (symbolMap[pair] && /^[A-Z0-9]{2,}_[A-Z]{3}$/.test(symbolMap[pair]) ? symbolMap[pair] : undefined)
    ?? (pair.length === 6 ? `${pair.slice(0, 3)}_${pair.slice(3)}` : pair); // EURUSD → EUR_USD
  const params = new URLSearchParams({
    count: String(Math.min(limit, 5000)),
    granularity: gran,
    price: "M", // midpoint candles
  });
  const url = `https://api-fxpractice.oanda.com/v3/instruments/${encodeURIComponent(instrument)}/candles?${params}`;
  const resp = await fetchFn(url, {
    headers: {
      authorization: `Bearer ${apiToken}`,
      "accept-datetime-format": "RFC3339",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await resp.json()) as {
    errorMessage?: string;
    candles?: {
      complete: boolean;
      time: string;
      mid?: { o: string; h: string; l: string; c: string };
    }[];
  };
  if (!resp.ok || !data.candles) {
    throw new Error(`OANDA error for ${instrument} ${gran}: HTTP ${resp.status} ${data.errorMessage ?? ""}`.trim());
  }
  const out: Candle[] = [];
  for (const cd of data.candles) {
    if (!cd.mid) continue; // skipped session gaps come back without prices
    out.push({
      t: Date.parse(cd.time.slice(0, 23) + "Z"), // trim ns → ms
      o: Number(cd.mid.o), h: Number(cd.mid.h), l: Number(cd.mid.l), c: Number(cd.mid.c),
    });
  }
  return out;
}

// ------------------------------------------------------------------ Dukascopy
// Public jetta API — Swiss-bank realtime quotes, no key/signup. Columnar
// delta-compressed candles: {timestamp, open, high, low, close, multiplier,
// shift, times[], opens[], highs[], lows[], closes[], volumes[]}. Buckets are
// partitioned minute/day, hour/month, day/year by UTC date.

const DUKA_ROOT = "https://jetta.dukascopy.com/v1/candles";
const DUKA_INSTRUMENTS: Record<string, string> = {
  US30: "USA30.IDX-USD", GER40: "DEU.IDX-EUR", DE40: "DEU.IDX-EUR",
  JAPAN225: "JPN.IDX-JPY", JP225: "JPN.IDX-JPY",
  NAS100: "USATECH.IDX-USD", US100: "USATECH.IDX-USD",
  SPX500: "USA500.IDX-USD", US500: "USA500.IDX-USD", UK100: "GBR.IDX-GBP",
  XAUUSD: "XAU-USD", XAGUSD: "XAG-USD",
};

function dukaCode(pair: string, symbolMap: Record<string, string>): string {
  const p = pair.toUpperCase();
  // curated map FIRST: SYMBOL_MAP is shared with Yahoo (^DJI-style) and would
  // otherwise poison the URL; accept a SYMBOL_MAP override only if it looks
  // like a Dukascopy code (e.g. USA30.IDX-USD, EUR-USD)
  if (DUKA_INSTRUMENTS[p]) return DUKA_INSTRUMENTS[p];
  const custom = symbolMap[pair] ?? symbolMap[p];
  if (custom && /^[A-Z0-9]{2,}(\.IDX)?-[A-Z]{3}$/.test(custom)) return custom;
  return p.length === 6 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

interface JettaCandleResponse {
  timestamp: number;     // epoch ms of bucket base
  open: number; high: number; low: number; close: number; // base candle
  multiplier: number;    // price unit
  shift: number;         // ms per bar
  times: number[];       // per-bar gaps measured in shifts from previous bar
  opens: number[]; highs: number[]; lows: number[]; closes: number[]; // unit deltas
  volumes?: number[];
}

/** Decode Dukascopy's cumulative-delta columns into plain candles.
 *  Gap periods are NOT flat-filled (we refuse to fabricate quiet bars). */
export function decodeJetta(d: JettaCandleResponse): Candle[] {
  const n = d.times?.length ?? 0;
  if (!n) return [];
  for (const col of [d.opens, d.highs, d.lows, d.closes]) {
    if (!Array.isArray(col) || col.length !== n) throw new DataQualityError("dukascopy column misalignment");
  }
  if (!Number.isFinite(d.timestamp) || !Number.isFinite(d.multiplier) || !(d.multiplier > 0) || !(d.shift > 0))
    throw new DataQualityError("dukascopy malformed header");
  const out: Candle[] = [];
  let t = d.timestamp;
  let oU = Math.round(d.open / d.multiplier);
  let hU = Math.round(d.high / d.multiplier);
  let lU = Math.round(d.low / d.multiplier);
  let cU = Math.round(d.close / d.multiplier);
  for (let i = 0; i < n; i++) {
    t += d.times[i] * d.shift;
    oU += d.opens[i]; hU += d.highs[i]; lU += d.lows[i]; cU += d.closes[i];
    out.push({ t, o: oU * d.multiplier, h: hU * d.multiplier, l: lU * d.multiplier, c: cU * d.multiplier });
  }
  return out;
}

type KvLike = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> } | undefined;

let tdCreditsExhausted = false;
let yahooUnavailable = false;

export function resetProviderCircuitBreakers(): void {
  tdCreditsExhausted = false;
  yahooUnavailable = false;
}

export async function fetchDukascopy(
  pair: string, tf: string, limit: number,
  symbolMap: Record<string, string> = {}, fetchFn: FetchLike = fetch, kv: KvLike = undefined,
  budget = 8,
): Promise<Candle[]> {
  const code = dukaCode(pair, symbolMap);
  const tfSec = TF_SECONDS[tf] ?? 1800;
  const minutes = tfSec / 60;
  const src = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  const cachePrefix = `duka:${pair}:${src}`;

  // enumerate UTC buckets covering `limit` bars, market-hours thinning ×2.2
  const calDays = Math.ceil((limit * tfSec) / 86400 * 2.2) + 3;
  interface Bucket { url: string; key: string; mutable: boolean }
  const buckets: Bucket[] = [];
  const now = new Date();
  // ACTIVE periods (today's minute file, this hour's month, this year's days)
  // only exist as `?from=<bucketStartMs>` — the /y/m[/d] path 400s for them.
  if (src === "minute") {
    for (let i = calDays; i >= 0; i--) {
      const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + 1, day = ref.getUTCDate();
      const url = i === 0
        ? `${DUKA_ROOT}/minute/${code}/BID?from=${ref.getTime()}`
        : `${DUKA_ROOT}/minute/${code}/BID/${y}/${m}/${day}`;
      buckets.push({
        url,
        key: `${cachePrefix}:${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        mutable: i <= 1, // today (active) + yesterday may still receive late ticks
      });
    }
  } else if (src === "hour") {
    const monthsBack = Math.ceil(calDays / 30) + 1;
    for (let i = monthsBack; i >= 0; i--) {
      const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + 1;
      buckets.push({
        url: i === 0 ? `${DUKA_ROOT}/hour/${code}/BID?from=${ref.getTime()}` : `${DUKA_ROOT}/hour/${code}/BID/${y}/${m}`,
        key: `${cachePrefix}:${y}-${m}`,
        mutable: i === 0,
      });
    }
  } else {
    for (let y = now.getUTCFullYear() - 3; y <= now.getUTCFullYear(); y++) {
      const y0 = Date.UTC(y, 0, 1);
      buckets.push({
        url: y === now.getUTCFullYear() ? `${DUKA_ROOT}/day/${code}/BID?from=${y0}` : `${DUKA_ROOT}/day/${code}/BID/${y}`,
        key: `${cachePrefix}:${y}`,
        mutable: y === now.getUTCFullYear(),
      });
    }
  }

  const all: Candle[] = [];
  // Free-plan Workers cap = 50 subrequests per invocation.
  // Fetch NEWEST buckets first with a hard budget: every tick goes deeper as
  // immutable history lands in the kv cache; partial history always ends at
  // the freshest bar so quality gates (freshness, minimum candles) pass early.
  let fetchBudget = budget;
  for (const b of [...buckets].reverse()) {
    let j: JettaCandleResponse | null = null;
    if (!b.mutable && kv) {
      const cached = await kv.get(b.key);
      if (cached) j = JSON.parse(cached);
    }
    if (!j) {
      if (fetchBudget <= 0) continue; // deeper history fills in on later ticks
      fetchBudget--;
      let resp: Response;
      try {
        resp = await fetchFn(b.url, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; slk-alert-worker/1.0)" },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        if (String(e).includes("subrequest")) break; // platform ceiling — use what we have
        throw e;
      }
      if (resp.status === 404) continue; // pre-instrument-history or empty period — fine
      if (!resp.ok) throw new Error(`Dukascopy ${b.url}: HTTP ${resp.status}`);
      j = (await resp.json()) as JettaCandleResponse;
      if (!b.mutable && kv && j && j.times?.length) await kv.set(b.key, JSON.stringify(j));
    }
    all.push(...decodeJetta(j));
  }
  all.sort((a, b) => a.t - b.t); // newest-first fetch order → re-merge ascending
  const out = all.filter((c, i) => i === 0 || c.t > all[i - 1].t);
  // raw source < requested tf → aggregate up (minute→30m, hour→1h/4h…)
  // NB: slicing must happen AFTER resampling — `limit` is counted in
  // requested-tf bars, not source bars (1010 source minutes ≈ 35 30m bars —
  // the production "only 35 closed candles" failure).
  const srcSec = src === "minute" ? 60 : src === "hour" ? 3600 : 86400;
  if (tfSec > srcSec) {
    const resampled = resampleCandles(out, tfSec);
    return resampled.length > limit ? resampled.slice(-limit) : resampled;
  }
  return out.length > limit ? out.slice(-limit) : out;
}

export const DERIV_SYMBOLS: Record<string, string> = {
  // 5 Standard Volatility Indices
  V75: "R_75",
  VOLATILITY75: "R_75",
  R_75: "R_75",
  V100: "R_100",
  VOLATILITY100: "R_100",
  R_100: "R_100",
  V50: "R_50",
  VOLATILITY50: "R_50",
  R_50: "R_50",
  V25: "R_25",
  VOLATILITY25: "R_25",
  R_25: "R_25",
  V10: "R_10",
  VOLATILITY10: "R_10",
  R_10: "R_10",

  // 5 1-Second (1s) Volatility Indices
  V75_1S: "1HZ75V",
  "1HZ75V": "1HZ75V",
  V100_1S: "1HZ100V",
  "1HZ100V": "1HZ100V",
  V50_1S: "1HZ50V",
  "1HZ50V": "1HZ50V",
  V25_1S: "1HZ25V",
  "1HZ25V": "1HZ25V",
  V10_1S: "1HZ10V",
  "1HZ10V": "1HZ10V",
};

/** Fetch continuous synthetic market data from Deriv via Workers WebSocket API */
export async function fetchDeriv(
  pair: string,
  tf: string,
  limit: number,
  symbolMap: Record<string, string> = {},
  appId = "1089",
  fetchFn: FetchLike = fetch,
): Promise<Candle[]> {
  const p = pair.toUpperCase().replace("/", "").replace("=X", "").replace("-", "");
  const symbol = symbolMap[pair] ?? DERIV_SYMBOLS[p] ?? p;
  const granularity = TF_SECONDS[tf] ?? 1800;

  const timeoutMs = 7_000;

  return new Promise<Candle[]>((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Deriv WebSocket timeout after ${timeoutMs}ms for ${symbol} ${tf}`));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
    };

    (async () => {
      try {
        let ws: any = null;
        let lastError = "";

        // In Cloudflare Workers runtime, outbound client WebSocket connections are established
        // using fetch(url, { headers: { Upgrade: "websocket" } }) followed by candidateWs.accept().
        // (Using new WebSocket() directly in Workers runtime causes an accept() error).
        const httpsUrls = [
          `https://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`,
          `https://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`,
        ];
        for (const targetUrl of httpsUrls) {
          try {
            const resp = await fetchFn(targetUrl, {
              headers: {
                Upgrade: "websocket",
                Connection: "Upgrade",
              },
            });

            const candidateWs = (resp as any).webSocket ?? (resp as any).body?.webSocket;
            if (candidateWs) {
              ws = candidateWs;
              if (typeof ws.accept === "function") {
                try {
                  ws.accept();
                } catch {}
              }
              break;
            } else {
              const status = (resp as any)?.status ?? "unknown";
              const statusText = (resp as any)?.statusText ?? "";
              lastError = `HTTP ${status} ${statusText} from ${targetUrl}`;
            }
          } catch (connErr) {
            lastError = connErr instanceof Error ? connErr.message : String(connErr);
          }
        }

        // Fallback for non-Workers environments (e.g. Node.js or browser) where fetch does not support Upgrade: websocket
        if (!ws && typeof (globalThis as any).WebSocket === "function" && fetchFn === fetch) {
          const endpoints = [
            `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`,
            `wss://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`,
          ];
          for (const ep of endpoints) {
            try {
              ws = new (globalThis as any).WebSocket(ep);
              if (ws) break;
            } catch (e) {
              lastError = e instanceof Error ? e.message : String(e);
            }
          }
        }

        if (!ws) {
          throw new Error(`Deriv server did not accept WebSocket connection: ${lastError || "no gateway responded with 101"}`);
        }

        const onMessage = (event: any) => {
          try {
            const rawData = typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);
            const data = JSON.parse(rawData);

            if (data.error) {
              if (!resolved) {
                resolved = true;
                cleanup();
                try { ws.close(); } catch {}
                reject(new Error(`Deriv API error for ${symbol}: ${data.error.message || JSON.stringify(data.error)}`));
              }
              return;
            }

            if (data.msg_type === "candles" || (data.candles && Array.isArray(data.candles))) {
              if (!resolved) {
                resolved = true;
                cleanup();
                const rawCandles = data.candles as Array<{
                  epoch: number | string;
                  open: number | string;
                  high: number | string;
                  low: number | string;
                  close: number | string;
                }>;
                const mapped: Candle[] = rawCandles.map((c) => ({
                  t: Number(c.epoch) * 1000,
                  o: Number(c.open),
                  h: Number(c.high),
                  l: Number(c.low),
                  c: Number(c.close),
                }));
                mapped.sort((a, b) => a.t - b.t);
                try { ws.close(); } catch {}
                resolve(mapped);
              }
            }
          } catch (err) {
            if (!resolved) {
              resolved = true;
              cleanup();
              try { ws.close(); } catch {}
              reject(err);
            }
          }
        };

        const onError = (err: unknown) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Deriv WebSocket error for ${symbol}: ${err instanceof Error ? err.message : String(err)}`));
          }
        };

        const onClose = () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(`Deriv WebSocket closed before candles were received for ${symbol}`));
          }
        };

        if (typeof ws.addEventListener === "function") {
          ws.addEventListener("message", onMessage);
          ws.addEventListener("error", onError);
          ws.addEventListener("close", onClose);
        } else {
          ws.onmessage = onMessage;
          ws.onerror = onError;
          ws.onclose = onClose;
        }

        let sent = false;
        const sendPayload = () => {
          if (sent) return;
          try {
            const reqPayload = {
              ticks_history: symbol,
              style: "candles",
              granularity,
              count: Math.min(limit, 1000),
              end: "latest",
            };
            ws.send(JSON.stringify(reqPayload));
            sent = true;
          } catch (sendErr) {
            // In runtimes where ws is not yet open (e.g. Node new WebSocket()),
            // ws.send may throw. If so, wait for the open event below.
          }
        };

        // In Cloudflare Workers, outbound client WebSockets from fetch Upgrade do NOT fire
        // an 'open' event because the handshake is already established upon return and accept().
        // We therefore attempt to send the payload immediately.
        sendPayload();

        // If not sent yet (e.g. constructor WebSocket in Node/browser environments where readyState === 0),
        // wait for the open event to trigger sendPayload.
        if (!sent) {
          if (typeof ws.addEventListener === "function") {
            ws.addEventListener("open", () => sendPayload(), { once: true });
          } else if ("onopen" in ws) {
            ws.onopen = () => sendPayload();
          }
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      }
    })();
  });
}

export type ProviderName = "twelvedata" | "yahoo" | "oanda" | "dukascopy" | "deriv";

/** Which upstream serves a canonical pair. Index CFDs: OANDA when its token
 *  exists (geo-restricted signups), else the keyless Dukascopy public feed
 *  (realtime broker quotes), with Yahoo as last resort. Deriv synthetics
 *  (e.g., V75, V100) route directly to Deriv. Everything else → Twelve Data.
 *  PROVIDER_MAP overrides. */
export function providerForPair(
  pair: string,
  providerMap: Record<string, string> = {},
  oandaTokenPresent = false,
  dukascopyEnabled = true,
): ProviderName {
  const override = providerMap[pair];
  if (override === "twelvedata" || override === "yahoo" || override === "oanda" || override === "dukascopy" || override === "deriv") return override;
  if (isDerivPair(pair)) return "deriv";
  const p = pair.toUpperCase();
  // NB: classify by the canonical index-name set only — OANDA_INSTRUMENTS
  // also lists metals (future all-OANDA option) and must NOT affect routing.
  const isIndexCfd = INDEX_POINT_PAIRS.has(p) || Boolean(YAHOO_INDEX_SYMBOLS[p]);
  if (isIndexCfd) {
    if (oandaTokenPresent) return "oanda";
    return dukascopyEnabled ? "dukascopy" : "yahoo";
  }
  return "twelvedata";
}

/** Range long enough to satisfy `limit` even with market-hours gaps. */
const YAHOO_RANGES: Record<string, string> = {
  "5m": "5d", "15m": "1mo", "30m": "3mo", "45m": "3mo", "1h": "6mo", "2h": "1y", "4h": "1y", "1d": "2y",
};

export async function fetchYahoo(
  pair: string,
  tf: string,
  limit: number,
  symbolMap: Record<string, string> = {},
  fetchFn: FetchLike = fetch,
): Promise<Candle[]> {
  const primarySymbol = yahooSymbolFor(pair, symbolMap);
  const candidates = [primarySymbol];
  const p = pair.toUpperCase();
  if (p === "XAUUSD" && !symbolMap[pair]) {
    candidates.push("XAUUSD=X");
  } else if (p === "XAGUSD" && !symbolMap[pair]) {
    candidates.push("XAGUSD=X");
  }

  let lastErr: Error | null = null;
  for (const symbol of candidates) {
    try {
      const range = YAHOO_RANGES[tf] ?? "3mo";
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
        + `?interval=${encodeURIComponent(tf)}&range=${range}&includePrePost=false`;
      const resp = await fetchFn(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; slk-alert-worker/1.0)" },
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await resp.json()) as {
        chart?: {
          error?: { description?: string } | null;
          result?: {
            timestamp?: number[];
            indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] };
          }[] | null;
        };
      };
      if (data.chart?.error) throw new Error(`Yahoo error for ${symbol} ${tf}: ${data.chart.error.description ?? "unknown"}`);
      const r = data.chart?.result?.[0];
      const q = r?.indicators?.quote?.[0];
      if (!r?.timestamp?.length || !q) throw new Error(`Yahoo returned no candles for ${symbol} ${tf}`);
      const out: Candle[] = [];
      for (let i = 0; i < r.timestamp.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue; // session gaps/holidays
        out.push({ t: r.timestamp[i] * 1000, o, h, l, c });
      }
      if (out.length === 0) throw new Error(`Yahoo returned empty candles for ${symbol} ${tf}`);
      return out.length > limit ? out.slice(-limit) : out;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`Yahoo failed for ${pair}`);
}

/** Unified entry point: route by provider, one argument shape for all. */
export interface MarketDataRequest {
  pair: string;
  tf: string;
  limit: number;
  tdKey?: string;
  oandaToken?: string;
  derivAppId?: string;
  symbolMap?: Record<string, string>;
  providerMap?: Record<string, string>;
  fetchFn?: FetchLike;
  /** cache for immutable historical buckets (Dukascopy); tests inject MemStore */
  kv?: { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };
  budget?: number;
}

export async function fetchMarketData(req: MarketDataRequest): Promise<{ provider: ProviderName; candles: Candle[] }> {
  const provider = providerForPair(req.pair, req.providerMap, Boolean(req.oandaToken));
  const dukaBudget = req.budget ?? (req.tf === "30m" ? 2 : 4);
  if (provider === "deriv") {
    const candles = await fetchDeriv(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.derivAppId ?? "1089", req.fetchFn);
    return { provider: "deriv", candles };
  }
  if (provider === "twelvedata") {
    if (!tdCreditsExhausted) {
      try {
        const candles = await fetchTwelveData(req.tdKey ?? "", req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn);
        return { provider, candles };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRateOrCredit = msg.includes("run out of API credits")
          || msg.includes("API credits were used")
          || msg.includes("429");
        if (isRateOrCredit) {
          tdCreditsExhausted = true;
          console.warn(JSON.stringify({
            level: "warn",
            msg: "slk.provider.fallback",
            pair: req.pair,
            tf: req.tf,
            from: "twelvedata",
            to: yahooUnavailable ? "dukascopy" : "yahoo",
            reason: msg,
          }));
        } else {
          throw err;
        }
      }
    }

    if (!yahooUnavailable) {
      try {
        const candles = await fetchYahoo(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn);
        return { provider: "yahoo", candles };
      } catch (yahooErr) {
        yahooUnavailable = true;
        console.warn(JSON.stringify({
          level: "warn",
          msg: "slk.provider.fallback",
          pair: req.pair,
          tf: req.tf,
          from: "yahoo",
          to: "dukascopy",
          reason: yahooErr instanceof Error ? yahooErr.message : String(yahooErr),
        }));
      }
    }

    try {
      const candles = await fetchDukascopy(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn, req.kv, dukaBudget);
      return { provider: "dukascopy", candles };
    } catch (dukaErr) {
      throw dukaErr;
    }
  }

  const candles = provider === "oanda"
    ? await fetchOanda(req.oandaToken ?? "", req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn)
    : provider === "dukascopy"
      ? await (async () => {
          try {
            return await fetchDukascopy(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn, req.kv, dukaBudget);
          } catch (dukaErr) {
            if (!yahooUnavailable) {
              console.warn(JSON.stringify({
                level: "warn",
                msg: "slk.provider.fallback",
                pair: req.pair,
                tf: req.tf,
                from: "dukascopy",
                to: "yahoo",
                reason: dukaErr instanceof Error ? dukaErr.message : String(dukaErr),
              }));
              return await fetchYahoo(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn);
            }
            throw dukaErr;
          }
        })()
      : await fetchYahoo(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn);
  return { provider, candles };
}

export class DataQualityError extends Error {}

/** Reliability gate: reject missing, out-of-order, malformed or stale
 *  candle feeds. A setup computed from bad data must never alert.
 *  Returns the feed with the trailing in-progress candle dropped. */
export function validateAndClose(
  candles: Candle[], tfSeconds: number, now: number, minLen = 40,
): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0)
    throw new DataQualityError("empty candle feed");
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const ok =
      Number.isFinite(c.t) && Number.isFinite(c.o) && Number.isFinite(c.h)
      && Number.isFinite(c.l) && Number.isFinite(c.c)
      && c.h >= Math.max(c.o, c.c) - 1e-12 && c.l <= Math.min(c.o, c.c) + 1e-12;
    if (!ok) throw new DataQualityError(`malformed candle at index ${i}`);
    if (i > 0 && c.t <= candles[i - 1].t)
      throw new DataQualityError(`out-of-order candle at index ${i}`);
  }
  // final-candle gate: work with closed candles only
  const closed = candles.filter((c) => c.t + tfSeconds * 1000 <= now);
  if (closed.length < minLen)
    throw new DataQualityError(`only ${closed.length} closed candles (min ${minLen})`);
  const last = closed[closed.length - 1];
  if (last.t + tfSeconds * 1000 > now)
    throw new DataQualityError("feed's last candle is in the future");
  // staleness: the newest closed candle must be within (up to) ~3 bars of now
  // for intraday feeds; the daily context gets a weekend-tolerant window
  const staleMs = tfSeconds >= 86400 ? 4 * 86400 * 1000 : 3 * tfSeconds * 1000 + 6 * 3600 * 1000;
  if (now - last.t - tfSeconds * 1000 > staleMs)
    throw new DataQualityError("stale feed (newest closed candle is too old)");
  return closed;
}
