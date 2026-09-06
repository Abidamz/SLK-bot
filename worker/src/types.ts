/** Typed records for the SLK worker engine — port of slk_bot/slk/types.py. */

export type Direction = "LONG" | "SHORT";
export type SignalStatus = "OPEN" | "TP_HIT" | "SL_HIT" | "EXPIRED";

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

/** kind: "A" (A-shaped top) | "V" (V-shaped bottom) | "OC" (open-close zone). */
export interface KeyLevel {
  kind: "A" | "V" | "OC";
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

export interface Alert {
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
}

export interface EngineEvent {
  setupId: string;
  pair: string;
  state: string; // MAP/TOUCH/SWEEP/SHIFT/RETEST/INVALID/EXPIRED
  candleTime: number;
  reason: string;
  price: number | null;
}

export interface Outcome {
  status: SignalStatus;
  exitPrice: number;
  exitTime: number;
  rMultiple: number;
}
