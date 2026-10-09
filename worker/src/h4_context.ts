/** H4 vantage context + session buckets — DIAGNOSTICS ONLY.
 *
 *  Ports the "H4 vantage" step of the TAYO Model into a per-scan context object
 *  that is attached to setup rows, shadow-ledger rows and experiment rows as
 *  confluence tags:
 *
 *    1. the most recent H4 structural breakout and its direction
 *    2. whether that breakout created an H4 FVG (imbalance)
 *    3. whether an H4 key level (ANY kind: A, V, OC, DECISION) sits
 *       inside/overlapping that breakout FVG
 *
 *  Plus the UTC+1 session bucket of a triggering candle.
 *
 *  Nothing in this module gates, suppresses, delays, or creates a live alert.
 *  Alerts, delivery, dedupe, cooldowns and outcome rules never read it.
 */
import * as F from "./features";
import { evaluateDailyContext } from "./shadow";
import type { StrategyConfig } from "./config";
import type {
  Candle, Direction, H4ConfluenceGrade, H4KeyLevelTag, KeyLevel, SessionBucket,
} from "./types";

// ------------------------------------------------------------------ sessions

export const SESSION_BUCKETS: readonly SessionBucket[] = [
  "S00_04", "S04_08", "S08_12", "S12_16", "S16_20", "S20_24",
] as const;

/** UTC+1 session bucket of a candle OPEN time. 00:00–08:00 UTC+1 (the
 *  overnight / Asia H4 candles) lands in S00_04 and S04_08. */
export function sessionBucketUtcPlus1(ms: number): SessionBucket {
  const hourUtc1 = (new Date(ms).getUTCHours() + 1) % 24;
  const index = Math.floor(hourUtc1 / 4);
  return SESSION_BUCKETS[index] ?? "S00_04";
}

// ---------------------------------------------------------------- confluence

/** Minimum closed H4 bars before the context is considered usable. */
export const H4_CONTEXT_MIN_BARS = 10;
/** A breakout older than this many closed H4 bars is still recorded as
 *  context, but is treated as stale by the shadow continuation experiment. */
export const H4_BREAKOUT_RECENCY_BARS = 12;

export type H4BreakoutDirection = "bullish" | "bearish";

export interface H4BreakoutFvg {
  lo: number;
  hi: number;
  direction: H4BreakoutDirection;
  time: number;
  /** Displacement candle index inside the H4 feed. */
  index: number;
}

export interface H4VantageConfluence {
  /** H4 feed had enough closed bars to evaluate. */
  available: boolean;
  /** Spec grade, highest first; null when there is no recent H4 breakout. */
  grade: H4ConfluenceGrade | null;
  /** All confluence tags for this scan (grade, key-level kind, direction,
   *  provisional OBSERVATION_ONLY marker). The session bucket is appended
   *  per row by the engine. */
  tags: string[];
  breakoutDirection: H4BreakoutDirection | null;
  breakoutTime: number | null;
  breakoutLevel: number | null;
  /** Age of the breakout in closed H4 bars (0 = the latest closed candle). */
  breakoutAgeBars: number | null;
  fvg: H4BreakoutFvg | null;
  keyLevelKind: KeyLevel["kind"] | null;
  keyLevelTag: H4KeyLevelTag | null;
  keyLevelZone: [number, number] | null;
  /** The overlapping key level carries fvgOverlap=true → plug-and-play. */
  keyLevelFvgOverlap: boolean;
  /** True when the daily read is neutral/unclear, so the H4 breakout
   *  direction is only a provisional (observation-only) bias input. */
  observationOnly: boolean;
  /** Provisional bias input recorded for grading/diagnostics. Never gates. */
  provisionalBias: Direction | null;
}

export const H4_KEY_LEVEL_TAGS: Record<KeyLevel["kind"], H4KeyLevelTag> = {
  A: "H4_KL_A",
  V: "H4_KL_V",
  OC: "H4_KL_OC",
  DECISION: "H4_KL_DECISION",
};

export function emptyH4Confluence(): H4VantageConfluence {
  return {
    available: false,
    grade: null,
    tags: [],
    breakoutDirection: null,
    breakoutTime: null,
    breakoutLevel: null,
    breakoutAgeBars: null,
    fvg: null,
    keyLevelKind: null,
    keyLevelTag: null,
    keyLevelZone: null,
    keyLevelFvgOverlap: false,
    observationOnly: false,
    provisionalBias: null,
  };
}

/** 3-candle FVG formed by the breakout displacement candle. The breakout
 *  candle itself is preferred, then the candle after it, then the candle
 *  before it — always in the breakout's direction. */
export function breakoutFvg(
  h4: Candle[], breakoutIndex: number, direction: H4BreakoutDirection,
): H4BreakoutFvg | null {
  const offsets = [0, 1, -1];
  for (const offset of offsets) {
    const i = breakoutIndex + offset;
    if (i < 1 || i > h4.length - 2) continue;
    const prev = h4[i - 1];
    const mid = h4[i];
    const next = h4[i + 1];
    if (direction === "bullish") {
      if (next.l > prev.h) return { lo: prev.h, hi: next.l, direction, time: mid.t, index: i };
    } else if (next.h < prev.l) {
      return { lo: next.h, hi: prev.l, direction, time: mid.t, index: i };
    }
  }
  return null;
}

function overlaps(level: KeyLevel, zone: { lo: number; hi: number }): boolean {
  return !(level.zoneHi < zone.lo || level.zoneLo > zone.hi);
}

/** Build the H4 vantage confluence for one market. Pure; safe to call on
 *  every scan. `d1` is optional and is used only to decide whether the H4
 *  breakout direction may be recorded as a provisional (observation-only)
 *  bias input when the daily read is neutral/unclear. */
export function buildH4VantageConfluence(
  h4: Candle[],
  cfg: StrategyConfig,
  d1?: Candle[],
): H4VantageConfluence {
  const ctx = emptyH4Confluence();
  if (!h4 || h4.length < H4_CONTEXT_MIN_BARS) return ctx;
  ctx.available = true;

  const bos = F.bosEvent(h4, cfg.pivotLeft, cfg.pivotRight);
  if (!bos) {
    ctx.tags.push("H4_NO_BREAKOUT");
    return ctx;
  }

  const [breakoutIndex, bosDirection, breakoutLevel] = bos;
  const direction: H4BreakoutDirection = bosDirection === "up" ? "bullish" : "bearish";
  ctx.breakoutDirection = direction;
  ctx.breakoutLevel = breakoutLevel;
  ctx.breakoutTime = h4[breakoutIndex]?.t ?? null;
  ctx.breakoutAgeBars = h4.length - 1 - breakoutIndex;

  const fvg = breakoutFvg(h4, breakoutIndex, direction);
  ctx.fvg = fvg;

  if (fvg) {
    // Key levels of ANY kind (A, V, OC, DECISION) + the same FVG-overlap
    // marking the storyline uses (features.markFvgOverlap).
    const levels = F.keyLevels(h4, cfg);
    const imbalances = F.fvgZones(h4, cfg.fvgLookback);
    F.markFvgOverlap(levels, imbalances);
    const inside = levels.filter((level) => overlaps(level, fvg));
    // Prefer a level that genuinely overlaps an OPEN imbalance (plug-and-play),
    // then the level closest to the FVG midpoint, then the freshest origin.
    const midpoint = (fvg.lo + fvg.hi) / 2;
    inside.sort((a, b) => {
      if (a.fvgOverlap !== b.fvgOverlap) return a.fvgOverlap ? -1 : 1;
      const da = Math.abs(a.originPrice - midpoint);
      const db = Math.abs(b.originPrice - midpoint);
      if (da !== db) return da - db;
      return b.originIndex - a.originIndex;
    });
    const level = inside[0] ?? null;
    if (level) {
      ctx.keyLevelKind = level.kind;
      ctx.keyLevelTag = H4_KEY_LEVEL_TAGS[level.kind] ?? null;
      ctx.keyLevelZone = [level.zoneLo, level.zoneHi];
      ctx.keyLevelFvgOverlap = level.fvgOverlap;
      ctx.grade = level.fvgOverlap ? "H4_PLUG_AND_PLAY" : "H4_KL_IN_FVG";
    } else {
      ctx.grade = "H4_FVG_ONLY";
    }
  } else {
    ctx.grade = "H4_BREAKOUT_BARE";
  }

  ctx.tags.push(ctx.grade);
  if (ctx.keyLevelTag) ctx.tags.push(ctx.keyLevelTag);
  ctx.tags.push(direction === "bullish" ? "H4_BREAKOUT_BULLISH" : "H4_BREAKOUT_BEARISH");

  // Provisional bias input: only when the daily read cannot supply a bias.
  const daily = d1 && d1.length ? evaluateDailyContext(d1) : null;
  const dailyUnclear = !daily || daily.incomplete || daily.bias === "neutral";
  if (dailyUnclear) {
    ctx.observationOnly = true;
    ctx.provisionalBias = direction === "bullish" ? "LONG" : "SHORT";
    ctx.tags.push("OBSERVATION_ONLY");
    ctx.tags.push(`H4_PROVISIONAL_BIAS_${ctx.provisionalBias}`);
  }

  return ctx;
}

/** Tags for one row: the scan-level confluence tags plus the row's own UTC+1
 *  session bucket of the triggering candle's open time. */
export function diagnosticTagsForRow(
  ctx: H4VantageConfluence | null | undefined, candleOpenTime: number,
): string[] {
  const bucket = sessionBucketUtcPlus1(candleOpenTime);
  return [...(ctx?.tags ?? []), bucket];
}
