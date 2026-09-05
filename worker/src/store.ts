/** Persistence layer. A tiny structural interface (`Store`) with two
 *  implementations: D1 (SQLite on Cloudflare) and an in-memory store used by
 *  tests. Dedupe semantics live in the schema: slk_alerts has a UNIQUE
 *  setup_id, slk_events a UNIQUE (setup_id, state, candle_time) — so Worker
 *  retries and rescans can never double-deliver. */
import type { Alert, EngineEvent, Outcome } from "./types";

// A subset of the D1Database API — the real env.DB satisfies this.
export interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta: { changes: number } }>;
      first(): Promise<Record<string, unknown> | null>;
      all(): Promise<{ results: Record<string, unknown>[] }>;
    };
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
  recentAlerts(limit: number): Promise<AlertRow[]>;
  recentEvents(limit: number): Promise<Record<string, unknown>[]>;
}

export interface ScanLogRow {
  ts: string;
  timeframes: string;
  pairs: string;
  alerts: number;
  events: number;
  errors: string;
  durationMs: number;
  note: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
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
    await this.db
      .prepare(
        `INSERT INTO slk_scan_log (ts, timeframes, pairs, alerts, events, errors, duration_ms, note)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(r.ts, r.timeframes, r.pairs, r.alerts, r.events, r.errors, r.durationMs, r.note)
      .run();
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
}

// ---------------------------------------------------------- in-memory impl

export class MemStore implements Store {
  alerts = new Map<string, AlertRow>();
  events: Record<string, unknown>[] = [];
  kv = new Map<string, string>();
  scanLog: ScanLogRow[] = [];
  private eventKeys = new Set<string>();

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
    this.events.push({ setup_id: ev.setupId, pair: ev.pair, state: ev.state, candle_time: iso(ev.candleTime), reason: ev.reason, price: ev.price });
    return true;
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

  async recentAlerts(limit: number): Promise<AlertRow[]> {
    return [...this.alerts.values()].slice(-limit).reverse();
  }

  async recentEvents(limit: number): Promise<Record<string, unknown>[]> {
    return this.events.slice(-limit).reverse();
  }
}

export function makeStore(db: D1Like | undefined): Store {
  if (!db) return new MemStore();
  return new D1Store(db);
}
