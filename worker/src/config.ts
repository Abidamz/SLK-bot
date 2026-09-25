/** Worker configuration: safe defaults + `vars` overrides.
 *  Strategic defaults mirror the Python engine (slk_bot/config.py) — all
 *  volatility thresholds are ATR-normalized per symbol/timeframe, never
 *  universal constants (per the research). */

export const TF_SECONDS: Record<string, number> = {
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "45m": 2700,
  "1h": 3600,
  "2h": 7200,
  "3h": 10800,
  "4h": 14400,
  "1d": 86400,
};

export const PARAM_VERSION = "slk-w1.0";

export interface StrategyConfig {
  pivotLeft: number;
  pivotRight: number;
  minSwingsEnv: number;
  phaseLookback: number;
  atrPeriod: number;
  avLen: number;
  levelToleranceAtr: number;
  levelLookback: number;
  decisionAtrMult: number;
  flipMarginAtr: number;
  zoneMaxDistanceAtr: number;
  fvgLookback: number;
  touchWindow: number;
  sweepWindow: number;
  bosWindow: number;
  retestWindow: number;
  retestToleranceAtr: number;
  setupWindow: number;
  slBufferAtr: number;
  minRiskAtr: number;
  minStopPips?: number;
  /** cap synthetic execution targets when a promoted external draw is very far */
  maxPromotedTpR: number;
  /** stop-width ceiling in entry-TF ATRs — e.g. 2.0 ⇒ stop ≤ 2× ATR(30m).
   *  In EURUSD 30m terms that's ≈8–12 pips; on US30 it scales to the
   *  index's own volatility (no universal pip constant across markets). */
  maxStopAtr: number;
  minTpR: number; // minimum reward:risk to the selected target (1:3 ⇒ 3.0)
  cooldownMinutes: number;
  sessionsAllowlist: [string, string, string][]; // [name, "HH:MM", "HH:MM"] UTC
  mapTfLabel: string;
}

export interface WorkerConfig {
  pairs: string[];
  entryTfs: Record<string, number>; // label -> seconds
  pairBatchSize: number; // number of pairs to scan per cron tick (keeps CPU under 10ms)
  mapTimeframe: string; // "4h" (built from mapSource)
  mapSourceTimeframe: string; // "1h" — derived from base feed (see baseTimeframe)
  baseTimeframe: string; // smallest entry TF — the only intraday fetch per pair
  baseCandlesLimit: number; // fetch size for the base feed (~enough for the H4 story)
  contextTimeframe: string; // "1d"
  mode: "paper" | "live";
  paperNotify: boolean;
  watchNotify: boolean; // 👀 TOUCH/SWEEP/SHIFT heads-ups before confirmation close
  candlesLimit: number; // fetch size for non-base direct fetches (fallbacks)
  scanDelayMs: number;
  minCandles: number; // per-feed sanity floor
  expireCandles: number;
  slOnClose: boolean;
  notifyOutcomes: boolean;
  symbolMap: Record<string, string>;
  providerMap: Record<string, "twelvedata" | "yahoo" | "oanda" | "dukascopy" | "deriv">;
  derivAppId: string;
  derivProxyUrl?: string;
  strategy: StrategyConfig;
}

export function defaultStrategy(): StrategyConfig {
  return {
    pivotLeft: 2,
    pivotRight: 2,
    minSwingsEnv: 2,
    phaseLookback: 20,
    atrPeriod: 14,
    avLen: 2,
    levelToleranceAtr: 0.25,
    levelLookback: 120,
    decisionAtrMult: 1.5,
    flipMarginAtr: 0.5,
    zoneMaxDistanceAtr: 3.5,
    fvgLookback: 80,
    touchWindow: 64,
    sweepWindow: 16,
    bosWindow: 16,
    retestWindow: 20,
    retestToleranceAtr: 0.3,
    setupWindow: 100,
    slBufferAtr: 0.1,
    minRiskAtr: 0.8,  // quarantine structurally tiny stops
    minStopPips: 10,  // minimum 10-pip stop loss floor for forex pairs
    maxPromotedTpR: 3.0, // far external liquidity remains context, not TP1
    maxStopAtr: 3.5, // never alert a stop wider than 3.5× entry-TF ATR (≈10-14 pips on EURUSD/30m)
    minTpR: 2.5,     // 1:2.5 minimum reward:risk
    cooldownMinutes: 240,
    sessionsAllowlist: [],
    mapTfLabel: "4h",
  };
}

interface EnvVars {
  PAIRS?: string;
  ENTRY_TFS?: string;
  MODE?: string;
  PAPER_NOTIFY?: string;
  WATCH_NOTIFY?: string;
  MIN_RISK_ATR?: string;
  MIN_STOP_PIPS?: string;
  MIN_TP_R?: string;
  SL_BUFFER_ATR?: string;
  PAIR_BATCH_SIZE?: string;
  SYMBOL_MAP?: string; // JSON object: canonical -> provider symbol
  PROVIDER_MAP?: string; // JSON object: canonical -> "twelvedata" | "yahoo" | "oanda" | "dukascopy" | "deriv"
  DERIV_APP_ID?: string;
  DERIV_PROXY_URL?: string;
}

export function loadConfig(env: EnvVars): WorkerConfig {
  const pairs = (env.PAIRS ?? "EURUSD,GBPUSD,XAUUSD")
    .split(",")
    .map((s) => s.trim().toUpperCase().replace("/", ""))
    .filter(Boolean);

  const entryLabels = (env.ENTRY_TFS ?? "30m,1h")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const entryTfs: Record<string, number> = {};
  for (const label of entryLabels) {
    const secs = TF_SECONDS[label];
    if (!secs || label === "1d") continue;
    if (secs < 900) {
      console.warn(JSON.stringify({ level: "warn", msg: "sub-15m entry timeframe enabled — the research recommends against it", tf: label }));
    }
    entryTfs[label] = secs;
  }

  const mode = (env.MODE ?? "paper").toLowerCase() === "live" ? "live" : "paper";
  const paperNotify = (env.PAPER_NOTIFY ?? "true").toLowerCase() !== "false";

  let symbolMap: Record<string, string> = {};
  if (env.SYMBOL_MAP) {
    try {
      symbolMap = JSON.parse(env.SYMBOL_MAP);
    } catch {
      console.warn(JSON.stringify({ level: "warn", msg: "SYMBOL_MAP is not valid JSON — ignored" }));
    }
  }
  let providerMap: Record<string, "twelvedata" | "yahoo" | "oanda" | "dukascopy" | "deriv"> = {};
  if (env.PROVIDER_MAP) {
    try {
      providerMap = JSON.parse(env.PROVIDER_MAP);
    } catch {
      console.warn(JSON.stringify({ level: "warn", msg: "PROVIDER_MAP is not valid JSON — ignored" }));
    }
  }

  // fetch once per pair at the smallest entry TF; every coarser feed is a
  // resample → 1 provider credit per pair per boundary (was ~2)
  const baseEntries = Object.entries(entryTfs);
  baseEntries.sort((a, b) => a[1] - b[1]);
  const baseTimeframe = baseEntries.length ? baseEntries[0][0] : "30m";
  // ~40 H4 bars of runway for the storyline + entry setup window
  const baseSec = TF_SECONDS[baseTimeframe] ?? 1800;
  const baseCandlesLimit = Math.min(2000, Math.max(300, Math.ceil((40 * TF_SECONDS["4h"]) / baseSec) + 50));

  const minRiskAtr = Number(env.MIN_RISK_ATR ?? "");
  const minStopPips = Number(env.MIN_STOP_PIPS ?? "");
  const slBufferAtr = Number(env.SL_BUFFER_ATR ?? "");
  const minTpR = Number(env.MIN_TP_R ?? "");
  const pairBatchSize = Math.max(1, Number(env.PAIR_BATCH_SIZE ?? "2") || 2);
  const strategy = defaultStrategy();
  if (Number.isFinite(minRiskAtr) && minRiskAtr > 0) strategy.minRiskAtr = minRiskAtr;
  if (Number.isFinite(minStopPips) && minStopPips >= 0) strategy.minStopPips = minStopPips;
  if (Number.isFinite(slBufferAtr) && slBufferAtr > 0) strategy.slBufferAtr = slBufferAtr;
  if (Number.isFinite(minTpR) && minTpR > 0) strategy.minTpR = minTpR;

  return {
    pairs,
    entryTfs,
    pairBatchSize,
    mapTimeframe: "4h",
    mapSourceTimeframe: "1h",
    baseTimeframe,
    baseCandlesLimit,
    contextTimeframe: "1d",
    mode,
    paperNotify,
    watchNotify: (env.WATCH_NOTIFY ?? "false").toLowerCase() === "true",
    candlesLimit: 400,
    scanDelayMs: 10_000,
    minCandles: 40,
    expireCandles: 120,
    slOnClose: false,
    notifyOutcomes: true,
    symbolMap,
    providerMap,
    derivAppId: env.DERIV_APP_ID ?? "1089",
    derivProxyUrl: env.DERIV_PROXY_URL?.trim() || undefined,
    strategy,
  };
}

// ------------------------------------------------------------ price helpers

/** Instruments that quote in points, not pips (index CFD canonical names). */
export const INDEX_POINT_PAIRS = new Set(["US30", "GER40", "DE40", "JAPAN225", "JP225", "N225", "NAS100", "US100", "SPX500", "US500", "UK100"]);

/** Deriv synthetic index instruments (24/7 continuous synthetic volatility). */
export const DERIV_SYNTHETIC_PAIRS = new Set([
  // 5 Standard Volatility Indices
  "V75", "R_75", "VOLATILITY75",
  "V100", "R_100", "VOLATILITY100",
  "V50", "R_50", "VOLATILITY50",
  "V25", "R_25", "VOLATILITY25",
  "V10", "R_10", "VOLATILITY10",
  // 5 1-Second (1s) Volatility Indices
  "V75_1S", "1HZ75V",
  "V100_1S", "1HZ100V",
  "V50_1S", "1HZ50V",
  "V25_1S", "1HZ25V",
  "V10_1S", "1HZ10V",
]);

export function isDerivPair(pair?: string | null): boolean {
  if (!pair) return false;
  const p = pair.toUpperCase().replace("/", "").replace("=X", "").replace("-", "");
  return DERIV_SYNTHETIC_PAIRS.has(p) || p.startsWith("R_") || p.startsWith("V1") || p.startsWith("V2") || p.startsWith("V5") || p.startsWith("V7") || p.startsWith("1HZ");
}

export function pipSize(pair: string): number {
  const p = pair.toUpperCase().replace("/", "").replace("=X", "").replace("-", "");
  if (isDerivPair(p)) return 0.01; // synthetic indices calculate in points/cents
  if (INDEX_POINT_PAIRS.has(p)) return 1.0; // index CFDs quote in points
  if (p.includes("JPY")) return 0.01;
  if (p.startsWith("XAU") || p.startsWith("XAG")) return 0.1;
  return 0.0001;
}

/** Minimum stop loss floor in absolute price distance to prevent spread and noise stop-outs. */
export function minStopDistance(pair: string, minStopPips = 10): number {
  const p = pair.toUpperCase().replace("/", "").replace("=X", "").replace("-", "");
  if (isDerivPair(p)) {
    if (p.includes("75")) return Math.max(50.0, minStopPips * 1.0);
    if (p.includes("100")) return Math.max(25.0, minStopPips * 1.0);
    if (p.includes("25")) return Math.max(20.0, minStopPips * 0.8);
    if (p.includes("50")) return Math.max(15.0, minStopPips * 0.6);
    if (p.includes("10")) return Math.max(10.0, minStopPips * 0.5);
    return Math.max(15.0, minStopPips * 0.5);
  }
  if (p === "US30") return Math.max(30.0, minStopPips * 1.0);
  if (p === "GER40" || p === "DE40") return Math.max(25.0, minStopPips * 1.0);
  if (p === "NAS100" || p === "US100") return Math.max(25.0, minStopPips * 1.0);
  if (p === "JAPAN225" || p === "JP225" || p === "N225") return Math.max(50.0, minStopPips * 1.0);
  if (INDEX_POINT_PAIRS.has(p)) return Math.max(20.0, minStopPips * 1.0);
  if (p.startsWith("XAU")) return Math.max(2.5, minStopPips * 0.1);
  if (p.includes("JPY")) return minStopPips * 0.01;
  return minStopPips * 0.0001;
}

export function fmtPrice(pair: string, price: number): string {
  if (price == null || !Number.isFinite(price)) return "0.00";
  if (isDerivPair(pair)) {
    return price.toFixed(2);
  }
  const ps = pipSize(pair);
  const dec = ps === 1.0 ? 1 : ps === 0.01 ? 3 : ps === 0.1 ? 2 : 5;
  return price.toFixed(dec);
}

export function fmtPips(pair: string, distance: number): string {
  const p = pair.toUpperCase().replace("/", "").replace("=X", "").replace("-", "");
  const unit = (INDEX_POINT_PAIRS.has(p) || isDerivPair(p)) ? "pts" : "pips";
  return `${(Math.abs(distance) / pipSize(pair)).toFixed(1)} ${unit}`;
}
