/** Prop-challenge verdict on the LIVE forward mixture (past events), not the
 *  backtest's. Source: the 2026-10-16 live direction census — 20 delivered
 *  alerts, 2026-08-25 → 2026-10-16, spread-adjusted. The ledger contains two
 *  owner-corrected NAS100 TPs (docs/OUTCOME_OVERRIDE_POLICY.md); the mixture
 *  inherits that mix and says so.
 *
 *  Mixture reconstruction (documented, not fitted):
 *    TP 10, SL 8, BE 2  → shares 0.50 / 0.40 / 0.10
 *    mean winner raw R  = (22.5 raw net + 8.0 lost R) / 10 = 3.05
 *    adjusted winner-equivalent = (20.7 adjusted net + 8.0 lost R) / 10 = 2.87
 *    expectancy           = .50*2.87 - .40*1.00 = +1.035 R/alert
 *    measured adjusted    = 20.7 / 20 = +1.035 R/alert ✓
 *  The simulator has one R value for every win/loss and no per-trade cost
 *  field, so 2.87 is an expectancy-preserving win equivalent, NOT the mean
 *  broker fill. It folds all measured spread cost into the win outcome.
 *
 *  Frequency: 20 alerts over 51.9 days ≈ 11.7 per calendar month across the
 *  whole service, so instruments=1 at 11.8 alerts/month. Measured mean
 *  pairwise correlation 0.004 → correlation 0; a 0.2 stress column is printed
 *  beside it because same-day macro shocks are not literally zero.
 *
 *  Bootstrap: resample TP/SL/BE categories at alert granularity with a fixed
 *  adjusted win-equivalent. The interval captures outcome-mix uncertainty,
 *  not variation in individual winner sizes. The dashboard verdict bootstraps
 *  full ledger rows. Usage: npx tsx scripts/prop_live.ts (no network access)
 *
 *  Refresh discipline: the constants below ARE the census. When the ledger
 *  moves (new resolutions or overrides), re-run
 *  `npx tsx scripts/live_direction.ts --from 2026-08-25` and update N/TP/SL/BE
 *  and the raw/adj sums before quoting anything this prints.
 */
import { simulate, type AlertMix, type PropRules } from "../src/prop_sim";

const N = 20;
const TP = 10, SL = 8, BE = 2;
const RAW_NET_R = 22.5;
const ADJUSTED_NET_R = 20.7;
const MEAN_WIN_RAW = (RAW_NET_R + SL) / TP;
// Equivalent reward that makes the simulator's -1R loss and 0R scratch
// reproduce the measured adjusted net: (20.7 + 8 losses) / 10 wins.
const ADJUSTED_WIN_EQ = (ADJUSTED_NET_R + SL) / TP;
const WINDOW_START_MS = Date.parse("2026-08-25T13:00:00.000Z");
const WINDOW_END_MS = Date.parse("2026-10-16T09:30:00.000Z");
const SPAN_DAYS = (WINDOW_END_MS - WINDOW_START_MS) / 86_400_000;
const ALERTS_PER_MONTH = N / (SPAN_DAYS / 30.44);

const liveMix = (): AlertMix => ({
  winRate: TP / N,
  lossRate: SL / N,
  scratchRate: BE / N,
  targetR: ADJUSTED_WIN_EQ,
});

/** Resample the 20 observed alerts (10 win, 8 loss, 2 scratch) with replacement
 *  and rebuild the mixture — the bootstrap, at alert granularity. */
function bootstrapMix(rand: () => number): AlertMix {
  const bag: ("W" | "L" | "S")[] = [
    ...Array(TP).fill("W"), ...Array(SL).fill("L"), ...Array(BE).fill("S"),
  ];
  let w = 0, l = 0, s = 0;
  for (let i = 0; i < N; i++) {
    const draw = bag[Math.floor(rand() * N) % N];
    if (draw === "W") w++;
    else if (draw === "L") l++;
    else s++;
  }
  return {
    winRate: w / N, lossRate: l / N, scratchRate: s / N,
    // Keep each bootstrap mix on the calibrated adjusted expectancy scale.
    targetR: ADJUSTED_WIN_EQ,
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

console.log("PROP CHALLENGE ON LIVE FORWARD MIXTURE (20 alerts, 2026-08-25 → 2026-10-16)");
console.log("ledger includes 2 owner-corrected NAS100 TPs - docs/OUTCOME_OVERRIDE_POLICY.md");
console.log(`mix: win ${(TP / N * 100).toFixed(1)}% loss ${(SL / N * 100).toFixed(1)}% scratch ${(BE / N * 100).toFixed(1)}% | win ${MEAN_WIN_RAW.toFixed(2)}R raw / ${ADJUSTED_WIN_EQ.toFixed(2)}R adjusted-equivalent | ${(ALERTS_PER_MONTH).toFixed(1)} alerts/month service-wide`);
console.log(`measured expectancy: +${(ADJUSTED_NET_R / N).toFixed(3)} adjusted R/alert`);
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
