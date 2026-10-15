/**
 * Live delivery split — direction, timeframe and pair, from the stored ledger.
 *
 * The owner reported seeing short signals only and a ~50% win rate on the
 * dashboard. Neither can be argued about from the dashboard's own aggregate:
 * it does not break down by direction, and its win% is TP/(TP+SL), which leaves
 * the breakeven scratches out of the denominator entirely. This pulls the raw
 * rows over HTTP and runs them through the SAME stats() and directionGroups()
 * the replay uses, so a live figure and a replay figure mean the same thing.
 *
 * Read-only. /alerts needs no key (readAuthed() returns true unconditionally).
 *
 *   npx tsx scripts/live_direction.ts
 *   npx tsx scripts/live_direction.ts --url https://... --from 2026-08-25
 */
import { directionGroups, f, stats, type Trade } from "../src/replay_stats";

const DEFAULT_URL = "https://slk-alert-worker.abidogundamilola.workers.dev";

const USAGE = `usage: npx tsx scripts/live_direction.ts [--url <base>] [--from <ISO>] [--to <ISO>]
  --url   worker base URL (default ${DEFAULT_URL})
  --from  only alerts at or after this ISO UTC date
  --to    only alerts at or before this ISO UTC date`;

interface Row {
  setupId: string; pair: string; tf: string; direction: string;
  entry: number; stopLoss: number; status: string; alertStatus: string;
  rMultiple: number; candleCloseTime: string;
}

function parseArgs(argv: string[]): { url: string; from?: string; to?: string } {
  let url = DEFAULT_URL;
  let from: string | undefined;
  let to: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (name: string): string => {
      const v = argv[++i];
      // An unset shell variable expands to nothing and would be swallowed as
      // the following positional, which is how a 360-day command once ran as
      // 60 days. Take the value or fail.
      if (v === undefined || v.startsWith("--")) {
        console.error(`${name} needs a value`);
        console.error(USAGE);
        process.exit(1);
      }
      return v;
    };
    if (a === "--url") url = next("--url");
    else if (a === "--from") from = next("--from");
    else if (a === "--to") to = next("--to");
    else {
      console.error(`unrecognised argument: ${JSON.stringify(a)}`);
      console.error(USAGE);
      process.exit(1);
    }
  }
  for (const [name, v] of [["--from", from], ["--to", to]] as const) {
    if (v !== undefined && !Number.isFinite(Date.parse(v))) {
      console.error(`${name} is not a parseable date: ${JSON.stringify(v)}`);
      process.exit(1);
    }
  }
  return { url: url.replace(/\/+$/, ""), from, to };
}

async function fetchAll(url: string, from?: string, to?: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 1; page <= 200; page++) {
    const q = new URLSearchParams({ page: String(page), pageSize: "200" });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const res = await fetch(`${url}/alerts?${q}`);
    if (!res.ok) {
      console.error(`GET /alerts?page=${page} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      process.exit(1);
    }
    const body = await res.json() as { items: Row[]; total: number };
    out.push(...body.items);
    if (out.length >= body.total || !body.items.length) {
      if (out.length < body.total) console.error(`warning: stopped at ${out.length} of ${body.total} rows`);
      return out;
    }
  }
  console.error("stopped after 200 pages without reaching total; results are partial");
  return out;
}

/** API row -> the Trade shape stats() consumes. Only the fields stats() reads
 *  are real; the rest are placeholders it never touches. */
function toTrade(r: Row): Trade {
  return {
    pair: r.pair, tf: r.tf, setupId: r.setupId,
    entryTime: r.candleCloseTime, entry: r.entry, stop: r.stopLoss, tp: NaN,
    status: r.status, exit: NaN, exitTime: "-", r: r.rMultiple,
    limitStatus: "OPEN", limitEntry: NaN, limitExitTime: "-", limitR: NaN,
    marketStatus: "OPEN", marketEntry: NaN, marketExitTime: "-", marketR: NaN,
    dir: r.direction === "LONG" || r.direction === "SHORT" ? r.direction : undefined,
  };
}

const cols = ["group", "alerts", "TP", "SL", "BE", "EXP", "open", "win%", "netR", "R/alert", "PF"];

function table(label: string, groups: [string, Trade[]][], spreadAdj: boolean): void {
  console.log(`\n${label} — ${spreadAdj ? "spread-adjusted" : "raw"}`);
  console.log(cols.map((c) => c.padStart(9)).join(""));
  for (const [name, rows] of groups) {
    if (!rows.length && name === "UNKNOWN") continue;
    const s = stats(rows, spreadAdj);
    const rPerAlert = rows.length ? s.finalR / rows.length : NaN;
    console.log([name, String(s.alerts), String(s.tp), String(s.sl), String(s.be), String(s.expired),
      String(s.open), f(s.winrate, 1), f(s.finalR, 1), f(rPerAlert, 3), f(s.pf)]
      .map((c) => c.padStart(9)).join(""));
  }
}

async function main(): Promise<void> {
  const { url, from, to } = parseArgs(process.argv.slice(2));
  const span = [from, to].some(Boolean) ? ` [${from ?? "…"} → ${to ?? "…"}]` : "";
  console.log(`source: ${url}${span}`);
  const rows = await fetchAll(url, from, to);
  const delivered = rows.filter((r) => String(r.alertStatus ?? "").toUpperCase() !== "SUPPRESSED");
  const suppressed = rows.length - delivered.length;
  const trades = delivered.map(toTrade);

  if (!trades.length) {
    console.log("no delivered alerts in range");
    return;
  }
  const first = delivered.map((r) => r.candleCloseTime).sort()[0];
  const last = delivered.map((r) => r.candleCloseTime).sort().slice(-1)[0];
  console.log(`${delivered.length} delivered alerts (${suppressed} suppressed, excluded)`);
  console.log(`window: ${first} → ${last}`);
  console.log("\nwin% is TP/(TP+SL) — the project's convention. Breakeven scratches (BE) and");
  console.log("EXPIRED are NOT in the denominator, so it reads higher than the share of");
  console.log("alerts that made money. R/alert is net R over ALL alerts, which is the");
  console.log("figure the 0.30R gate was written against.");

  for (const adj of [false, true]) {
    table("DIRECTION", directionGroups(trades), adj);
    table("ENTRY TF", groupBy(trades, (t) => t.tf), adj);
    table("PAIR", groupBy(trades, (t) => t.pair), adj);
  }
}

/** Same discipline as directionGroups: never drop a group for being unnamed. */
function groupBy(rows: Trade[], key: (t: Trade) => string): [string, Trade[]][] {
  const names = [...new Set(rows.map(key))].sort();
  return names.map((n) => [n, rows.filter((t) => key(t) === n)] as [string, Trade[]]);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
