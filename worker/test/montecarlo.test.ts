/** Deterministic coverage for the Monte Carlo stress-test engine
 *  (Roadmap Priority 5) and its public endpoint contract. */
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { makeStore } from "../src/store";
import { mulberry32, percentileSorted, runMonteCarlo } from "../src/montecarlo";
import type { Alert } from "../src/types";

const T0 = Date.parse("2024-03-04T00:00:00.000Z");

describe("monte carlo engine", () => {
  it("mulberry32 is deterministic and bounded to [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seqA).not.toEqual(Array.from({ length: 50 }, () => mulberry32(43)()));
  });

  it("percentileSorted interpolates linearly", () => {
    expect(percentileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(percentileSorted([1, 2, 3, 4], 1)).toBe(4);
    expect(percentileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("same seed + inputs reproduce identical results (auditability)", () => {
    const r = [-1, 3, 2.5, -1, 3, 0, 2, -1, 3, 2.5];
    const one = runMonteCarlo({ rSeries: r, iterations: 200, horizon: 50, riskPct: 1, seed: 7 });
    const two = runMonteCarlo({ rSeries: r, iterations: 200, horizon: 50, riskPct: 1, seed: 7 });
    expect(one).toEqual(two);
    const three = runMonteCarlo({ rSeries: r, iterations: 200, horizon: 50, riskPct: 1, seed: 8 });
    expect(three.bands.p50).not.toEqual(one.bands.p50);
  });

  it("an all-winning series can never lose, draw down, or streak", () => {
    const res = runMonteCarlo({ rSeries: [3, 2.5, 3, 3, 2.5, 3], iterations: 150, horizon: 40, riskPct: 1, seed: 1 });
    expect(res.probNetLoss).toBe(0);
    expect(res.probDd10).toBe(0);
    expect(res.probDd20).toBe(0);
    expect(res.consecLoss.worst).toBe(0);
    expect(res.maxDrawdownPct.worst).toBe(0);
    expect(res.finalGrowth.p5).toBeGreaterThan(1);
    expect(res.histWinRate).toBe(1);
  });

  it("an all-losing series always bleeds and streaks the full horizon", () => {
    const res = runMonteCarlo({ rSeries: [-1, -1, -1, -1, -1], iterations: 100, horizon: 20, riskPct: 1, seed: 2 });
    expect(res.probNetLoss).toBe(1);
    expect(res.consecLoss.worst).toBe(20);
    expect(res.finalGrowth.p95).toBeLessThan(1);
    expect(res.histExpectancyR).toBe(-1);
  });

  it("bands are ordered p5 <= p50 <= p95 at every trade index", () => {
    const res = runMonteCarlo({ rSeries: [-1, 3, 0, 2.5, -1, 3, 2], iterations: 120, horizon: 30, riskPct: 1, seed: 3 });
    expect(res.bands.p5).toHaveLength(31);
    expect(res.bands.p50).toHaveLength(31);
    expect(res.bands.p95).toHaveLength(31);
    for (let i = 0; i <= 30; i++) {
      expect(res.bands.p5[i]).toBeLessThanOrEqual(res.bands.p50[i]);
      expect(res.bands.p50[i]).toBeLessThanOrEqual(res.bands.p95[i]);
    }
    expect(res.bands.p50[0]).toBe(1); // every path starts at starting equity
  });

  it("higher risk per trade widens the drawdown tail", () => {
    const r = [-1, 3, -1, 2.5, 3, -1, 0, 2.5];
    const low = runMonteCarlo({ rSeries: r, iterations: 300, horizon: 80, riskPct: 0.5, seed: 5 });
    const high = runMonteCarlo({ rSeries: r, iterations: 300, horizon: 80, riskPct: 3, seed: 5 });
    expect(high.maxDrawdownPct.p95).toBeGreaterThan(low.maxDrawdownPct.p95);
  });
});

describe("/api/monte-carlo endpoint", () => {
  function closedAlert(setupId: string, exitAt: number): Alert {
    return {
      setupId, pair: "EURUSD", entryTf: "30m", mapTf: "4h", direction: "SHORT",
      entry: 104.9, stopLoss: 105.2, tpInternal: 104.0, tpExternal: null,
      candleCloseTime: exitAt - 3600_000, environment: "bearish", phase: "expansion",
      htfAlignment: "H4:↓", originKeyLevel: 105.0, keyLevelType: "OC",
      keyLevelBounds: [104.95, 105.05], keyLevelTested: true, keyLevelFlipped: false,
      imbalanceContext: [], internalLiquidity: [], externalLiquidity: [],
      drawOnLiquidity: null, nearestExternalTarget: null, intermediateZones: [],
      opposingLiquidityStanding: true, sweepTime: exitAt - 7200_000,
      bosTime: exitAt - 5400_000, returnTime: exitAt - 3600_000,
      invalidationLevel: 105.2, invalidationReason: null, parameterVersion: "1",
      alertStatus: "PAPER", suppressReason: null, session: null, atrEntry: 0.3,
      rrInternal: 3.0, cycleStage: "entry_alert", entryMode: "confirmation",
      shadowClassification: "A_GRADE",
    };
  }

  it("refuses to simulate on insufficient history", async () => {
    // this file's mem store is still empty at this point (tests run in order)
    const resp = await worker.fetch(new Request("https://w.test/api/monte-carlo?seed=1"), {} as Env, {} as any);
    const data = (await resp.json()) as any;
    expect(resp.status).toBe(200);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("INSUFFICIENT_HISTORY");
  });

  it("returns deterministic seeded stats from the verified ledger", async () => {
    const store = makeStore(undefined);
    const rs: [number, string][] = [[3, "TP_HIT"], [-1, "SL_HIT"], [0, "BE_HIT"], [2.5, "TP_HIT"], [3, "TP_HIT"], [-1, "SL_HIT"], [2.5, "TP_HIT"]];
    for (let i = 0; i < rs.length; i++) {
      const [r, status] = rs[i];
      const setupId = `td:EURUSD:30m:SHORT:V:104.2:mc${i}`;
      await store.insertAlert(closedAlert(setupId, T0 + i * 3600_000), "twelvedata");
      await store.recordOutcome(setupId, { status: status as any, exitPrice: 104, exitTime: T0 + i * 3600_000 + 1800_000, rMultiple: r });
    }
    const env = {} as Env;
    const q = "iterations=150&horizon=40&riskPct=1&seed=11";
    const a = await worker.fetch(new Request(`https://w.test/api/monte-carlo?${q}`), env, {} as any);
    const b = await worker.fetch(new Request(`https://w.test/api/monte-carlo?${q}`), env, {} as any);
    const da = (await a.json()) as any;
    const db = (await b.json()) as any;
    expect(a.status).toBe(200);
    expect(da.ok).toBe(true);
    expect(da).toEqual(db); // seeded reproducibility over HTTP
    expect(da.trades).toBe(7);
    expect(da.iterations).toBe(150);
    expect(da.horizon).toBe(40);
    expect(da.bands.p50).toHaveLength(41);
    expect(typeof da.probDd10).toBe("number");
    expect(da.histWinRate).toBeCloseTo(4 / 7, 6);
  });

  it("caps iteration×horizon work to protect Free-tier CPU", async () => {
    const resp = await worker.fetch(new Request("https://w.test/api/monte-carlo?iterations=10000&horizon=500&seed=3"), {} as Env, {} as any);
    const data = (await resp.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.iterations * data.horizon).toBeLessThanOrEqual(600_000);
  });

  it("strictly excludes SUPPRESSED alerts from the Monte Carlo trade pool", async () => {
    const store = makeStore(undefined);
    // Insert a SUPPRESSED alert with an outlier outcome
    const suppSetupId = "td:EURUSD:30m:SHORT:V:supp:mc";
    const suppAlert = closedAlert(suppSetupId, T0 + 10 * 3600_000);
    suppAlert.alertStatus = "SUPPRESSED";
    await store.insertAlert(suppAlert, "twelvedata");
    await store.recordOutcome(suppSetupId, { status: "TP_HIT", exitPrice: 104, exitTime: T0 + 10 * 3600_000 + 1800_000, rMultiple: 99.0 });

    const env = {} as Env;
    const q = "iterations=100&horizon=20&riskPct=1&seed=11";
    const resp = await worker.fetch(new Request(`https://w.test/api/monte-carlo?${q}`), env, {} as any);
    const data = (await resp.json()) as any;
    expect(data.ok).toBe(true);
    // Still 7 trades from previous test, the suppressed trade was not added to pool
    expect(data.trades).toBe(7);
  });
});
