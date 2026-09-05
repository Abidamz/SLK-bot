/** Outcome resolution for open alerts — port of tracking.evaluate_signal.
 *  Stops are close-based by default (model prefers close-based invalidation);
 *  targets are touch-based. If one candle resolves both, SL wins
 *  (conservative). */
import type { Candle, Direction, Outcome, SignalStatus } from "./types";

export function evaluateSignal(
  direction: Direction,
  entry: number,
  stop: number,
  tp: number,
  candlesAfter: Candle[],
  expireAfter = 120,
  slOnClose = true,
): Outcome | null {
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const sign = direction === "LONG" ? 1 : -1;
  const rMultiple = (price: number) => (sign * (price - entry)) / risk;

  const window = expireAfter ? candlesAfter.slice(0, expireAfter) : candlesAfter;
  for (const c of window) {
    let slHit: boolean;
    let tpHit: boolean;
    if (direction === "LONG") {
      slHit = slOnClose ? c.c < stop : c.l <= stop;
      tpHit = c.h >= tp;
    } else {
      slHit = slOnClose ? c.c > stop : c.h >= stop;
      tpHit = c.l <= tp;
    }
    if (slHit) return { status: "SL_HIT" as SignalStatus, exitPrice: stop, exitTime: c.t, rMultiple: -1 };
    if (tpHit) return { status: "TP_HIT" as SignalStatus, exitPrice: tp, exitTime: c.t, rMultiple: rMultiple(tp) };
  }
  if (expireAfter && candlesAfter.length >= expireAfter && window.length) {
    const last = window[window.length - 1];
    return { status: "EXPIRED", exitPrice: last.c, exitTime: last.t, rMultiple: rMultiple(last.c) };
  }
  return null;
}
