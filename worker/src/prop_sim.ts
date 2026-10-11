import { stats, type Trade } from "./replay_stats";

/**
 * Monte Carlo simulation of a prop-firm challenge.
 *
 * A challenge is a first-passage problem, not an average: reach the profit
 * target before touching the daily or overall drawdown limit. Averaging hides
 * that completely - a book can have positive expectancy and still fail most
 * challenges, because a single bad day ends the account and the expectancy
 * never gets to show up. So the pass rate is simulated directly.
 *
 * Everything is driven by an AlertMix derived from a real book (see
 * alertMix), so the answer reflects measured behaviour rather than an assumed
 * win rate. The dominant finding this tool exists to surface is that
 * instrument count and, above all, correlation between instruments decide the
 * outcome far more than the strategy's edge does.
 */

/** Per-alert outcome distribution, in R. Scratch covers BE_HIT and EXPIRED. */
export interface AlertMix {
  winRate: number;
  lossRate: number;
  scratchRate: number;
  /** Realised reward on a winner, in R. Solved from the measured expectancy. */
  targetR: number;
}

/** The firm's rules, in percent of the starting balance. */
export interface PropRules {
  targetPct: number;
  dailyPct: number;
  overallPct: number;
  /** Trading days allowed. Calendar-month challenges are usually ~21. */
  tradingDays: number;
}

export interface SimConfig {
  mix: AlertMix;
  rules: PropRules;
  instruments: number;
  /** Alerts per calendar month from ONE instrument, at its own scan rate. */
  alertsPerMonthPerInstrument: number;
  /** Risk per trade as a percent of account, e.g. 0.75 for 0.75%. */
  riskPct: number;
  /**
   * 0 = fully independent instruments, 1 = they all move together. On a
   * correlated day every trade that day takes the same outcome, which is the
   * crudest useful model of instruments gapping together in a stress session.
   */
  correlation: number;
  /** Stop for the day after this many losing trades. 0 = no cap. */
  dailyLossCap: number;
  trials: number;
  /** Seeds the PRNG. Same seed, same answer - which is what makes this testable. */
  seed: number;
}

export interface SimResult {
  passRate: number;
  blownRate: number;
  /** Finished the window having neither passed nor blown the account. */
  neitherRate: number;
  /**
   * Mean trades taken per trial. Exposed because it is the only direct check
   * that the alert sampler is drawing the rate it was asked for - a pass rate
   * on its own cannot tell a good strategy from a broken random generator.
   */
  avgTrades: number;
  trials: number;
}

/**
 * mulberry32. Math.random would make every run and every test irreproducible,
 * and a pass rate you cannot re-derive is not a result.
 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth's method. Fine at these rates; alerts per day are well under 10. */
function poisson(lam: number, rand: () => number): number {
  if (lam <= 0) return 0;
  const limit = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > limit);
  return k - 1;
}

function drawOutcome(mix: AlertMix, rand: () => number): number {
  const u = rand();
  if (u < mix.winRate) return mix.targetR;
  if (u < mix.winRate + mix.lossRate) return -1;
  return 0;
}

type Outcome = 1 | 0 | -1;

/** +1 passed, -1 account blown, 0 ran out of time. */
function trial(cfg: SimConfig, rand: () => number, count: { trades: number }): Outcome {
  // alertsPerMonthPerInstrument is per calendar month; the window holds one
  // month of opportunity spread over tradingDays sessions. Dividing by the
  // trading days rather than by 30 is what keeps the total constant when the
  // firm allows fewer days - a shorter window means fewer chances, not denser
  // ones, and getting this backwards would make a harder challenge look easier.
  const perDay = (cfg.alertsPerMonthPerInstrument * cfg.instruments) / cfg.rules.tradingDays;
  let acct = 0;
  for (let d = 0; d < cfg.rules.tradingDays; d++) {
    const k = poisson(perDay, rand);
    // One draw shared by every trade that day. It has to be drawn from the mix
    // itself: an earlier version chose between -1 and +targetR with equal
    // probability, which is not neutral at a 2.77R target - it injected
    // +0.89R of expectancy per trade and made correlation look helpful.
    // Mean-preserving correlation raises variance without touching the drift,
    // which is the only thing it should do.
    let shock: number | null = null;
    if (cfg.correlation > 0 && rand() < cfg.correlation) {
      shock = drawOutcome(cfg.mix, rand);
    }
    let day = 0, losses = 0;
    for (let i = 0; i < k; i++) {
      if (cfg.dailyLossCap > 0 && losses >= cfg.dailyLossCap) break;
      const r = (shock === null ? drawOutcome(cfg.mix, rand) : shock) * cfg.riskPct;
      count.trades++;
      if (r < 0) losses++;
      day += r;
      acct += r;
      if (acct <= -cfg.rules.overallPct) return -1;
      if (acct >= cfg.rules.targetPct) return 1;
    }
    if (day <= -cfg.rules.dailyPct) return -1;
  }
  return acct >= cfg.rules.targetPct ? 1 : 0;
}

export function simulate(cfg: SimConfig): SimResult {
  const rand = makeRng(cfg.seed);
  let pass = 0, blown = 0;
  const count = { trades: 0 };
  const n = Math.max(1, Math.floor(cfg.trials));
  for (let i = 0; i < n; i++) {
    const r = trial(cfg, rand, count);
    if (r === 1) pass++;
    else if (r === -1) blown++;
  }
  return {
    passRate: (pass / n) * 100,
    blownRate: (blown / n) * 100,
    neitherRate: ((n - pass - blown) / n) * 100,
    avgTrades: count.trades / n,
    trials: n,
  };
}

/**
 * Derives the per-alert distribution from a real book.
 *
 * The target is solved from the measured expectancy rather than read off
 * MIN_TP_R, because the engine targets the nearest liquidity beyond a 2.5R
 * floor and the realised reward is not the configured one. Solving
 * E = winRate*T - lossRate for T makes the simulation reproduce the book's own
 * expectancy by construction, which is the check that the mix is faithful.
 */
export function alertMix(rows: Trade[], spreadAdj: boolean): AlertMix {
  const s = stats(rows, spreadAdj);
  const n = s.alerts;
  if (!n) return { winRate: 0, lossRate: 0, scratchRate: 0, targetR: 0 };
  const winRate = s.tp / n;
  const lossRate = s.sl / n;
  const targetR = winRate > 0 ? (s.finalR / n + lossRate) / winRate : 0;
  return { winRate, lossRate, scratchRate: Math.max(0, 1 - winRate - lossRate), targetR };
}
