/** Observational counters only: never consulted by strategy or delivery gates.
 * Replay counts include historical/duplicate transitions, not unique setups.
 * RETEST retains the engine's existing meaning: an accepted confirmation.
 */
export const LIFECYCLE_STATES = ["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST", "INVALID", "EXPIRED"] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];
export type LifecycleCounts = Record<LifecycleState, number>;
export type RiskRejectReason = "nonPositiveRisk" | "belowMinRiskAtr" | "aboveMaxStopAtr";

export interface ReplayDiagnostics extends LifecycleCounts {
  retestCandidates: number;
  riskRejects: number;
  riskRejectReasons: Record<RiskRejectReason, number>;
  targetRejects: number;
  confirmedAlerts: number;
}

export interface RecordedDiagnostics extends LifecycleCounts {
  confirmedAlerts: number;
}

export interface ScanDiagnostics {
  version: 1;
  replay: ReplayDiagnostics;
  recorded: RecordedDiagnostics;
  byPairTimeframe: { pair: string; timeframe: string; replay: ReplayDiagnostics }[];
}

export function emptyLifecycleCounts(): LifecycleCounts {
  return { MAP: 0, TOUCH: 0, SWEEP: 0, SHIFT: 0, RETEST: 0, INVALID: 0, EXPIRED: 0 };
}

export function countTransition(counts: LifecycleCounts, state: string): void {
  if (LIFECYCLE_STATES.includes(state as LifecycleState)) counts[state as LifecycleState]++;
}

export function emptyReplayDiagnostics(): ReplayDiagnostics {
  return {
    ...emptyLifecycleCounts(), retestCandidates: 0, riskRejects: 0,
    riskRejectReasons: { nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0 },
    targetRejects: 0, confirmedAlerts: 0,
  };
}

export function emptyScanDiagnostics(): ScanDiagnostics {
  return {
    version: 1, replay: emptyReplayDiagnostics(),
    recorded: { ...emptyLifecycleCounts(), confirmedAlerts: 0 }, byPairTimeframe: [],
  };
}

export function addReplayDiagnostics(scan: ScanDiagnostics, pair: string, timeframe: string, replay: ReplayDiagnostics): void {
  scan.byPairTimeframe.push({ pair, timeframe, replay });
  for (const state of LIFECYCLE_STATES) scan.replay[state] += replay[state];
  for (const key of ["retestCandidates", "riskRejects", "targetRejects", "confirmedAlerts"] as const) {
    scan.replay[key] += replay[key];
  }
  for (const key of ["nonPositiveRisk", "belowMinRiskAtr", "aboveMaxStopAtr"] as const) {
    scan.replay.riskRejectReasons[key] += replay.riskRejectReasons[key];
  }
}

// ------------------------------------------------------------------ engine pulse

/** One slk_scan_log row for the pulse aggregate. D1 rows carry
 *  `diagnostics_json` (string); the in-memory store carries `diagnostics`
 *  (object). Rows with an empty `pairs` column are idle scans with empty
 *  diagnostics by construction. */
export interface EnginePulseRow {
  ts: string;
  pairs: string;
  diagnostics_json?: string | null;
  diagnostics?: ScanDiagnostics | null;
}

/** Rolling 24h aggregate of the engine's recorded activity. Framing is
 *  positive by design: the counts show setups the engine EVALUATED and how
 *  few cleared the strict floors — "selectivity working", not a miss rate. */
export interface EnginePulse {
  windowHours: number;
  scans: number; // every scan logged in the window (incl. idle ticks)
  activeScans: number; // scans that covered at least one pair
  pairs: string[];
  pairsCovered: number;
  evaluated: number; // newly recorded MAP arms (setups the engine evaluated)
  chains: { TOUCH: number; SWEEP: number; SHIFT: number; RETEST: number };
  confirmed: number; // newly recorded confirmed alerts
  rejections: { nonPositiveRisk: number; belowMinRiskAtr: number; aboveMaxStopAtr: number; targetFloor: number };
  lastScanTs: string | null;
}

export function emptyEnginePulse(windowHours = 24): EnginePulse {
  return {
    windowHours, scans: 0, activeScans: 0, pairs: [], pairsCovered: 0,
    evaluated: 0, chains: { TOUCH: 0, SWEEP: 0, SHIFT: 0, RETEST: 0 },
    confirmed: 0, rejections: { nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0, targetFloor: 0 },
    lastScanTs: null,
  };
}

/** Pure aggregation over scan-log rows (read-only; never called from the
 *  scan/write path). `chains`/`evaluated`/`confirmed` use the RECORDED
 *  (deduped, first-write) counters — i.e. unique setup activity, not
 *  rescan-inflated replay counts. */
export function buildEnginePulse(rows: EnginePulseRow[], nowMs: number, windowHours = 24): EnginePulse {
  const pulse = emptyEnginePulse(windowHours);
  const cutoff = nowMs - windowHours * 3600_000;
  const pairs = new Set<string>();
  for (const row of rows) {
    const ts = Date.parse(row.ts);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    pulse.scans++;
    if (!pulse.lastScanTs || row.ts >= pulse.lastScanTs) pulse.lastScanTs = row.ts;
    const list = String(row.pairs ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) continue; // idle scan — empty diagnostics by construction
    pulse.activeScans++;
    for (const p of list) pairs.add(p);
    const raw = row.diagnostics_json ?? row.diagnostics;
    let diag: ScanDiagnostics | null = null;
    if (typeof raw === "string" && raw) {
      try { diag = JSON.parse(raw) as ScanDiagnostics; } catch { diag = null; }
    } else if (raw && typeof raw === "object") {
      diag = raw as ScanDiagnostics;
    }
    if (!diag || diag.version !== 1 || !diag.recorded) continue;
    pulse.evaluated += diag.recorded.MAP;
    pulse.chains.TOUCH += diag.recorded.TOUCH;
    pulse.chains.SWEEP += diag.recorded.SWEEP;
    pulse.chains.SHIFT += diag.recorded.SHIFT;
    pulse.chains.RETEST += diag.recorded.RETEST;
    pulse.confirmed += diag.recorded.confirmedAlerts;
    const r = diag.replay;
    if (r && r.riskRejectReasons) {
      pulse.rejections.nonPositiveRisk += r.riskRejectReasons.nonPositiveRisk;
      pulse.rejections.belowMinRiskAtr += r.riskRejectReasons.belowMinRiskAtr;
      pulse.rejections.aboveMaxStopAtr += r.riskRejectReasons.aboveMaxStopAtr;
      pulse.rejections.targetFloor += r.targetRejects;
    }
  }
  pulse.pairs = [...pairs].sort();
  pulse.pairsCovered = pairs.size;
  return pulse;
}
