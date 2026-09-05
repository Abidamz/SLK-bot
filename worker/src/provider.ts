/** Market data: Twelve Data REST (fetch-based, Workers-compatible) plus
 *  data-quality validation. Canonical symbol mapping is explicit: the
 *  research requires normalized symbols per provider. */
import type { Candle } from "./types";

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
