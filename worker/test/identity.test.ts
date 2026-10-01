/**
 * Setup identity stability (Task 3):
 *  1. Sub-tick price jitter → identical setup IDs (tick-rounded identity).
 *  2. Provider failover → identical setup ID (provider is a column, not identity).
 *  3. Different levels (price / origin time / kind) → different IDs.
 *  4. A legacy provider-prefixed alert row blocks a new-format duplicate
 *     (store-level migration guard), in both MemStore and D1Store.
 */
import { describe, expect, it } from "vitest";
import { buildSetupId } from "../src/engine";
import { identityTick, roundToTick } from "../src/config";
import { D1Store, MemStore, originTimeFromSetupId } from "../src/store";
import type { Alert } from "../src/types";

const ORIGIN_MS = Date.parse("2026-03-02T10:30:00.000Z");

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    setupId: "placeholder",
    pair: "EURUSD",
    entryTf: "30m",
    mapTf: "1H",
    direction: "SHORT",
    entry: 104.2,
    stopLoss: 104.29,
    tpInternal: 104.02,
    tpExternal: 97.42,
    candleCloseTime: ORIGIN_MS,
    environment: "PAPER",
    phase: "RETEST",
    htfAlignment: "aligned",
    originKeyLevel: 104.2,
    keyLevelType: "V",
    keyLevelBounds: [104.19, 104.21],
    keyLevelTested: true,
    keyLevelFlipped: false,
    imbalanceContext: [],
    internalLiquidity: [],
    externalLiquidity: [],
    drawOnLiquidity: 97.42,
    nearestExternalTarget: 97.42,
    intermediateZones: [],
    opposingLiquidityStanding: false,
    sweepTime: ORIGIN_MS,
    bosTime: ORIGIN_MS,
    returnTime: ORIGIN_MS,
    invalidationLevel: 104.29,
    invalidationReason: null,
    parameterVersion: "v1",
    alertStatus: "PAPER",
    suppressReason: null,
    session: "London",
    atrEntry: 0.05,
    rrInternal: 2.5,
    cycleStage: "RETEST",
    entryMode: "confirmation",
    ...overrides,
  };
}

describe("setup identity stability", () => {
  it("rounds origin prices to instrument ticks (sub-tick jitter is invisible)", () => {
    // Standard FX: 0.5 pip = 0.00005
    expect(identityTick("EURUSD")).toBe(0.00005);
    expect(roundToTick("EURUSD", 1.085241)).toBeCloseTo(1.08525, 8);
    expect(roundToTick("EURUSD", 1.085244)).toBeCloseTo(1.08525, 8);
    // JPY pairs: 0.005
    expect(roundToTick("USDJPY", 148.5551)).toBeCloseTo(148.555, 8);
    expect(roundToTick("USDJPY", 148.5554)).toBeCloseTo(148.555, 8);
    // Metals: 0.05
    expect(roundToTick("XAUUSD", 4305.001)).toBeCloseTo(4305.0, 8);
    expect(roundToTick("XAUUSD", 4305.004)).toBeCloseTo(4305.0, 8);
    // Indices: 1.0
    expect(roundToTick("NAS100", 19500.1)).toBeCloseTo(19500, 6);
    expect(roundToTick("NAS100", 19500.4)).toBeCloseTo(19500, 6);
    // Synthetics: 0.01
    expect(roundToTick("V75", 450320.004)).toBeCloseTo(450320.0, 6);
  });

  it("jittered origin prices produce the identical setup ID", () => {
    const base = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 1.085241, originTime: ORIGIN_MS,
    });
    const jitter = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 1.085244, originTime: ORIGIN_MS,
    });
    expect(base).toBe(jitter);
    expect(base).toContain("1.085250");

    const jpyA = buildSetupId("USDJPY", "30m", "LONG", {
      kind: "L", originPrice: 148.5551, originTime: ORIGIN_MS,
    });
    const jpyB = buildSetupId("USDJPY", "30m", "LONG", {
      kind: "L", originPrice: 148.5554, originTime: ORIGIN_MS,
    });
    expect(jpyA).toBe(jpyB);
    expect(jpyA).toContain("148.555000");

    const goldA = buildSetupId("XAUUSD", "30m", "SHORT", {
      kind: "V", originPrice: 4305.001, originTime: ORIGIN_MS,
    });
    const goldB = buildSetupId("XAUUSD", "30m", "SHORT", {
      kind: "V", originPrice: 4305.004, originTime: ORIGIN_MS,
    });
    expect(goldA).toBe(goldB);
    expect(goldA).toContain("4305.000000");
  });

  it("provider failover never changes the setup ID (MemStore dedupes across providers)", async () => {
    const store = new MemStore();
    const id = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2, originTime: ORIGIN_MS,
    });
    const alert = makeAlert({ setupId: id, originTime: ORIGIN_MS });
    expect(await store.insertAlert(alert, "oanda")).toBe(true);
    // Same logical setup re-minted after a provider failover → duplicate.
    expect(await store.insertAlert(alert, "dukascopy")).toBe(false);
    expect(await store.insertAlert(alert, "twelvedata")).toBe(false);
  });

  it("different levels always produce different setup IDs", () => {
    const base = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2, originTime: ORIGIN_MS,
    });
    const diffPrice = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2 + 8 * 0.0001, originTime: ORIGIN_MS, // 8 pips
    });
    const diffOriginTime = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2, originTime: ORIGIN_MS + 900_000,
    });
    const diffKind = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "A", originPrice: 104.2, originTime: ORIGIN_MS,
    });
    const all = [base, diffPrice, diffOriginTime, diffKind];
    expect(new Set(all).size).toBe(4);
  });

  it("legacy provider-prefixed row blocks a new-format duplicate (MemStore)", async () => {
    const store = new MemStore();
    const originIso = new Date(ORIGIN_MS).toISOString();
    const legacyId = `twelvedata:EURUSD:30m:SHORT:V:104.200001:${originIso}`;
    const legacyAlert = makeAlert({ setupId: legacyId, originTime: ORIGIN_MS });
    expect(await store.insertAlert(legacyAlert, "twelvedata")).toBe(true);

    // New-format ID for the same logical setup (tick-rounded price, no prefix).
    const newId = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2, originTime: ORIGIN_MS,
    });
    expect(newId).not.toContain("twelvedata:");
    const duplicate = makeAlert({ setupId: newId, originTime: ORIGIN_MS });
    expect(await store.insertAlert(duplicate, "dukascopy")).toBe(false);

    // A genuinely different origin time is a different setup → allowed.
    const otherId = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2, originTime: ORIGIN_MS + 3_600_000,
    });
    const other = makeAlert({ setupId: otherId, originTime: ORIGIN_MS + 3_600_000 });
    expect(await store.insertAlert(other, "dukascopy")).toBe(true);
  });

  it("legacy provider-prefixed row blocks a new-format duplicate (D1Store)", async () => {
    const originIso = new Date(ORIGIN_MS).toISOString();
    const legacyId = `twelvedata:EURUSD:30m:SHORT:V:104.200001:${originIso}`;
    let insertCalled = false;
    const fakeDb: any = {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            if (sql.startsWith("INSERT")) {
              return {
                run: async () => { insertCalled = true; return { meta: { changes: 1 } }; },
                first: async () => ({ setup_id: "x" }),
                all: async () => ({ results: [{ setup_id: "x" }] }),
              };
            }
            // Identity-guard SELECT setup_id ...
            return {
              run: async () => ({ meta: { changes: 0 } }),
              first: async () => null,
              all: async () => ({ results: [{ setup_id: legacyId }] }),
            };
          },
        };
      },
    };
    const store = new D1Store(fakeDb);
    const newId = buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2, originTime: ORIGIN_MS,
    });
    const duplicate = makeAlert({ setupId: newId, originTime: ORIGIN_MS });
    expect(await store.insertAlert(duplicate, "dukascopy")).toBe(false);
    expect(insertCalled).toBe(false); // never reached the INSERT
  });

  it("originTimeFromSetupId extracts the trailing ISO from both ID formats", () => {
    const originIso = new Date(ORIGIN_MS).toISOString();
    expect(originTimeFromSetupId(`twelvedata:EURUSD:30m:SHORT:V:104.200001:${originIso}`)).toBe(originIso);
    expect(originTimeFromSetupId(buildSetupId("EURUSD", "30m", "SHORT", {
      kind: "V", originPrice: 104.2, originTime: ORIGIN_MS,
    }))).toBe(originIso);
    expect(originTimeFromSetupId("EURUSD:30m:SHORT:V:104.200000")).toBeNull();
  });
});
