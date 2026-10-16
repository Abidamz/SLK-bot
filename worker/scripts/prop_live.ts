/** Prop-challenge verdict on the LIVE forward mixture (past events), not the
 *  backtest's. Source: the 2026-10-15 live direction census — 19 delivered
 *  alerts, 2026-08-25 → 2026-10-15, spread-adjusted.
 *
 *  Mixture reconstruction (documented, not fitted):
 *    TP 9, SL 8, BE 2  → shares 0.4737 / 0.4211 / 0.1053
 *    mean winner raw R  = (9.0 + 18.5) / 9 = 3.056   (LONG net 8.0 + 1 SL,
 *                                                     SHORT net 11.5 + 7 SL)
 *    mean spread cost   = (19.5 raw - 17.8 adj) / 19 = 0.0895 per alert
 *    targetR (adj)      = 3.056 - 0.0895 = 2.966
 *    expectancy check   = .4737*2.966 - .4211*1.0895 = +0.946 R/alert ✓
 *  Scratches carry a small cost the simulator books as 0; the bias is
 *  ~0.01 R/alert and is deliberately left visible rather than hidden.
 *
 *  Frequency: 19 alerts over 50.9 days ≈ 11.4 per calendar month across the
 *  whole service, so instruments=1 at 11.4 alerts/month. Measured mean
 *  pairwise correlation 0.004 → correlation 0; a 0.2 stress column is printed
 *  beside it because same-day macro shocks are not literally zero.
 *
 *  Bootstrap: resample the 19 alerts with replacement, rebuild the mixture,
 *  re-simulate — the spread of pass rates IS the uncertainty n=19 imposes.
 *  Usage: npx tsx scripts/prop_live.ts            (no network access needed)
 *
 *  STALE AS OF 2026-10-16: the census below is the 2026-10-15 ledger. A
 *  second owner override (NAS100 OC 30003, OPEN -> TP_HIT +3.00R, logged in
 *  docs/OUTCOME_OVERRIDE_POLICY.md) resolved after it, so the live book is
 *  now 20 alerts. Refresh the constants from a fresh live_direction.ts run
 *  before using the output; the script prints the same warning.
 */
import { simulate, type AlertMix, type PropRules } from "../src/prop_sim";

const N = 19;
const TP = 9, SL = 8, BE = 2;
const MEAN_WIN_RAW = (9.0 + 18.5) / TP;
const MEAN_COST = (19.5 - 17.8) / N;
const ALERTS_PER_MONTH = 19 / (50.9 / 30.44);

const liveMix = (): AlertMix => ({
  winRate: TP / N,
  lossRate: SL / N,
  scratchRate: BE / N,
  targetR: MEAN_WIN_RAW - MEAN_COST,
});

/** Resample the 19 observed alerts (9 win, 8 loss, 2 scratch) with replacement
 *  and rebuild the mixture — the bootstrap, at alert granularity. */
function bootstrapMix(rand: () => number): AlertMix {
  const bag: ("W" | "L" | "S")[] = [
    ...Array(TP).fill("W"), ...Array(SL).fill("L"), ...Array(BE).fill("S"),
  ];
  let w = 0, l = 0, s = 0, winR = 0;
  for (let i = 0; i < N; i++) {
    const draw = bag[Math.floor(rand() * N) % N];
    if (draw === "W") { w++; winR += MEAN_WIN_RAW; }
    else if (draw === "L") l++;
    else s++;
  }
  if (w === 0) return { winRate: 0, lossRate: l / N, scratchRate: s / N, targetR: 1 };
  return {
    winRate: w / N, lossRate: l / N, scratchRate: s / N,
    targetR: winR / w - MEAN_COST,
  };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RULES: PropRules[] = [
  { targetPct: 8, dailyPct: 3, overallPct: 5, tradingDays: 21 },
  { targetPct: 5, dailyPct: 3, overallPct: 5, tradingDays: 21 },
  { targetPct: 8, dailyPct: 5, overallPct: 5, tradingDays: 21 },
];
const RISKS = [0.5, 0.75, 1.0];

console.log("PROP CHALLENGE ON LIVE FORWARD MIXTURE (19 alerts, 2026-08-25 → 2026-10-15)");
console.log("!! CENSUS STALE: a second NAS100 override (+3.00R) landed 2026-10-16.");
console.log("!! Re-run `npx tsx scripts/live_direction.ts --from 2026-08-25` and update");
console.log("!! N/TP/SL/BE/MEAN_* below before quoting any number this prints.");
console.log(`mix: win ${(TP / N * 100).toFixed(1)}% loss ${(SL / N * 100).toFixed(1)}% scratch ${(BE / N * 100).toFixed(1)}% | winner ${(MEAN_WIN_RAW - MEAN_COST).toFixed(2)}R adj | ${(ALERTS_PER_MONTH).toFixed(1)} alerts/month service-wide`);
console.log("rules: 21 trading days, overall blow at -5%; subscriber envelope 0.5-1% risk\n");
console.log("target daily  risk%   pass%   blown%  neither%  avgTrades  [bootstrap 90% interval on pass%]");

for (const rules of RULES) {
  for (const risk of RISKS) {
    const base = simulate({
      mix: liveMix(), rules, instruments: 1,
      alertsPerMonthPerInstrument: ALERTS_PER_MONTH,
      riskPct: risk, correlation: 0, dailyLossCap: 0, trials: 20000, seed: 20261015,
    });
    const rand = mulberry(7);
    const passes: number[] = [];
    for (let b = 0; b < 300; b++) {
      const r = simulate({
        mix: bootstrapMix(rand), rules, instruments: 1,
        alertsPerMonthPerInstrument: ALERTS_PER_MONTH,
        riskPct: risk, correlation: 0, dailyLossCap: 0, trials: 1500,
        seed: 1000 + b,
      });
      passes.push(r.passRate);
    }
    passes.sort((a, b) => a - b);
    const lo = passes[Math.floor(0.05 * passes.length)];
    const hi = passes[Math.floor(0.95 * passes.length) - 1];
    console.log(
      `${String(rules.targetPct).padStart(5)}% ${String(rules.dailyPct).padStart(5)}%  ${risk.toFixed(2).padStart(5)}  ${base.passRate.toFixed(1).padStart(6)}  ${base.blownRate.toFixed(1).padStart(6)}  ${base.neitherRate.toFixed(1).padStart(7)}  ${base.avgTrades.toFixed(1).padStart(8)}   [${lo.toFixed(0)}% – ${hi.toFixed(0)}%]`,
    );
  }
  console.log("");
}

const stress = simulate({
  mix: liveMix(), rules: RULES[0], instruments: 1,
  alertsPerMonthPerInstrument: ALERTS_PER_MONTH,
  riskPct: 0.75, correlation: 0.2, dailyLossCap: 0, trials: 20000, seed: 99,
});
console.log(`stress (correlation 0.2, target 8 daily 3, risk 0.75): pass ${stress.passRate.toFixed(1)}% blown ${stress.blownRate.toFixed(1)}%`);
console.log("\nSanity: avgTrades near 11 at 0.5% risk (few trials end early); lower at higher risk because passes end the trial.");
