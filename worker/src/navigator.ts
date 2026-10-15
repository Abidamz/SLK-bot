/** Monthly → weekly → daily bias navigator — the sit-out switch.
 *
 * The teaching is a chain, not a menu: the monthly storyline sets the
 * context, the weekly must align with it ("if weekly is not in alignment,
 * you don't have any trade"), and the daily supplies a confirmation event —
 * one of three interchangeable forms — before any entry is permitted. The
 * older bias gate treated the monthly tier as optional and walked tier
 * pairs until something fired, which is why it fired on ~100% of ticks and
 * its agreement-with-profit sign flipped between windows. This module makes
 * the chain mandatory and returns one permitted direction, or null.
 *
 * Pure function of COMPLETE candles: the caller supplies the monthly,
 * weekly and daily series as it aggregates them (calendar boundaries). The
 * state can only change when a daily candle closes, so callers cache on the
 * daily close time — cron-shaped, never per-tick.
 *
 * Level retirement is inherited from bosEvent: a swing that a later body
 * closes through is consumed by that break and never sources a future one,
 * which is "a broken level no longer has my attention" in mechanical form.
 */
import { bosEvent } from "./features";
import { confirmationEvent, type ConfirmationKind } from "./bias_gate";
import type { Candle, Direction, KeyLevel } from "./types";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type NavigatorReason =
  | "ALIGNED_CONFIRMED"
  | "INSUFFICIENT_HISTORY"
  | "NO_MONTHLY_BOS"
  | "NO_WEEKLY_BOS"
  | "WEEKLY_MISALIGNED"
  | "NO_DAILY_CONFIRM";

export interface NavigatorState {
  monthDir: Direction | null;
  weekDir: Direction | null;
  /** Daily structural direction, diagnostic only: entries follow the
   *  aligned weekly direction once the daily confirms it. */
  dayDir: Direction | null;
  /** Open time of the current (incomplete) week: confirmations must be
   *  inside it, so last week's engulfing cannot license this week's trades. */
  weekStart: number | null;
  confirmation: ConfirmationKind | null;
  permitted: Direction | null;
  reason: NavigatorReason;
}

export interface NavigatorOptions {
  left?: number;
  right?: number;
  sweptLookback?: number;
  /** Daily key levels; enables the disrespected-level tap confirmation form.
   *  Empty keeps the two level-free forms (sweep-and-break, engulfing). */
  levels?: KeyLevel[];
}

export const EMPTY_NAVIGATOR: NavigatorState = {
  monthDir: null, weekDir: null, dayDir: null,
  weekStart: null, confirmation: null, permitted: null,
  reason: "INSUFFICIENT_HISTORY",
};

function bosDir(candles: Candle[], left: number, right: number): Direction | null {
  if (candles.length < left + right + 2) return null;
  const ev = bosEvent(candles, left, right);
  return ev ? (ev[1] === "up" ? "LONG" : "SHORT") : null;
}

/** The chain, evaluated once per daily close. */
export function navigatorState(
  mo: Candle[], w1: Candle[], d1: Candle[], opts: NavigatorOptions = {},
): NavigatorState {
  const left = opts.left ?? 2;
  const right = opts.right ?? 2;
  const monthDir = bosDir(mo, left, right);
  const weekDir = bosDir(w1, left, right);
  const dayDir = bosDir(d1, left, right);
  const weekStart = w1.length ? w1[w1.length - 1].t + WEEK_MS : null;
  const st: NavigatorState = { ...EMPTY_NAVIGATOR, monthDir, weekDir, dayDir, weekStart };
  if (!mo.length || !w1.length || !d1.length) return st;
  if (!monthDir) return { ...st, reason: "NO_MONTHLY_BOS" };
  if (!weekDir) return { ...st, reason: "NO_WEEKLY_BOS" };
  // The mandatory link: a weekly storyline against the monthly one is not a
  // trade, it is the market changing its mind mid-month.
  if (weekDir !== monthDir) return { ...st, reason: "WEEKLY_MISALIGNED" };
  const sinceIdx = weekStart === null ? -1 : d1.findIndex((c) => c.t >= weekStart);
  const lookback = sinceIdx < 0 ? 6 : Math.max(2, d1.length - sinceIdx);
  const conf = confirmationEvent(d1, opts.levels ?? [], weekDir, {
    left, right, lookback, sweptLookback: opts.sweptLookback ?? 12,
  });
  if (!conf || (weekStart !== null && conf.time < weekStart)) {
    return { ...st, reason: "NO_DAILY_CONFIRM" };
  }
  return { ...st, confirmation: conf.kind, permitted: weekDir, reason: "ALIGNED_CONFIRMED" };
}
