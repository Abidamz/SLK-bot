/** The account curve for a window of LIVE delivered trades, at fixed risk
 *  per trade, in plain language. Answers the question a good week always
 *  provokes: "what would this have done to a prop account at X% risk?" —
 *  including the two ways prop accounts actually die: a single day past the
 *  daily limit, and a drawdown past the overall limit.
 *
 *  Usage:
 *    npx tsx scripts/week_curve.ts [--from 2026-10-08] [--to 2026-10-15]
 *                                  [--url https://...workers.dev]
 *  Defaults: the last 8 days including today, production worker.
 *
 *  Trades are ordered by exit time (entry time for anything still open),
 *  because that is the order a real account would have felt them. R values
 *  are the ledger's own, so manual corrections are included.
 */
const DEFAULT_URL = "https://slk-alert-worker.abidogundamilola.workers.dev";

interface Row {
  pair: string; tf: string; setupId: string; direction: string;
  status: string; alertStatus: string; rMultiple: number | null;
  candleCloseTime: string; exitTime: string | null;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv: string[]): { url: string; from: string; to: string } {
  let url = DEFAULT_URL;
  const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  let from = day(8);
  let to = day(0);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--url") url = next();
    else if (a === "--from") { from = next(); if (!Number.isFinite(Date.parse(from))) fail(`--from is not a date: ${from}`); }
    else if (a === "--to") { to = next(); if (!Number.isFinite(Date.parse(to))) fail(`--to is not a date: ${to}`); }
    else fail(`unknown flag: ${a} (valid: --url, --from, --to)`);
  }
  return { url: url.replace(/\/+$/, ""), from, to };
}

async function fetchAll(url: string, from: string, to: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 1; page <= 100; page++) {
    const q = new URLSearchParams({ page: String(page), pageSize: "200", from, to });
    const res = await fetch(`${url}/alerts?${q}`);
    if (!res.ok) fail(`GET /alerts?page=${page} -> HTTP ${res.status}`);
    const body = (await res.json()) as { items: Row[]; total: number };
    out.push(...body.items);
    if (out.length >= body.total || !body.items.length) return out;
  }
  return out;
}

const CLOSED = new Set(["TP_HIT", "SL_HIT", "BE_HIT", "EXPIRED"]);

function curve(rows: Row[], riskPct: number) {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const t = r.exitTime && Number.isFinite(Date.parse(r.exitTime)) ? r.exitTime : r.candleCloseTime;
    const day = new Date(Date.parse(t)).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (Number(r.rMultiple) || 0) * riskPct);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cum = 0, peak = 0, maxDD = 0, worstDay = 0, worstDayLabel = "-";
  let dailyBreached = false, overallBreached = false;
  let target6: string | null = null, target8: string | null = null;
  for (const [day, v] of days) {
    cum += v;
    if (v < worstDay) { worstDay = v; worstDayLabel = day; }
    if (v <= -3) dailyBreached = true;
    if (cum <= -5) overallBreached = true;
    if (peak - cum > maxDD) maxDD = peak - cum;
    if (cum > peak) peak = cum;
    if (target6 === null && cum >= 6) target6 = day;
    if (target8 === null && cum >= 8) target8 = day;
  }
  return { cum, peak, maxDD, worstDay, worstDayLabel, dailyBreached, overallBreached, target6, target8, days };
}

async function main(): Promise<void> {
  const { url, from, to } = parseArgs(process.argv.slice(2));
  const rows = await fetchAll(url, from, to);
  const delivered = rows.filter((r) => String(r.alertStatus ?? "").toUpperCase() !== "SUPPRESSED");
  const closed = delivered
    .filter((r) => CLOSED.has(String(r.status)) && Number.isFinite(Number(r.rMultiple)))
    .sort((a, b) => {
      const ta = Date.parse(a.exitTime ?? a.candleCloseTime);
      const tb = Date.parse(b.exitTime ?? b.candleCloseTime);
      return ta - tb;
    });
  const open = delivered.filter((r) => String(r.status) === "OPEN");

  console.log(`LIVE ACCOUNT CURVE — ${from} → ${to}  (${closed.length} closed delivered trades, ${open.length} still open)`);
  for (const r of closed) {
    const when = new Date(Date.parse(r.exitTime ?? r.candleCloseTime)).toISOString().slice(5, 16).replace("T", " ");
    console.log(`  ${when} UTC  ${r.pair.padEnd(9)} ${String(r.direction).padEnd(5)} ${String(r.status).padEnd(8)} ${(Number(r.rMultiple) >= 0 ? "+" : "") + Number(r.rMultiple).toFixed(2)}R`);
  }
  for (const r of open) {
    console.log(`  in flight: ${r.pair} ${r.direction} ${r.tf} since ${r.candleCloseTime.slice(0, 16).replace("T", " ")} UTC`);
  }
  if (!closed.length) { console.log("\nNo closed delivered trades in this window."); return; }
  const netR = closed.reduce((s, r) => s + (Number(r.rMultiple) || 0), 0);
  console.log(`\nwindow net: ${netR >= 0 ? "+" : ""}${netR.toFixed(2)}R across ${closed.length} trades`);
  console.log("at a FIXED percent of the starting balance per trade:\n");
  for (const risk of [0.5, 0.75, 1.0]) {
    const c = curve(closed, risk);
    console.log(
      `risk ${risk.toFixed(2)}%: ends ${c.cum >= 0 ? "+" : ""}${c.cum.toFixed(2)}% · worst day ${c.worstDay.toFixed(2)}% (${c.worstDayLabel})` +
        ` · deepest dip ${c.maxDD.toFixed(2)}% · peak +${c.peak.toFixed(2)}%`,
    );
    console.log(
      `            daily -3% touched: ${c.dailyBreached ? "YES — account would have died that day" : "no"}` +
        ` · overall -5% touched: ${c.overallBreached ? "YES — account would have died" : "no"}`,
    );
    console.log(
      `            6% target: ${c.target6 ? "hit on " + c.target6 : `not reached (peak +${c.peak.toFixed(2)}%)`}` +
        ` · 8% target: ${c.target8 ? "hit on " + c.target8 : "not reached"}\n`,
    );
  }
  console.log("Read the worst-day and dip lines before the target lines. That order is the whole lesson.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));

// Module scope: without an export this file's helpers are global and collide
// with same-named helpers in other scripts under tsconfig.scripts.
export {};
