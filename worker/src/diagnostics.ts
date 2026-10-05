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

export interface ScanAuditFunnelRow {
  pair: string;
  timeframe: string;
  scanRows: number;
  replay: ReplayDiagnostics;
}

/** Read-only historical scan summary. Replay funnel counts include replays and
 *  are not unique setups; `recordedConfirmedAlerts` counts first-write rows. */
export interface ScanAuditSummary {
  scanRows: number;
  activeScanRows: number;
  scanErrorRows: number;
  errorCategories: { staleFeed: number; rateLimitOrCredits: number; networkOrTimeout: number; other: number };
  alertRowsWritten: number;
  eventRowsWritten: number;
  firstScanUtc: string | null;
  lastScanUtc: string | null;
  diagnosticsAvailable: boolean;
  diagnosticRows: number;
  invalidDiagnosticRows: number;
  recordedConfirmedAlerts: number;
  byPairTimeframe: ScanAuditFunnelRow[];
}

export interface DeliveryAuditBucket {
  channel: string;
  kind: "confirmed_entry" | "final_outcome";
  delivered: number;
  partial: number;
  failed: number;
  notConfigured: number;
  total: number;
}

/** Counts of channel-level notifier results. These are not proof of user
 *  receipt; only successful provider API responses are counted as delivered. */
export interface NotificationDeliveryAuditSummary {
  available: boolean;
  firstTrackedUtc: string | null;
  totalResults: number;
  byChannel: DeliveryAuditBucket[];
}

export interface NotificationDeliveryAuditGroup {
  channel: string;
  kind: "confirmed_entry" | "final_outcome";
  status: string;
  count: number;
}

export function buildNotificationDeliveryAuditSummary(
  available: boolean,
  firstTrackedUtc: string | null,
  groups: NotificationDeliveryAuditGroup[],
): NotificationDeliveryAuditSummary {
  const buckets = new Map<string, DeliveryAuditBucket>();
  for (const group of groups) {
    const key = `${group.kind}:${group.channel}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        channel: group.channel, kind: group.kind,
        delivered: 0, partial: 0, failed: 0, notConfigured: 0, total: 0,
      };
      buckets.set(key, bucket);
    }
    const count = Number.isFinite(Number(group.count)) ? Math.max(0, Number(group.count)) : 0;
    bucket.total += count;
    switch (group.status) {
      case "delivered": bucket.delivered += count; break;
      case "partial": bucket.partial += count; break;
      case "not_configured": bucket.notConfigured += count; break;
      default: bucket.failed += count; break;
    }
  }
  const byChannel = [...buckets.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.channel.localeCompare(b.channel),
  );
  return {
    available, firstTrackedUtc,
    totalResults: byChannel.reduce((total, bucket) => total + bucket.total, 0),
    byChannel,
  };
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

export function addReplayCounts(target: ReplayDiagnostics, source: Partial<ReplayDiagnostics>): void {
  for (const state of LIFECYCLE_STATES) {
    target[state] += Number.isFinite(Number(source[state])) ? Math.max(0, Number(source[state])) : 0;
  }
  for (const key of ["retestCandidates", "riskRejects", "targetRejects", "confirmedAlerts"] as const) {
    target[key] += Number.isFinite(Number(source[key])) ? Math.max(0, Number(source[key])) : 0;
  }
  for (const key of ["nonPositiveRisk", "belowMinRiskAtr", "aboveMaxStopAtr"] as const) {
    const value = source.riskRejectReasons?.[key];
    target.riskRejectReasons[key] += Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  }
}

export interface ScanAuditInputRow {
  ts: string;
  pairs?: string | null;
  errors?: string | null;
  alerts?: number | null;
  events?: number | null;
  diagnostics?: ScanDiagnostics | null;
  diagnostics_json?: string | null;
}

export function buildScanAuditSummary(
  rows: ScanAuditInputRow[], diagnosticsAvailable: boolean,
): ScanAuditSummary {
  const summary: ScanAuditSummary = {
    scanRows: rows.length, activeScanRows: 0, scanErrorRows: 0,
    errorCategories: { staleFeed: 0, rateLimitOrCredits: 0, networkOrTimeout: 0, other: 0 },
    alertRowsWritten: 0, eventRowsWritten: 0, firstScanUtc: null, lastScanUtc: null,
    diagnosticsAvailable, diagnosticRows: 0, invalidDiagnosticRows: 0,
    recordedConfirmedAlerts: 0, byPairTimeframe: [],
  };
  const funnel = new Map<string, ScanAuditFunnelRow>();
  const asCount = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  for (const row of rows) {
    const pairs = String(row.pairs ?? "").trim();
    if (pairs && pairs !== "[]" && pairs.toLowerCase() !== "null") summary.activeScanRows++;
    const errors = String(row.errors ?? "").trim();
    if (errors && errors !== "[]" && errors.toLowerCase() !== "null") {
      summary.scanErrorRows++;
      const normalizedError = errors.toLowerCase();
      if (normalizedError.includes("stale feed")) summary.errorCategories.staleFeed++;
      else if (normalizedError.includes("rate limit") || normalizedError.includes("credit")) summary.errorCategories.rateLimitOrCredits++;
      else if (normalizedError.includes("network") || normalizedError.includes("timeout")) summary.errorCategories.networkOrTimeout++;
      else summary.errorCategories.other++;
    }
    summary.alertRowsWritten += asCount(row.alerts);
    summary.eventRowsWritten += asCount(row.events);
    if (row.ts && (!summary.firstScanUtc || row.ts < summary.firstScanUtc)) summary.firstScanUtc = row.ts;
    if (row.ts && (!summary.lastScanUtc || row.ts > summary.lastScanUtc)) summary.lastScanUtc = row.ts;

    let raw: unknown = row.diagnostics ?? row.diagnostics_json ?? null;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = false; }
    }
    if (raw == null) continue;
    if (!raw || typeof raw !== "object") {
      summary.invalidDiagnosticRows++;
      continue;
    }
    const diagnostics = raw as ScanDiagnostics;
    if (diagnostics.version !== 1 || !diagnostics.replay || !diagnostics.recorded) {
      summary.invalidDiagnosticRows++;
      continue;
    }
    summary.diagnosticRows++;
    summary.recordedConfirmedAlerts += asCount(diagnostics.recorded.confirmedAlerts);
    for (const item of Array.isArray(diagnostics.byPairTimeframe) ? diagnostics.byPairTimeframe : []) {
      const pair = String(item?.pair ?? "").trim();
      const timeframe = String(item?.timeframe ?? "").trim();
      if (!pair || !timeframe || !item?.replay) continue;
      const key = `${pair}\u0000${timeframe}`;
      let entry = funnel.get(key);
      if (!entry) {
        entry = { pair, timeframe, scanRows: 0, replay: emptyReplayDiagnostics() };
        funnel.set(key, entry);
      }
      entry.scanRows++;
      addReplayCounts(entry.replay, item.replay);
    }
  }
  summary.byPairTimeframe = [...funnel.values()].sort((a, b) =>
    a.pair.localeCompare(b.pair) || a.timeframe.localeCompare(b.timeframe),
  );
  if (!diagnosticsAvailable) {
    summary.diagnosticRows = 0;
    summary.invalidDiagnosticRows = 0;
    summary.recordedConfirmedAlerts = 0;
    summary.byPairTimeframe = [];
  }
  return summary;
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
