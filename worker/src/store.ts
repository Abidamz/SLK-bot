/** Persistence layer. A tiny structural interface (`Store`) with two
 *  implementations: D1 (SQLite on Cloudflare) and an in-memory store used by
 *  tests. Dedupe semantics live in the schema: slk_alerts has a UNIQUE
 *  setup_id, slk_events a UNIQUE (setup_id, state, candle_time) — so Worker
 *  retries and rescans can never double-deliver. */
import type { Alert, EngineEvent, Outcome, ShadowTradeCapture, ShadowTradeOutcome, ShadowTradeStatus, ShadowRejectReason } from "./types";
import { summarizeScanLogs, type EngineDisciplineTotals, type ScanDiagnostics } from "./diagnostics";
import { isDerivPair } from "./config";

// A subset of the D1Database API — the real env.DB satisfies this.
export interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta: { changes: number } }>;
      first(): Promise<Record<string, unknown> | null>;
      all(): Promise<{ results: Record<string, unknown>[] }>;
    };
    run?(): Promise<{ meta: { changes: number } }>;
    first?(): Promise<Record<string, unknown> | null>;
    all?(): Promise<{ results: Record<string, unknown>[] }>;
  };
}

export interface AlertRow extends Record<string, unknown> {
  setup_id: string;
  canonical_symbol: string;
  entry_timeframe: string;
  direction: string;
  entry: number;
  stop_loss: number;
  tp_internal: number;
  tp_external: number | null;
  candle_close_time: string;
  environment: string;
  phase: string;
  htf_alignment: string;
  key_level_type: string;
  origin_key_level: number;
  alert_status: string;
  status: string;
}

export interface Store {
  insertAlert(a: Alert, provider: string): Promise<boolean>; // false = duplicate
  updateAlertStatus(setupId: string, status: string, reason?: string): Promise<void>;
  insertEvent(ev: EngineEvent): Promise<boolean>;            // false = duplicate
  openAlerts(pair?: string, tf?: string): Promise<AlertRow[]>;
  lastAlertTime(pair: string, direction: string, excludeSetupId?: string): Promise<number | null>;
  recordOutcome(setupId: string, oc: Outcome): Promise<void>;
  getKv(key: string): Promise<string | null>;
  setKv(key: string, value: string): Promise<void>;
  insertScanLog(row: ScanLogRow): Promise<void>;
  scanLogsSince(sinceMs: number, limit?: number): Promise<ScanLogRow[]>;
  scanDiagnosticsSince(sinceMs: number): Promise<EngineDisciplineTotals | null>;
  insertShadowTrade(row: ShadowTradeCapture): Promise<boolean>;
  openShadowTrades(pair?: string, tf?: string): Promise<ShadowTradeRow[]>;
  recordShadowOutcome(setupId: string, outcome: ShadowTradeOutcome): Promise<void>;
  getShadowLedger(limit?: number): Promise<ShadowLedger>;
  recentAlerts(limit: number): Promise<AlertRow[]>;
  queryAlerts(query: AlertQuery): Promise<AlertQueryResult>;
  recentEvents(limit: number): Promise<Record<string, unknown>[]>;
  eventsSince(cursorId: number, limit: number): Promise<Record<string, unknown>[]>;
  recentScanLogs(limit: number): Promise<Record<string, unknown>[]>;
  getNotificationPreferences(): Promise<NotificationPreferences>;
  saveNotificationPreferences(prefs: NotificationPreferences, source: string): Promise<void>;
  insertNotificationDeliveryAudit(row: { channel: string; kind: string; status: string; detail?: string }): Promise<void>;
  expireOpenAlerts(): Promise<number>;
  resetAllAlerts(): Promise<void>;
  clearSyntheticsAlerts(): Promise<number>;
  insertWaitlist(entry: WaitlistEntry): Promise<{ ok: boolean; duplicate?: boolean }>;
  getWaitlistCount(): Promise<number>;
  listWaitlist(limit?: number): Promise<WaitlistRow[]>;
}

export interface WaitlistEntry {
  email: string;
  telegram?: string;
  segmentInterest?: string;
  createdUtc?: string;
  source?: string;
}

export interface WaitlistRow extends Record<string, unknown> {
  email: string;
  telegram: string | null;
  segment_interest: string | null;
  created_utc: string;
  source: string | null;
}



export interface AlertQuery {
  pair?: string; timeframe?: string; direction?: string; channel?: string; lifecycle?: string; outcome?: string; provider?: string;
  from?: string; to?: string; search?: string; sort?: string; order?: "asc" | "desc";
  segment?: "all" | "institutional" | "synthetics";
  page: number; pageSize: number;
}
export interface AlertQueryResult { rows: AlertRow[]; total: number; }

export interface NotificationPreferences {
  primaryConfirmed: true;
  telegramWatch: boolean;
  discordWatch: boolean;
  operationalEnabled: boolean;
  cooldownMinutes: number;
  updatedUtc: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  primaryConfirmed: true, telegramWatch: true, discordWatch: true,
  operationalEnabled: true, cooldownMinutes: 30, updatedUtc: "",
};

export interface ScanLogRow {
  diagnostics?: ScanDiagnostics; // absent on legacy callers/rows, not a zero scan
  ts: string;
  timeframes: string;
  pairs: string;
  alerts: number;
  events: number;
  errors: string;
  durationMs: number;
  note: string;
}

export interface ShadowTradeRow extends Record<string, unknown> {
  setup_id: string;
  canonical_symbol: string;
  entry_timeframe: string;
  direction: "LONG" | "SHORT";
  hypothetical_entry: number;
  hypothetical_stop_loss: number;
  hypothetical_tp1: number;
  hypothetical_rr: number;
  reject_reason: ShadowRejectReason;
  created_utc: string;
  candle_close_time: string;
  status: ShadowTradeStatus;
  exit_time: string | null;
  exit_price: number | null;
  r_multiple: number | null;
}

export interface ShadowAggregate {
  count: number;
  resolved: number;
  wins: number;
  losses: number;
  netR: number;
  winRate: number | null; // percentage among resolved rows
}

export interface ShadowLedger {
  available: boolean;
  rows: ShadowTradeRow[];
  aggregate: Record<ShadowRejectReason, ShadowAggregate>;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const shadowTableCache = new WeakMap<object, boolean>();
const shadowTableProbe = new WeakMap<object, Promise<boolean>>();
const scanDiagnosticsColumnCache = new WeakMap<object, boolean>();
const scanDiagnosticsColumnProbe = new WeakMap<object, Promise<boolean>>();

async function hasShadowTable(db: D1Like): Promise<boolean> {
  const key = db as object;
  if (shadowTableCache.has(key)) return shadowTableCache.get(key)!;
  const pending = shadowTableProbe.get(key);
  if (pending) return pending;
  const probe = (async () => {
    let exists = false;
    try {
      await db.prepare("SELECT 1 FROM slk_shadow_trades LIMIT 0").bind().all();
      exists = true;
    } catch (err) {
      // D1 migration may not have been applied yet. Cache the negative result
      // for this DB binding so every scan does not repeat a failing SQL query.
      console.warn(JSON.stringify({ level: "warn", msg: "shadow ledger unavailable; migration not applied", error: String(err) }));
    }
    shadowTableCache.set(key, exists);
    shadowTableProbe.delete(key);
    return exists;
  })();
  shadowTableProbe.set(key, probe);
  return probe;
}

async function hasScanDiagnosticsColumn(db: D1Like): Promise<boolean> {
  const key = db as object;
  if (scanDiagnosticsColumnCache.has(key)) return scanDiagnosticsColumnCache.get(key)!;
  const pending = scanDiagnosticsColumnProbe.get(key);
  if (pending) return pending;
  const probe = (async () => {
    let exists = false;
    try {
      await db.prepare("SELECT diagnostics_json FROM slk_scan_log LIMIT 0").bind().all();
      exists = true;
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "scan diagnostics column unavailable; using legacy scan log schema", error: String(err) }));
    }
    scanDiagnosticsColumnCache.set(key, exists);
    scanDiagnosticsColumnProbe.delete(key);
    return exists;
  })();
  scanDiagnosticsColumnProbe.set(key, probe);
  return probe;
}

function markScanDiagnosticsColumn(db: D1Like, exists: boolean): void {
  const key = db as object;
  scanDiagnosticsColumnCache.set(key, exists);
  scanDiagnosticsColumnProbe.delete(key);
}

const emptyShadowAggregate = (): ShadowAggregate => ({
  count: 0, resolved: 0, wins: 0, losses: 0, netR: 0, winRate: null,
});

function emptyShadowLedger(available: boolean): ShadowLedger {
  return {
    available,
    rows: [],
    aggregate: {
      TARGET_FLOOR: emptyShadowAggregate(),
      NO_RETEST: emptyShadowAggregate(),
    },
  };
}

function aggregateShadowRows(rows: ShadowTradeRow[]): ShadowLedger["aggregate"] {
  const aggregate = {
    TARGET_FLOOR: emptyShadowAggregate(),
    NO_RETEST: emptyShadowAggregate(),
  };
  for (const row of rows) {
    const stats = aggregate[row.reject_reason];
    if (!stats) continue;
    stats.count++;
    if (row.status === "OPEN") continue;
    stats.resolved++;
    const r = Number(row.r_multiple ?? 0);
    stats.netR += r;
    if (r > 0) stats.wins++;
    else if (r < 0) stats.losses++;
  }
  for (const stats of Object.values(aggregate)) {
    stats.netR = Math.round(stats.netR * 10000) / 10000;
    stats.winRate = stats.resolved ? Math.round((stats.wins / stats.resolved) * 10000) / 100 : null;
  }
  return aggregate;
}

function scanLogFromD1(row: Record<string, unknown>): ScanLogRow {
  let diagnostics: ScanDiagnostics | undefined;
  if (typeof row.diagnostics_json === "string") {
    try { diagnostics = JSON.parse(row.diagnostics_json) as ScanDiagnostics; } catch { /* legacy/malformed diagnostics are unavailable */ }
  }
  return {
    ts: String(row.ts ?? ""),
    timeframes: String(row.timeframes ?? ""),
    pairs: String(row.pairs ?? ""),
    alerts: Number(row.alerts ?? 0),
    events: Number(row.events ?? 0),
    errors: String(row.errors ?? ""),
    durationMs: Number(row.duration_ms ?? 0),
    note: String(row.note ?? ""),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

// ------------------------------------------------------------------ D1 impl

export class D1Store implements Store {
  constructor(private db: D1Like) {}

  async insertAlert(a: Alert, provider: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO slk_alerts (
          setup_id, provider, canonical_symbol, map_timeframe, entry_timeframe,
          candle_close_time, direction, environment, phase, htf_alignment,
          origin_key_level, key_level_type, key_level_bounds, key_level_tested,
          key_level_flipped, imbalance_context, internal_liquidity,
          external_liquidity, draw_on_liquidity, nearest_external_target,
          intermediate_zones, opposing_liquidity_standing, cycle_stage,
          entry_mode, entry, stop_loss, tp_internal, tp_external, sweep_time,
          bos_time, return_time, invalidation_level, invalidation_reason,
          parameter_version, setup_ref, alert_status, suppress_reason,
          created_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        a.setupId, provider, a.pair, a.mapTf, a.entryTf,
        iso(a.candleCloseTime), a.direction, a.environment, a.phase, a.htfAlignment,
        a.originKeyLevel, a.keyLevelType, JSON.stringify(a.keyLevelBounds),
        a.keyLevelTested ? 1 : 0, a.keyLevelFlipped ? 1 : 0,
        JSON.stringify(a.imbalanceContext), JSON.stringify(a.internalLiquidity),
        JSON.stringify(a.externalLiquidity), a.drawOnLiquidity,
        a.nearestExternalTarget, JSON.stringify(a.intermediateZones),
        a.opposingLiquidityStanding ? 1 : 0, a.cycleStage, a.entryMode,
        a.entry, a.stopLoss, a.tpInternal, a.tpExternal,
        iso(a.sweepTime), iso(a.bosTime), iso(a.returnTime),
        a.invalidationLevel, a.invalidationReason, a.parameterVersion,
        a.setupId, a.alertStatus, a.suppressReason, new Date().toISOString(),
      )
      .run();
    return res.meta.changes > 0;
  }

  async updateAlertStatus(setupId: string, status: string, reason?: string): Promise<void> {
    await this.db
      .prepare("UPDATE slk_alerts SET alert_status=?, suppress_reason=? WHERE setup_id=?")
      .bind(status, reason ?? null, setupId)
      .run();
  }

  async insertEvent(ev: EngineEvent): Promise<boolean> {
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO slk_events
         (setup_id, pair, state, candle_time, reason, price, created_utc)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(ev.setupId, ev.pair, ev.state, iso(ev.candleTime), ev.reason, ev.price, new Date().toISOString())
      .run();
    return res.meta.changes > 0;
  }

  async openAlerts(pair?: string, tf?: string): Promise<AlertRow[]> {
    let sql = "SELECT * FROM slk_alerts WHERE status='OPEN'";
    const args: unknown[] = [];
    if (pair) { sql += " AND canonical_symbol=?"; args.push(pair); }
    if (tf) { sql += " AND entry_timeframe=?"; args.push(tf); }
    const res = await this.db.prepare(sql).bind(...args).all();
    return res.results as AlertRow[];
  }

  async lastAlertTime(pair: string, direction: string, excludeSetupId?: string): Promise<number | null> {
    let sql = `SELECT candle_close_time FROM slk_alerts
               WHERE canonical_symbol=? AND direction=?
                 AND alert_status IN ('PAPER','SENT')`;
    const args: unknown[] = [pair, direction];
    if (excludeSetupId) { sql += " AND setup_id != ?"; args.push(excludeSetupId); }
    sql += " ORDER BY candle_close_time DESC LIMIT 1";
    const row = await this.db.prepare(sql).bind(...args).first();
    return row ? Date.parse(row.candle_close_time as string) : null;
  }

  async recordOutcome(setupId: string, oc: Outcome): Promise<void> {
    await this.db
      .prepare(
        `UPDATE slk_alerts SET status=?, exit_price=?, exit_time=?, r_multiple=?
         WHERE setup_id=? AND status='OPEN'`,
      )
      .bind(oc.status, oc.exitPrice, iso(oc.exitTime), oc.rMultiple, setupId)
      .run();
  }

  async getKv(key: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT v FROM slk_kv WHERE k=?").bind(key).first();
    return row ? (row.v as string) : null;
  }

  async setKv(key: string, value: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO slk_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(key, value)
      .run();
  }

  async insertScanLog(r: ScanLogRow): Promise<void> {
    const hasDiagnostics = await hasScanDiagnosticsColumn(this.db);
    if (hasDiagnostics) {
      try {
        await this.db
          .prepare(
            `INSERT INTO slk_scan_log (ts, timeframes, pairs, alerts, events, errors, duration_ms, note, diagnostics_json)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(r.ts, r.timeframes, r.pairs, r.alerts, r.events, r.errors, r.durationMs, r.note, r.diagnostics ? JSON.stringify(r.diagnostics) : null)
          .run();
        return;
      } catch (err) {
        // A deployment can race the additive migration. Fall back once and
        // remember the old schema for the lifetime of this D1 binding.
        markScanDiagnosticsColumn(this.db, false);
        console.warn(JSON.stringify({ level: "warn", msg: "insertScanLog diagnostics fallback", error: String(err) }));
      }
    }
    try {
      await this.db
        .prepare(
          `INSERT INTO slk_scan_log (ts, timeframes, pairs, alerts, events, errors, duration_ms, note)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(r.ts, r.timeframes, r.pairs, r.alerts, r.events, r.errors, r.durationMs, r.note)
        .run();
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "insertScanLog failed", error: String(err) }));
    }
  }

  async scanLogsSince(sinceMs: number, limit = 1000): Promise<ScanLogRow[]> {
    const maxRows = Math.max(1, Math.min(10_000, Math.floor(limit)));
    let includeDiagnostics = await hasScanDiagnosticsColumn(this.db);
    const queryRows = async (withDiagnostics: boolean): Promise<Record<string, unknown>[]> => {
      const diagnosticsColumn = withDiagnostics ? ", diagnostics_json" : "";
      const result = await this.db.prepare(
        `SELECT ts, timeframes, pairs, alerts, events, errors, duration_ms, note${diagnosticsColumn}
         FROM slk_scan_log WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT ?`,
      ).bind(iso(sinceMs), maxRows).all();
      return result.results ?? [];
    };
    let rows: Record<string, unknown>[];
    try {
      rows = await queryRows(includeDiagnostics);
    } catch (err) {
      if (!includeDiagnostics) throw err;
      // Regression hardening: legacy D1 may be missing diagnostics_json even
      // when another read path has not probed the column yet.
      markScanDiagnosticsColumn(this.db, false);
      console.warn(JSON.stringify({ level: "warn", msg: "scanLogsSince falling back to legacy schema", error: String(err) }));
      includeDiagnostics = false;
      rows = await queryRows(false);
    }
    return rows
      .reverse()
      .map((row) => scanLogFromD1(includeDiagnostics ? row : { ...row, diagnostics_json: null }));
  }

  async scanDiagnosticsSince(sinceMs: number): Promise<EngineDisciplineTotals | null> {
    if (!await hasScanDiagnosticsColumn(this.db)) return null;
    try {
      const row = await this.db.prepare(`
        SELECT
          SUM(CASE WHEN json_valid(diagnostics_json) THEN 1 ELSE 0 END) AS scans,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.MAP') AS INTEGER), 0) ELSE 0 END) AS setups_evaluated,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.SWEEP') AS INTEGER), 0) ELSE 0 END) AS sweep,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.SHIFT') AS INTEGER), 0) ELSE 0 END) AS shift,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.retestCandidates') AS INTEGER), 0) ELSE 0 END) AS retest,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.recorded.confirmedAlerts') AS INTEGER), 0) ELSE 0 END) AS confirmed,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.targetRejects') AS INTEGER), 0) ELSE 0 END) AS target_floor,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.riskRejectReasons.belowMinRiskAtr') AS INTEGER), 0) ELSE 0 END) AS below_min_risk,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.riskRejectReasons.aboveMaxStopAtr') AS INTEGER), 0) ELSE 0 END) AS above_max_stop,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.riskRejectReasons.nonPositiveRisk') AS INTEGER), 0) ELSE 0 END) AS non_positive_risk,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.INVALID') AS INTEGER), 0) ELSE 0 END) AS invalid,
          SUM(CASE WHEN json_valid(diagnostics_json) THEN COALESCE(CAST(json_extract(diagnostics_json, '$.replay.EXPIRED') AS INTEGER), 0) ELSE 0 END) AS expired
        FROM slk_scan_log WHERE ts >= ? AND diagnostics_json IS NOT NULL
      `).bind(iso(sinceMs)).first();
      if (!row || Number(row.scans ?? 0) === 0) return null;
      return {
        scans: Number(row.scans ?? 0),
        setupsEvaluated: Number(row.setups_evaluated ?? 0),
        sweep: Number(row.sweep ?? 0),
        shift: Number(row.shift ?? 0),
        retest: Number(row.retest ?? 0),
        confirmed: Number(row.confirmed ?? 0),
        rejectionCounts: {
          targetFloor: Number(row.target_floor ?? 0),
          belowMinRiskAtr: Number(row.below_min_risk ?? 0),
          aboveMaxStopAtr: Number(row.above_max_stop ?? 0),
          nonPositiveRisk: Number(row.non_positive_risk ?? 0),
          invalid: Number(row.invalid ?? 0),
          expired: Number(row.expired ?? 0),
        },
      };
    } catch (err) {
      // Never make weekly research recaps depend on a diagnostics migration.
      if (String(err).toLowerCase().includes("diagnostics_json")) markScanDiagnosticsColumn(this.db, false);
      console.warn(JSON.stringify({ level: "warn", msg: "scanDiagnosticsSince unavailable", error: String(err) }));
      return null;
    }
  }

  async insertShadowTrade(r: ShadowTradeCapture): Promise<boolean> {
    if (!await hasShadowTable(this.db)) return false;
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO slk_shadow_trades (
        setup_id, canonical_symbol, entry_timeframe, direction,
        hypothetical_entry, hypothetical_stop_loss, hypothetical_tp1, hypothetical_rr,
        reject_reason, created_utc, candle_close_time, status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'OPEN')
    `).bind(
      r.setupId, r.pair, r.entryTf, r.direction, r.entry, r.stopLoss, r.tp1, r.rr,
      r.rejectReason, new Date().toISOString(), iso(r.candleCloseTime),
    ).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async openShadowTrades(pair?: string, tf?: string): Promise<ShadowTradeRow[]> {
    if (!await hasShadowTable(this.db)) return [];
    const where: string[] = ["status='OPEN'"];
    const binds: unknown[] = [];
    if (pair) { where.push("canonical_symbol=?"); binds.push(pair); }
    if (tf) { where.push("entry_timeframe=?"); binds.push(tf); }
    const result = await this.db.prepare(
      `SELECT * FROM slk_shadow_trades WHERE ${where.join(" AND ")} ORDER BY candle_close_time ASC`,
    ).bind(...binds).all();
    return (result.results ?? []) as ShadowTradeRow[];
  }

  async recordShadowOutcome(setupId: string, outcome: ShadowTradeOutcome): Promise<void> {
    if (!await hasShadowTable(this.db)) return;
    await this.db.prepare(`
      UPDATE slk_shadow_trades SET status=?, exit_price=?, exit_time=?, r_multiple=?
      WHERE setup_id=? AND status='OPEN'
    `).bind(outcome.status, outcome.exitPrice, iso(outcome.exitTime), outcome.rMultiple, setupId).run();
  }

  async getShadowLedger(limit = 500): Promise<ShadowLedger> {
    if (!await hasShadowTable(this.db)) return emptyShadowLedger(false);
    const maxRows = Math.max(1, Math.min(5000, Math.floor(limit)));
    const [rowResult, aggregateResult] = await Promise.all([
      this.db.prepare("SELECT * FROM slk_shadow_trades ORDER BY created_utc DESC, setup_id ASC LIMIT ?").bind(maxRows).all(),
      this.db.prepare(`
        SELECT reject_reason,
          COUNT(*) AS count,
          SUM(CASE WHEN status <> 'OPEN' THEN 1 ELSE 0 END) AS resolved,
          SUM(CASE WHEN status <> 'OPEN' AND r_multiple > 0 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN status <> 'OPEN' AND r_multiple < 0 THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN status <> 'OPEN' THEN COALESCE(r_multiple, 0) ELSE 0 END) AS net_r
        FROM slk_shadow_trades GROUP BY reject_reason
      `).bind().all(),
    ]);
    const aggregate = emptyShadowLedger(true).aggregate;
    for (const raw of aggregateResult.results ?? []) {
      const reason = String(raw.reject_reason) as ShadowRejectReason;
      if (!(reason in aggregate)) continue;
      const resolved = Number(raw.resolved ?? 0);
      const wins = Number(raw.wins ?? 0);
      aggregate[reason] = {
        count: Number(raw.count ?? 0), resolved, wins,
        losses: Number(raw.losses ?? 0), netR: Math.round(Number(raw.net_r ?? 0) * 10000) / 10000,
        winRate: resolved ? Math.round((wins / resolved) * 10000) / 100 : null,
      };
    }
    return { available: true, rows: (rowResult.results ?? []) as ShadowTradeRow[], aggregate };
  }

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    try {
      const row = await this.db.prepare("SELECT * FROM notification_preferences WHERE preference_id=1").bind().first();
      if (!row) {
        const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, updatedUtc: new Date().toISOString() };
        try { await this.saveNotificationPreferences(prefs, "default"); } catch {}
        return prefs;
      }
      return { primaryConfirmed: true, telegramWatch: Boolean(row.telegram_watch), discordWatch: Boolean(row.discord_watch), operationalEnabled: Boolean(row.operational_enabled), cooldownMinutes: Number(row.cooldown_minutes), updatedUtc: String(row.updated_utc) };
    } catch {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES, updatedUtc: new Date().toISOString() };
    }
  }

  async saveNotificationPreferences(prefs: NotificationPreferences, source: string): Promise<void> {
    const previous = await this.db.prepare("SELECT * FROM notification_preferences WHERE preference_id=1").bind().first();
    const now = prefs.updatedUtc || new Date().toISOString();
    await this.db.prepare(`INSERT INTO notification_preferences (preference_id,telegram_watch,discord_watch,operational_enabled,cooldown_minutes,updated_utc) VALUES (1,?,?,?,?,?) ON CONFLICT(preference_id) DO UPDATE SET telegram_watch=excluded.telegram_watch,discord_watch=excluded.discord_watch,operational_enabled=excluded.operational_enabled,cooldown_minutes=excluded.cooldown_minutes,updated_utc=excluded.updated_utc`).bind(prefs.telegramWatch ? 1 : 0, prefs.discordWatch ? 1 : 0, prefs.operationalEnabled ? 1 : 0, prefs.cooldownMinutes, now).run();
    await this.db.prepare("INSERT INTO notification_preference_audit (previous_value,new_value,source,changed_utc) VALUES (?,?,?,?)").bind(JSON.stringify(previous ?? DEFAULT_NOTIFICATION_PREFERENCES), JSON.stringify(prefs), source, now).run();
  }

  async insertNotificationDeliveryAudit(row: { channel: string; kind: string; status: string; detail?: string }): Promise<void> {
    await this.db.prepare("INSERT INTO notification_delivery_audit (channel,kind,status,detail,created_utc) VALUES (?,?,?,?,?)").bind(row.channel, row.kind, row.status, row.detail ?? null, new Date().toISOString()).run();
  }

  async queryAlerts(q: AlertQuery): Promise<AlertQueryResult> {
    const where: string[] = []; const binds: unknown[] = [];
    const add = (sql: string, value: unknown) => { where.push(sql); binds.push(value); };
    if (q.pair) add("canonical_symbol = ?", q.pair); if (q.timeframe) add("entry_timeframe = ?", q.timeframe); if (q.direction) add("direction = ?", q.direction); if (q.channel === "WATCH") where.push("1 = 0"); if (q.channel === "CONFIRMED") where.push("alert_status IN ('PAPER','SENT')"); if (q.lifecycle) add("status = ?", q.lifecycle); if (q.outcome) add("status = ?", q.outcome); if (q.provider) add("provider = ?", q.provider); if (q.from) add("candle_close_time >= ?", q.from); if (q.to) add("candle_close_time <= ?", q.to); if (q.search) { where.push("(setup_id LIKE ? OR canonical_symbol LIKE ?)"); binds.push(`%${q.search}%`, `%${q.search}%`); }
    if (q.segment === "synthetics") {
      where.push("(canonical_symbol LIKE 'V%' OR canonical_symbol LIKE 'R_%')");
    } else if (q.segment === "institutional") {
      where.push("(canonical_symbol NOT LIKE 'V%' AND canonical_symbol NOT LIKE 'R_%')");
    }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const sortMap: Record<string,string> = { candleCloseTime: "candle_close_time", pair: "canonical_symbol", timeframe: "entry_timeframe", direction: "direction", status: "status", provider: "provider" };
    const order = q.order === "asc" ? "ASC" : "DESC"; const sort = sortMap[q.sort ?? "candleCloseTime"] ?? "candle_close_time";
    const offset = (q.page - 1) * q.pageSize;
    const count = await this.db.prepare(`SELECT COUNT(*) AS total FROM slk_alerts${clause}`).bind(...binds).first();
    const rows = await this.db.prepare(`SELECT * FROM slk_alerts${clause} ORDER BY ${sort} ${order}, id DESC LIMIT ? OFFSET ?`).bind(...binds, q.pageSize, offset).all();
    return { rows: rows.results as AlertRow[], total: Number((count as Record<string,unknown> | null)?.total ?? 0) };
  }

  async recentAlerts(limit: number): Promise<AlertRow[]> {
    const res = await this.db
      .prepare("SELECT * FROM slk_alerts ORDER BY id DESC LIMIT ?")
      .bind(limit)
      .all();
    return res.results as AlertRow[];
  }

  async recentEvents(limit: number): Promise<Record<string, unknown>[]> {
    const res = await this.db
      .prepare("SELECT * FROM slk_events ORDER BY id DESC LIMIT ?")
      .bind(limit)
      .all();
    return res.results;
  }

  async eventsSince(cursorId: number, limit: number): Promise<Record<string, unknown>[]> {
    const res = await this.db
      .prepare("SELECT * FROM slk_events WHERE id > ? ORDER BY id ASC LIMIT ?")
      .bind(cursorId, limit)
      .all();
    return res.results;
  }

  async recentScanLogs(limit: number): Promise<Record<string, unknown>[]> {
    const res = await this.db
      .prepare("SELECT id, ts, timeframes, pairs, alerts, events, errors, duration_ms, note FROM slk_scan_log ORDER BY ts DESC, id DESC LIMIT ?")
      .bind(limit)
      .all();
    return res.results;
  }

  async expireOpenAlerts(): Promise<number> {
    const res = await this.db
      .prepare("UPDATE slk_alerts SET status='EXPIRED', r_multiple=0, exit_time=? WHERE status='OPEN'")
      .bind(new Date().toISOString())
      .run();
    return Number(res.meta?.changes ?? 0);
  }

  async resetAllAlerts(): Promise<void> {
    await this.db.prepare("DELETE FROM slk_alerts").bind().run();
    await this.db.prepare("DELETE FROM slk_events").bind().run();
    await this.db.prepare("DELETE FROM slk_scan_log").bind().run();
  }

  async clearSyntheticsAlerts(): Promise<number> {
    const res = await this.db
      .prepare(
        "DELETE FROM slk_alerts WHERE canonical_symbol LIKE 'V%' OR canonical_symbol LIKE 'R_%' OR canonical_symbol LIKE '1HZ%'"
      )
      .bind()
      .run();
    await this.db
      .prepare(
        "DELETE FROM slk_events WHERE pair LIKE 'V%' OR pair LIKE 'R_%' OR pair LIKE '1HZ%'"
      )
      .bind()
      .run();
    return Number(res.meta?.changes ?? 0);
  }

  async insertWaitlist(entry: WaitlistEntry): Promise<{ ok: boolean; duplicate?: boolean }> {
    const createdUtc = entry.createdUtc || new Date().toISOString();
    const email = entry.email.toLowerCase().trim();
    try {
      const res = await this.db
        .prepare(
          `INSERT OR IGNORE INTO slk_waitlist (email, telegram, segment_interest, created_utc, source)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(email, entry.telegram?.trim() || null, entry.segmentInterest || "all", createdUtc, entry.source || "dashboard")
        .run();
      const duplicate = (res.meta?.changes ?? 0) === 0;
      return { ok: true, duplicate };
    } catch {
      // Fallback: If table is not yet migrated, safely persist to slk_kv so signups are never dropped
      await this.setKv(`waitlist:${email}`, JSON.stringify({ ...entry, email, createdUtc }));
      return { ok: true, duplicate: false };
    }
  }

  async getWaitlistCount(): Promise<number> {
    try {
      const row = await this.db.prepare("SELECT count(*) as c FROM slk_waitlist").bind().first();
      return Number(row?.c ?? 0);
    } catch {
      return 0;
    }
  }

  async listWaitlist(limit = 100): Promise<WaitlistRow[]> {
    try {
      const res = await this.db
        .prepare("SELECT email, telegram, segment_interest, created_utc, source FROM slk_waitlist ORDER BY created_utc DESC LIMIT ?")
        .bind(limit)
        .all();
      return (res.results ?? []) as WaitlistRow[];
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------- in-memory impl

export class MemStore implements Store {
  alerts = new Map<string, AlertRow>();
  events: Record<string, unknown>[] = [];
  kv = new Map<string, string>();
  scanLog: ScanLogRow[] = [];
  shadowTrades = new Map<string, ShadowTradeRow>();
  private eventKeys = new Set<string>();
  private eventSeq = 0;
  preferences: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  preferenceAudit: Record<string, unknown>[] = [];
  waitlist = new Map<string, WaitlistEntry>();

  async insertAlert(a: Alert, provider: string): Promise<boolean> {
    if (this.alerts.has(a.setupId)) return false;
    this.alerts.set(a.setupId, {
      setup_id: a.setupId, provider, canonical_symbol: a.pair,
      map_timeframe: a.mapTf, entry_timeframe: a.entryTf,
      candle_close_time: iso(a.candleCloseTime), direction: a.direction,
      environment: a.environment, phase: a.phase, htf_alignment: a.htfAlignment,
      origin_key_level: a.originKeyLevel, key_level_type: a.keyLevelType,
      entry: a.entry, stop_loss: a.stopLoss, tp_internal: a.tpInternal,
      tp_external: a.tpExternal, invalidation_level: a.invalidationLevel,
      alert_status: a.alertStatus, status: "OPEN",
    });
    return true;
  }

  async updateAlertStatus(setupId: string, status: string, reason?: string): Promise<void> {
    const row = this.alerts.get(setupId);
    if (row) {
      row.alert_status = status;
      row.suppress_reason = reason ?? null;
    }
  }

  async insertEvent(ev: EngineEvent): Promise<boolean> {
    const key = `${ev.setupId}|${ev.state}|${iso(ev.candleTime)}`;
    if (this.eventKeys.has(key)) return false;
    this.eventKeys.add(key);
    this.eventSeq += 1;
    this.events.push({ id: this.eventSeq, setup_id: ev.setupId, pair: ev.pair, state: ev.state, candle_time: iso(ev.candleTime), reason: ev.reason, price: ev.price, created_utc: new Date().toISOString() });
    return true;
  }

  async eventsSince(cursorId: number, limit: number): Promise<Record<string, unknown>[]> {
    return this.events.filter((e) => Number(e.id ?? 0) > cursorId).slice(0, limit);
  }

  async openAlerts(pair?: string, tf?: string): Promise<AlertRow[]> {
    return [...this.alerts.values()].filter(
      (r) => r.status === "OPEN"
        && (!pair || r.canonical_symbol === pair)
        && (!tf || r.entry_timeframe === tf),
    );
  }

  async lastAlertTime(pair: string, direction: string, excludeSetupId?: string): Promise<number | null> {
    const rows = [...this.alerts.values()]
      .filter((r) => r.canonical_symbol === pair && r.direction === direction
        && (r.alert_status === "PAPER" || r.alert_status === "SENT")
        && r.setup_id !== excludeSetupId)
      .map((r) => Date.parse(r.candle_close_time as string));
    return rows.length ? Math.max(...rows) : null;
  }

  async recordOutcome(setupId: string, oc: Outcome): Promise<void> {
    const row = this.alerts.get(setupId);
    if (row && row.status === "OPEN") {
      row.status = oc.status;
      row.exit_price = oc.exitPrice;
      row.exit_time = iso(oc.exitTime);
      row.r_multiple = oc.rMultiple;
    }
  }

  async getKv(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async setKv(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }

  async insertScanLog(row: ScanLogRow): Promise<void> {
    this.scanLog.push(row);
  }

  async scanLogsSince(sinceMs: number, limit = 1000): Promise<ScanLogRow[]> {
    return this.scanLog
      .filter((row) => Date.parse(row.ts) >= sinceMs)
      .slice()
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      .slice(-Math.max(1, Math.min(10_000, Math.floor(limit))));
  }

  async scanDiagnosticsSince(sinceMs: number): Promise<EngineDisciplineTotals | null> {
    return summarizeScanLogs(this.scanLog.filter((row) => Date.parse(row.ts) >= sinceMs));
  }

  async insertShadowTrade(row: ShadowTradeCapture): Promise<boolean> {
    if (this.shadowTrades.has(row.setupId)) return false;
    this.shadowTrades.set(row.setupId, {
      setup_id: row.setupId,
      canonical_symbol: row.pair,
      entry_timeframe: row.entryTf,
      direction: row.direction,
      hypothetical_entry: row.entry,
      hypothetical_stop_loss: row.stopLoss,
      hypothetical_tp1: row.tp1,
      hypothetical_rr: row.rr,
      reject_reason: row.rejectReason,
      created_utc: new Date().toISOString(),
      candle_close_time: iso(row.candleCloseTime),
      status: "OPEN",
      exit_time: null,
      exit_price: null,
      r_multiple: null,
    });
    return true;
  }

  async openShadowTrades(pair?: string, tf?: string): Promise<ShadowTradeRow[]> {
    return [...this.shadowTrades.values()].filter((row) =>
      row.status === "OPEN"
      && (!pair || row.canonical_symbol === pair)
      && (!tf || row.entry_timeframe === tf),
    );
  }

  async recordShadowOutcome(setupId: string, outcome: ShadowTradeOutcome): Promise<void> {
    const row = this.shadowTrades.get(setupId);
    if (!row || row.status !== "OPEN") return;
    row.status = outcome.status;
    row.exit_price = outcome.exitPrice;
    row.exit_time = iso(outcome.exitTime);
    row.r_multiple = outcome.rMultiple;
  }

  async getShadowLedger(limit = 500): Promise<ShadowLedger> {
    const allRows = [...this.shadowTrades.values()];
    const rows = allRows
      .slice()
      .sort((a, b) => Date.parse(b.created_utc) - Date.parse(a.created_utc))
      .slice(0, Math.max(1, Math.min(5000, Math.floor(limit))));
    return { available: true, rows, aggregate: aggregateShadowRows(allRows) };
  }

  async getNotificationPreferences(): Promise<NotificationPreferences> { return { ...this.preferences }; }

  async saveNotificationPreferences(prefs: NotificationPreferences, source: string): Promise<void> {
    const previous = { ...this.preferences };
    this.preferences = { ...prefs, primaryConfirmed: true, updatedUtc: prefs.updatedUtc || new Date().toISOString() };
    this.preferenceAudit.push({ previous, newValue: this.preferences, source, changedUtc: this.preferences.updatedUtc });
  }

  async insertNotificationDeliveryAudit(row: { channel: string; kind: string; status: string; detail?: string }): Promise<void> { this.preferenceAudit.push({ delivery: row, createdUtc: new Date().toISOString() }); }

  async queryAlerts(q: AlertQuery): Promise<AlertQueryResult> {
    let rows = [...this.alerts.values()]; const match = (v: unknown, x?: string) => !x || String(v).toUpperCase() === x.toUpperCase();
    rows = rows.filter(r => {
      if (q.segment === "synthetics" && !isDerivPair(r.canonical_symbol)) return false;
      if (q.segment === "institutional" && isDerivPair(r.canonical_symbol)) return false;
      return match(r.canonical_symbol,q.pair) && match(r.entry_timeframe,q.timeframe) && match(r.direction,q.direction) && (q.channel !== "WATCH") && match(r.status,q.lifecycle||q.outcome) && match(r.provider,q.provider) && (!q.search || `${r.setup_id} ${r.canonical_symbol}`.toLowerCase().includes(q.search.toLowerCase())) && (!q.from || String(r.candle_close_time) >= q.from) && (!q.to || String(r.candle_close_time) <= q.to);
    });
    const total=rows.length; rows=rows.slice((q.page-1)*q.pageSize,q.page*q.pageSize); return { rows, total };
  }

  async recentAlerts(limit: number): Promise<AlertRow[]> {
    return [...this.alerts.values()].slice(-limit).reverse();
  }

  async recentEvents(limit: number): Promise<Record<string, unknown>[]> {
    return this.events.slice(-limit).reverse();
  }

  async recentScanLogs(limit: number): Promise<Record<string, unknown>[]> {
    return this.scanLog.slice(-limit).reverse() as unknown as Record<string, unknown>[];
  }

  async expireOpenAlerts(): Promise<number> {
    let count = 0;
    const nowIso = new Date().toISOString();
    for (const row of this.alerts.values()) {
      if (row.status === "OPEN") {
        row.status = "EXPIRED";
        row.r_multiple = 0;
        row.exit_time = nowIso;
        count++;
      }
    }
    return count;
  }

  async resetAllAlerts(): Promise<void> {
    this.alerts.clear();
    this.events = [];
    this.eventKeys.clear();
    this.scanLog = [];
  }

  async clearSyntheticsAlerts(): Promise<number> {
    let count = 0;
    for (const [id, row] of this.alerts.entries()) {
      if (isDerivPair(row.canonical_symbol)) {
        this.alerts.delete(id);
        count++;
      }
    }
    this.events = this.events.filter((e) => !isDerivPair(String(e.pair ?? "")));
    return count;
  }

  async insertWaitlist(entry: WaitlistEntry): Promise<{ ok: boolean; duplicate?: boolean }> {
    const email = entry.email.toLowerCase().trim();
    const duplicate = this.waitlist.has(email);
    this.waitlist.set(email, {
      ...entry,
      email,
      createdUtc: entry.createdUtc || new Date().toISOString(),
    });
    return { ok: true, duplicate };
  }

  async getWaitlistCount(): Promise<number> {
    return this.waitlist.size;
  }

  async listWaitlist(limit = 100): Promise<WaitlistRow[]> {
    return Array.from(this.waitlist.values())
      .slice(0, limit)
      .map((e) => ({
        email: e.email,
        telegram: e.telegram ?? null,
        segment_interest: e.segmentInterest ?? null,
        created_utc: e.createdUtc || new Date().toISOString(),
        source: e.source ?? null,
      }));
  }
}

let defaultMemStore: Store | null = null;

export function resetDefaultMemStore(): void {
  defaultMemStore = null;
}

export function makeStore(db: D1Like | undefined): Store {
  if (!db) {
    if (!defaultMemStore) defaultMemStore = new MemStore();
    return defaultMemStore;
  }
  return new D1Store(db);
}
