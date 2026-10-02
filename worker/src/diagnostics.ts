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

export interface EngineDisciplineTotals {
  scans: number;
  setupsEvaluated: number;
  sweep: number;
  shift: number;
  retest: number;
  confirmed: number;
  rejectionCounts: {
    targetFloor: number;
    belowMinRiskAtr: number;
    aboveMaxStopAtr: number;
    nonPositiveRisk: number;
    invalid: number;
    expired: number;
  };
}

export function summarizeScanLogs(rows: { diagnostics?: ScanDiagnostics }[]): EngineDisciplineTotals | null {
  const totals: EngineDisciplineTotals = {
    scans: 0, setupsEvaluated: 0, sweep: 0, shift: 0, retest: 0, confirmed: 0,
    rejectionCounts: {
      targetFloor: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0,
      nonPositiveRisk: 0, invalid: 0, expired: 0,
    },
  };
  const count = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  for (const row of rows) {
    const diagnostics = row.diagnostics;
    if (!diagnostics || !diagnostics.replay || !diagnostics.recorded) continue;
    const replay = diagnostics.replay;
    totals.scans++;
    totals.setupsEvaluated += count(replay.MAP);
    totals.sweep += count(replay.SWEEP);
    totals.shift += count(replay.SHIFT);
    // A retest candidate is counted before risk/target gates. RETEST itself
    // retains its existing meaning: an accepted confirmation.
    totals.retest += count(replay.retestCandidates);
    totals.confirmed += count(diagnostics.recorded.confirmedAlerts);
    totals.rejectionCounts.targetFloor += count(replay.targetRejects);
    totals.rejectionCounts.belowMinRiskAtr += count(replay.riskRejectReasons?.belowMinRiskAtr);
    totals.rejectionCounts.aboveMaxStopAtr += count(replay.riskRejectReasons?.aboveMaxStopAtr);
    totals.rejectionCounts.nonPositiveRisk += count(replay.riskRejectReasons?.nonPositiveRisk);
    totals.rejectionCounts.invalid += count(replay.INVALID);
    totals.rejectionCounts.expired += count(replay.EXPIRED);
  }
  return totals.scans ? totals : null;
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
