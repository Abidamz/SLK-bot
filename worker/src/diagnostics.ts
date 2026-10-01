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
