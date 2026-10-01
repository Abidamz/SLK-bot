/** Outcome resolution for open alerts — port of tracking.evaluate_signal.
 *  Stops are close-based by default (model prefers close-based invalidation);
 *  targets are touch-based. If one candle resolves both, SL wins
 *  (conservative).
 *  Trailing Breakeven: when favorable excursion reaches trailingBeTriggerR (default +1.5R),
 *  the stop loss automatically moves to entry price. If price subsequently retraces to entry,
 *  the trade resolves as BE_HIT with 0.00R (preventing a +1.5R to +2.0R winner from turning into -1.0R loss). */
import type { Candle, Direction, Outcome, SignalStatus } from "./types";

export function evaluateSignal(
  direction: Direction,
  entry: number,
  stop: number,
  tp: number,
  candlesAfter: Candle[],
  expireAfter = 120,
  slOnClose = false,
  trailingBeTriggerR = 1.5,
  trailingBeEnabled = true,
): Outcome | null {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  // corrupt-target guard: a TP on the wrong side of entry can never be a
  // legitimate take-profit (see engine.selectTargets for the prevention);
  // rows created before that fix simply never resolve rather than spamming
  // "TP HIT" with a negative R.
  if (direction === "SHORT" ? tp >= entry : tp <= entry) return null;
  const sign = direction === "LONG" ? 1 : -1;
  const rMultiple = (price: number) => (sign * (price - entry)) / risk;

  const window = expireAfter ? candlesAfter.slice(0, expireAfter) : candlesAfter;
  let beArmed = false;

  for (const c of window) {
    let slHit = false;
    let tpHit = false;
    let beHit = false;

    if (direction === "LONG") {
      tpHit = c.h >= tp;
      if (beArmed) {
        beHit = slOnClose ? c.c <= entry : c.l <= entry;
      } else {
        slHit = slOnClose ? c.c < stop : c.l <= stop;
      }
    } else {
      tpHit = c.l <= tp;
      if (beArmed) {
        beHit = slOnClose ? c.c >= entry : c.h >= entry;
      } else {
        slHit = slOnClose ? c.c > stop : c.h >= stop;
      }
    }

    // Conservative conflict resolution: SL/BE beats TP if touched in same candle
    if (slHit) return { status: "SL_HIT" as SignalStatus, exitPrice: stop, exitTime: c.t, rMultiple: -1 };
    if (beHit && !tpHit) return { status: "BE_HIT" as SignalStatus, exitPrice: entry, exitTime: c.t, rMultiple: 0 };
    if (tpHit) return { status: "TP_HIT" as SignalStatus, exitPrice: tp, exitTime: c.t, rMultiple: rMultiple(tp) };
    if (beHit) return { status: "BE_HIT" as SignalStatus, exitPrice: entry, exitTime: c.t, rMultiple: 0 };

    // Check if favorable excursion reaches trailingBeTriggerR to arm BE for subsequent candles
    if (trailingBeEnabled && !beArmed) {
      const maxFavorableR = direction === "LONG"
        ? (c.h - entry) / risk
        : (entry - c.l) / risk;
      if (maxFavorableR >= trailingBeTriggerR) {
        beArmed = true;
      }
    }
  }

  if (expireAfter && candlesAfter.length >= expireAfter && window.length) {
    const last = window[window.length - 1];
    return { status: "EXPIRED", exitPrice: last.c, exitTime: last.t, rMultiple: rMultiple(last.c) };
  }
  return null;
}

/** Timestamp of the first candle whose favorable excursion reaches the
 *  trailing-BE trigger (the exact candle where BE arms), or null when it
 *  never arms. Mirrors the arming rule inside `evaluateSignal` so the live
 *  MT5 bridge trails the broker stop on the same candle the paper engine
 *  would have armed breakeven. */
export function beArmedTime(
  direction: Direction,
  entry: number,
  stop: number,
  candlesAfter: Candle[],
  trailingBeTriggerR = 1.5,
  trailingBeEnabled = true,
): number | null {
  if (!trailingBeEnabled) return null;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  for (const c of candlesAfter) {
    const maxFavorableR = direction === "LONG"
      ? (c.h - entry) / risk
      : (entry - c.l) / risk;
    if (maxFavorableR >= trailingBeTriggerR) return c.t;
  }
  return null;
}
