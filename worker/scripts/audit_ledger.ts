/** Read-only audit of the delivered ledger: is the live system working, and
 *  could a subscriber run it on a funded account?
 *
 *  This exists because the analysis it performs cannot be run from a sandbox
 *  without network access to the Worker. Moving it here means the numbers are
 *  reproducible by anyone with the owner key, instead of being reconstructed
 *  by hand from pasted output.
 *
 *  It answers four questions the dashboard does not:
 *    1. What is the expectancy, and is the sample big enough to trust it?
 *       A confidence interval is printed because a small ledger can look
 *       excellent and be indistinguishable from break-even.
 *    2. What is the worst single DAY? Prop firms enforce a daily limit, and a
 *       whole-window drawdown cannot tell you whether one session breaches it.
 *    3. Would each calendar month have passed a challenge?
 *    4. What risk per trade would have kept both limits intact?
 *
 *  rMultiple is already realised from the stored entry, stop and exit, so real
 *  spread is already inside it. Nothing here adds SPREAD_EST on top - doing so
 *  would charge costs twice.
 *
 *  Usage:
 *    cd worker
 *    TAYO_ADMIN_KEY=... npx tsx scripts/audit_ledger.ts
 *    TAYO_ADMIN_KEY=... TAYO_BASE_URL=https://... npx tsx scripts/audit_ledger.ts
 */

import {
  challengeVerdict, dailyRisk, f, monthlyBuckets, riskForLimit, stats, type Trade,
} from "../src/replay_stats";

const BASE = process.env.TAYO_BASE_URL ?? "https://slk-alert-worker.abidogundamilola.workers.dev";
const KEY = process.env.TAYO_ADMIN_KEY ?? "";
const PROP_TARGET = Number(process.env.PROP_TARGET ?? 8);
const PROP_DAILY = Number(process.env.PROP_DAILY ?? 3);
const PROP_TOTAL = Number(process.env.PROP_TOTAL ?? 5);
const RISK_PCTS = (process.env.RISK_PCTS ?? "0.5,0.75,1")
  .split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);

interface Row {
  setupId?: string; pair?: string; tf?: string; direction?: string;
  entry?: number; stopLoss?: number; tp1?: number;
  status?: string; alertStatus?: string;
  candleCloseTime?: string; exitTime?: string | null; exitPrice?: number | null;
  rMultiple?: number | null; suppressReason?: string | null;
}

async function fetchAll(): Promise<Row[]> {
  if (!KEY) {
    console.error("TAYO_ADMIN_KEY is required - /alerts is authenticated.");
    process.exit(1);
  }
  const out: Row[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${BASE}/alerts?limit=200&page=${page}&order=desc&sort=candleCloseTime`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${KEY}` } });
    if (!res.ok) {
      console.error(`GET ${url} -> ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const body = (await res.json()) as { items?: Row[]; total?: number };
    const items = body.items ?? [];
    out.push(...items);
    if (!items.length || out.length >= (body.total ?? 0)) break;
  }
  return out;
}

/**
 * Maps a ledger row onto the replay Trade shape so the same accounting used by
 * the backtest applies to live results. Unresolved rows are kept but carry no
 * r, and are reported separately - counting an open trade as zero would flatter
 * the expectancy by hiding positions that have not finished.
 */
function toTrade(r: Row): Trade | null {
  const status = String(r.status ?? "").toUpperCase();
  if (!status || status === "OPEN") return null;
  const rm = typeof r.rMultiple === "number" && Number.isFinite(r.rMultiple) ? r.rMultiple : null;
  if (rm === null) return null;
  const entry = Number(r.entry ?? 0), stop = Number(r.stopLoss ?? 0);
  return {
    pair: r.pair ?? "?", tf: r.tf ?? "?", setupId: r.setupId ?? "?",
    entryTime: r.candleCloseTime ?? "", entry, stop, tp: Number(r.tp1 ?? 0),
    status, exit: Number(r.exitPrice ?? 0), exitTime: r.exitTime ?? "", r: rm,
    limitStatus: status, limitEntry: entry, limitExitTime: r.exitTime ?? "", limitR: rm,
    marketStatus: status, marketEntry: entry, marketExitTime: r.exitTime ?? "", marketR: rm,
    dir: r.direction === "LONG" || r.direction === "SHORT" ? r.direction : undefined,
  };
}

/** Two-sided 95% interval on the mean. Printed because it is the difference
 *  between "this is working" and "this is seventeen trades". */
function ci95(rs: number[]): [number, number] {
  const n = rs.length;
  if (n < 2) return [NaN, NaN];
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  return [mean - 1.96 * se, mean + 1.96 * se];
}

function byBucket(label: string, key: (t: Trade) => string, trades: Trade[]): void {
  const m = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = key(t);
    const arr = m.get(k);
    if (arr) arr.push(t); else m.set(k, [t]);
  }
  console.log(`\n=== ${label} ===`);
  console.log("   key          alerts   TP   SL   BE   win%     netR   R/alert      PF  maxDD");
  for (const [k, rs] of [...m.entries()].sort((a, b) => stats(b[1], false).finalR - stats(a[1], false).finalR)) {
    const s = stats(rs, false);
    console.log(
      `   ${k.padEnd(12)} ${String(s.alerts).padStart(5)} ${String(s.tp).padStart(4)} ` +
      `${String(s.sl).padStart(4)} ${String(s.be).padStart(4)} ${f(s.winrate, 1).padStart(6)} ` +
      `${f(s.finalR, 1).padStart(8)} ${f(s.alerts ? s.finalR / s.alerts : NaN, 2).padStart(9)} ` +
      `${f(s.pf, 2).padStart(7)} ${f(s.maxDD, 2).padStart(6)}`);
  }
}

async function main(): Promise<void> {
  const rows = await fetchAll();
  const delivered = rows.filter((r) => String(r.alertStatus ?? "").toUpperCase() !== "SUPPRESSED");
  const trades = delivered.map(toTrade).filter((t): t is Trade => t !== null);
  const open = delivered.length - trades.length;

  console.log(`source : ${BASE}`);
  console.log(`rows   : ${rows.length} total, ${delivered.length} delivered, ${open} unresolved/OPEN (excluded)`);
  if (!trades.length) { console.log("\nNo resolved delivered alerts. Nothing to score."); return; }

  const s = stats(trades, false);
  const rs = trades.map((t) => t.r);
  const [lo, hi] = ci95(rs);
  const per = s.finalR / s.alerts;

  console.log(`\n=== expectancy ===`);
  console.log(`   ${s.alerts} resolved alerts · ${s.tp} TP / ${s.sl} SL / ${s.be} BE · win ${f(s.winrate, 1)}% of resolved`);
  console.log(`   net ${f(s.finalR, 2)}R · PF ${f(s.pf, 2)} · expectancy ${f(per, 3)}R per alert`);
  console.log(`   95% CI on expectancy: [${f(lo, 2)}, ${f(hi, 2)}]R`
    + (Number.isFinite(lo) && lo <= 0
      ? "   <- crosses zero: this sample cannot be separated from break-even"
      : ""));

  const dr = dailyRisk(trades, false);
  console.log(`\n=== daily risk (what a funded account is actually tested on) ===`);
  console.log(`   ${dr.days} days with a close · worst intraday loss ${f(dr.worstDayLoss, 2)}R (${dr.worstDayLossDate})`);
  console.log(`   worst day close ${f(dr.worstDayClose, 2)}R (${dr.worstDayCloseDate}) · worst 3-day ${f(dr.worst3Day, 2)}R · worst 5-day ${f(dr.worst5Day, 2)}R`);
  console.log(`   window maxDD ${f(s.maxDD, 2)}R`);
  const pct = (x: number) => (Number.isFinite(x) ? `${f(x, 2)}%` : "n/a");
  console.log(`   max risk/trade that held: ${PROP_DAILY}% daily ${pct(riskForLimit(dr.worstDayLoss, PROP_DAILY))} · `
    + `${PROP_TOTAL}% overall ${pct(riskForLimit(s.maxDD, PROP_TOTAL))}`);

  const months = monthlyBuckets(trades, false);
  if (months.length) {
    console.log(`\n=== challenge scoring — target ${PROP_TARGET}% · daily ${PROP_DAILY}% · overall ${PROP_TOTAL}% ===`);
    for (const risk of RISK_PCTS) {
      const v = months.map((m) => challengeVerdict(m, risk, { targetPct: PROP_TARGET, dailyPct: PROP_DAILY, totalPct: PROP_TOTAL }));
      console.log(`   risk ${f(risk, 2)}% : ${v.filter((x) => x.pass).length}/${months.length} months pass · `
        + `worst day ${f(Math.max(...months.map((m) => m.worstDay * risk)), 2)}% · `
        + `worst month ${f(Math.min(...months.map((m) => m.netR * risk)), 2)}%`);
    }
    const mid = RISK_PCTS[Math.floor(RISK_PCTS.length / 2)] ?? 1;
    console.log(`   per month at ${f(mid, 2)}% risk:`);
    for (const m of months) {
      const v = challengeVerdict(m, mid, { targetPct: PROP_TARGET, dailyPct: PROP_DAILY, totalPct: PROP_TOTAL });
      console.log(`      ${m.month}  ${String(m.alerts).padStart(3)} alerts  netR ${f(m.netR, 1).padStart(6)}  `
        + `maxDD ${f(m.maxDD, 2).padStart(5)}R  worstDay ${f(m.worstDay, 2).padStart(5)}R  ${v.pass ? "PASS" : "FAIL"} — ${v.reason}`);
    }
  }

  byBucket("by instrument", (t) => t.pair, trades);
  byBucket("by entry timeframe", (t) => t.tf, trades);

  const suppressed = rows.filter((r) => String(r.alertStatus ?? "").toUpperCase() === "SUPPRESSED");
  if (suppressed.length) {
    console.log(`\n=== suppressed rows (${suppressed.length}) — reported, never added to the book ===`);
    console.log("   These are stale or gated setups. Counting them as tradeable is the");
    console.log("   hindsight error documented in CONTINUATION_HANDOFF.md; listed for audit only.");
    const reasons = new Map<string, number>();
    for (const r of suppressed) {
      const k = String(r.suppressReason ?? "(no reason recorded)");
      reasons.set(k, (reasons.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(4)}  ${k}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
