/** Typed records for the SLK worker engine — port of slk_bot/slk/types.py. */

import type { DirectionalBiasDiagnostics, ShadowClassification } from "./shadow";

export type Direction = "LONG" | "SHORT";
export type SignalStatus = "OPEN" | "TP_HIT" | "SL_HIT" | "BE_HIT" | "EXPIRED";

export type ShadowRejectReason = "TARGET_FLOOR" | "NO_RETEST";
export type ShadowTradeStatus = "OPEN" | "TP_HIT" | "SL_HIT" | "EXPIRED";
export type ShadowExperimentVariant = "BREAKOUT_CONTINUATION" | "FVG_RETEST_50";

// ---------------------------------------------------- diagnostics-only tagging
//
// Everything below is observability metadata. It is recorded on setup rows,
// shadow-ledger rows and experiment rows so the research ledgers can be sliced
// after the fact. NO tag, grade, or bucket is ever consulted by an alert gate,
// dedupe check, notification decision, delivery path, or outcome rule.

/** UTC+1 session bucket of the triggering candle's OPEN time. */
export type SessionBucket = "S00_04" | "S04_08" | "S08_12" | "S12_16" | "S16_20" | "S20_24";

/** H4 vantage confluence grade, highest first:
 *    H4_PLUG_AND_PLAY — key level (any kind) with fvgOverlap=true sitting
 *                       inside the breakout's H4 FVG (a ready plug-and-play zone)
 *    H4_KL_IN_FVG     — key level (any kind) overlapping the breakout FVG zone
 *    H4_FVG_ONLY      — the breakout created an H4 FVG with no key level inside
 *    H4_BREAKOUT_BARE — breakout with no H4 FVG
 *  A scan with no recent H4 breakout carries the H4_NO_BREAKOUT tag and no grade. */
export type H4ConfluenceGrade = "H4_PLUG_AND_PLAY" | "H4_KL_IN_FVG" | "H4_FVG_ONLY" | "H4_BREAKOUT_BARE";

/** Key-level kind recorded when a key level sits inside the breakout's FVG. */
export type H4KeyLevelTag = "H4_KL_A" | "H4_KL_V" | "H4_KL_OC" | "H4_KL_DECISION";

/** Optional diagnostics-only annotation shared by setup rows, shadow-ledger
 *  rows and experiment rows. */
export interface DiagnosticTagging {
  h4ConfluenceGrade?: H4ConfluenceGrade | null;
  h4ConfluenceTags?: string[];
  sessionBucket?: SessionBucket | null;
}

/** Counterfactual SLK Model candidate. These experiments never create alerts
 *  or events and are persisted in a separate, owner-only research ledger. */
export interface ShadowExperimentCapture extends DiagnosticTagging {
  experimentId: string;
  sourceSetupId: string;
  variant: ShadowExperimentVariant;
  pair: string;
  entryTf: string;
  direction: Direction;
  entry: number;
  stopLoss: number;
  target: number;
  rr: number;
  candleCloseTime: number;
}

/** Observation-only candidate. This is persisted separately from alerts,
 *  events, outcomes, and public performance statistics. */
export interface ShadowTradeCapture extends DiagnosticTagging {
  setupId: string;
  pair: string;
  entryTf: string;
  direction: Direction;
  entry: number;
  stopLoss: number;
  tp1: number;
  rr: number;
  rejectReason: ShadowRejectReason;
  candleCloseTime: number;
}

export interface ShadowTradeOutcome {
  status: Exclude<ShadowTradeStatus, "OPEN">;
  exitPrice: number;
  exitTime: number;
  rMultiple: number;
}

export interface Candle {
  t: number; // candle OPEN time, ms epoch UTC
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Swing {
  index: number;
  price: number;
  time: number;
  kind: "high" | "low";
}

export interface LiquidityPool {
  price: number;
  side: "buyside" | "sellside";
  kind: string; // PDH/PDL/PWH/PWL/PMH/PML/external-swing/structural/single-candle
  sourceTime: number;
}

export interface Imbalance {
  lo: number;
  hi: number;
  direction: "bullish" | "bearish";
  time: number;
}

/** A/V extrema, consecutive-candle body overlap (OC), or wide-range
 *  decision-candle body (DECISION). */
export interface KeyLevel {
  kind: "A" | "V" | "OC" | "DECISION";
  originPrice: number;
  zoneLo: number;
  zoneHi: number;
  originTime: number;
  originIndex: number;
  touches: number;
  flipped: boolean;
  fvgOverlap: boolean;
}

export interface Storyline {
  asof: number;
  valid: boolean;
  reason: string;
  direction: Direction | null;
  environment: string; // bullish | bearish | consolidation
  phase: string; // expansion | pullback | reversal | range
  htfAlignment: string;
  origin: KeyLevel | null;
  drawOnLiquidity: number | null;
  nearestExternalTarget: number | null;
  internalPools: LiquidityPool[];
  externalPools: LiquidityPool[];
  imbalances: Imbalance[];
  mapClose: number;
}

/** Mutable execution state during a replay. Stateless across scans — the DB
 *  (unique setup ids + unique event keys) is what makes repeats idempotent. */
export interface Setup {
  setupId: string;
  direction: Direction;
  level: KeyLevel;
  state: "MAP" | "TOUCH" | "SHIFT" | "RETEST";
  mapIndex: number;
  mapTime: number;
  touchIndex: number;
  touchTime: number | null;
  sweptPoolIndex: number;
  sweptPoolPrice: number;
  sweepIndex: number;
  sweepTime: number | null;
  extreme: number;
  refPrice: number;
  bosIndex: number;
  bosTime: number | null;
  invLevel: number;
  leftZone: boolean;
  environment: string;
  phase: string;
  htfAlignment: string;
  drawOnLiquidity: number | null;
  nearestExternalTarget: number | null;
  internalPools: LiquidityPool[];
  externalPools: LiquidityPool[];
  imbalances: Imbalance[];
}

export interface Alert extends DiagnosticTagging {
  setupId: string;
  pair: string;
  entryTf: string;
  mapTf: string;
  direction: Direction;
  entry: number;
  stopLoss: number;
  tpInternal: number;
  tpExternal: number | null;
  candleCloseTime: number;
  environment: string;
  phase: string;
  htfAlignment: string;
  originKeyLevel: number;
  /** Origin level's source candle open time (ms epoch). Powers the
   *  store-level identity guard, which matches duplicates across ID
   *  formats on (pair, timeframe, direction, level kind, origin time).
   *  When absent, the guard falls back to the origin time embedded in the
   *  setup ID (both legacy and current formats carry it). */
  originTime?: number;
  keyLevelType: string;
  keyLevelBounds: [number, number];
  keyLevelTested: boolean;
  keyLevelFlipped: boolean;
  imbalanceContext: unknown[];
  internalLiquidity: unknown[];
  externalLiquidity: unknown[];
  drawOnLiquidity: number | null;
  nearestExternalTarget: number | null;
  intermediateZones: unknown[];
  opposingLiquidityStanding: boolean;
  sweepTime: number;
  bosTime: number;
  returnTime: number;
  invalidationLevel: number;
  invalidationReason: string | null;
  parameterVersion: string;
  alertStatus: "PAPER" | "SENT" | "SUPPRESSED";
  suppressReason: string | null;
  session: string | null;
  atrEntry: number;
  rrInternal: number | null;
  cycleStage: string;
  entryMode: string;
  shadowClassification?: ShadowClassification;
  directionalBias?: DirectionalBiasDiagnostics;
}

export interface EngineEvent {
  setupId: string;
  pair: string;
  state: string; // MAP/TOUCH/SWEEP/SHIFT/RETEST/INVALID/EXPIRED
  candleTime: number;
  reason: string;
  price: number | null;
  biasGrade?: string;
}

export interface Outcome {
  status: SignalStatus;
  exitPrice: number;
  exitTime: number;
  rMultiple: number;
}

export type { DirectionalBiasDiagnostics, ShadowClassification } from "./shadow";
