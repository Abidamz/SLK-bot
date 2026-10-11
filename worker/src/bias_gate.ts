/**
 * Multi-timeframe bias gate — the storyline rule as taught.
 *
 * A storyline is three criteria, and they are bound to specific timeframes:
 *
 *   "Number one is the rejection. Number two is candle closure. And number
 *    three is what we call breakouts on time frame lower."
 *
 * The first two are satisfied on the timeframe the bias is built from. The
 * third is satisfied exactly one timeframe below it:
 *
 *   monthly  -> rejection + closure on monthly,  confirmation on weekly
 *   weekly   -> rejection + closure on weekly,   confirmation on daily
 *   daily    -> rejection + closure on daily,    confirmation on 4H
 *
 * The confirmation one timeframe lower may take any of three forms:
 *
 *   "The daily confirmation doesn't have to be a liquidity sweep and break of
 *    structure... sometimes it can be an engulfing... Or it can be a key level
 *    that was disrespected. Price will come back, tap into that particular key
 *    level and we know that the weekly and the daily has already aligned."
 *
 *   1. a liquidity sweep followed by a break of structure
 *   2. an engulfing
 *   3. a key level that was disrespected, which price returns to and taps
 *
 * Neither the rejection nor the confirmation is sufficient alone: "the
 * rejection is not a standalone factor", and a bare breakout "might just mean
 * price has taken out an external liquidity and then we'll be in the reversal
 * phase of the market."
 *
 * This replaces multiTfGate for bias purposes. That function required a
 * breakout on every timeframe simultaneously and required no rejection and no
 * closure anywhere — stricter than the rule on count, looser on kind.
 */
import { bosEvent, findSwings, keyLevels } from "./features";
import type { StrategyConfig } from "./config";
import type { Candle, Direction, KeyLevel } from "./types";

/**
 * An engulfing candle: the body of the second candle completely covers the
 * body of the first. The wicks are not part of the test — an engulfing candle
 * can sit entirely inside the previous candle's range and still qualify.
 *
 * Two consequences of taking the definition literally:
 *
 *   - The pattern is a reversal, so the two candles must be opposite colours.
 *     A larger candle in the same direction is momentum, not an engulfing.
 *   - A doji has no body, so neither a doji as the engulfing candle nor a doji
 *     as the candle being engulfed can produce the pattern.
 *
 * Coverage must be genuine rather than a shared boundary: at least one end of
 * the body has to extend past the previous body, which also rules out two
 * equal-sized bodies stacked end to end.
 */
export function isEngulfing(c: Candle, prev: Candle): boolean {
  const dir = engulfingDirection(c);
  const prevDir = engulfingDirection(prev);
  if (dir === null || prevDir === null) return false;
  if (dir === prevDir) return false;
  const cHi = Math.max(c.o, c.c);
  const cLo = Math.min(c.o, c.c);
  const pHi = Math.max(prev.o, prev.c);
  const pLo = Math.min(prev.o, prev.c);
  return cHi >= pHi && cLo <= pLo && (cHi > pHi || cLo < pLo);
}

/**
 * Direction of an engulfing candle, taken from its own close versus its open.
 * Returns null for a doji, where the engulfing says nothing about intent.
 */
export function engulfingDirection(c: Candle): Direction | null {
  if (c.c > c.o) return "LONG";
  if (c.c < c.o) return "SHORT";
  return null;
}

export interface TimedEvent {
  dir: Direction;
  index: number;
  time: number;
}

/**
 * Most recent engulfing candle in the given direction, within `lookback`
 * candles of the end of the series.
 */
export function engulfingEvent(
  candles: Candle[],
  dir: Direction,
  lookback = 6,
): TimedEvent | null {
  const start = Math.max(1, candles.length - lookback);
  for (let i = candles.length - 1; i >= start; i--) {
    if (!isEngulfing(candles[i], candles[i - 1])) continue;
    if (engulfingDirection(candles[i]) !== dir) continue;
    return { dir, index: i, time: candles[i].t };
  }
  return null;
}

/**
 * A liquidity sweep: a candle wick takes out a prior swing extreme but the
 * candle closes back on the inside. Taking out a low and closing above it is
 * a bullish sweep — sellside liquidity was raided and rejected.
 *
 * Deliberately requires the close back inside. A wick that merely exceeds an
 * extreme and keeps going is a break, not a sweep.
 */
export function sweepEvent(
  candles: Candle[],
  dir: Direction,
  left = 2,
  right = 2,
  lookback = 12,
): TimedEvent | null {
  const [highs, lows] = findSwings(candles, left, right);
  const start = Math.max(1, candles.length - lookback);
  for (let i = candles.length - 1; i >= start; i--) {
    const c = candles[i];
    if (dir === "LONG") {
      for (const sw of lows) {
        if (sw.index < i && c.l < sw.price && c.c > sw.price) {
          return { dir, index: i, time: c.t };
        }
      }
    } else {
      for (const sw of highs) {
        if (sw.index < i && c.h > sw.price && c.c < sw.price) {
          return { dir, index: i, time: c.t };
        }
      }
    }
  }
  return null;
}

/**
 * Rejection with a candle closure at a key level — criteria one and two.
 *
 * Bullish: price trades down into the level zone and closes above it. The
 * close is what makes it a rejection rather than a touch; without the close
 * it is "not a standalone factor to be considered."
 */
export function rejectionClosure(
  candles: Candle[],
  levels: KeyLevel[],
  lookback = 6,
): (TimedEvent & { level: KeyLevel }) | null {
  if (!levels.length) return null;
  const start = Math.max(0, candles.length - lookback);
  for (let i = candles.length - 1; i >= start; i--) {
    const c = candles[i];
    for (const lv of levels) {
      if (lv.originIndex >= i) continue; // level must predate the rejection
      if (c.l <= lv.zoneHi && c.c > lv.zoneHi) {
        return { dir: "LONG", index: i, time: c.t, level: lv };
      }
      if (c.h >= lv.zoneLo && c.c < lv.zoneLo) {
        return { dir: "SHORT", index: i, time: c.t, level: lv };
      }
    }
  }
  return null;
}

export type ConfirmationKind = "sweep_bos" | "engulfing" | "flipped_level";

export interface Confirmation {
  kind: ConfirmationKind;
  dir: Direction;
  index: number;
  time: number;
}

/**
 * Confirmation one timeframe lower. Returns the first of the three forms that
 * holds, in the order the teaching presents them.
 */
export function confirmationEvent(
  candles: Candle[],
  levels: KeyLevel[],
  dir: Direction,
  opts: { left?: number; right?: number; lookback?: number; sweptLookback?: number } = {},
): Confirmation | null {
  const left = opts.left ?? 2;
  const right = opts.right ?? 2;
  const lookback = opts.lookback ?? 6;
  const sweptLookback = opts.sweptLookback ?? 12;

  // 1. sweep of liquidity followed by a break of structure, same direction.
  const sweep = sweepEvent(candles, dir, left, right, sweptLookback);
  const bos = bosEvent(candles, left, right);
  if (sweep && bos) {
    const bosDir: Direction = bos[1] === "up" ? "LONG" : "SHORT";
    if (bosDir === dir && bos[0] >= sweep.index) {
      return { kind: "sweep_bos", dir, index: bos[0], time: candles[bos[0]].t };
    }
  }

  // 2. an engulfing candle in the bias direction.
  const eng = engulfingEvent(candles, dir, lookback);
  if (eng) return { kind: "engulfing", dir, index: eng.index, time: eng.time };

  // 3. a key level that was already disrespected, which price has come back
  //    to tap and then closed through in the bias direction.
  const start = Math.max(0, candles.length - lookback);
  for (let i = candles.length - 1; i >= start; i--) {
    const c = candles[i];
    for (const lv of levels) {
      if (!lv.flipped || lv.originIndex >= i) continue;
      const tapsAndCloses = dir === "LONG"
        ? c.l <= lv.zoneHi && c.c > lv.zoneHi
        : c.h >= lv.zoneLo && c.c < lv.zoneLo;
      if (tapsAndCloses) {
        return { kind: "flipped_level", dir, index: i, time: c.t };
      }
    }
  }

  return null;
}

export interface BiasTier {
  /** Label used in diagnostics, e.g. "w1", "d1", "h4". */
  tf: string;
  candles: Candle[];
  levels: KeyLevel[];
}

export interface BiasEvidence {
  dir: Direction;
  /** Timeframe the rejection and candle closure were found on. */
  originTf: string;
  /** Timeframe one below the origin, where the confirmation was found. */
  confirmTf: string;
  confirmation: ConfirmationKind;
  originTime: number;
  confirmTime: number;
}

export interface BiasGateOptions {
  left?: number;
  right?: number;
  /** Candles searched on the origin timeframe for a rejection and closure. */
  originLookback?: number;
  /** Candles searched on the confirming timeframe. */
  confirmLookback?: number;
  /** Candles searched for the sweep half of a sweep-and-break. */
  sweptLookback?: number;
}

/**
 * Walk the tiers highest to lowest and take the first adjacent pair where the
 * higher gives a rejection with a candle closure and the next one down
 * confirms. Highest origin wins: a monthly storyline outranks a weekly one.
 *
 * Tiers must be ordered highest to lowest. The monthly tier acts as the
 * navigator — it is checked first and refreshed monthly, but the gate does
 * not require it, because a storyline can legitimately be built from the
 * weekly or the daily when the monthly is unclear.
 */
export function biasGate(tiers: BiasTier[], opts: BiasGateOptions = {}): BiasEvidence | null {
  const o = {
    left: opts.left ?? 2,
    right: opts.right ?? 2,
    originLookback: opts.originLookback ?? 4,
    confirmLookback: opts.confirmLookback ?? 6,
    sweptLookback: opts.sweptLookback ?? 12,
  };
  for (let i = 0; i + 1 < tiers.length; i++) {
    const origin = tiers[i];
    const confirm = tiers[i + 1];
    if (origin.candles.length < 2 || confirm.candles.length < 2) continue;
    const rej = rejectionClosure(origin.candles, origin.levels, o.originLookback);
    if (!rej) continue;
    const conf = confirmationEvent(confirm.candles, confirm.levels, rej.dir, {
      left: o.left, right: o.right,
      lookback: o.confirmLookback, sweptLookback: o.sweptLookback,
    });
    if (!conf) continue;
    return {
      dir: rej.dir,
      originTf: origin.tf,
      confirmTf: confirm.tf,
      confirmation: conf.kind,
      originTime: rej.time,
      confirmTime: conf.time,
    };
  }
  return null;
}

export interface TierSource {
  /** Label used in diagnostics, e.g. "mo", "w1", "d1", "h4". */
  tf: string;
  /** Candles for this timeframe, truncated to what had closed by the tick. */
  candles: Candle[];
}

export interface TierLevelOptions {
  /**
   * Key-level kinds the gate may reject from. Defaults to A, V and OC.
   *
   * DECISION is left out: it is a single wide-range candle's body, kept in
   * keyLevels so pre-existing behaviour is not silently discarded, and it is
   * not a key level in the teaching. OC is the one to watch — keyLevels emits
   * one for every consecutive pair of overlapping bodies, which is most bars,
   * so a gate free to reject from any OC level will find a rejection on almost
   * every candle.
   */
  kinds?: KeyLevel["kind"][];
  /** A level must have been touched at least this often to sponsor a rejection. */
  minTouches?: number;
}

/**
 * Attach key levels to each timeframe so the result can go straight into
 * biasGate. Tiers must already be ordered highest to lowest — that ordering is
 * the rule, not a convenience, because biasGate reads rejection and closure on
 * one tier and confirmation on the next one down.
 *
 * A tier with fewer than three candles gets no levels. Two candles cannot hold
 * an A or V extremum, and keyLevels on a stub series produces a zone width
 * derived from an ATR that does not exist yet.
 */
export function storylineTiers(
  sources: TierSource[],
  cfg: StrategyConfig,
  opts: TierLevelOptions = {},
): BiasTier[] {
  const kinds = new Set<KeyLevel["kind"]>(opts.kinds ?? ["A", "V", "OC"]);
  const minTouches = opts.minTouches ?? 0;
  return sources.map(({ tf, candles }) => ({
    tf,
    candles,
    levels: candles.length < 3 ? [] : keyLevels(candles, cfg)
      .filter((l) => kinds.has(l.kind) && l.touches >= minTouches),
  }));
}
