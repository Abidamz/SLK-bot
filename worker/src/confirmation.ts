/**
 * Confirmation entry — SHADOW ONLY. Nothing here gates a live alert.
 *
 * The second of the two entry models in the mentorship, and the more precisely
 * specified of the two. It is not a competitor to the continuation setup; it is
 * what you trade when the continuation setup already moved without you:
 *
 *   "I use confirmation entry every time I miss out on the first move. So when
 *    the initial move has started, and I'm not in it, I'm waiting and I'm
 *    paying attention for the confirmation entry."
 *
 * The trigger, stated for a bullish scenario:
 *
 *   1. Price is reacting from a higher-timeframe key level. "all I know is
 *      that the higher time frame is bullish... we are reacting from a key
 *      level right here."
 *   2. Drop one timeframe. From the 4 hours he plays the 2 hours, the 1 hour,
 *      then the 30 minutes as a last resort — never straight to the 30.
 *   3. "this last sell candle has to create a high and it also needs to create
 *      a low." Call it the setup candle.
 *   4. "I want to see price take out this particular low. And after price
 *      takes out that low we need to see price close above." The sweep of the
 *      low, closing back above it — which is what forms the V-shape.
 *   5. "If price takes out the low the high has to still be standing."
 *
 * Then two outcomes, and he is explicit that the first dominates:
 *
 *   "there are two expectations... either the third candle is going to play out
 *    from the V-shaped key level and continue to move to the upside, or the
 *    third candle is going to serve as internal liquidity. But 80 to 90% of the
 *    time you are always going to see the third candle play out from that level."
 *
 * Note what that figure is and is not. It is a claim about the third candle
 * playing out from the level in THIS model. It says nothing about the
 * continuation setup, and it is his claim, unverified.
 *
 * Risk and reward are the least ambiguous numbers in the whole material:
 *
 *   "Your stop loss is just going to be below this low, one pip below this low."
 *   "the least it gives to you is a 1 to 5. It will always give you at least
 *    1 to 3, 1 to 4, max a 1 to 5. Sometimes it can give to you a 1 to 10."
 */

import type { Candle, Direction } from "./types";

export interface ConfirmationParams {
  /** Distance beyond the swept low/high for the stop, in price units. */
  stopBuffer: number;
  /** Reward-to-risk. His stated floor is 3; he expects 4-5. */
  rr: number;
  /**
   * Candles to look back for the setup candle whose extreme gets swept. Too
   * small and the sweep is missed; too large and a stale low gets traded.
   */
  setupLookback: number;
}

export const DEFAULT_CONFIRMATION_PARAMS: ConfirmationParams = {
  stopBuffer: 0.0001, // one pip on a five-decimal FX quote
  rr: 3,
  setupLookback: 12,
};

export interface ConfirmationEntry {
  direction: Direction;
  /** Close of the candle that swept the extreme and closed back inside. */
  entry: number;
  /** One pip beyond the swept extreme. */
  stop: number;
  tp: number;
  /** The extreme that was swept — the low for a long, the high for a short. */
  swept: number;
  /** The extreme that had to remain standing. */
  standing: number;
  /** Index of the candle that swept, and of the setup candle it swept. */
  sweepIndex: number;
  setupIndex: number;
  /** Reward-to-risk actually achieved. */
  rr: number;
  time: number;
  setupId: string;
}

/**
 * Find confirmation entries on one timeframe.
 *
 * `bias` comes from the higher timeframe. A sweep against the bias is not this
 * setup — it is the lower timeframe doing what lower timeframes do.
 *
 * Scans every candle so a replay can call it once per tick on a growing series;
 * `setupId` makes the results dedupeable across ticks the way production does.
 */
export function findConfirmationEntries(
  candles: Candle[],
  bias: Direction | null,
  params: ConfirmationParams = DEFAULT_CONFIRMATION_PARAMS,
): ConfirmationEntry[] {
  if (!bias || candles.length < 3) return [];
  const out: ConfirmationEntry[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];

    // Look back for the setup candle whose extreme this candle takes out.
    let setupIndex = -1;
    for (let j = i - 1; j >= Math.max(0, i - params.setupLookback); j--) {
      const s = candles[j];
      if (bias === "LONG") {
        // Sweeps the setup candle's low, then closes back above it.
        if (c.l < s.l && c.c > s.l) { setupIndex = j; break; }
      } else {
        if (c.h > s.h && c.c < s.h) { setupIndex = j; break; }
      }
    }
    if (setupIndex < 0) continue;

    const setup = candles[setupIndex];

    if (bias === "LONG") {
      const swept = setup.l;
      const standing = setup.h;
      // "If price takes out the low the high has to still be standing."
      if (c.h >= standing) continue;
      const stop = swept - params.stopBuffer;
      const risk = c.c - stop;
      if (!(risk > 0)) continue;
      const tp = c.c + risk * params.rr;
      out.push({
        direction: "LONG", entry: c.c, stop, tp, swept, standing,
        sweepIndex: i, setupIndex, rr: (tp - c.c) / risk, time: c.t,
        setupId: ["CONF", "LONG", setupIndex, i, candles.length].join("|"),
      });
    } else {
      const swept = setup.h;
      const standing = setup.l;
      if (c.l <= standing) continue;
      const stop = swept + params.stopBuffer;
      const risk = stop - c.c;
      if (!(risk > 0)) continue;
      const tp = c.c - risk * params.rr;
      out.push({
        direction: "SHORT", entry: c.c, stop, tp, swept, standing,
        sweepIndex: i, setupIndex, rr: (c.c - tp) / risk, time: c.t,
        setupId: ["CONF", "SHORT", setupIndex, i, candles.length].join("|"),
      });
    }
  }
  return out;
}

/**
 * Which of the two expectations played out.
 *
 * The third candle either trades back into the V-shaped level and the move
 * continues, or it fails to and instead becomes internal liquidity that gets
 * swept first. He puts the first at 80-90%. This exists so the replay can
 * count it rather than take the figure on faith.
 */
export function thirdCandleOutcome(
  candles: Candle[],
  e: ConfirmationEntry,
): "played_out" | "internal_liquidity" | "pending" {
  const idx = e.sweepIndex + 1;
  if (idx >= candles.length) return "pending";
  const third = candles[idx];
  if (e.direction === "LONG") {
    // Traded back into the level it was supposed to play out from.
    return third.l <= e.entry ? "played_out" : "internal_liquidity";
  }
  return third.h >= e.entry ? "played_out" : "internal_liquidity";
}
