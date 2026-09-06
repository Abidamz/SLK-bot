/** Walk-forward replay of the LIVE SLK alert engine on real Dukascopy
 *  minute data — the same candles the production worker consumes. Nothing is
 *  fabricated or synthesised; statistics come from the replay alone. (The
 *  model spec bans invented backtest/performance numbers; this script is how
 *  you produce real ones yourself.)
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
import { decodeJetta } from "../src/provider";
import { defaultStrategy, TF_SECONDS } from "../src/config";
import { resampleCandles, dropIncomplete } from "../src/features";
import { storylineSeries } from "../src/storyline";
import { scanEntry } from "../src/engine";
import { evaluateSignal } from "../src/outcomes";
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

/** ESTIMATE of typical spread, in price units. Conservative averages, NOT measured. */
const SPREAD_EST: Record<string, number> = {
  EURUSD: 0.00002, GBPUSD: 0.00004, XAUUSD: 0.40, USDZAR: 0.0025,
  US30: 4.0, GER40: 1.2, JAPAN225: 8.0,
};

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
  urls.push(activeUrl); // the forming current-day bucket lives at ?from=

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

interface Trade {
  pair: string; tf: string; setupId: string;
  entryTime: string; entry: number; stop: number; tp: number;
  status: string; exit: number; exitTime: string; r: number;
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
          r: oc?.rMultiple ?? NaN,
        });
      }
    }
  }
  return trades;
}

function stats(rows: Trade[], spreadAdj: boolean) {
  const adj = (t: Trade): Trade => {
    if (!spreadAdj || t.status === "OPEN" || !Number.isFinite(t.r)) return t;
    const riskDist = Math.abs(t.entry - t.stop);
    const spread = SPREAD_EST[t.pair] ?? 0;
    const costR = riskDist > 0 ? spread / riskDist : 0;
    return { ...t, r: t.r - 2 * costR };
  };
  const rowsA = rows.map(adj);
  const tp = rowsA.filter((r) => r.status === "TP_HIT");
  const sl = rowsA.filter((r) => r.status === "SL_HIT");
  const ex = rowsA.filter((r) => r.status === "EXPIRED");
  const closed = [...tp, ...sl];
  const r = closed.map((t) => t.r);
  const wins = tp.map((t) => t.r);
  const losses = sl.map((t) => Math.abs(t.r));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    alerts: rowsA.length, tp: tp.length, sl: sl.length, expired: ex.length,
    open: rowsA.length - tp.length - sl.length - ex.length,
    winrate: closed.length ? (tp.length / closed.length) * 100 : NaN,
    avgR: r.length ? sum(r) / r.length : NaN,
    pf: losses.length && sum(losses) > 0 ? sum(wins) / sum(losses) : NaN,
    ...rack(rowsA),
  };
}

/** Closed-trade equity curve, ordered by exit time. */
function rack(rows: Trade[]) {
  const closed = rows.filter((t) => t.status !== "OPEN" && Number.isFinite(t.r))
    .sort((a, b) => (a.exitTime + a.setupId).localeCompare(b.exitTime + b.setupId));
  let cum = 0, peak = 0, maxDD = 0, ddFrom = "-", ddTo = "-", peakAt: string | null = null;
  let loss = 0, win = 0, maxLoss = 0, maxWin = 0;
  for (const t of closed) {
    cum += t.r;
    if (cum > peak) { peak = cum; peakAt = t.exitTime; }
    if (peak - cum > maxDD) { maxDD = peak - cum; ddFrom = peakAt ?? "-"; ddTo = t.exitTime; }
    if (t.r > 0) { win++; loss = 0; } else { loss++; win = 0; }
    if (loss > maxLoss) maxLoss = loss;
    if (win > maxWin) maxWin = win;
  }
  return { maxDD, ddFrom, ddTo, lossStreak: maxLoss, winStreak: maxWin, finalR: cum };
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");

async function main() {
  const args = process.argv.slice(2);
  let days = 60;
  let pairs = DEFAULT_PAIRS;
  if (args.length && /^[A-Z]/.test(args[0])) { pairs = args[0].split(","); args.shift(); }
  if (args.length && /^\d+$/.test(args[0])) days = Number(args[0]);

  const strategy = defaultStrategy();   // the SAME gates the live worker uses
  const all: Trade[] = [];
  for (const pair of pairs) all.push(...await replay(pair, days, strategy));

  const cols = ["pair", "alerts", "TP", "SL", "EXP", "open", "win%", "avgR", "PF", "maxDD-R", "loseStrk"];
  console.log(`\n${cols.map((c) => c.padStart(9)).join("")}`);
  let lines = `# SLK walk-forward replay — last ${days} days (real Dukascopy data, live-engine gates)\n\n`;
  const emit = (spreadAdj: boolean) => {
    const block: string[] = [];
    block.push(`| pair | alerts | TP | SL | EXPIRED | open | win% | avgR | PF | maxDD (R) | lose streak |`);
    block.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const pair of pairs) {
      const rows = all.filter((t) => t.pair === pair);
      const s = stats(rows, spreadAdj);
      const line = [pair, String(s.alerts), String(s.tp), String(s.sl), String(s.expired), String(s.open),
        f(s.winrate, 1), f(s.avgR), f(s.pf), f(s.maxDD), String(s.lossStreak)];
      console.log(line.map((c) => c.padStart(9)).join(""));
      block.push(`| ${line.join(" | ")} |`);
    }
    const t = stats(all, spreadAdj);
    const tot = ["TOTAL", String(t.alerts), String(t.tp), String(t.sl), String(t.expired), String(t.open),
      f(t.winrate, 1), f(t.avgR), f(t.pf), f(t.maxDD), String(t.lossStreak)];
    console.log(tot.map((c) => c.padStart(9)).join(""));
    block.push(`| **${tot.join(" | ")}** |`);
    const riskNote = `max drawdown **${f(t.maxDD)}R** (${t.ddFrom} → ${t.ddTo} UTC) · ` +
      `≈${f(t.maxDD, 1)}% at 1% risk/trade · longest losing streak **${t.lossStreak}** ` +
      `· longest win streak ${t.winStreak} · net ${f(t.finalR, 1)}R over window`;
    console.log(`\n${riskNote.replace(/\*\*/g, "")}`);
    return { block: block.join("\n"), riskNote };
  };

  const raw = emit(false);
  const adj = emit(true);
  lines += `### Raw fills (mid touch)\n\n${raw.block}\n\n`;
  lines += `### Spread-adjusted (est. per-pair spread cost, 2× round trip)\n\n${adj.block}\n\n`;
  lines += `\n## Risk over time (raw / spread-adjusted)\n\n- raw: ${raw.riskNote}\n- adj: ${adj.riskNote}\n\n`;
  lines += `\n## Trades (pair, tf, entry time UTC, entry → exit, status, R)\n\n`;
  lines += `| pair | tf | entry time | entry | stop | tp | status | exit | exit time | R |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of all) {
    lines += `| ${r.pair} | ${r.tf} | ${r.entryTime} | ${r.entry} | ${r.stop} | ${r.tp} | ${r.status} | ${Number.isFinite(r.exit) ? r.exit : "-"} | ${r.exitTime} | ${Number.isFinite(r.r) ? r.r.toFixed(2) : "-"} |\n`;
  }

  const name = `backtest-report-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(name, lines);
  console.log(`\nreport written: ${name}\n(alert = entry that would have alerted; win% over TP+SL only; PF = Σwins/Σ|losses|)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
