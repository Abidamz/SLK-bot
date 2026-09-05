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
  minTpR: number;
  cooldownMinutes: number;
  sessionsAllowlist: [string, string, string][]; // [name, "HH:MM", "HH:MM"] UTC
  mapTfLabel: string;
}

export interface WorkerConfig {
  pairs: string[];
  entryTfs: Record<string, number>; // label -> seconds
  mapTimeframe: string; // "4h" (built from mapSource)
  mapSourceTimeframe: string; // "1h"
  contextTimeframe: string; // "1d"
  mode: "paper" | "live";
  paperNotify: boolean;
  candlesLimit: number;
  scanDelayMs: number;
  minCandles: number; // per-feed sanity floor
  expireCandles: number;
  slOnClose: boolean;
  notifyOutcomes: boolean;
  symbolMap: Record<string, string>;
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
    zoneMaxDistanceAtr: 8.0,
    fvgLookback: 80,
    touchWindow: 64,
    sweepWindow: 24,
    bosWindow: 24,
    retestWindow: 64,
    retestToleranceAtr: 0.3,
    setupWindow: 240,
    slBufferAtr: 0.1,
    minRiskAtr: 0.1,
    minTpR: 0.8,
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
  SYMBOL_MAP?: string; // JSON object
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

  return {
    pairs,
    entryTfs,
    mapTimeframe: "4h",
    mapSourceTimeframe: "1h",
    contextTimeframe: "1d",
    mode,
    paperNotify,
    candlesLimit: 400,
    scanDelayMs: 10_000,
    minCandles: 40,
    expireCandles: 120,
    slOnClose: true,
    notifyOutcomes: true,
    symbolMap,
    strategy: defaultStrategy(),
  };
}

// ------------------------------------------------------------ price helpers

export function pipSize(pair: string): number {
  const p = pair.toUpperCase().replace("/", "").replace("=X", "");
  if (p.includes("JPY")) return 0.01;
  if (p.startsWith("XAU") || p.startsWith("XAG")) return 0.1;
  return 0.0001;
}

export function fmtPrice(pair: string, price: number): string {
  const ps = pipSize(pair);
  const dec = ps === 0.01 ? 3 : ps === 0.1 ? 2 : 5;
  return price.toFixed(dec);
}

export function fmtPips(pair: string, distance: number): string {
  return `${(Math.abs(distance) / pipSize(pair)).toFixed(1)} pips`;
}
