/** Walk-forward replay of the LIVE SLK alert engine on real Dukascopy
 *  minute data — the same candles the production worker consumes. Nothing is
 *  fabricated or synthesised; statistics come from the replay alone. (The
 *  model spec bans invented backtest/performance numbers; this script is how
 *  you produce real ones yourself.)
 *
 *  Two stats blocks are printed per run:
 *    • raw          — spread-naive, the historical baseline view
 *    • spread-adj.  — an ESTIMATED round-trip spread is subtracted from every
 *                     closed trade's R (see SPREAD_EST in src/perf.ts), so the
 *                     cost of actually getting filled is visible instead of
 *                     hidden. Still an estimate: no slippage/commission model.
 *  Plus a "Risk over time" section: exit-ordered equity curve with the worst
 *  peak→trough drawdown in R and the longest losing/winning streaks.
 *
 *  Usage (Codespaces terminal):
 *    cd /workspaces/SLK-bot/worker
 *    npm i -D tsx                      # one-time
 *    npx tsx scripts/backtest.ts                 # all 7 pairs, 60 days
 *    npx tsx scripts/backtest.ts US30 30         # one pair, 30 days
 *
 *  Report also lands in backtest-report-<date>.md (gitignored).
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { decodeJetta } from "../src/provider";
import { defaultStrategy, TF_SECONDS } from "../src/config";
import { resampleCandles, dropIncomplete } from "../src/features";
import { storylineSeries } from "../src/storyline";
import { scanEntry } from "../src/engine";
import { evaluateSignal } from "../src/outcomes";
import { summarize, spreadFor, type TradeRow } from "../src/perf";
import { COLS, pad, riskSection, row, tableLines } from "../src/report";
import type { Alert, Candle } from "../src/types";

const ROOT = "https://jetta.dukascopy.com/v1/candles";

/** canonical watchlist → Dukascopy instrument code (same map as provider.ts) */
const CODES: Record<string, string> = {
  US30: "USA30.IDX-USD", GER40: "DEU.IDX-EUR", DE40: "DEU.IDX-EUR",
  JAPAN225: "JPN.IDX-JPY", JP225: "JPN.IDX-JPY",
  EURUSD: "EUR-USD", GBPUSD: "GBP-USD", USDZAR: "USD-ZAR",
  XAUUSD: "XAU-USD",
};
const DEFAULT_PAIRS = ["EURUSD", "GBPUSD", "XAUUSD", "USDZAR", "US30", "GER40", "JAPAN225"];

const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; slk-backtest/1.0)" };

async function fetchJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (resp.status === 404) return null;         // pre-history / no trading that day
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      return await resp.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

function* dayRange(fromMs: number, toMs: number): Generator<Date> {
  for (let t = fromMs; t <= toMs; t += 86400_000) yield new Date(t);
}

/** minute file per UTC day across the window (raw 1-minute candles) */
async function loadMinuteHistory(code: string, from: Date, to: Date): Promise<Candle[]> {
  const urls: string[] = [];
  const today = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const activeUrl = `${ROOT}/minute/${code}/BID?from=${today.getTime()}`;
  for (const d of dayRange(from.getTime(), today.getTime() - 86400_000)) {
    urls.push(`${ROOT}/minute/${code}/BID/${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
  }
  urls.push(activeUrl); // the forming current-day bucket lives at ?from=\n
  const all: Candle[] = [];
  let done = 0;
  for (let i = 0; i < urls.length; i += 6) {          // polite batches of 6
    const chunk = await Promise.all(urls.slice(i, i + 6).map((u) => fetchJson(u)));
    for (const j of chunk) if (j) all.push(...decodeJetta(j as Parameters<typeof decodeJetta>[0]));
    done += chunk.length;
    process.stdout.write(`\r   minute files: ${Math.min(done, urls.length)}/${urls.length}`);
  }
  process.stdout.write("\n");
  all.sort((a, b) => a.t - b.t);
  return all.filter((c, i) => i === 0 || c.t > all[i - 1].t);
}

/** daily candles for the M/W/D bias context — whole-year files */
async function loadDailyContext(code: string, year: number): Promise<Candle[]> {
  const urls = [`${ROOT}/day/${code}/BID?from=${Date.UTC(year, 0, 1)}`, `${ROOT}/day/${code}/BID/${year - 1}`];
  const all: Candle[] = [];
  for (const u of urls) {
    const j = await fetchJson(u);
    if (j) all.push(...decodeJetta(j as Parameters<typeof decodeJetta>[0]));
  }
  all.sort((a, b) => a.t - b.t);
  return all.filter((c, i) => i === 0 || c.t > all[i - 1].t);
}

interface Trade extends TradeRow {
  setupId: string;
  entryTime: string;
  tp: number;
}

async function replay(pair: string, days: number, strategy = defaultStrategy()): Promise<Trade[]> {
  const code = CODES[pair];
  if (!code) throw new Error(`no Duka code for ${pair}`);
  const now = new Date();
  const scanStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days);
  const warmupStart = scanStart - 10 * 86400_000;

  console.log(`\n=== ${pair} (${code}) — fetching ${days}d + warmup…`);
  const m1 = await loadMinuteHistory(code, new Date(warmupStart), now);
  const d1 = await loadDailyContext(code, now.getUTCFullYear());
  console.log(`   ${m1.length.toLocaleString()} m1 bars, ${d1.length} d1 bars`);

  const m30 = resampleCandles(m1, TF_SECONDS["30m"]);
  const h1 = resampleCandles(m1, TF_SECONDS["1h"]);

  const seen = new Set<string>();
  const trades: Trade[] = [];
  // every 30m candle close in the scan window is a production tick
  for (let i = 0; i < m30.length; i++) {
    const close = m30[i].t + 1_800_000;
    if (close < scanStart || close > now.getTime()) continue;

    const base = m30.filter((c) => c.t + 1_800_000 <= close).slice(-1010); // prod: baseCandlesLimit
    if (base.length < 40) continue;                                          // prod: minCandles
    const h4 = dropIncomplete(resampleCandles(base, TF_SECONDS["4h"]), TF_SECONDS["4h"], close);
    if (h4.length < 30) continue;                                            // prod gate
    const d1t = d1.filter((c) => c.t + 86400_000 <= close).slice(-400);      // prod: candlesLimit
    if (d1t.length < 25) continue;
    const snaps = storylineSeries(d1t, h4, strategy);

    const tfs: [string, Candle[], number][] = [["30m", base, close]];
    if (close % 3_600_000 === 0) {                                            // 1h boundary
      const h1s = dropIncomplete(resampleCandles(base, 3600), 3600, close);
      tfs.push(["1h", h1s, close]);
    }
    for (const [tf, candles, nowMs] of tfs) {
      const { alerts } = scanEntry({
        pair, entryTf: tf, tfSeconds: TF_SECONDS[tf], candles, snaps,
        cfg: strategy, mode: "paper", provider: "dukascopy",
      });
      for (const a of alerts) {
        if (seen.has(a.setupId)) continue;                                    // prod dedupe
        seen.add(a.setupId);
        const tfCandles = tf === "1h" ? h1 : m30;
        const after = tfCandles.filter((c) => c.t >= a.candleCloseTime);      // prod semantics
        const oc = evaluateSignal(a.direction, a.entry, a.stopLoss, a.tpInternal, after, 120);
        trades.push({
          pair, tf, setupId: a.setupId,
          entryTime: new Date(a.candleCloseTime).toISOString().slice(0, 16).replace("T", " "),
          entry: a.entry, stop: a.stopLoss, tp: a.tpInternal,
          status: oc?.status ?? "OPEN",
          exit: oc?.exitPrice ?? after[after.length - 1]?.c ?? NaN,
          exitTime: oc ? new Date(oc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
          exitMs: oc ? oc.exitTime : NaN,
          r: oc?.rMultiple ?? NaN,
        });
      }
    }
  }
  return trades;
}

async function main() {
  const args = process.argv.slice(2);
  let days = 60;
  let pairs = DEFAULT_PAIRS;
  if (args.length && /^[A-Z]/.test(args[0])) { pairs = args[0].split(","); args.shift(); }
  if (args.length && /^\d+$/.test(args[0])) days = Number(args[0]);

  const strategy = defaultStrategy();   // the SAME gates the live worker uses
  const all: Trade[] = [];
  for (const pair of pairs) all.push(...await replay(pair, days, strategy));

  const views: { label: string; spread: boolean; rows: string[][]; total: PerfSummary }[] = [
    { label: "Raw (spread-naive)", spread: false, rows: [], total: summarize(all) },
    { label: "Spread-adjusted (ESTIMATE)", spread: true, rows: [], total: summarize(all, { spread: true }) },
  ];

  for (const view of views) {
    for (const pair of pairs) {
      const rows = all.filter((t) => t.pair === pair);
      view.rows.push(row(pair, summarize(rows, { spread: view.spread })));
    }
    view.rows.push(row("**TOTAL**", view.total));
  }

  let lines = `# SLK walk-forward replay — last ${days} days (real Dukascopy data, live-engine gates)\n\n`;
  for (const view of views) {
    console.log(`\n${view.label}`);
    console.log(pad(COLS));
    for (const r of view.rows) console.log(pad(r));
    lines += `\n## ${view.label}\n\n`;
    lines += `| ${COLS.join(" | ")} |\n|${COLS.map(() => "---").join("|")}|\n`;
    lines += tableLines(view.rows) + "\n";
    lines += `\n(win% = share of closed TP+SL trades with R > 0${view.spread ? " after the estimated spread cost" : ""}; `
      + `PF = Σwins/Σ|losses|; maxDD-R = worst peak→trough on the exit-ordered equity curve)\n`;
    lines += riskSection(`Risk over time — ${view.label}`, view.total);
  }

  lines += `\n\n## Spread cost model (ESTIMATE)\n\n`
    + `Round-trip spread subtracted from every closed trade's R: cost(R) = spread(price) / |entry − stop|.\n\n`
    + `| pair | est. round-trip spread (price units) |\n|---|---|\n`
    + pairs.map((p) => `| ${p} | ${spreadFor(p)} |`).join("\n") + "\n\n"
    + `Typical-session estimates, not measured fills: no slippage, commission or swap is modelled.\n`
    + `Pairs with a wide spread relative to their stop (USDZAR, JAPAN225) move the most.\n`;

  lines += `\n## Trades (pair, tf, entry time UTC, entry → exit, status, R)\n\n`;
  lines += `| pair | tf | entry time | entry | stop | tp | status | exit | exit time | R |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of all) {
    lines += `| ${r.pair} | ${r.tf} | ${r.entryTime} | ${r.entry} | ${r.stop} | ${r.tp} | ${r.status} | ${Number.isFinite(r.exit) ? r.exit : "-"} | ${r.exitTime} | ${Number.isFinite(r.r) ? r.r.toFixed(2) : "-"} |\n`;
  }
  const name = `backtest-report-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(name, lines);
  console.log(`\nreport written: ${name}\n(alert = entry that would have alerted; win% over TP+SL only; PF = Σwins/Σ|losses|)`);
}

// run only when invoked directly (`npx tsx scripts/backtest.ts …`), so the
// report helpers above stay importable by tests without hitting the network
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });
