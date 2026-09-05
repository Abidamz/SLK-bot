/** Store semantics: dedupe, idempotent events, cooldown source, outcomes. */
import { describe, expect, it } from "vitest";
import { MemStore } from "../src/store";
import type { Alert } from "../src/types";
import { BASE } from "./fixtures";

function mkAlert(setupId = "td:EURUSD:30m:SHORT:A:105.00000000:x"): Alert {
  return {
    setupId, pair: "EURUSD", entryTf: "30m", mapTf: "4h", direction: "SHORT",
    entry: 104.9, stopLoss: 105.15, tpInternal: 104.0, tpExternal: 101.0,
    candleCloseTime: BASE, environment: "bearish", phase: "pullback",
    htfAlignment: "M:? W:↓ D:↓ H4:↓", originKeyLevel: 105.0, keyLevelType: "A",
    keyLevelBounds: [104.95, 105.05], keyLevelTested: true, keyLevelFlipped: false,
    imbalanceContext: [], internalLiquidity: [], externalLiquidity: [],
    drawOnLiquidity: 101.0, nearestExternalTarget: 101.0, intermediateZones: [],
    opposingLiquidityStanding: true, sweepTime: BASE, bosTime: BASE, returnTime: BASE,
    invalidationLevel: 105.1, invalidationReason: null, parameterVersion: "slk-w1.0",
    alertStatus: "PAPER", suppressReason: null, session: null, atrEntry: 0.4,
    rrInternal: 3.7, cycleStage: "entry_alert", entryMode: "confirmation",
  };
}

describe("MemStore", () => {
  it("dedupes alerts by setup_id", async () => {
    const s = new MemStore();
    expect(await s.insertAlert(mkAlert(), "td")).toBe(true);
    expect(await s.insertAlert(mkAlert(), "td")).toBe(false);
    const open = await s.openAlerts("EURUSD", "30m");
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("OPEN");
  });

  it("logs events idempotently", async () => {
    const s = new MemStore();
    const ev = { setupId: "x", pair: "EURUSD", state: "MAP", candleTime: BASE, reason: "armed", price: 105 };
    expect(await s.insertEvent(ev)).toBe(true);
    expect(await s.insertEvent(ev)).toBe(false);
    expect(await s.recentEvents(10)).toHaveLength(1);
  });

  it("cooldown reads only delivered alerts, not the just-inserted row or suppressed ones", async () => {
    const s = new MemStore();
    await s.insertAlert(mkAlert("a1"), "td");
    const suppressed = mkAlert("a2");
    suppressed.alertStatus = "SUPPRESSED";
    await s.insertAlert(suppressed, "td");
    expect(await s.lastAlertTime("EURUSD", "SHORT", "fresh3")).toBe(BASE);
    expect(await s.lastAlertTime("EURUSD", "SHORT", "a1")).toBeNull();
    expect(await s.lastAlertTime("EURUSD", "LONG")).toBeNull();
  });

  it("records outcomes", async () => {
    const s = new MemStore();
    await s.insertAlert(mkAlert("a1"), "td");
    await s.recordOutcome("a1", { status: "TP_HIT", exitPrice: 104.0, exitTime: BASE + 3600_000, rMultiple: 3.7 });
    const open = await s.openAlerts();
    expect(open).toHaveLength(0);
    const rows = await s.recentAlerts(10);
    expect(rows[0].status).toBe("TP_HIT");
  });

  it("kv roundtrip + scan log", async () => {
    const s = new MemStore();
    await s.setKv("last_boundary:30m", "123");
    expect(await s.getKv("last_boundary:30m")).toBe("123");
    await s.insertScanLog({ ts: "x", timeframes: "30m", pairs: "EURUSD", alerts: 1, events: 5, errors: "", durationMs: 42, note: "ok" });
    expect(s.scanLog).toHaveLength(1);
  });
});
