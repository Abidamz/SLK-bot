import { describe, expect, it } from "vitest";
import { alertMix, simulate, type AlertMix, type SimConfig } from "../src/prop_sim";
import type { Trade } from "../src/replay_stats";

// The measured 360-day book: 25 TP / 34 SL / 10 BE over 69 alerts at a 2.77R
// realised target. Using the real numbers keeps the tests honest about scale.
const MIX: AlertMix = {
  winRate: 25 / 69, lossRate: 34 / 69, scratchRate: 10 / 69, targetR: 2.77,
};

const base = (o: Partial<SimConfig> = {}): SimConfig => ({
  mix: MIX,
  rules: { targetPct: 8, dailyPct: 3, overallPct: 5, tradingDays: 21 },
  instruments: 3,
  alertsPerMonthPerInstrument: (69 / 12) / 3,
  riskPct: 0.75,
  correlation: 0,
  dailyLossCap: 0,
  trials: 4000,
  seed: 12345,
  ...o,
});

describe("prop challenge simulation", () => {
  it("is reproducible for a given seed", () => {
    const a = simulate(base());
    const b = simulate(base());
    expect(a).toEqual(b);
    expect(simulate(base({ seed: 999 }))).not.toEqual(a);
  });

  it("gives a break-even book a real chance on luck alone", () => {
    // Break-even expectancy: win rate exactly 1/(1+T). For a fair walk between
    // +8 and -5 the ruin formula gives 5/13 = 38%; the time limit cuts that.
    // This is the fact that makes a headline pass rate hard to interpret - a
    // strategy with no edge at all still clears a meaningful share of
    // challenges, so a pass rate has to be read against this baseline.
    const flat = simulate(base({
      mix: { winRate: 1 / 3.77, lossRate: 1 - 1 / 3.77, scratchRate: 0, targetR: 2.77 },
      instruments: 20, riskPct: 0.75,
    }));
    expect(flat.passRate).toBeGreaterThan(10);
    expect(flat.passRate).toBeLessThan(40);
    const edged = simulate(base({ instruments: 20, riskPct: 0.75 }));
    expect(edged.passRate).toBeGreaterThan(flat.passRate);
  });

  it("draws the alert rate it was asked for", () => {
    // Guards the sampler directly. A pass rate alone cannot distinguish a good
    // strategy from a broken random generator, and the throwaway script this
    // replaced drew 11% of the intended alerts for exactly that reason.
    // An all-scratch mix never moves the account, so no trial ends early and
    // every one runs the full window. Anything else measures the exit rules
    // instead of the sampler.
    const r = simulate(base({
      instruments: 20, trials: 20000,
      mix: { winRate: 0, lossRate: 0, scratchRate: 1, targetR: 2.77 },
    }));
    const expected = ((69 / 12) / 3) * 20;   // alerts per month across 20
    expect(r.avgTrades).toBeGreaterThan(expected * 0.95);
    expect(r.avgTrades).toBeLessThan(expected * 1.05);
  });

  it("passes almost always with a strong edge and enough instruments", () => {
    const r = simulate(base({
      mix: { winRate: 0.6, lossRate: 0.35, scratchRate: 0.05, targetR: 2.77 },
      instruments: 20, riskPct: 0.75,
    }));
    expect(r.passRate).toBeGreaterThan(80);
  });

  it("raises the pass rate with instrument count — the dominant lever", () => {
    const few = simulate(base({ instruments: 3 }));
    const many = simulate(base({ instruments: 20 }));
    expect(many.passRate).toBeGreaterThan(few.passRate + 20);
  });

  it("is worth far less when the instruments are correlated", () => {
    // Correlation must be mean-preserving: it raises variance and leaves the
    // drift alone, so it can only make a barrier problem worse.
    const indep = simulate(base({ instruments: 20, riskPct: 0.5, trials: 20000 }));
    const corr = simulate(base({ instruments: 20, riskPct: 0.5, correlation: 0.3, trials: 20000 }));
    expect(corr.passRate).toBeLessThan(indep.passRate);
    expect(corr.blownRate).toBeGreaterThan(indep.blownRate);
  });

  it("trades pass rate for survival with a daily loss cap", () => {
    const open = simulate(base({ instruments: 20, riskPct: 1.0 }));
    const capped = simulate(base({ instruments: 20, riskPct: 1.0, dailyLossCap: 2 }));
    expect(capped.blownRate).toBeLessThan(open.blownRate);
  });

  it("ends the trial the moment the overall limit is breached", () => {
    // 100% losers: the account must blow, never merely fail the target.
    const r = simulate(base({
      mix: { winRate: 0, lossRate: 1, scratchRate: 0, targetR: 2.77 },
      instruments: 20, riskPct: 1.0,
    }));
    expect(r.blownRate).toBeGreaterThan(95);
  });

  it("treats a shorter window as fewer chances, not denser ones", () => {
    // Regression: the alert rate must be spread over the allowed days. Scaling
    // it by 30/tradingDays instead would make a tighter deadline look easier.
    const full = simulate(base({ instruments: 12 }));
    const short = simulate(base({
      instruments: 12, rules: { targetPct: 8, dailyPct: 3, overallPct: 5, tradingDays: 7 },
    }));
    expect(short.passRate).toBeLessThan(full.passRate);
  });
});

describe("alertMix — deriving the distribution from a real book", () => {
  const mk = (status: string, r: number): Trade => ({
    pair: "EURUSD", tf: "30m", setupId: `s${Math.random()}`,
    entryTime: "2026-05-01 10:00", entry: 1.1, stop: 1.099, tp: 1.1027,
    exit: 1.1, exitTime: "2026-05-01 12:00", status, r,
  } as Trade);

  it("solves a target that reproduces the book's own expectancy", () => {
    const rows = [
      ...Array.from({ length: 25 }, () => mk("TP_HIT", 2.77)),
      ...Array.from({ length: 34 }, () => mk("SL_HIT", -1)),
      ...Array.from({ length: 10 }, () => mk("BE_HIT", 0)),
    ];
    const m = alertMix(rows, false);
    expect(m.winRate).toBeCloseTo(25 / 69, 10);
    expect(m.targetR).toBeCloseTo(2.77, 10);
    // The whole point: the mix must regenerate the measured expectancy.
    const expectancy = m.winRate * m.targetR - m.lossRate;
    expect(expectancy).toBeCloseTo(35.3 / 69, 2);
  });

  it("counts scratches as everything that is not a win or a loss", () => {
    const rows = [mk("TP_HIT", 3), mk("SL_HIT", -1), mk("BE_HIT", 0), mk("EXPIRED", 0)];
    const m = alertMix(rows, false);
    expect(m.winRate).toBe(0.25);
    expect(m.lossRate).toBe(0.25);
    expect(m.scratchRate).toBe(0.5);
  });

  it("returns an empty mix rather than dividing by zero", () => {
    expect(alertMix([], false)).toEqual({
      winRate: 0, lossRate: 0, scratchRate: 0, targetR: 0,
    });
  });
});
