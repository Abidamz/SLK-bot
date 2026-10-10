/**
 * Continuation setup detection — SHADOW ONLY. Nothing here gates a live alert.
 *
 * The engine implements the origin model: sweep, shift, retest. The mentorship
 * describes a second model, the continuation setup, which it calls the higher
 * probability of the two. It has a different trigger, a different confirmation
 * and a different retracement expectation, and none of it exists in the engine.
 *
 * The rules, as stated across the entry-model sessions:
 *
 *   1. Multi-timeframe gate. "The moment I see that the 4 hours, the daily and
 *      the weekly have given to us all of these most recent breakout to the
 *      downside, we have a multi-time frame alignment." At least two time
 *      frames below the one the storyline starts on must agree.
 *   2. The level was tested and held. "a key level that has been tested that
 *      held". That is `touches` before the break, not after it.
 *   3. It was then disrespected with an impulsive move. "What validates a
 *      breakout for us is a body to body break... move to the line chart."
 *      A line chart plots closes only, so this is a close-over-close test.
 *   4. The level overlaps an imbalance. "that same key level now is
 *      overlapping in an imbalance". Without it he calls the setup
 *      "low probability".
 *   5. Shallow retracement. "we didn't do a deep retracement". He never
 *      quantifies it, so it is a parameter here and must be swept.
 *
 * Where a rule has no stated number, it is exposed as a parameter rather than
 * guessed. A wrong guess baked into an entry filter is worse than no filter.
 */

import type { Candle, Direction, Imbalance, KeyLevel } from "./types";
import type { StrategyConfig } from "./config";
import { atr, bosEvent, fvgZones, keyLevels, markFvgOverlap } from "./features";

export interface ContinuationParams {
  /** Minimum times the level was tested and held before it broke. */
  minTouches: number;
  /** Maximum retracement into the impulsive leg, as a fraction. 1 = no limit. */
  maxRetraceDepth: number;
  /** Reward-to-risk used for the target. */
  rr: number;
  /** Stop buffer beyond the swept extreme, as a fraction of the risk distance. */
  stopBufferPct: number;
  /** Candles of FVG history considered for the overlap test. */
  fvgLookback: number;
}

export const DEFAULT_CONTINUATION_PARAMS: ContinuationParams = {
  minTouches: 1,
  maxRetraceDepth: 1,
  rr: 3,
  stopBufferPct: 0.1,
  fvgLookback: 60,
};

/** What a level did after it formed: how it was tested, and how it broke. */
export interface LevelHistory {
  /** Touches recorded BEFORE the level broke — the "tested and held" count. */
  touchesBefore: number;
  /** Index of the candle that broke the level, or -1 if it never broke. */
  breakIndex: number;
  /** Direction of the break, or null if it never broke. */
  breakDir: Direction | null;
  /** Furthest price reached in the break direction after the break. */
  extreme: number;
  /** Furthest price travelled back against the break after `extreme`. */
  pullback: number;
}

/**
 * Replay a level's life: how many times it held, whether it broke, and how far
 * price ran before coming back.
 *
 * `flipped` on KeyLevel is a single boolean and loses both the direction of the
 * break and the ordering of touches against it. Ordering is the point — a level
 * that held twice and then broke is the setup; a level that broke immediately
 * and was touched afterwards is not.
 */
export function levelHistory(
  candles: Candle[],
  level: KeyLevel,
  cfg: StrategyConfig,
): LevelHistory {
  const atrVal = atr(candles, cfg.atrPeriod);
  const margin = cfg.flipMarginAtr * atrVal;
  let touchesBefore = 0;
  let breakIndex = -1;
  let breakDir: Direction | null = null;

  for (let j = level.originIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    if (c.c > level.zoneHi + margin) { breakIndex = j; breakDir = "LONG"; break; }
    if (c.c < level.zoneLo - margin) { breakIndex = j; breakDir = "SHORT"; break; }
    if (c.h >= level.zoneLo && c.l <= level.zoneHi) touchesBefore += 1;
  }

  if (breakIndex < 0 || !breakDir) {
    return { touchesBefore, breakIndex: -1, breakDir: null, extreme: NaN, pullback: NaN };
  }

  // Track the run and the retrace in one pass, in candle order. The extreme
  // always precedes the pullback that measures against it.
  let extreme = breakDir === "LONG" ? -Infinity : Infinity;
  let extremeIndex = breakIndex;
  for (let j = breakIndex; j < candles.length; j++) {
    const price = breakDir === "LONG" ? candles[j].h : candles[j].l;
    if (breakDir === "LONG" ? price > extreme : price < extreme) {
      extreme = price;
      extremeIndex = j;
    }
  }
  // Scan from the candle AFTER the extreme. Within the extreme candle the
  // order of high and low is unknowable, so counting its own low as a
  // pullback would credit a retrace that may have happened before the run
  // even finished.
  let pullback = extreme;
  for (let j = extremeIndex + 1; j < candles.length; j++) {
    const price = breakDir === "LONG" ? candles[j].l : candles[j].h;
    if (breakDir === "LONG" ? price < pullback : price > pullback) pullback = price;
  }

  return { touchesBefore, breakIndex, breakDir, extreme, pullback };
}

/**
 * Fraction of the impulsive leg given back by the pullback.
 *
 * 0 means price never came back at all; 1 means the whole leg was retraced.
 * He calls the setup shallow without ever saying how shallow, so this is the
 * number to sweep rather than to guess.
 */
export function retraceDepth(h: LevelHistory, level: KeyLevel): number {
  if (!h.breakDir || !Number.isFinite(h.extreme)) return NaN;
  const leg = Math.abs(h.extreme - level.originPrice);
  if (leg <= 0) return NaN;
  return Math.abs(h.extreme - h.pullback) / leg;
}

/**
 * The most recent break of structure, validated on closes.
 *
 * `bosEvent` already tests close-over-close against a swing, which is the
 * line-chart body-to-body test. This only maps it onto Direction.
 */
export function mostRecentBreakout(
  candles: Candle[],
  left = 2,
  right = 2,
): { dir: Direction; index: number; price: number } | null {
  const ev = bosEvent(candles, left, right);
  if (!ev) return null;
  const [index, upDown, price] = ev;
  return { dir: upDown === "up" ? "LONG" : "SHORT", index, price };
}

/**
 * Multi-timeframe gate.
 *
 * Timeframes must be ordered highest to lowest, e.g. [weekly, daily, h4].
 * Every one supplied must agree or there is no bias: "the weekly has given to
 * you a bearish breakout, daily has given to you a bearish breakout, but the
 * four hours has not... that is where patience has to kick in."
 *
 * Returns null when any timeframe disagrees or has no breakout at all — which
 * is the gate doing its job, not an error.
 */
export function multiTfGate(
  timeframes: Candle[][],
  left = 2,
  right = 2,
): Direction | null {
  if (timeframes.length === 0) return null;
  let agreed: Direction | null = null;
  for (const candles of timeframes) {
    const bo = mostRecentBreakout(candles, left, right);
    if (!bo) return null;
    if (agreed === null) agreed = bo.dir;
    else if (agreed !== bo.dir) return null;
  }
  return agreed;
}

export interface ContinuationSetup {
  /** The key level whose break and rebalance produced the setup. */
  level: KeyLevel;
  /** Direction of the break — the direction the trade takes. */
  direction: Direction;
  /** Level zone midpoint: where price is expected to rebalance. */
  entry: number;
  stop: number;
  tp: number;
  /** Touches before the break — rule 2. */
  touchesBefore: number;
  /** Fraction of the impulsive leg retraced — rule 5. */
  depth: number;
  /** Reward-to-risk actually achieved after stop placement. */
  rr: number;
  time: number;
  /** Stable identity so a replay can dedupe across ticks, as production does. */
  setupId: string;
}

/**
 * Find continuation setups on one timeframe.
 *
 * `bias` is the multi-timeframe gate result. A level only counts when its break
 * agrees with that bias — a break against the higher-timeframe direction is a
 * retracement in his model, not a continuation.
 */
export function findContinuationSetups(
  candles: Candle[],
  cfg: StrategyConfig,
  bias: Direction | null,
  params: ContinuationParams = DEFAULT_CONTINUATION_PARAMS,
): ContinuationSetup[] {
  if (!bias || candles.length < 40) return [];

  const levels = keyLevels(candles, cfg);
  const imbalances: Imbalance[] = fvgZones(candles, params.fvgLookback);
  markFvgOverlap(levels, imbalances);

  const out: ContinuationSetup[] = [];
  for (const level of levels) {
    // Rule 4: overlap. He calls the setup low probability without it.
    if (!level.fvgOverlap) continue;

    const h = levelHistory(candles, level, cfg);

    // Rule 3 direction: the break must agree with the multi-timeframe bias.
    if (h.breakDir !== bias) continue;

    // Rule 2: tested and held before it broke.
    if (h.touchesBefore < params.minTouches) continue;

    // Rule 5: shallow. Parameterised because he never quantifies it.
    const depth = retraceDepth(h, level);
    if (Number.isFinite(depth) && depth > params.maxRetraceDepth) continue;

    const entry = (level.zoneLo + level.zoneHi) / 2;
    const riskRaw = Math.abs(entry - h.pullback);
    // The stop sits beyond the extreme the pullback reached, so a re-test of
    // that swing does not take the trade out before the move resumes.
    const stop =
      bias === "LONG"
        ? h.pullback - riskRaw * params.stopBufferPct
        : h.pullback + riskRaw * params.stopBufferPct;
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) continue;

    const tp = bias === "LONG" ? entry + risk * params.rr : entry - risk * params.rr;
    const rr = Math.abs(tp - entry) / risk;

    out.push({
      level,
      direction: bias,
      entry,
      stop,
      tp,
      touchesBefore: h.touchesBefore,
      depth,
      rr,
      time: candles[candles.length - 1].t,
      setupId: [
        "CONT",
        level.kind,
        bias,
        level.originTime,
        h.breakIndex,
        candles.length,
      ].join("|"),
    });
  }
  return out;
}
