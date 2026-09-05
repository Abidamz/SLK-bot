/** Shared test fixtures. All candles are SYNTHETIC — they verify state-machine
 *  logic only and must never be presented as market backtests or performance
 *  evidence. Row-for-row parity with the Python engine fixtures. */
import type { Candle, KeyLevel, LiquidityPool, Storyline } from "../src/types";

export const BASE = Date.parse("2024-03-04T00:00:00.000Z"); // a Monday

export function mkCandles(rows: [number, number, number, number][], stepMin = 30, base = BASE): Candle[] {
  return rows.map(([o, h, l, c], i) => ({
    t: base + i * stepMin * 60_000,
    o, h, l, c,
  }));
}

export function fromCloses(closes: number[], stepMin = 240, base = BASE, wick = 0.08): Candle[] {
  const out: Candle[] = [];
  let prev = closes[0];
  closes.forEach((c, i) => {
    const o = prev;
    out.push({
      t: base + i * stepMin * 60_000,
      o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c,
    });
    prev = c;
  });
  return out;
}

// ── engine parity fixtures (identical numbers to tests/test_engine.py) ─────
//
// bar4  swing high 104.55 = resting buyside internal liquidity
// bar7  swing low  104.03 = pullback structure (BOS reference)
// bar10 wick 105.10 into origin zone, closes back under 104.55 → TOUCH+SWEEP
// bar11 close 103.90 < 104.03 → SHIFT (BOS)
// bar14 high 105.00 back in zone after leaving → RETEST → ALERT @ 104.90

export const SHORT_ROWS: [number, number, number, number][] = [
  [103.80, 103.86, 103.74, 103.82],
  [103.82, 103.92, 103.78, 103.90],
  [103.90, 104.04, 103.86, 104.00],
  [104.00, 104.15, 103.95, 104.10],
  [104.10, 104.55, 104.05, 104.50],
  [104.50, 104.52, 104.25, 104.30],
  [104.30, 104.33, 104.10, 104.15],
  [104.15, 104.20, 104.03, 104.06],
  [104.06, 104.30, 104.06, 104.25],
  [104.25, 104.40, 104.20, 104.35],
  [104.35, 105.10, 104.30, 104.50], // 10 touch+sweep
  [104.50, 104.62, 103.85, 103.90], // 11 BOS
  [103.90, 103.95, 103.55, 103.60], // 12
  [103.60, 103.75, 103.50, 103.55], // 13
  [103.55, 105.00, 103.50, 104.90], // 14 retest → alert
];

export const LONG_ROWS: [number, number, number, number][] = [
  [100.20, 100.26, 100.14, 100.18],
  [100.18, 100.22, 100.08, 100.10],
  [100.10, 100.14, 99.96, 100.00],
  [100.00, 100.06, 99.85, 99.90],
  [99.90, 99.95, 97.45, 97.50],
  [97.50, 97.75, 97.48, 97.70],
  [97.70, 97.90, 97.67, 97.85],
  [97.85, 98.50, 97.80, 98.45],
  [98.45, 98.47, 98.15, 98.20],
  [98.20, 98.30, 98.10, 98.25],
  [98.25, 98.30, 96.90, 97.55],   // 10 touch+sweep
  [97.55, 98.70, 98.45, 98.60],   // 11 BOS
  [98.60, 98.75, 98.40, 98.55],   // 12
  [98.55, 98.60, 98.30, 98.45],   // 13
  [98.45, 98.52, 97.80, 98.10],   // 14 retest → alert
];

function story(
  direction: "LONG" | "SHORT",
  zone: [number, number],
  originPrice: number,
  pools: LiquidityPool[],
  target: number,
): Storyline {
  const level: KeyLevel = {
    kind: "A", originPrice, zoneLo: zone[0], zoneHi: zone[1],
    originTime: BASE, originIndex: 5, touches: 2, flipped: false, fvgOverlap: true,
  };
  return {
    asof: BASE, valid: true, reason: "ok", direction,
    environment: direction === "SHORT" ? "bearish" : "bullish",
    phase: "pullback", htfAlignment: "M:? W:↓ D:↓ H4:↓",
    origin: level, drawOnLiquidity: target, nearestExternalTarget: target,
    internalPools: pools, externalPools: [], imbalances: [],
    mapClose: direction === "SHORT" ? 104.0 : 100.0,
  };
}

export const SHORT_STORY = story("SHORT", [104.95, 105.05], 105.0, [
  { price: 104.0, side: "sellside", kind: "structural", sourceTime: BASE },
  { price: 103.5, side: "sellside", kind: "single-candle", sourceTime: BASE },
  { price: 105.8, side: "buyside", kind: "structural", sourceTime: BASE },
], 101.0);

export const LONG_STORY = story("LONG", [97.75, 98.05], 98.0, [
  { price: 100.0, side: "buyside", kind: "structural", sourceTime: BASE },
  { price: 100.5, side: "buyside", kind: "single-candle", sourceTime: BASE },
], 103.0);

/** Snapshots valid from 4h before the first entry candle. */
export function snapsFor(st: Storyline): [number, Storyline][] {
  return [[BASE - 8 * 3600_000, st]];
}

// ── end-to-end fixtures for the scheduled() path ───────────────────────────

export const T0 = BASE; // entry fixture starts here

/** Daily context feed: ~broad decline with a clean dip-and-recover so a
 *  sellside swing-low pool qualifies below current price. Last bar opens at
 *  T0−1d (Sunday) so its open-age at the e2e "now" (Monday 08:00) is 32h —
 *  inside the 48h freshness gate for d1. */
export function dailyFeed(): Candle[] {
  const closes = Array.from({ length: 50 }, (_, i) => 110 - 0.3 * i);
  // dip to a swing low at bar 46, then a 3-bar recovery (keeps the pivot valid)
  closes[45] = 97.4; closes[46] = 97.1; closes[47] = 97.5; closes[48] = 97.7; closes[49] = 97.9;
  return fromCloses(closes, 1440, T0 - 50 * 86400_000, 0.08);
}

/** H4 closes path: 8 flat bars of lead-in (storylineSeries needs ≥20 bars,
 *  the scan requires ≥30), then a clean bearish structure — lower highs
 *  105.7/104.95, lower lows — with an A-top origin ~104.95–105.01 above
 *  current price ~103.6. Buckets 0..28 of the base feed map 1:1 to these;
 *  buckets 29–31 are drift pad + the entry sequence below. */
export const H4_PATH = [
  106.5, 106.5, 106.5, 106.5, 106.5, 106.5, 106.5, 106.5, // flat lead-in
  106.5, 106.2, 105.9, 105.6, 105.3,                    // swing V needed for env structure
  105.7,                                              // LH (idx 13)
  105.4, 105.1, 104.8, 104.5, 104.2,                  // LL (idx 18) → flip origin
  104.7, 104.9, 104.95,                               // LH (idx 21)
  104.6, 104.4, 104.2, 104.0, 103.9, 103.8, 103.75, 103.7,
];

/** Shift applied to SHORT_ROWS inside the e2e base feed. */
export const E2E_SHIFT = 0.15;

/** Single 30m base feed (mirrors production: the worker fetches the smallest
 *  entry TF once and resamples 1h/4h out of it). Layout:
 *  buckets 0..28  → H4_PATH values as flat candles (232 bars)
 *  bucket 29      → tiny drift pad (103.61 → 103.645)
 *  bucket 30      → SHORT_ROWS[0..7] − E2E_SHIFT
 *  bucket 31      → SHORT_ROWS[8..14] − E2E_SHIFT (7 bars; bucket complete
 *                   exactly at T0+8h = the e2e "now")
 *  Bucket j spans [T0 + (j−30)·4h, T0 + (j−29)·4h). */
export function baseFeed(): Candle[] {
  const out: Candle[] = [];
  const bucketOpen = (j: number) => T0 + (j - 30) * 4 * 3600_000;
  for (let j = 0; j <= 28; j++) {
    const p = H4_PATH[j];
    for (let k = 0; k < 8; k++) {
      out.push({ t: bucketOpen(j) + k * 1800_000, o: p, h: p + 0.05, l: p - 0.05, c: p });
    }
  }
  for (let k = 0; k < 8; k++) {
    const prev = k === 0 ? 103.605 : 103.61 + 0.005 * (k - 1);
    const c = 103.61 + 0.005 * k;
    out.push({ t: bucketOpen(29) + k * 1800_000, o: prev, h: Math.max(prev, c) + 0.03, l: Math.min(prev, c) - 0.03, c });
  }
  SHORT_ROWS.forEach(([o, h, l, c], i) => {
    out.push({ t: bucketOpen(30) + i * 1800_000, o: o - E2E_SHIFT, h: h - E2E_SHIFT, l: l - E2E_SHIFT, c: c - E2E_SHIFT });
  });
  return out;
}

/** Twelve Data wire format helper (values ascending, "YYYY-MM-DD HH:mm:ss"). */
export function tdJson(candles: Candle[]) {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const day = d.toISOString().slice(0, 10);
    const hm = d.toISOString().slice(11, 19);
    return `${day} ${hm}`;
  };
  return {
    values: candles.map((c) => ({
      datetime: fmt(c.t),
      open: String(c.o), high: String(c.h), low: String(c.l), close: String(c.c),
    })),
  };
}

/** Yahoo Finance wire format helper (v8 chart: epoch seconds + quote arrays). */
export function yahooJson(candles: Candle[]) {
  return {
    chart: {
      result: [{
        timestamp: candles.map((c) => Math.floor(c.t / 1000)),
        indicators: {
          quote: [{
            open: candles.map((c) => c.o),
            high: candles.map((c) => c.h),
            low: candles.map((c) => c.l),
            close: candles.map((c) => c.c),
          }],
        },
      }],
      error: null,
    },
  };
}

/** A flat index-CFD feed (no structure → no storylines → no alerts). */
export function yahooFlatFeed(): Candle[] {
  const closes = Array.from({ length: 420 }, (_, i) => 39000 + Math.sin(i / 24) * 8);
  return fromCloses(closes, 30, T0 + 8 * 3600_000 - 420 * 1800_000, 3);
}

export interface RecordedCalls {
  telegram: string[];
  discord: string[];
  /** raw upstream URLs hit (per provider), populated when passed in */
  dataCalls?: string[];
}

/** A fetch replacement that serves fixture candles and captures notification
 *  calls. Pass overrides to simulate outages. */
export function makeFakeFetch(calls: RecordedCalls, opts: { failData?: boolean } = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("api.twelvedata.com")) {
      (calls.dataCalls ??= []).push(url);
      if (opts.failData) throw new Error("network down (simulated)");
      const interval = new URL(String(url)).searchParams.get("interval");
      const candles = interval === "1day" ? dailyFeed() : baseFeed();
      return new Response(JSON.stringify(tdJson(candles)), { status: 200 });
    }
    if (url.includes("finance.yahoo.com")) {
      (calls.dataCalls ??= []).push(url);
      if (opts.failData) throw new Error("network down (simulated)");
      return new Response(JSON.stringify(yahooJson(yahooFlatFeed())), { status: 200 });
    }
    if (url.includes("api.telegram.org")) {
      calls.telegram.push(JSON.parse(String(init?.body ?? "{}")).text ?? "");
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }
    if (url.includes("discord.com")) {
      calls.discord.push(JSON.parse(String(init?.body ?? "{}")).content ?? "");
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  };
}
