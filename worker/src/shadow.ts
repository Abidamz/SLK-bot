/** Shadow classification for video-aligned directional bias.
 *
 *  Behavior-neutral observational layer: never acts as a hard gate.
 *  Alert decisions, deduplication, notifications, outcomes, and risk rules
 *  remain unchanged.
 *
 *  Diagnostics hierarchy:
 *    1. Weekly liquidity context (high/low sweep, opposing standing, primary target)
 *    2. Daily context (body-to-body breakout, liquidity sweep + structure break, incomplete)
 *    3. 4H vantage-point direction (bullish / bearish / neutral + structural breakout status)
 *    4. 1H execution-context alignment (bullish / bearish / neutral + agreement with 4H)
 *    5. Entry quality (LTF sweep, BOS, FVG detected, FVG rebalance detected, retest)
 *    6. Classification (A_GRADE, B_GRADE, HTF_CONFLICT, OBSERVATION_ONLY)
 *
 *  Timeframe roles:
 *    30m entries: 4H = structural direction, 1H = execution-context alignment,
 *                 30m = sweep, structure shift, FVG rebalance, retest.
 *    1h entries:  4H = structural direction, 1H = entry confirmation.
 */
import type { Candle, Direction, KeyLevel } from "./types";
import type { StrategyConfig } from "./config";
import * as F from "./features";

export type ShadowClassification =
  | "A_GRADE"
  | "B_GRADE"
  | "HTF_CONFLICT"
  | "OBSERVATION_ONLY";

export interface WeeklyLiquidityContext {
  weeklyHighSwept: boolean;
  weeklyLowSwept: boolean;
  opposingLiquidityStanding: boolean;
  primaryOpposingTarget: number | null;
}

export type DailyBreakout = "bullish" | "bearish" | "none";
export type DailyContextBias = "bullish" | "bearish" | "neutral";

export interface DailyContext {
  bias: DailyContextBias;
  bodyToBodyBreakout: DailyBreakout;
  liquiditySweepPlusStructureBreak: boolean;
  sweepDirection: "bullish" | "bearish" | null;
  incomplete: boolean;
}

export type H4Direction = "bullish" | "bearish" | "neutral";
export type StructuralBreakoutStatus = "bullish_breakout" | "bearish_breakout" | "none";

export interface H4VantageContext {
  direction: H4Direction;
  breakoutStatus: StructuralBreakoutStatus;
  hasStructureBreak: boolean;
}

export type H1Direction = "bullish" | "bearish" | "neutral";

export interface H1ExecutionContext {
  direction: H1Direction;
  agreesWith4H: boolean;
}

export interface EntryQuality {
  lowerTimeframeSweep: boolean;
  bosStructureShift: boolean;
  fvgDetected: boolean;
  fvgRebalanceDetected: boolean;
  retestDetected: boolean;
}

export interface DirectionalBiasDiagnostics {
  weekly: WeeklyLiquidityContext;
  daily: DailyContext;
  h4: H4VantageContext;
  h1: H1ExecutionContext;
  entryQuality: EntryQuality;
  classification: ShadowClassification;
  timeframeRole: {
    entryTf: string;
    structuralTf: "4h";
    executionContextTf: "1h";
  };
}

// -------------------------------------------------------- 1. Weekly context

export function evaluateWeeklyContext(
  d1: Candle[],
  direction: Direction,
  asofTime?: number,
): WeeklyLiquidityContext {
  const candles = asofTime ? d1.filter((c) => c.t + 86400_000 <= asofTime) : d1;
  if (!candles || candles.length < 10) {
    return {
      weeklyHighSwept: false,
      weeklyLowSwept: false,
      opposingLiquidityStanding: false,
      primaryOpposingTarget: null,
    };
  }

  const weekly = F.resampleCalendar(candles, "W");
  if (weekly.length < 2) {
    return {
      weeklyHighSwept: false,
      weeklyLowSwept: false,
      opposingLiquidityStanding: false,
      primaryOpposingTarget: null,
    };
  }

  const prevW = weekly[weekly.length - 2];
  const curW = weekly[weekly.length - 1];

  const weeklyHighSwept = curW.h > prevW.h;
  const weeklyLowSwept = curW.l < prevW.l;

  let opposingLiquidityStanding = false;
  let primaryOpposingTarget: number | null = null;

  if (direction === "SHORT") {
    // For bearish direction, the opposing liquidity is sellside (PWL)
    primaryOpposingTarget = prevW.l;
    // Standing if price has not yet broken/swept below the target
    opposingLiquidityStanding = curW.l > prevW.l;
  } else {
    // For bullish direction, the opposing liquidity is buyside (PWH)
    primaryOpposingTarget = prevW.h;
    // Standing if price has not yet broken/swept above the target
    opposingLiquidityStanding = curW.h < prevW.h;
  }

  return {
    weeklyHighSwept,
    weeklyLowSwept,
    opposingLiquidityStanding,
    primaryOpposingTarget,
  };
}

// --------------------------------------------------------- 2. Daily context

export function evaluateDailyContext(d1: Candle[], asofTime?: number): DailyContext {
  const candles = asofTime ? d1.filter((c) => c.t + 86400_000 <= asofTime) : d1;
  if (!candles || candles.length < 2) {
    return {
      bias: "neutral",
      bodyToBodyBreakout: "none",
      liquiditySweepPlusStructureBreak: false,
      sweepDirection: null,
      incomplete: true,
    };
  }

  const curr = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const prevBodyTop = Math.max(prev.o, prev.c);
  const prevBodyBottom = Math.min(prev.o, prev.c);

  let bodyToBodyBreakout: DailyBreakout = "none";
  if (curr.c > prevBodyTop) {
    bodyToBodyBreakout = "bullish";
  } else if (curr.c < prevBodyBottom) {
    bodyToBodyBreakout = "bearish";
  }

  // Daily liquidity sweep plus structure break:
  // Bearish: swept prev.h (curr.h > prev.h), closed back below prev.h (curr.c < prev.h),
  //          and closed bearish (curr.c < curr.o or curr.c < prevBodyBottom)
  // Bullish: swept prev.l (curr.l < prev.l), closed back above prev.l (curr.c > prev.l),
  //          and closed bullish (curr.c > curr.o or curr.c > prevBodyTop)
  let liquiditySweepPlusStructureBreak = false;
  let sweepDirection: "bullish" | "bearish" | null = null;

  if (curr.h > prev.h && curr.c < prev.h && curr.c < curr.o) {
    liquiditySweepPlusStructureBreak = true;
    sweepDirection = "bearish";
  } else if (curr.l < prev.l && curr.c > prev.l && curr.c > curr.o) {
    liquiditySweepPlusStructureBreak = true;
    sweepDirection = "bullish";
  }

  // If not on the single-bar comparison, check recent daily swings
  if (!liquiditySweepPlusStructureBreak && candles.length >= 4) {
    const [highs, lows] = F.findSwings(candles, 1, 1);
    if (highs.length && curr.h > highs[highs.length - 1].price && curr.c < highs[highs.length - 1].price && curr.c < curr.o) {
      liquiditySweepPlusStructureBreak = true;
      sweepDirection = "bearish";
    } else if (lows.length && curr.l < lows[lows.length - 1].price && curr.c > lows[lows.length - 1].price && curr.c > curr.o) {
      liquiditySweepPlusStructureBreak = true;
      sweepDirection = "bullish";
    }
  }

  let bias: DailyContextBias = "neutral";
  if (bodyToBodyBreakout === "bullish" || sweepDirection === "bullish") {
    bias = "bullish";
  } else if (bodyToBodyBreakout === "bearish" || sweepDirection === "bearish") {
    bias = "bearish";
  }

  return {
    bias,
    bodyToBodyBreakout,
    liquiditySweepPlusStructureBreak,
    sweepDirection,
    incomplete: candles.length < 10,
  };
}

// ---------------------------------------------------- 3. 4H Vantage context

export function evaluateH4VantageContext(
  h4: Candle[],
  cfg: StrategyConfig,
): H4VantageContext {
  if (!h4 || h4.length < 10) {
    return {
      direction: "neutral",
      breakoutStatus: "none",
      hasStructureBreak: false,
    };
  }

  const env = F.environment(h4, cfg.pivotLeft, cfg.pivotRight, cfg.minSwingsEnv);
  let direction: H4Direction = "neutral";
  if (env === "bullish") direction = "bullish";
  else if (env === "bearish") direction = "bearish";

  const bos = F.bosEvent(h4, cfg.pivotLeft, cfg.pivotRight);
  let breakoutStatus: StructuralBreakoutStatus = "none";
  if (bos) {
    const [index, dir] = bos;
    if (h4.length - 1 - index <= cfg.phaseLookback) {
      breakoutStatus = dir === "up" ? "bullish_breakout" : "bearish_breakout";
    }
  }

  if (direction === "neutral" && breakoutStatus !== "none") {
    direction = breakoutStatus === "bullish_breakout" ? "bullish" : "bearish";
  }

  return {
    direction,
    breakoutStatus,
    hasStructureBreak: breakoutStatus !== "none",
  };
}

// ------------------------------------------------- 4. 1H Execution context

export function evaluateH1ExecutionContext(
  h1: Candle[],
  h4Direction: H4Direction,
  cfg: StrategyConfig,
): H1ExecutionContext {
  if (!h1 || h1.length < 10) {
    return {
      direction: "neutral",
      agreesWith4H: false,
    };
  }

  const env = F.environment(h1, cfg.pivotLeft, cfg.pivotRight, cfg.minSwingsEnv);
  let direction: H1Direction = "neutral";
  if (env === "bullish") direction = "bullish";
  else if (env === "bearish") direction = "bearish";

  if (direction === "neutral") {
    const bos = F.bosEvent(h1, cfg.pivotLeft, cfg.pivotRight);
    if (bos && h1.length - 1 - bos[0] <= cfg.phaseLookback) {
      direction = bos[1] === "up" ? "bullish" : "bearish";
    }
  }

  const agreesWith4H =
    (h4Direction === "bullish" && direction === "bullish") ||
    (h4Direction === "bearish" && direction === "bearish");

  return {
    direction,
    agreesWith4H,
  };
}

// --------------------------------------------------------- 5. Entry quality

/** Detect 3-candle Fair Value Gap (FVG) and whether subsequent price rebalanced into it. */
export function detectFvgAndRebalance(
  candles: Candle[],
  direction: Direction,
  startIndex = 0,
  endIndex?: number,
): { fvgDetected: boolean; fvgRebalanceDetected: boolean; fvgRange: [number, number] | null } {
  const n = candles.length;
  if (n < 3) {
    return { fvgDetected: false, fvgRebalanceDetected: false, fvgRange: null };
  }

  const start = Math.max(1, startIndex);
  const end = Math.min(n - 1, endIndex ?? n - 1);

  let fvgDetected = false;
  let fvgRebalanceDetected = false;
  let fvgRange: [number, number] | null = null;

  for (let i = start; i < end; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];

    if (direction === "SHORT") {
      // Bearish FVG: next.h < prev.l (downward displacement creates a gap)
      if (next.h < prev.l) {
        fvgDetected = true;
        const lo = next.h;
        const hi = prev.l;
        fvgRange = [lo, hi];

        // Check subsequent candles up to endIndex for upward rebalance into the gap
        for (let j = i + 2; j <= (endIndex ?? n - 1); j++) {
          if (candles[j].h >= lo) {
            fvgRebalanceDetected = true;
            break;
          }
        }
        if (fvgRebalanceDetected) break;
      }
    } else {
      // Bullish FVG: next.l > prev.h (upward displacement creates a gap)
      if (next.l > prev.h) {
        fvgDetected = true;
        const lo = prev.h;
        const hi = next.l;
        fvgRange = [lo, hi];

        // Check subsequent candles up to endIndex for downward rebalance into the gap
        for (let j = i + 2; j <= (endIndex ?? n - 1); j++) {
          if (candles[j].l <= hi) {
            fvgRebalanceDetected = true;
            break;
          }
        }
        if (fvgRebalanceDetected) break;
      }
    }
  }

  return { fvgDetected, fvgRebalanceDetected, fvgRange };
}

export function evaluateEntryQuality(args: {
  direction: Direction;
  candles: Candle[];
  sweepOccurred?: boolean;
  bosOccurred?: boolean;
  retestOccurred?: boolean;
  startIndex?: number;
  retestIndex?: number;
}): EntryQuality {
  const { direction, candles, sweepOccurred, bosOccurred, retestOccurred, startIndex, retestIndex } = args;

  const { fvgDetected, fvgRebalanceDetected } = detectFvgAndRebalance(
    candles,
    direction,
    startIndex ?? 0,
    retestIndex,
  );

  return {
    lowerTimeframeSweep: sweepOccurred ?? true,
    bosStructureShift: bosOccurred ?? true,
    fvgDetected,
    fvgRebalanceDetected,
    retestDetected: retestOccurred ?? true,
  };
}

// -------------------------------------------------------- 6. Classification

export function classifyShadowSetup(args: {
  direction: Direction;
  weekly: WeeklyLiquidityContext;
  daily: DailyContext;
  h4: H4VantageContext;
  h1: H1ExecutionContext;
  entryQuality: EntryQuality;
}): ShadowClassification {
  const { direction, weekly, daily, h4, h1, entryQuality } = args;

  // 1. HTF CONFLICT:
  // Conflict if 1H and 4H are in opposing directions (one bullish, one bearish),
  // OR if 4H directly opposes the setup direction,
  // OR if 1H directly opposes the setup direction.
  const isOpposingH4 =
    (direction === "SHORT" && h4.direction === "bullish") ||
    (direction === "LONG" && h4.direction === "bearish");
  const isOpposingH1 =
    (direction === "SHORT" && h1.direction === "bullish") ||
    (direction === "LONG" && h1.direction === "bearish");
  const h1H4Opposing =
    (h4.direction === "bullish" && h1.direction === "bearish") ||
    (h4.direction === "bearish" && h1.direction === "bullish");

  if (h1H4Opposing || isOpposingH4 || isOpposingH1) {
    return "HTF_CONFLICT";
  }

  // 2. OBSERVATION ONLY:
  // Missing or incomplete daily or weekly context
  if (daily.incomplete || weekly.primaryOpposingTarget === null) {
    return "OBSERVATION_ONLY";
  }

  // Neutral 1H execution context (no directional trend alignment)
  if (h1.direction === "neutral" || !h1.agreesWith4H) {
    return "OBSERVATION_ONLY";
  }

  // 4H vantage direction is neutral
  if (h4.direction === "neutral") {
    return "OBSERVATION_ONLY";
  }

  // Opposing liquidity is NOT standing (already violated)
  if (!weekly.opposingLiquidityStanding) {
    return "OBSERVATION_ONLY";
  }

  // Prerequisite entry quality: must have sweep, BOS, and retest
  if (!entryQuality.lowerTimeframeSweep || !entryQuality.bosStructureShift || !entryQuality.retestDetected) {
    return "OBSERVATION_ONLY";
  }

  // 3. A_GRADE:
  // Fully aligned: 1H/4H agree with setup, opposing liquidity standing,
  // daily context valid, and entry quality includes both FVG detection AND FVG rebalance.
  if (entryQuality.fvgDetected && entryQuality.fvgRebalanceDetected) {
    return "A_GRADE";
  }

  // 4. B_GRADE:
  // Aligned 1H/4H setup with valid sweep, BOS, and retest, but missing FVG rebalance.
  return "B_GRADE";
}

// ---------------------------------------------------- Unified entry evaluator

export interface DirectionalBiasEvaluationArgs {
  pair: string;
  entryTf: string;
  direction: Direction;
  entryCandles: Candle[];
  d1Candles?: Candle[];
  h4Candles?: Candle[];
  h1Candles?: Candle[];
  cfg?: StrategyConfig;
  setup?: {
    sweptPoolPrice?: number;
    sweepTime?: number | null;
    sweepIndex?: number;
    bosTime?: number | null;
    bosIndex?: number;
    retestTime?: number | null;
    retestIndex?: number;
    origin?: KeyLevel | null;
  };
  sweepOccurred?: boolean;
  bosOccurred?: boolean;
  retestOccurred?: boolean;
}

export function evaluateDirectionalBias(
  args: DirectionalBiasEvaluationArgs,
): DirectionalBiasDiagnostics {
  const {
    entryTf, direction, entryCandles, d1Candles, h4Candles, h1Candles,
    cfg = {
      pivotLeft: 2, pivotRight: 2, minSwingsEnv: 2, phaseLookback: 8,
      atrPeriod: 14, avLen: 2, levelToleranceAtr: 0.1, flipMarginAtr: 0.2,
      decisionAtrMult: 1.5, levelLookback: 120, zoneMaxDistanceAtr: 3.5,
      touchWindow: 20, sweepWindow: 12, bosWindow: 12, retestWindow: 16,
      retestToleranceAtr: 0.1, slBufferAtr: 0.1, minRiskAtr: 0.8,
      maxStopAtr: 3.5, minTpR: 3.0, maxPromotedTpR: 3.0, cooldownMinutes: 30,
      sessionsAllowlist: [], mapTfLabel: "4h", setupWindow: 90, fvgLookback: 40,
    },
    setup,
  } = args;

  // 1. Weekly liquidity context
  const weekly = d1Candles
    ? evaluateWeeklyContext(d1Candles, direction)
    : { weeklyHighSwept: false, weeklyLowSwept: false, opposingLiquidityStanding: false, primaryOpposingTarget: null };

  // 2. Daily context
  const daily = d1Candles
    ? evaluateDailyContext(d1Candles)
    : { bias: "neutral" as const, bodyToBodyBreakout: "none" as const, liquiditySweepPlusStructureBreak: false, sweepDirection: null, incomplete: true };

  // 3. 4H Vantage context
  const h4 = h4Candles
    ? evaluateH4VantageContext(h4Candles, cfg)
    : { direction: "neutral" as const, breakoutStatus: "none" as const, hasStructureBreak: false };

  // 4. 1H Execution context
  // For 30m entries: 1H candles provide execution-context alignment.
  // For 1H entries: 1H is the entry timeframe, so entryCandles can serve as 1H feed if h1Candles is absent.
  const h1Source = (h1Candles && h1Candles.length) ? h1Candles : (entryTf === "1h" ? entryCandles : []);
  const h1 = evaluateH1ExecutionContext(h1Source, h4.direction, cfg);

  // 5. Entry quality
  // For 30m entries: 30m provides sweep, structure shift, FVG rebalance, and retest.
  // For 1H entries: 1H provides entry confirmation (sweep, shift, FVG rebalance, retest).
  const sweepOccurred = args.sweepOccurred ?? (setup ? Boolean(setup.sweepTime || (setup.sweptPoolPrice && setup.sweptPoolPrice > 0)) : true);
  const bosOccurred = args.bosOccurred ?? (setup ? Boolean(setup.bosTime) : true);
  const retestOccurred = args.retestOccurred ?? (setup ? Boolean(setup.retestTime !== undefined || setup.retestIndex !== undefined) : true);

  const entryQuality = evaluateEntryQuality({
    direction,
    candles: entryCandles,
    sweepOccurred,
    bosOccurred,
    retestOccurred,
    startIndex: setup?.sweepIndex ?? 0,
    retestIndex: setup?.retestIndex,
  });

  // 6. Classification
  const classification = classifyShadowSetup({
    direction,
    weekly,
    daily,
    h4,
    h1,
    entryQuality,
  });

  return {
    weekly,
    daily,
    h4,
    h1,
    entryQuality,
    classification,
    timeframeRole: {
      entryTf,
      structuralTf: "4h",
      executionContextTf: "1h",
    },
  };
}
