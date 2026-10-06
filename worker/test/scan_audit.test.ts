import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { emptyScanDiagnostics } from "../src/diagnostics";
import { D1Store, makeStore, MemStore, resetDefaultMemStore, type D1Like } from "../src/store";

const request = (path: string, authorization?: string) => new Request(`https://w.test${path}`, {
  headers: authorization ? { authorization } : undefined,
});

function diagnostics() {
  const value = emptyScanDiagnostics();
  value.replay.MAP = 2;
  value.replay.TOUCH = 1;
  value.replay.SWEEP = 1;
  value.replay.SHIFT = 1;
  value.replay.retestCandidates = 1;
  value.replay.RETEST = 1;
  value.replay.targetRejects = 1;
  value.replay.riskRejects = 1;
  value.replay.riskRejectReasons.belowMinRiskAtr = 1;
  value.replay.confirmedAlerts = 1;
  value.recorded.MAP = 1;
  value.recorded.confirmedAlerts = 1;
  value.recorded.staleConfirmationSkips = 2;
  value.recorded.duplicateConfirmationSkips = 1;
  value.byPairTimeframe.push({ pair: "EURUSD", timeframe: "30m", replay: structuredClone(value.replay) });
  return value;
}

describe("private scan audit", () => {
  beforeEach(() => resetDefaultMemStore());

  it("aggregates scan, replay funnel, and channel delivery results without raw details", async () => {
    const store = makeStore(undefined);
    const now = Date.now();
    (store as MemStore).alerts.set("stored-audit-row", {
      setup_id: "stored-audit-row", canonical_symbol: "EURUSD", entry_timeframe: "30m",
      direction: "SHORT", entry: 1.1, stop_loss: 1.2, tp_internal: 0.8, tp_external: 0.7,
      candle_close_time: new Date(now - 60_000).toISOString(), environment: "range",
      phase: "reversal", htf_alignment: "aligned", key_level_type: "V", origin_key_level: 1.1,
      alert_status: "SUPPRESSED", status: "OPEN", suppress_reason: "boot gate",
      created_utc: new Date(now - 60_000).toISOString(),
    });
    await store.insertScanLog({
      ts: new Date(now - 60_000).toISOString(), timeframes: "30m", pairs: "EURUSD",
      alerts: 1, events: 5, errors: "", durationMs: 50, note: "ok", diagnostics: diagnostics(),
    });
    await store.insertScanLog({
      ts: new Date(now - 120_000).toISOString(), timeframes: "30m", pairs: "",
      alerts: 0, events: 0, errors: "GBPUSD: simulated outage", durationMs: 25, note: "partial",
    });
    await store.insertScanLog({
      ts: new Date(now - 24 * 86400_000).toISOString(), timeframes: "30m", pairs: "XAUUSD",
      alerts: 9, events: 9, errors: "", durationMs: 80, note: "old",
    });
    await store.insertNotificationDeliveryAudit({
      channel: "telegram", kind: "confirmed_entry", status: "delivered",
      detail: JSON.stringify({ pair: "EURUSD", timeframe: "30m", setupId: "private-setup" }),
    });
    await store.insertNotificationDeliveryAudit({
      channel: "discord", kind: "confirmed_entry", status: "failed",
      detail: "never returned by the audit endpoint",
    });

    const env = { ADMIN_KEY: "owner-test" } as Env;
    expect((await worker.fetch(request("/api/scan-audit"), env, {} as any)).status).toBe(401);

    const response = await worker.fetch(
      request("/api/scan-audit?days=21", "Bearer owner-test"), env, {} as any,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.window.days).toBe(21);
    expect(body.scan).toMatchObject({
      scanRows: 2, activeScanRows: 1, scanErrorRows: 1,
      errorCategories: { staleFeed: 0, rateLimitOrCredits: 0, networkOrTimeout: 0, other: 1 },
      alertRowsWritten: 1, eventRowsWritten: 5,
      diagnosticsAvailable: true, diagnosticRows: 1, recordedConfirmedAlerts: 1,
      storedAlertsAvailable: true,
    });
    const activeDay = body.scan.byDay.find((row: any) => row.utcDay === new Date(now - 60_000).toISOString().slice(0, 10));
    expect(activeDay).toMatchObject({
      scanRows: 2, activeScanRows: 1, alertRowsWritten: 1, eventRowsWritten: 5,
      diagnosticRows: 1, gateMetricsRows: 1, replayRetestTransitions: 1,
      retestCandidates: 1, targetRejects: 1, riskRejects: 1,
      recordedConfirmedAlerts: 1, staleConfirmationSkips: 2, duplicateConfirmationSkips: 1,
    });
    expect(body.scan.storedAlertsByDay).toContainEqual(expect.objectContaining({
      utcDay: new Date(now - 60_000).toISOString().slice(0, 10),
      pair: "EURUSD", timeframe: "30m", direction: "SHORT",
      alertStatus: "SUPPRESSED", tradeStatus: "OPEN", suppressReason: "boot gate", count: 1,
    }));
    expect(body.scan.byDay.length).toBeGreaterThan(1); // includes zero-scan UTC days
    expect(body.scan.byPairTimeframe[0]).toMatchObject({
      pair: "EURUSD", timeframe: "30m", scanRows: 1,
      replay: { MAP: 2, TOUCH: 1, SWEEP: 1, SHIFT: 1, RETEST: 1, targetRejects: 1 },
    });
    expect(body.delivery).toMatchObject({
      available: true, totalResults: 2,
      byChannel: [
        { channel: "discord", kind: "confirmed_entry", failed: 1, delivered: 0 },
        { channel: "telegram", kind: "confirmed_entry", delivered: 1, failed: 0 },
      ],
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("private-setup");
    expect(serialized).not.toContain("never returned");
    expect(body.caveats).toContain("Scan error categories are keyword-based row counts, not confirmed root causes or unique incidents.");
    expect(body.caveats).toContain("Stale-confirmation and duplicate-insert counters start with this release; older rows have no coverage, not zero skips.");
    expect(body.caveats).toContain("Delivery audit writes are best-effort; a missing result does not prove a message was not sent.");
    expect(body.caveats).toContain("Delivery API-result tracking starts with this release; older delivery outcomes cannot be reconstructed.");
  });

  it("rejects invalid windows and does not turn the private audit into a public API", async () => {
    const env = { ADMIN_KEY: "owner-test" } as Env;
    const invalid = await worker.fetch(
      request("/api/scan-audit?days=32", "Bearer owner-test"), env, {} as any,
    );
    expect(invalid.status).toBe(400);
    expect((await worker.fetch(request("/api/scan-audit?days=21"), env, {} as any)).status).toBe(401);
  });

  it("maps D1 daily scan counters and stored-alert status groups", async () => {
    const dailyRow = {
      utc_day: "2026-10-01", scan_rows: 2, active_scan_rows: 2, scan_error_rows: 1,
      stale_feed_errors: 0, rate_limit_errors: 0, network_timeout_errors: 1, other_errors: 0,
      alert_rows_written: 1, event_rows_written: 5,
      first_scan_utc: "2026-10-01T00:00:00.000Z", last_scan_utc: "2026-10-01T00:01:00.000Z",
      diagnostic_rows: 2, invalid_diagnostic_rows: 0, gate_metrics_rows: 2,
      recorded_confirmed_alerts: 1, replay_retest_transitions: 3, retest_candidates: 2,
      target_rejects: 1, risk_rejects: 1, stale_confirmation_skips: 1,
      duplicate_confirmation_skips: 1,
    };
    const db = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          run: async () => ({ meta: { changes: 0 } }),
          first: async () => {
            if (sql.includes("COUNT(*) AS scan_rows")) return {
              scan_rows: 2, active_scan_rows: 2, scan_error_rows: 1,
              stale_feed_errors: 0, rate_limit_errors: 0, network_timeout_errors: 1, other_errors: 0,
              alert_rows_written: 1, event_rows_written: 5,
              first_scan_utc: "2026-10-01T00:00:00.000Z", last_scan_utc: "2026-10-01T00:01:00.000Z",
            };
            if (sql.includes("SUM(CASE WHEN json_valid(diagnostics_json)")) return {
              diagnostic_rows: 2, invalid_diagnostic_rows: 0, recorded_confirmed_alerts: 1,
            };
            return null;
          },
          all: async () => {
            if (sql.includes("SELECT diagnostics_json FROM slk_scan_log LIMIT 0")) return { results: [] };
            if (sql.includes("GROUP BY substr(ts, 1, 10)")) return { results: [dailyRow] };
            if (sql.includes("FROM slk_alerts")) return { results: [{
              utc_day: "2026-10-01", pair: "EURUSD", timeframe: "30m", direction: "SHORT",
              alert_status: "SUPPRESSED", trade_status: "OPEN", suppress_reason: "boot gate", row_count: 1,
            }] };
            if (sql.includes("JOIN json_each")) return { results: [{
              pair: "EURUSD", timeframe: "30m", scan_rows: 2,
              map_count: 2, touch_count: 1, sweep_count: 1, shift_count: 1, retest_count: 1,
              invalid_count: 0, expired_count: 0, retest_candidates: 2, risk_rejects: 1,
              non_positive_risk: 0, below_min_risk_atr: 1, above_max_stop_atr: 0,
              target_rejects: 1, confirmed_alerts: 1,
            }] };
            return { results: [] };
          },
        }),
      }),
    } as unknown as D1Like;
    const scan = await new D1Store(db).scanAuditBetween(
      "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z",
    );
    expect(scan.diagnosticsAvailable).toBe(true);
    expect(scan.byDay[0]).toMatchObject({
      utcDay: "2026-10-01", scanRows: 2, diagnosticRows: 2,
      gateMetricsRows: 2, replayRetestTransitions: 3, recordedConfirmedAlerts: 1,
      staleConfirmationSkips: 1, duplicateConfirmationSkips: 1,
    });
    expect(scan.byDay[1]).toMatchObject({ utcDay: "2026-10-02", scanRows: 0 });
    expect(scan.storedAlertsAvailable).toBe(true);
    expect(scan.storedAlertsByDay).toContainEqual(expect.objectContaining({
      utcDay: "2026-10-01", pair: "EURUSD", timeframe: "30m",
      alertStatus: "SUPPRESSED", tradeStatus: "OPEN", suppressReason: "boot gate", count: 1,
    }));
  });

  it("keeps aggregate scan counts available when diagnostics and delivery tables are absent", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          run: async () => ({ meta: { changes: 0 } }),
          first: async () => {
            if (sql.includes("COUNT(*) AS scan_rows")) return {
              scan_rows: 3, active_scan_rows: 2, scan_error_rows: 1,
              stale_feed_errors: 0, rate_limit_errors: 0, network_timeout_errors: 1, other_errors: 0,
              alert_rows_written: 0, event_rows_written: 4,
              first_scan_utc: "2026-10-01T00:00:00.000Z", last_scan_utc: "2026-10-02T00:00:00.000Z",
            };
            if (sql.includes("notification_delivery_audit")) throw new Error("no such table: notification_delivery_audit");
            return null;
          },
          all: async () => {
            if (sql.includes("diagnostics_json")) throw new Error("no such column: diagnostics_json");
            if (sql.includes("notification_delivery_audit")) throw new Error("no such table: notification_delivery_audit");
            return { results: [] };
          },
        }),
      }),
    } as unknown as D1Like;
    const store = new D1Store(db);
    const scan = await store.scanAuditBetween("2026-10-01T00:00:00.000Z", "2026-10-03T00:00:00.000Z");
    const delivery = await store.deliveryAuditBetween("2026-10-01T00:00:00.000Z", "2026-10-03T00:00:00.000Z");
    expect(scan).toMatchObject({
      scanRows: 3, activeScanRows: 2, scanErrorRows: 1,
      errorCategories: { staleFeed: 0, rateLimitOrCredits: 0, networkOrTimeout: 1, other: 0 },
      diagnosticsAvailable: false, diagnosticRows: 0, byPairTimeframe: [],
    });
    expect(delivery).toMatchObject({ available: false, totalResults: 0, byChannel: [] });
  });
});
