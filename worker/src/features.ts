/** Feature extraction for the SLK model — TypeScript port of
 *  slk_bot/slk/features.py. Pure functions, no I/O. */
import type { Candle, Direction, Imbalance, KeyLevel, LiquidityPool, Swing } from "./types";
import type { StrategyConfig } from "./config";

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { h, l } = candles[i];
    const pc = candles[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const tail = trs.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

export function sessionFor(ms: number, windows: [string, string, string][]): string | null {
  const d = new Date(ms);
  const tod = d.getUTCHours() * 60 + d.getUTCMinutes();
  const parse = (s: string) => {
    const [hh, mm] = s.split(":").map(Number);
    return hh * 60 + mm;
  };
  for (const [name, start, end] of windows) {
    const s = parse(start);
    const e = parse(end);
    if (s <= e) {
      if (tod >= s && tod < e) return name;
    } else if (tod >= s || tod < e) return name; // overnight window
  }
  return null;
}

/** Fractal pivots — confirmed only once `right` bars follow, so consumers
 *  never look ahead. */
export function findSwings(candles: Candle[], left = 2, right = 2): [Swing[], Swing[]] {
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  const n = candles.length;
  for (let i = left; i < n - right; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= left; k++) {
      if (!(c.h > candles[i - k].h)) isHigh = false;
      if (!(c.l < candles[i - k].l)) isLow = false;
    }
    for (let k = 1; k <= right; k++) {
      if (!(c.h >= candles[i + k].h)) isHigh = false;
      if (!(c.l <= candles[i + k].l)) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: c.h, time: c.t, kind: "high" });
    if (isLow) lows.push({ index: i, price: c.l, time: c.t, kind: "low" });
  }
  return [highs, lows];
}

export function environment(candles: Candle[], left = 2, right = 2, minSwings = 2): string {
  const [highs, lows] = findSwings(candles, left, right);
  if (highs.length < minSwings || lows.length < minSwings) return "consolidation";
  const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
  const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (hh && hl) return "bullish";
  if (lh && ll) return "bearish";
  return "consolidation";
}

/** Opposing structural point: a CLOSE beyond it kills the storyline. */
export function structureInvalidationLevel(
  candles: Candle[], direction: Direction, left = 2, right = 2,
): number | null {
  const [highs, lows] = findSwings(candles, left, right);
  if (direction === "SHORT") return highs.length ? highs[highs.length - 1].price : null;
  return lows.length ? lows[lows.length - 1].price : null;
}

/** Most recent break of structure: [index, "up"|"down", level]. */
export function bosEvent(
  candles: Candle[], left = 2, right = 2,
): [number, "up" | "down", number] | null {
  const [highs, lows] = findSwings(candles, left, right);
  const crossed = new Set<string>();
  const events: [number, "up" | "down", number][] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    for (const sw of highs) {
      if (sw.index < i && !crossed.has(`H${sw.index}`) && c.c > sw.price && candles[i - 1].c <= sw.price) {
        crossed.add(`H${sw.index}`);
        events.push([i, "up", sw.price]);
      }
    }
    for (const sw of lows) {
      if (sw.index < i && !crossed.has(`L${sw.index}`) && c.c < sw.price && candles[i - 1].c >= sw.price) {
        crossed.add(`L${sw.index}`);
        events.push([i, "down", sw.price]);
      }
    }
  }
  return events.length ? events[events.length - 1] : null;
}

export function phase(candles: Candle[], env: string, lookback: number, left = 2, right = 2): string {
  if (env !== "bullish" && env !== "bearish") return "range";
  const ev = bosEvent(candles, left, right);
  if (!ev) return "range";
  const [i, dir] = ev;
  const sameDir = (dir === "up" && env === "bullish") || (dir === "down" && env === "bearish");
  if (sameDir) return candles.length - 1 - i <= lookback ? "expansion" : "pullback";
  return "reversal";
}

// ---------------------------------------------------------------- resampling

export function resampleCandles(candles: Candle[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const b = Math.floor(c.t / 1000 / seconds);
    const existing = buckets.get(b);
    if (existing) {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c;
    } else {
      buckets.set(b, { t: b * seconds * 1000, o: c.o, h: c.h, l: c.l, c: c.c });
    }
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function calendarKey(t: number, period: "W" | "M"): string {
  const d = new Date(t);
  if (period === "M") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  // ISO week
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3
      + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

/** Aggregate daily candles into calendar weeks ("W") or months ("M"). */
export function resampleCalendar(daily: Candle[], period: "W" | "M"): Candle[] {
  const groups = new Map<string, Candle[]>();
  for (const c of daily) {
    const key = calendarKey(c.t, period);
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.values()].map((cs) => ({
    t: cs[0].t,
    o: cs[0].o,
    h: Math.max(...cs.map((x) => x.h)),
    l: Math.min(...cs.map((x) => x.l)),
    c: cs[cs.length - 1].c,
  }));
}

const ARROWS: Record<string, string> = { bullish: "↑", bearish: "↓", consolidation: "↔", "n/a": "?" };

export function htfAlignment(d1: Candle[], h4Env: string, left = 2, right = 2): string {
  const dEnv = environment(d1, left, right);
  const w = resampleCalendar(d1, "W");
  const wEnv = w.length >= 7 ? environment(w, 1, 1) : "n/a";
  const m = resampleCalendar(d1, "M");
  const mEnv = m.length >= 7 ? environment(m, 1, 1) : "n/a";
  return `M:${ARROWS[mEnv] ?? "?"} W:${ARROWS[wEnv] ?? "?"} D:${ARROWS[dEnv] ?? "?"} H4:${ARROWS[h4Env] ?? "?"}`;
}

// ----------------------------------------------------------------- liquidity

export function externalPools(daily: Candle[], left = 2, right = 2, swingCount = 4): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  if (daily.length) {
    const d = daily[daily.length - 1];
    pools.push({ price: d.h, side: "buyside", kind: "PDH", sourceTime: d.t });
    pools.push({ price: d.l, side: "sellside", kind: "PDL", sourceTime: d.t });
  }
  const weeks = resampleCalendar(daily, "W");
  if (weeks.length >= 2) {
    const w = weeks[weeks.length - 2]; // last completed week
    pools.push({ price: w.h, side: "buyside", kind: "PWH", sourceTime: w.t });
    pools.push({ price: w.l, side: "sellside", kind: "PWL", sourceTime: w.t });
  }
  const months = resampleCalendar(daily, "M");
  if (months.length >= 2) {
    const m = months[months.length - 2];
    pools.push({ price: m.h, side: "buyside", kind: "PMH", sourceTime: m.t });
    pools.push({ price: m.l, side: "sellside", kind: "PML", sourceTime: m.t });
  }
  const [highs, lows] = findSwings(daily, left, right);
  for (const sw of highs.slice(-swingCount))
    pools.push({ price: sw.price, side: "buyside", kind: "external-swing", sourceTime: sw.time });
  for (const sw of lows.slice(-swingCount))
    pools.push({ price: sw.price, side: "sellside", kind: "external-swing", sourceTime: sw.time });
  return pools;
}

/** Internal liquidity on the map TF: structural swings + single-candle
 *  liquidity from wide-range "decision" candles. */
export function internalPools(
  candles: Candle[], atrVal: number, decisionAtrMult = 1.5, left = 2, right = 2,
): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  const [highs, lows] = findSwings(candles, left, right);
  for (const sw of highs)
    pools.push({ price: sw.price, side: "buyside", kind: "structural", sourceTime: sw.time });
  for (const sw of lows)
    pools.push({ price: sw.price, side: "sellside", kind: "structural", sourceTime: sw.time });
  if (atrVal > 0) {
    for (const c of candles) {
      if (c.h - c.l >= decisionAtrMult * atrVal) {
        pools.push({ price: c.h, side: "buyside", kind: "single-candle", sourceTime: c.t });
        pools.push({ price: c.l, side: "sellside", kind: "single-candle", sourceTime: c.t });
      }
    }
  }
  return pools;
}

// ---------------------------------------------------------------- key levels

/** Unmitigated 3-candle fair value gaps near current price. */
export function fvgZones(candles: Candle[], lookback: number): Imbalance[] {
  const n = candles.length;
  const out: Imbalance[] = [];
  for (let i = Math.max(1, n - 1 - lookback); i < n - 1; i++) {
    const a = candles[i - 1];
    const b = candles[i];
    const c = candles[i + 1];
    let zone: Imbalance | null = null;
    if (c.l > a.h) zone = { lo: a.h, hi: c.l, direction: "bullish", time: b.t };
    else if (c.h < a.l) zone = { lo: c.h, hi: a.l, direction: "bearish", time: b.t };
    if (!zone) continue;
    let mitigated = false;
    for (let j = i + 2; j < n; j++) {
      if (zone.direction === "bullish" && candles[j].l <= zone.lo) { mitigated = true; break; }
      if (zone.direction === "bearish" && candles[j].h >= zone.hi) { mitigated = true; break; }
    }
    if (!mitigated) out.push(zone);
  }
  return out;
}

/** A/V line-chart extrema (on closes) + Open-Close decision zones, with
 *  touch counting and flip detection. */
export function keyLevels(candles: Candle[], cfg: StrategyConfig): KeyLevel[] {
  const n = candles.length;
  const atrVal = atr(candles, cfg.atrPeriod);
  const tol = cfg.levelToleranceAtr * atrVal;
  const v = cfg.avLen;
  const closes = candles.map((c) => c.c);
  const levels: KeyLevel[] = [];

  for (let i = Math.max(v, n - cfg.levelLookback); i < n - v; i++) {
    let isA = true;
    let isV = true;
    for (let k = 1; k <= v; k++) {
      if (!(closes[i] > closes[i - k])) isA = false;
      if (!(closes[i] < closes[i - k])) isV = false;
    }
    for (let k = 1; k <= v; k++) {
      if (!(closes[i] >= closes[i + k])) isA = false;
      if (!(closes[i] <= closes[i + k])) isV = false;
    }
    if (isA) {
      levels.push({ kind: "A", originPrice: closes[i], zoneLo: closes[i] - tol, zoneHi: closes[i] + tol, originTime: candles[i].t, originIndex: i, touches: 0, flipped: false, fvgOverlap: false });
    }
    if (isV) {
      levels.push({ kind: "V", originPrice: closes[i], zoneLo: closes[i] - tol, zoneHi: closes[i] + tol, originTime: candles[i].t, originIndex: i, touches: 0, flipped: false, fvgOverlap: false });
    }
  }

  for (let i = Math.max(1, n - cfg.levelLookback); i < n; i++) {
    const c = candles[i];
    if (atrVal > 0 && c.h - c.l >= cfg.decisionAtrMult * atrVal) {
      levels.push({ kind: "OC", originPrice: c.c, zoneLo: Math.min(c.o, c.c), zoneHi: Math.max(c.o, c.c), originTime: c.t, originIndex: i, touches: 0, flipped: false, fvgOverlap: false });
    }
  }

  // touches and flips — only bars after the level's own origin
  for (const lv of levels) {
    for (let j = lv.originIndex + 1; j < n; j++) {
      const c = candles[j];
      const brokeUp = c.c > lv.zoneHi + cfg.flipMarginAtr * atrVal;
      const brokeDn = c.c < lv.zoneLo - cfg.flipMarginAtr * atrVal;
      if (brokeUp || brokeDn) lv.flipped = true;
      else if (c.h >= lv.zoneLo && c.l <= lv.zoneHi) lv.touches += 1;
    }
  }
  return levels;
}

export function markFvgOverlap(levels: KeyLevel[], imbalances: Imbalance[]): void {
  for (const lv of levels) {
    lv.fvgOverlap = imbalances.some((imb) => !(imb.hi < lv.zoneLo || imb.lo > lv.zoneHi));
  }
}

/** Origin level must sit on the entry side of price: above for shorts
 *  (sell into premium), below for longs. FVG overlap, repeated touches,
 *  flips and proximity raise the score. */
export function selectOrigin(
  levels: KeyLevel[], price: number, atrVal: number, direction: Direction, cfg: StrategyConfig,
): KeyLevel | null {
  if (atrVal <= 0) return null;
  let best: KeyLevel | null = null;
  let bestScore = -Infinity;
  for (const lv of levels) {
    let dist: number;
    if (direction === "SHORT") {
      if (price >= lv.zoneHi) continue;
      dist = lv.zoneLo - price;
    } else {
      if (price <= lv.zoneLo) continue;
      dist = price - lv.zoneHi;
    }
    const distAtr = dist / atrVal;
    if (distAtr > cfg.zoneMaxDistanceAtr) continue;
    const score =
      (lv.fvgOverlap ? 2.0 : 0) +
      0.5 * Math.min(lv.touches, 3) +
      (lv.flipped ? 0.25 : 0) +
      1 / (1 + distAtr);
    if (score > bestScore) {
      bestScore = score;
      best = lv;
    }
  }
  return best;
}

/** Drop the trailing in-progress candle so the engine only sees closed bars. */
export function dropIncomplete(candles: Candle[], tfSeconds: number, now?: number): Candle[] {
  const nowMs = now ?? Date.now();
  return candles.filter((c) => c.t + tfSeconds * 1000 <= nowMs);
}
