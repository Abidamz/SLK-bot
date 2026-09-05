/** Market data: Twelve Data REST (fetch-based, Workers-compatible) plus a
 *  Yahoo Finance fallback for index CFDs, plus data-quality validation.
 *  Canonical symbol mapping is explicit: the research requires normalized
 *  symbols per provider. */
import type { Candle } from "./types";
import { INDEX_POINT_PAIRS, TF_SECONDS } from "./config";
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
    symbolMap[pair] ?? OANDA_INSTRUMENTS[pair.toUpperCase()]
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
  if (symbolMap[pair]) return symbolMap[pair];
  const p = pair.toUpperCase();
  if (DUKA_INSTRUMENTS[p]) return DUKA_INSTRUMENTS[p];
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

export async function fetchDukascopy(
  pair: string, tf: string, limit: number,
  symbolMap: Record<string, string> = {}, fetchFn: FetchLike = fetch, kv: KvLike = undefined,
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
  if (src === "minute") {
    for (let i = calDays; i >= 0; i--) {
      const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + 1, day = ref.getUTCDate();
      buckets.push({
        url: `${DUKA_ROOT}/minute/${code}/BID/${y}/${m}/${day}`,
        key: `${cachePrefix}:${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        mutable: i <= 1, // today + yesterday mutable (late ticks)
      });
    }
  } else if (src === "hour") {
    const monthsBack = Math.ceil(calDays / 30) + 1;
    for (let i = monthsBack; i >= 0; i--) {
      const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + 1;
      buckets.push({ url: `${DUKA_ROOT}/hour/${code}/BID/${y}/${m}`, key: `${cachePrefix}:${y}-${m}`, mutable: i === 0 });
    }
  } else {
    for (let y = now.getUTCFullYear() - 3; y <= now.getUTCFullYear(); y++) {
      buckets.push({ url: `${DUKA_ROOT}/day/${code}/BID/${y}`, key: `${cachePrefix}:${y}`, mutable: y === now.getUTCFullYear() });
    }
  }

  const all: Candle[] = [];
  for (const b of buckets) {
    let j: JettaCandleResponse | null = null;
    if (!b.mutable && kv) {
      const cached = await kv.get(b.key);
      if (cached) j = JSON.parse(cached);
    }
    if (!j) {
      const resp = await fetchFn(b.url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; slk-alert-worker/1.0)" },
        signal: AbortSignal.timeout(20_000),
      });
      if (resp.status === 404) continue; // pre-instrument-history or empty period — fine
      if (!resp.ok) throw new Error(`Dukascopy ${b.url}: HTTP ${resp.status}`);
      j = (await resp.json()) as JettaCandleResponse;
      if (!b.mutable && kv && j && j.times?.length) await kv.set(b.key, JSON.stringify(j));
    }
    all.push(...decodeJetta(j));
  }
  const out = all.filter((c, i) => i === 0 || c.t > all[i - 1].t);
  const sliced = out.length > limit ? out.slice(-limit) : out;
  // raw source < requested tf → aggregate up (minute→30m, hour→1h/4h…)
  return tfSec > (src === "minute" ? 60 : src === "hour" ? 3600 : 86400)
    ? resampleCandles(sliced, tfSec)
    : sliced;
}

export type ProviderName = "twelvedata" | "yahoo" | "oanda" | "dukascopy";

/** Which upstream serves a canonical pair. Index CFDs: OANDA when its token
 *  exists (geo-restricted signups), else the keyless Dukascopy public feed
 *  (realtime broker quotes), with Yahoo as last resort. Everything else →
 *  Twelve Data. PROVIDER_MAP overrides. */
export function providerForPair(
  pair: string,
  providerMap: Record<string, string> = {},
  oandaTokenPresent = false,
  dukascopyEnabled = true,
): ProviderName {
  const override = providerMap[pair];
  if (override === "twelvedata" || override === "yahoo" || override === "oanda" || override === "dukascopy") return override;
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
  const symbol = symbolMap[pair] ?? YAHOO_INDEX_SYMBOLS[pair.toUpperCase()] ?? symbolFor(pair, symbolMap);
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
  return out.length > limit ? out.slice(-limit) : out;
}

/** Unified entry point: route by provider, one argument shape for all. */
export interface MarketDataRequest {
  pair: string;
  tf: string;
  limit: number;
  tdKey?: string;
  oandaToken?: string;
  symbolMap?: Record<string, string>;
  providerMap?: Record<string, string>;
  fetchFn?: FetchLike;
  /** cache for immutable historical buckets (Dukascopy); tests inject MemStore */
  kv?: { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };
}

export async function fetchMarketData(req: MarketDataRequest): Promise<{ provider: ProviderName; candles: Candle[] }> {
  const provider = providerForPair(req.pair, req.providerMap, Boolean(req.oandaToken));
  const candles = provider === "oanda"
    ? await fetchOanda(req.oandaToken ?? "", req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn)
    : provider === "dukascopy"
      ? await fetchDukascopy(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn, req.kv)
      : provider === "yahoo"
        ? await fetchYahoo(req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn)
        : await fetchTwelveData(req.tdKey ?? "", req.pair, req.tf, req.limit, req.symbolMap ?? {}, req.fetchFn);
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
