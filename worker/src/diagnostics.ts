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
  /** Setups entering RETEST with no direction-matched, zone-overlapping
   *  imbalance — the FVG retest path cannot accept these at any depth. */
  retestNoFvg: number;
  /** Setups entering RETEST that do have one. */
  retestWithFvg: number;
  riskRejects: number;
  riskRejectReasons: Record<RiskRejectReason, number>;
  targetRejects: number;
  confirmedAlerts: number;
}

/** Per-entry-timeframe confirmation funnel, recorded at the live freshness
 *  gate. Diagnostics only: nothing here can accept, drop, delay, or reorder a
 *  confirmation — the gate reads none of these counters. */
export interface ConfirmationFunnelEntry {
  /** Confirmation candidates that reached the live gate. */
  built: number;
  /** Passed the freshness window (either stored or already stored). */
  fresh: number;
  /** Older than `2.5 × timeframe` at discovery and dropped without a row. */
  stale: number;
  /** Fresh and written to the alert ledger. */
  inserted: number;
  /** Fresh but the logical setup was already stored. */
  duplicate: number;
  /** Stale, yet within twice the freshness window — "almost on time". */
  nearMiss: number;
  /** Sum and maximum discovery age (age = now − confirming candle close). */
  ageSumSec: number;
  ageMaxSec: number;
  /** Age sum over fresh attempts, for an honest accepted-latency average. */
  freshAgeSumSec: number;
}

export type ConfirmationFunnel = Record<string, ConfirmationFunnelEntry>;

export interface RecordedDiagnostics extends LifecycleCounts {
  confirmedAlerts: number;
  /** Confirmation candidates rejected as stale at the live freshness gate. */
  staleConfirmationSkips: number;
  /** Fresh candidates rejected because the logical setup was already stored. */
  duplicateConfirmationSkips: number;
  /** Per-timeframe discovery-latency funnel. Absent on rows written before
   *  this instrumentation; readers must tolerate its absence. */
  confirmations?: ConfirmationFunnel;
}

/** Per-invocation phase timings, written once per scan row. Diagnostics only:
 *  nothing here is read back into a scan, gate, delivery, or outcome decision.
 *  `shadowGroups` is how many distinct open shadow (pair, timeframe) groups
 *  existed; `shadowChecked` is how many of them this tick actually fetched
 *  (the resolver rotates through the set so one tick can never fan out
 *  unboundedly). `httpCalls` counts HTTP requests issued during the tick. */
export interface ScanTimingDiagnostics {
  liveResolveMs: number;
  shadowResolveMs: number;
  pairScanMs: number;
  shadowGroups: number;
  shadowChecked: number;
  httpCalls: number;
  /** Time spent deciding which markets are due (boundary + last-scan reads). */
  scheduleMs: number;
  /** Store (D1) round-trips issued by this invocation, and their wall time. */
  storeCalls: number;
  storeMs: number;
}

export interface ScanDiagnostics {
  version: 1;
  replay: ReplayDiagnostics;
  recorded: RecordedDiagnostics;
  byPairTimeframe: { pair: string; timeframe: string; replay: ReplayDiagnostics }[];
  /** Absent on rows written before this instrumentation existed. */
  timing?: ScanTimingDiagnostics;
}

export interface ScanAuditFunnelRow {
  pair: string;
  timeframe: string;
  scanRows: number;
  replay: ReplayDiagnostics;
}

export interface ScanAuditDaySummary {
  utcDay: string;
  scanRows: number;
  activeScanRows: number;
  scanErrorRows: number;
  errorCategories: { staleFeed: number; rateLimitOrCredits: number; networkOrTimeout: number; other: number };
  diagnosticRows: number;
  invalidDiagnosticRows: number;
  gateMetricsRows: number;
  alertRowsWritten: number;
  eventRowsWritten: number;
  recordedConfirmedAlerts: number;
  replayRetestTransitions: number;
  retestCandidates: number;
  retestNoFvg: number;
  retestWithFvg: number;
  targetRejects: number;
  riskRejects: number;
  staleConfirmationSkips: number;
  duplicateConfirmationSkips: number;
  firstScanUtc: string | null;
  lastScanUtc: string | null;
}

export interface StoredAlertAuditGroup {
  utcDay: string;
  pair: string;
  timeframe: string;
  direction: string;
  alertStatus: string;
  tradeStatus: string;
  suppressReason: string | null;
  count: number;
}

export interface StoredAlertAuditInputRow {
  created_utc?: unknown;
  canonical_symbol?: unknown;
  entry_timeframe?: unknown;
  direction?: unknown;
  alert_status?: unknown;
  status?: unknown;
  suppress_reason?: unknown;
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
  byDay: ScanAuditDaySummary[];
  storedAlertsAvailable: boolean;
  storedAlertsByDay: StoredAlertAuditGroup[];
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
    ...emptyLifecycleCounts(), retestCandidates: 0, retestNoFvg: 0, retestWithFvg: 0,
    riskRejects: 0,
    riskRejectReasons: { nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0 },
    targetRejects: 0, confirmedAlerts: 0,
  };
}

export function addReplayCounts(target: ReplayDiagnostics, source: Partial<ReplayDiagnostics>): void {
  for (const state of LIFECYCLE_STATES) {
    target[state] += Number.isFinite(Number(source[state])) ? Math.max(0, Number(source[state])) : 0;
  }
  for (const key of ["retestCandidates", "retestNoFvg", "retestWithFvg", "riskRejects", "targetRejects", "confirmedAlerts"] as const) {
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

export function emptyScanAuditDay(utcDay: string): ScanAuditDaySummary {
  return {
    utcDay, scanRows: 0, activeScanRows: 0, scanErrorRows: 0,
    errorCategories: { staleFeed: 0, rateLimitOrCredits: 0, networkOrTimeout: 0, other: 0 },
    diagnosticRows: 0, invalidDiagnosticRows: 0, gateMetricsRows: 0,
    alertRowsWritten: 0, eventRowsWritten: 0, recordedConfirmedAlerts: 0,
    replayRetestTransitions: 0, retestCandidates: 0, retestNoFvg: 0, retestWithFvg: 0,
    targetRejects: 0, riskRejects: 0,
    staleConfirmationSkips: 0, duplicateConfirmationSkips: 0,
    firstScanUtc: null, lastScanUtc: null,
  };
}

/** Fill missing UTC days with zeroes so a missing log day is visible. */
export function completeScanAuditDays(
  rows: ScanAuditDaySummary[], fromIso: string, toIso: string,
): ScanAuditDaySummary[] {
  const byDay = new Map(rows.map((row) => [row.utcDay, row]));
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return [...byDay.values()].sort((a, b) => a.utcDay.localeCompare(b.utcDay));
  }
  const start = new Date(fromMs);
  const end = new Date(toMs);
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const finalDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor <= finalDay) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, emptyScanAuditDay(day));
    cursor += 86400_000;
  }
  return [...byDay.values()].sort((a, b) => a.utcDay.localeCompare(b.utcDay));
}

export function mapScanAuditDayAggregateRows(
  rows: Record<string, unknown>[], fromIso: string, toIso: string,
): ScanAuditDaySummary[] {
  const asCount = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const days = rows.flatMap((row) => {
    const utcDay = String(row.utc_day ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDay)) return [];
    return [{
      utcDay,
      scanRows: asCount(row.scan_rows),
      activeScanRows: asCount(row.active_scan_rows),
      scanErrorRows: asCount(row.scan_error_rows),
      errorCategories: {
        staleFeed: asCount(row.stale_feed_errors),
        rateLimitOrCredits: asCount(row.rate_limit_errors),
        networkOrTimeout: asCount(row.network_timeout_errors),
        other: asCount(row.other_errors),
      },
      diagnosticRows: asCount(row.diagnostic_rows),
      invalidDiagnosticRows: asCount(row.invalid_diagnostic_rows),
      gateMetricsRows: asCount(row.gate_metrics_rows),
      alertRowsWritten: asCount(row.alert_rows_written),
      eventRowsWritten: asCount(row.event_rows_written),
      recordedConfirmedAlerts: asCount(row.recorded_confirmed_alerts),
      replayRetestTransitions: asCount(row.replay_retest_transitions),
      retestCandidates: asCount(row.retest_candidates),
      retestNoFvg: asCount(row.retest_no_fvg),
      retestWithFvg: asCount(row.retest_with_fvg),
      targetRejects: asCount(row.target_rejects),
      riskRejects: asCount(row.risk_rejects),
      staleConfirmationSkips: asCount(row.stale_confirmation_skips),
      duplicateConfirmationSkips: asCount(row.duplicate_confirmation_skips),
      firstScanUtc: row.first_scan_utc == null ? null : String(row.first_scan_utc),
      lastScanUtc: row.last_scan_utc == null ? null : String(row.last_scan_utc),
    }];
  });
  return completeScanAuditDays(days, fromIso, toIso);
}

export function buildStoredAlertAuditGroups(rows: StoredAlertAuditInputRow[]): StoredAlertAuditGroup[] {
  const groups = new Map<string, StoredAlertAuditGroup>();
  for (const row of rows) {
    const createdUtc = String(row.created_utc ?? "");
    const utcDay = createdUtc.slice(0, 10);
    const pair = String(row.canonical_symbol ?? "").trim();
    const timeframe = String(row.entry_timeframe ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDay) || !pair || !timeframe) continue;
    const direction = String(row.direction ?? "unknown");
    const alertStatus = String(row.alert_status ?? "unknown");
    const tradeStatus = String(row.status ?? "unknown");
    const suppressReason = row.suppress_reason == null || String(row.suppress_reason).trim() === ""
      ? null : String(row.suppress_reason);
    const key = [utcDay, pair, timeframe, direction, alertStatus, tradeStatus, suppressReason ?? ""].join("\u0000");
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { utcDay, pair, timeframe, direction, alertStatus, tradeStatus, suppressReason, count: 1 });
  }
  return [...groups.values()].sort((a, b) =>
    a.utcDay.localeCompare(b.utcDay) || a.pair.localeCompare(b.pair)
      || a.timeframe.localeCompare(b.timeframe) || a.alertStatus.localeCompare(b.alertStatus),
  );
}

function scanErrorCategory(errors: string): "staleFeed" | "rateLimitOrCredits" | "networkOrTimeout" | "other" {
  const normalized = errors.toLowerCase();
  if (normalized.includes("stale feed")) return "staleFeed";
  if (normalized.includes("rate limit") || normalized.includes("credit")) return "rateLimitOrCredits";
  if (normalized.includes("network") || normalized.includes("timeout")) return "networkOrTimeout";
  return "other";
}

export function buildScanAuditSummary(
  rows: ScanAuditInputRow[], diagnosticsAvailable: boolean,
  fromIso?: string, toIso?: string,
): ScanAuditSummary {
  const summary: ScanAuditSummary = {
    scanRows: 0, activeScanRows: 0, scanErrorRows: 0,
    errorCategories: { staleFeed: 0, rateLimitOrCredits: 0, networkOrTimeout: 0, other: 0 },
    alertRowsWritten: 0, eventRowsWritten: 0, firstScanUtc: null, lastScanUtc: null,
    diagnosticsAvailable, diagnosticRows: 0, invalidDiagnosticRows: 0,
    recordedConfirmedAlerts: 0, byPairTimeframe: [], byDay: [],
    storedAlertsAvailable: false, storedAlertsByDay: [],
  };
  const funnel = new Map<string, ScanAuditFunnelRow>();
  const dayMap = new Map<string, ScanAuditDaySummary>();
  const asCount = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const dayFor = (utcDay: string) => {
    let day = dayMap.get(utcDay);
    if (!day) { day = emptyScanAuditDay(utcDay); dayMap.set(utcDay, day); }
    return day;
  };
  for (const row of rows) {
    const utcDay = String(row.ts ?? "").slice(0, 10);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(utcDay) ? dayFor(utcDay) : null;
    summary.scanRows++;
    if (day) day.scanRows++;
    const pairs = String(row.pairs ?? "").trim();
    if (pairs && pairs !== "[]" && pairs.toLowerCase() !== "null") {
      summary.activeScanRows++;
      if (day) day.activeScanRows++;
    }
    const errors = String(row.errors ?? "").trim();
    if (errors && errors !== "[]" && errors.toLowerCase() !== "null") {
      summary.scanErrorRows++;
      if (day) day.scanErrorRows++;
      const category = scanErrorCategory(errors);
      summary.errorCategories[category]++;
      if (day) day.errorCategories[category]++;
    }
    summary.alertRowsWritten += asCount(row.alerts);
    summary.eventRowsWritten += asCount(row.events);
    if (day) {
      day.alertRowsWritten += asCount(row.alerts);
      day.eventRowsWritten += asCount(row.events);
      if (row.ts && (!day.firstScanUtc || row.ts < day.firstScanUtc)) day.firstScanUtc = row.ts;
      if (row.ts && (!day.lastScanUtc || row.ts > day.lastScanUtc)) day.lastScanUtc = row.ts;
    }
    if (row.ts && (!summary.firstScanUtc || row.ts < summary.firstScanUtc)) summary.firstScanUtc = row.ts;
    if (row.ts && (!summary.lastScanUtc || row.ts > summary.lastScanUtc)) summary.lastScanUtc = row.ts;

    let raw: unknown = row.diagnostics ?? row.diagnostics_json ?? null;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = false; }
    }
    if (raw == null) continue;
    if (!raw || typeof raw !== "object") {
      summary.invalidDiagnosticRows++;
      if (day) day.invalidDiagnosticRows++;
      continue;
    }
    const diagnostics = raw as ScanDiagnostics;
    if (diagnostics.version !== 1 || !diagnostics.replay || !diagnostics.recorded) {
      summary.invalidDiagnosticRows++;
      if (day) day.invalidDiagnosticRows++;
      continue;
    }
    summary.diagnosticRows++;
    if (day) day.diagnosticRows++;
    const recorded = diagnostics.recorded as RecordedDiagnostics;
    const recordedConfirms = asCount(recorded.confirmedAlerts);
    summary.recordedConfirmedAlerts += recordedConfirms;
    if (day) {
      day.recordedConfirmedAlerts += recordedConfirms;
      day.replayRetestTransitions += asCount(diagnostics.replay.RETEST);
      day.retestCandidates += asCount(diagnostics.replay.retestCandidates);
      day.retestNoFvg += asCount(diagnostics.replay.retestNoFvg);
      day.retestWithFvg += asCount(diagnostics.replay.retestWithFvg);
      day.targetRejects += asCount(diagnostics.replay.targetRejects);
      day.riskRejects += asCount(diagnostics.replay.riskRejects);
      day.staleConfirmationSkips += asCount(recorded.staleConfirmationSkips);
      day.duplicateConfirmationSkips += asCount(recorded.duplicateConfirmationSkips);
      if (recorded.staleConfirmationSkips != null && recorded.duplicateConfirmationSkips != null) day.gateMetricsRows++;
    }
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
  summary.byDay = fromIso && toIso
    ? completeScanAuditDays([...dayMap.values()], fromIso, toIso)
    : [...dayMap.values()].sort((a, b) => a.utcDay.localeCompare(b.utcDay));
  if (!diagnosticsAvailable) {
    summary.diagnosticRows = 0;
    summary.invalidDiagnosticRows = 0;
    summary.recordedConfirmedAlerts = 0;
    summary.byPairTimeframe = [];
    summary.byDay = summary.byDay.map((day) => ({
      ...day, diagnosticRows: 0, invalidDiagnosticRows: 0, gateMetricsRows: 0,
      recordedConfirmedAlerts: 0, replayRetestTransitions: 0, retestCandidates: 0,
      targetRejects: 0, riskRejects: 0, staleConfirmationSkips: 0, duplicateConfirmationSkips: 0,
    }));
  }
  return summary;
}

export function emptyConfirmationFunnelEntry(): ConfirmationFunnelEntry {
  return {
    built: 0, fresh: 0, stale: 0, inserted: 0, duplicate: 0,
    nearMiss: 0, ageSumSec: 0, ageMaxSec: 0, freshAgeSumSec: 0,
  };
}

/** Record one confirmation attempt at the live gate. Pure counter bookkeeping:
 *  the caller still owns the accept/drop decision (`alertEventFresh`), and no
 *  value written here is ever read back by a strategy or delivery gate.
 *  `windowSec` is the caller's freshness window (`2.5 × timeframe`), used only
 *  to classify an "almost on time" stale attempt as a near miss.
 *  Stages are ordered and each attempt lands in exactly one leaf:
 *  `built` = every attempt, `fresh` = cleared the freshness gate
 *  (`fresh === inserted + duplicate`), `stale` = dropped by the gate
 *  (`built === fresh + stale`). Duplicates were discovered on an earlier scan,
 *  so their latency still counts toward `ageSumSec`/`freshAgeSumSec`. */
export function noteConfirmationAttempt(
  recorded: RecordedDiagnostics,
  tf: string,
  ageSec: number,
  outcome: "stale" | "duplicate" | "inserted",
  windowSec: number,
): void {
  const age = Number.isFinite(ageSec) && ageSec > 0 ? Math.round(ageSec) : 0;
  const funnel = recorded.confirmations ?? (recorded.confirmations = {});
  const entry = funnel[tf] ?? (funnel[tf] = emptyConfirmationFunnelEntry());
  entry.built++;
  entry.ageSumSec += age;
  if (age > entry.ageMaxSec) entry.ageMaxSec = age;
  if (outcome === "stale") {
    entry.stale++;
    if (windowSec > 0 && age <= 2 * windowSec) entry.nearMiss++;
    return;
  }
  entry.fresh++;
  entry.freshAgeSumSec += age;
  if (outcome === "inserted") entry.inserted++;
  else entry.duplicate++;
}

export function emptyScanDiagnostics(): ScanDiagnostics {
  return {
    version: 1, replay: emptyReplayDiagnostics(),
    recorded: {
      ...emptyLifecycleCounts(), confirmedAlerts: 0,
      staleConfirmationSkips: 0, duplicateConfirmationSkips: 0,
    },
    byPairTimeframe: [],
  };
}

export function addReplayDiagnostics(scan: ScanDiagnostics, pair: string, timeframe: string, replay: ReplayDiagnostics): void {
  scan.byPairTimeframe.push({ pair, timeframe, replay });
  for (const state of LIFECYCLE_STATES) scan.replay[state] += replay[state];
  for (const key of ["retestCandidates", "retestNoFvg", "retestWithFvg", "riskRejects", "targetRejects", "confirmedAlerts"] as const) {
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

/** Rolling 24h aggregate of recorded engine counters. Lifecycle counts are
 *  first-write event rows (not distinct setups); rejection counts are replay
 *  attempts and can include the same opportunity on multiple scans. These
 *  metrics describe pipeline activity, not strategy efficacy or delivery. */
export interface EnginePulseConfirmationRow {
  timeframe: string;
  built: number;
  fresh: number;
  stale: number;
  inserted: number;
  duplicate: number;
  nearMiss: number;
  avgAgeSec: number;
  maxAgeSec: number;
  avgFreshAgeSec: number;
}

/** Window aggregate of the per-tick phase timings. Averages are over the scan
 *  rows that recorded timings; the scheduler/store averages use only rows that
 *  actually carry those counters (they were added later), and maxes are the
 *  largest single value seen. */
export interface EnginePulseTiming {
  ticks: number;
  avgScheduleMs: number;
  maxScheduleMs: number;
  avgStoreCalls: number;
  maxStoreCalls: number;
  avgStoreMs: number;
  maxStoreMs: number;
  avgPairScanMs: number;
  maxPairScanMs: number;
  avgLiveResolveMs: number;
  maxLiveResolveMs: number;
  avgShadowResolveMs: number;
  maxShadowResolveMs: number;
  avgShadowGroups: number;
  avgShadowChecked: number;
  avgHttpCalls: number;
  maxHttpCalls: number;
}

export interface EnginePulse {
  windowHours: number;
  scans: number; // every scan logged in the window (incl. idle ticks)
  activeScans: number; // scans that covered at least one pair
  pairs: string[];
  pairsCovered: number;
  evaluated: number; // newly recorded MAP event rows; not distinct setup IDs
  chains: { TOUCH: number; SWEEP: number; SHIFT: number; RETEST: number }; // first-write event rows; a setup can recur on a later candle
  confirmed: number; // alert rows inserted; not proof of notification delivery
  rejections: { nonPositiveRisk: number; belowMinRiskAtr: number; aboveMaxStopAtr: number; targetFloor: number };
  /** Per entry timeframe: how many confirmations reached the live gate, how
   *  many were discovered inside the freshness window, and how long discovery
   *  took. Answers "are we losing alerts to timing?" without a redeploy. */
  confirmations: EnginePulseConfirmationRow[];
  /** Where each tick's wall clock goes. Shows what actually gates cadence. */
  timing: EnginePulseTiming;
  lastScanTs: string | null;
}

export function emptyEnginePulseTiming(): EnginePulseTiming {
  return {
    ticks: 0, avgScheduleMs: 0, maxScheduleMs: 0,
    avgStoreCalls: 0, maxStoreCalls: 0, avgStoreMs: 0, maxStoreMs: 0,
    avgPairScanMs: 0, maxPairScanMs: 0,
    avgLiveResolveMs: 0, maxLiveResolveMs: 0,
    avgShadowResolveMs: 0, maxShadowResolveMs: 0,
    avgShadowGroups: 0, avgShadowChecked: 0,
    avgHttpCalls: 0, maxHttpCalls: 0,
  };
}

export function emptyEnginePulse(windowHours = 24): EnginePulse {
  return {
    windowHours, scans: 0, activeScans: 0, pairs: [], pairsCovered: 0,
    evaluated: 0, chains: { TOUCH: 0, SWEEP: 0, SHIFT: 0, RETEST: 0 },
    confirmed: 0, rejections: { nonPositiveRisk: 0, belowMinRiskAtr: 0, aboveMaxStopAtr: 0, targetFloor: 0 },
    confirmations: [],
    timing: emptyEnginePulseTiming(),
    lastScanTs: null,
  };
}

/** Pure aggregation over scan-log rows (read-only; never called from the
 *  scan/write path). `chains`/`evaluated`/`confirmed` use recorded counters;
 *  lifecycle rows are de-duplicated by event identity, not by setup ID, and
 *  `confirmed` means an alert row was inserted before delivery gates. Rejection
 *  counters are replay attempts and may repeat the same opportunity. */
export function buildEnginePulse(rows: EnginePulseRow[], nowMs: number, windowHours = 24): EnginePulse {
  const pulse = emptyEnginePulse(windowHours);
  const cutoff = nowMs - windowHours * 3600_000;
  const pairs = new Set<string>();
  const funnels = new Map<string, ConfirmationFunnelEntry>();
  let timingTicks = 0, pairSum = 0, pairMax = 0, liveSum = 0, liveMax = 0;
  let shadowSum = 0, shadowMax = 0, groupSum = 0, checkedSum = 0, httpSum = 0, httpMax = 0;
  let scheduleSum = 0, scheduleMax = 0, storeCallSum = 0, storeCallMax = 0, storeMsSum = 0, storeMsMax = 0;
  // Rows written before the scheduler/store counters existed record a `timing`
  // block without them. They must not be counted as zeros in these averages,
  // so this phase keeps its own denominator until the old rows age out.
  let scheduleTicks = 0;
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
    // Phase timings. Tolerates rows without the field and never trusts values.
    const timing = diag.timing;
    if (timing && typeof timing === "object") {
      const phase = (value: unknown) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      const pairMs = phase(timing.pairScanMs);
      const liveMs = phase(timing.liveResolveMs);
      const shadowMs = phase(timing.shadowResolveMs);
      const httpMs = phase(timing.httpCalls);
      timingTicks++;
      pairSum += pairMs; if (pairMs > pairMax) pairMax = pairMs;
      liveSum += liveMs; if (liveMs > liveMax) liveMax = liveMs;
      shadowSum += shadowMs; if (shadowMs > shadowMax) shadowMax = shadowMs;
      groupSum += phase(timing.shadowGroups);
      checkedSum += phase(timing.shadowChecked);
      httpSum += httpMs; if (httpMs > httpMax) httpMax = httpMs;
      const carriesSchedule = "scheduleMs" in timing || "storeCalls" in timing;
      if (carriesSchedule) scheduleTicks++;
      const scheduleMs = phase(timing.scheduleMs);
      const storeCalls = phase(timing.storeCalls);
      const storeMs = phase(timing.storeMs);
      scheduleSum += scheduleMs; if (scheduleMs > scheduleMax) scheduleMax = scheduleMs;
      storeCallSum += storeCalls; if (storeCalls > storeCallMax) storeCallMax = storeCalls;
      storeMsSum += storeMs; if (storeMs > storeMsMax) storeMsMax = storeMs;
    }

    // Discovery-latency funnel. Tolerates rows written before this
    // instrumentation existed (field absent) and never trusts row shapes.
    const cf = diag.recorded.confirmations;
    if (cf && typeof cf === "object") {
      for (const [tf, raw] of Object.entries(cf)) {
        if (!raw || typeof raw !== "object") continue;
        const entry = funnels.get(tf) ?? emptyConfirmationFunnelEntry();
        const candidate = raw as Partial<Record<keyof ConfirmationFunnelEntry, unknown>>;
        let touched = false;
        for (const key of [
          "built", "fresh", "stale", "inserted", "duplicate", "nearMiss",
          "ageSumSec", "freshAgeSumSec",
        ] as const) {
          const value = Number(candidate[key]);
          if (Number.isFinite(value) && value > 0) {
            entry[key] += value;
            touched = true;
          }
        }
        // Each row reports its own worst case; the window's worst case is the
        // largest of those, never their sum.
        const rowMax = Number(candidate.ageMaxSec);
        if (Number.isFinite(rowMax) && rowMax > entry.ageMaxSec) {
          entry.ageMaxSec = rowMax;
          touched = true;
        }
        if (touched) funnels.set(tf, entry);
      }
    }
  }
  if (timingTicks > 0) {
    const avg = (sum: number) => Math.round(sum / timingTicks);
    pulse.timing = {
      ticks: timingTicks,
      avgScheduleMs: scheduleTicks > 0 ? Math.round(scheduleSum / scheduleTicks) : 0,
      maxScheduleMs: scheduleMax,
      avgStoreCalls: scheduleTicks > 0 ? Math.round(storeCallSum / scheduleTicks) : 0,
      maxStoreCalls: storeCallMax,
      avgStoreMs: scheduleTicks > 0 ? Math.round(storeMsSum / scheduleTicks) : 0,
      maxStoreMs: storeMsMax,
      avgPairScanMs: avg(pairSum), maxPairScanMs: pairMax,
      avgLiveResolveMs: avg(liveSum), maxLiveResolveMs: liveMax,
      avgShadowResolveMs: avg(shadowSum), maxShadowResolveMs: shadowMax,
      avgShadowGroups: avg(groupSum), avgShadowChecked: avg(checkedSum),
      avgHttpCalls: avg(httpSum), maxHttpCalls: httpMax,
    };
  }
  pulse.confirmations = [...funnels.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timeframe, entry]) => ({
      timeframe,
      built: entry.built,
      fresh: entry.fresh,
      stale: entry.stale,
      inserted: entry.inserted,
      duplicate: entry.duplicate,
      nearMiss: entry.nearMiss,
      avgAgeSec: entry.built > 0 ? Math.round(entry.ageSumSec / entry.built) : 0,
      maxAgeSec: entry.ageMaxSec,
      avgFreshAgeSec: entry.fresh > 0 ? Math.round(entry.freshAgeSumSec / entry.fresh) : 0,
    }));
  pulse.pairs = [...pairs].sort();
  pulse.pairsCovered = pairs.size;
  return pulse;
}
