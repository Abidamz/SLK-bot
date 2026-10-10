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
 *   6. Liquidity resting on the far side. "that same key level that sponsor
 *      the sale must be overlapping in term of an imbalance and there must be
 *      liquidity resting above it." Price has somewhere to go.
 *   7. The rebalance must have happened. "you want to see price take out
 *      liquidity, rebalance imbalance at this specific pricing level". A level
 *      that broke and is still running away has not been retested, so there is
 *      nothing to enter.
 *
 * Where a rule has no stated number, it is exposed as a parameter rather than
 * guessed. A wrong guess baked into an entry filter is worse than no filter.
 */

import type { Candle, Direction, Imbalance, KeyLevel } from "./types";
import type { StrategyConfig } from "./config";
import { atr, bosEvent, fvgZones, internalPools, keyLevels, markFvgOverlap } from "./features";

/**
 * Where the impulsive leg is measured from, for the shallow-retracement test.
 *
 * Only "swing" is geometrically coherent with entering at the level, and the
 * first 180d run proved it: with "break", depth <= 1 forces the pullback to
 * stay above the break close, while entering at the level requires the pullback
 * to come back below it. Every one of 152,411 candidates died on that
 * contradiction. For a long the level sits BELOW the break, so a return to it
 * is always more than a 100% retrace of a leg measured from the break — the leg
 * has to start below the level, at the swing the impulsive move launched from.
 *
 * The other two are kept so the sweep can show the difference rather than have
 * it asserted.
 */
export type LegOrigin = "break" | "level" | "swing";

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
  /** Where the impulsive leg is measured from. See LegOrigin. */
  legOrigin: LegOrigin;
  /** Candles searched before the break for the swing the move launched from. */
  impulseLookback: number;
  /**
   * Minimum body-to-range ratio for the break candle. 0 = not required.
   * See breakStrength.
   */
  minBreakBodyPct: number;
  /** Minimum break-candle body as a multiple of ATR. 0 = not required. */
  minBreakAtrMult: number;
  /**
   * Require liquidity resting on the far side of the level. Stated as part of
   * the definition rather than as a filter, so it is on by default; exposed so
   * the sweep can measure what it contributes.
   */
  requireLiquidity: boolean;
}

export const DEFAULT_CONTINUATION_PARAMS: ContinuationParams = {
  minTouches: 1,
  maxRetraceDepth: 1,
  rr: 3,
  stopBufferPct: 0.1,
  fvgLookback: 60,
  legOrigin: "swing",
  impulseLookback: 10,
  // Both off. These are the "impulsive" test, and the mentorship calls the
  // impulsive move "the secret, the blueprint" without ever putting a number
  // on it in fourteen sources. Shipping a guess here would make the first
  // replay return zero setups, which teaches nothing. They are swept in so
  // their marginal contribution is measured rather than assumed.
  minBreakBodyPct: 0,
  minBreakAtrMult: 0,
  requireLiquidity: true,
};

/** How hard the break candle actually moved. */
export interface BreakStrength {
  /** Body as a fraction of the candle's total range. 1 = no wicks at all. */
  bodyPct: number;
  /** Body as a multiple of ATR. */
  bodyAtr: number;
}

/**
 * Measure the impulsive move that disrespected the level.
 *
 * "The secret, it's the blueprint, is in the impulsive move that led to the
 * break." He never quantifies it, but he does say what a valid break looks
 * like — a body-to-body break read off the line chart, which is closes with
 * the wicks stripped out — and that he loves inefficient price action, which
 * is a candle that travels without looking back.
 *
 * Both readings of that are here: bodyPct says the candle committed (little
 * wick, no indecision), bodyAtr says it travelled a real distance. A candle
 * crawling through the zone on a long wick scores badly on both.
 */
export function breakStrength(c: Candle, atrVal: number): BreakStrength {
  const body = Math.abs(c.c - c.o);
  const range = c.h - c.l;
  return {
    bodyPct: range > 0 ? body / range : 0,
    bodyAtr: atrVal > 0 ? body / atrVal : 0,
  };
}

/** What a level did after it formed: how it was tested, and how it broke. */
export interface LevelHistory {
  /**
   * Touches recorded between the previous break and the break in question —
   * the "tested that held" count. Touches from before an earlier break belong
   * to that earlier break's story, not this one.
   */
  touchesBefore: number;
  /** Index of the candle that broke the level, or -1 if it never broke. */
  breakIndex: number;
  /** Direction of the break, or null if it never broke. */
  breakDir: Direction | null;
  /** How many times the level has been broken in total. */
  breaks: number;
  /** Close of the break candle — where the impulsive leg is measured from. */
  breakPrice: number;
  /** Furthest price reached in the break direction after the break. */
  extreme: number;
  /** Furthest price travelled back against the break after `extreme`. */
  pullback: number;
}

/**
 * Replay a level's life: how many times it held, how many times it broke, and
 * how far price ran before coming back.
 *
 * `flipped` on KeyLevel is a single boolean and loses the direction, the count
 * and the ordering — all three of which the setup turns on.
 *
 * The MOST RECENT break is the one that counts, not the first. The level that
 * forms an A-shape is created by the rejection that breaks it downward; the
 * trade is the later break in the other direction. Taking the first break
 * would report every one of those levels as a short. It also matches the rule
 * the whole method rests on: "follow the most recent breakout."
 */
export function levelHistory(
  candles: Candle[],
  level: KeyLevel,
  cfg: StrategyConfig,
): LevelHistory {
  const atrVal = atr(candles, cfg.atrPeriod);
  const margin = cfg.flipMarginAtr * atrVal;

  const breaks: { index: number; dir: Direction }[] = [];
  // Touches accumulated since the last break, snapshotted at each break.
  const touchesAtBreak: number[] = [];
  let run = 0;

  // A break is an EDGE, not a state. An impulsive move closes beyond the zone
  // on several consecutive candles; counting each one as its own break would
  // report the last of them as the break and leave it with no touches before
  // it, which is not the setup. Only the transition counts.
  type Side = "inside" | "above" | "below";
  let side: Side = "inside";

  for (let j = level.originIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    const next: Side =
      c.c > level.zoneHi + margin ? "above"
      : c.c < level.zoneLo - margin ? "below"
      : "inside";
    if (next !== "inside" && next !== side) {
      breaks.push({ index: j, dir: next === "above" ? "LONG" : "SHORT" });
      touchesAtBreak.push(run);
      run = 0;
    } else if (next === "inside" && c.h >= level.zoneLo && c.l <= level.zoneHi) {
      run += 1;
    }
    side = next;
  }

  if (!breaks.length) {
    return {
      touchesBefore: run, breakIndex: -1, breakDir: null, breaks: 0,
      breakPrice: NaN, extreme: NaN, pullback: NaN,
    };
  }

  const last = breaks.length - 1;
  const breakIndex = breaks[last].index;
  const breakDir = breaks[last].dir;
  const touchesBefore = touchesAtBreak[last];

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

  return {
    touchesBefore, breakIndex, breakDir, breaks: breaks.length,
    breakPrice: candles[breakIndex].c, extreme, pullback,
  };
}

/**
 * Fraction of the impulsive leg given back by the pullback.
 *
 * 0 means price never came back at all; 1 means the whole leg was retraced.
 *
 * The leg is measured from the BREAK candle, not from the level's origin.
 * "The secret is in the impulsive move that led to the break" — so the
 * impulsive move begins at the break, and a pullback that returns to the level
 * itself is a shallow retrace of that move, not a full one. Measured from the
 * origin instead, every rebalance-at-the-level would read as depth 1.0 and the
 * shallow-retracement filter would reject exactly the setups it is meant to
 * keep.
 *
 * He calls the setup shallow without ever saying how shallow, so the threshold
 * is a parameter to sweep rather than a number to guess.
 */
export function retraceDepth(
  h: LevelHistory,
  level: KeyLevel,
  legOrigin: LegOrigin,
  candles?: Candle[],
  impulseLookback = 10,
): number {
  if (!h.breakDir || !Number.isFinite(h.extreme)) return NaN;

  let from: number;
  if (legOrigin === "break") {
    from = h.breakPrice;
  } else if (legOrigin === "level") {
    from = level.originPrice;
  } else {
    // The swing the impulsive move launched from: the most adverse price in
    // the run-up to the break. This is the only reference that puts the leg
    // start below the level, so a return to the level reads as a partial
    // retrace instead of an impossible >100% one.
    if (!candles) return NaN;
    const start = Math.max(0, h.breakIndex - impulseLookback);
    from = h.breakDir === "LONG" ? Infinity : -Infinity;
    for (let j = start; j <= h.breakIndex && j < candles.length; j++) {
      const p = h.breakDir === "LONG" ? candles[j].l : candles[j].h;
      if (h.breakDir === "LONG" ? p < from : p > from) from = p;
    }
  }
  if (!Number.isFinite(from)) return NaN;

  const leg = Math.abs(h.extreme - from);
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
  /**
   * How many times the level has been broken in total. The mentorship trades a
   * level differently the second time it is disrespected, so this is carried
   * for the sweep even though it does not gate anything yet.
   */
  breaks: number;
  /** Fraction of the impulsive leg retraced — rule 5. */
  depth: number;
  /** How hard the break candle moved — rule 3, whether or not it gates. */
  bodyPct: number;
  bodyAtr: number;
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
  /**
   * Optional rejection counters. A run that finds nothing is uninterpretable
   * without knowing which rule rejected what: "0 setups" is the same string
   * whether one filter is too strict or five are all slightly too strict.
   */
  diag?: Record<string, number>,
): ContinuationSetup[] {
  if (!bias || candles.length < 40) return [];
  const bump = (k: string) => { if (diag) diag[k] = (diag[k] ?? 0) + 1; };

  const levels = keyLevels(candles, cfg);
  const imbalances: Imbalance[] = fvgZones(candles, params.fvgLookback);
  markFvgOverlap(levels, imbalances);
  const atrVal = atr(candles, cfg.atrPeriod);
  const pools = internalPools(candles, atrVal, cfg.decisionAtrMult);

  const out: ContinuationSetup[] = [];
  for (const level of levels) {
    bump("levels");
    // Rule 4: overlap. He calls the setup low probability without it.
    if (!level.fvgOverlap) { bump("noFvg"); continue; }

    const h = levelHistory(candles, level, cfg);

    // Rule 3 direction: the break must agree with the multi-timeframe bias.
    if (h.breakDir !== bias) { bump("wrongDir"); continue; }

    // Rule 2: tested and held before it broke.
    if (h.touchesBefore < params.minTouches) { bump("touches"); continue; }

    // Rule 5: shallow. Parameterised because he never quantifies it.
    const depth = retraceDepth(h, level, params.legOrigin, candles, params.impulseLookback);
    if (Number.isFinite(depth) && depth > params.maxRetraceDepth) { bump("depth"); continue; }

    // Rule 6: liquidity resting on the far side, so the move has somewhere to
    // go. A buyside pool above the level for a long, sellside below for a short.
    //
    // Measured as vacuous on the first 180d run: 0 rejections out of 152,411
    // candidates that reached it. internalPools returns every structural swing
    // and every wide-candle extreme, so there is essentially always one on the
    // far side. Left in place because the condition is part of his definition,
    // but it is not currently doing any work and should not be credited with
    // any filtering until it is tightened — probably to the nearest pool
    // rather than any pool.
    if (params.requireLiquidity) {
      const want = bias === "LONG" ? "buyside" : "sellside";
      const beyond = pools.some(
        (p) => p.side === want && (bias === "LONG" ? p.price > level.zoneHi : p.price < level.zoneLo),
      );
      if (!beyond) { bump("liquidity"); continue; }
    }

    // Rule 3: the break must have been IMPULSIVE, not merely a close that
    // happened to land past the zone. Off by default; see the params.
    const brk = candles[h.breakIndex];
    const strength = breakStrength(brk, atrVal);
    if (strength.bodyPct < params.minBreakBodyPct) { bump("bodyPct"); continue; }
    if (strength.bodyAtr < params.minBreakAtrMult) { bump("bodyAtr"); continue; }

    const entry = (level.zoneLo + level.zoneHi) / 2;

    // Rule 6: the rebalance has to have actually happened, at the price we
    // would enter. Not merely somewhere in the zone — the entry is a pending
    // limit at this price, so if price never traded through it there is no
    // fill and no trade. This also guarantees the risk is positive by
    // construction: a limit below the entry cannot have its stop above it.
    if (bias === "LONG" ? h.pullback > entry : h.pullback < entry) { bump("rebalance"); continue; }

    // Stop beyond the swing the pullback made, so re-testing it does not stop
    // the trade out before the move resumes. The risk is kept signed on
    // purpose: Math.abs here would happily report a long whose stop sits above
    // its entry, which is not a trade.
    const buf = Math.abs(entry - h.pullback) * params.stopBufferPct;
    const stop = bias === "LONG" ? h.pullback - buf : h.pullback + buf;
    const risk = bias === "LONG" ? entry - stop : stop - entry;
    if (!(risk > 0)) { bump("risk"); continue; }

    const tp = bias === "LONG" ? entry + risk * params.rr : entry - risk * params.rr;
    const rr = Math.abs(tp - entry) / risk;

    bump("emitted");
    out.push({
      level,
      direction: bias,
      entry,
      stop,
      tp,
      touchesBefore: h.touchesBefore,
      breaks: h.breaks,
      depth,
      bodyPct: strength.bodyPct,
      bodyAtr: strength.bodyAtr,
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
