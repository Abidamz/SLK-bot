/** Walk-forward replay of the LIVE TAYO alert engine on real Dukascopy
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
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { decodeJetta, fetchOandaRange } from "../src/provider";
import { defaultStrategy, pipSize, TF_SECONDS } from "../src/config";
import { resampleCandles, dropIncomplete, resampleCalendar } from "../src/features";
import { storylineSeries } from "../src/storyline";
import { scanEntry } from "../src/engine";
import {
  DEFAULT_CONFIRMATION_PARAMS as CONF_PARAMS,
  findConfirmationEntries,
  thirdCandleOutcome,
} from "../src/confirmation";
import {
  DEFAULT_CONTINUATION_PARAMS as CONT_PARAMS,
  findContinuationSetups,
  multiTfGate,
  type ContinuationSetup,
} from "../src/continuation";
import { evaluateSignal } from "../src/outcomes";
import type { Alert, Candle } from "../src/types";

const ROOT = "https://jetta.dukascopy.com/v1/candles";

/** canonical watchlist → Dukascopy instrument code (same map as provider.ts) */
const CODES: Record<string, string> = {
  US30: "USA30.IDX-USD", GER40: "DEU.IDX-EUR", DE40: "DEU.IDX-EUR",
  JAPAN225: "JPN.IDX-JPY", JP225: "JPN.IDX-JPY",
  NAS100: "USATECH.IDX-USD", US100: "USATECH.IDX-USD",
  EURUSD: "EUR-USD", GBPUSD: "GBP-USD", USDZAR: "USD-ZAR",
  USDJPY: "USD-JPY", AUDJPY: "AUD-JPY", GBPJPY: "GBP-JPY", EURJPY: "EUR-JPY",
  USDCAD: "USD-CAD", NZDUSD: "NZD-USD",
  XAUUSD: "XAU-USD",
};
// Every live pair Dukascopy carries. The ten Deriv synthetics (V*) are not
// available on this feed, so they cannot be replayed here at all.
const DEFAULT_PAIRS = [
  "AUDJPY", "EURJPY", "GBPJPY", "USDJPY", "USDCAD", "JAPAN225", "NAS100",
  "EURUSD", "GBPUSD", "NZDUSD", "XAUUSD", "US30", "GER40",
];

/** ESTIMATE of typical spread, in price units. Conservative averages, NOT measured. */
const SPREAD_EST: Record<string, number> = {
  EURUSD: 0.00002, GBPUSD: 0.00004, XAUUSD: 0.40, USDZAR: 0.0025,
  US30: 4.0, GER40: 1.2, JAPAN225: 8.0, NAS100: 1.5,
  USDJPY: 0.015, AUDJPY: 0.02, GBPJPY: 0.03, EURJPY: 0.02,
  USDCAD: 0.00002, NZDUSD: 0.00003,
};

const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; slk-backtest/1.0)" };

let emptyDays = 0;
let okDays = 0;

/**
 * The feed answers with an empty body for days with no trading (weekends,
 * holidays) rather than a 404, and occasionally with an HTML error page under
 * load. Both used to reach JSON.parse and abort the whole replay. Treat an
 * empty or unparseable body as "no data for this day" and carry on.
 */
async function fetchJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (resp.status === 404) { emptyDays++; return null; }   // pre-history / no trading that day
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      const text = (await resp.text()).trim();
      if (!text) { emptyDays++; return null; }
      try {
        const parsed = JSON.parse(text);
        okDays++;
        return parsed;
      } catch {
        emptyDays++;
        return null;                                            // HTML error page, not JSON
      }
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
  const out = all.filter((c, i) => i === 0 || c.t > all[i - 1].t);
  console.log(`   day files: ${okDays} with data, ${emptyDays} empty/unparseable (weekends and holidays are expected)`);
  return out;
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
  limitStatus: string; limitEntry: number; limitExitTime: string; limitR: number;
  marketStatus: string; marketEntry: number; marketExitTime: string; marketR: number;
  /** Continuation shadow only: how impulsive the break candle was. */
  bodyPct?: number; bodyAtr?: number;
}

const OANDA_TOKEN = process.env.OANDA_API_TOKEN ?? process.env.OANDA_API_KEY ?? "";
const OANDA_ENV = (process.env.OANDA_ENV ?? "auto") as "practice" | "live" | "auto";

/** OANDA serves M1 directly, so no resampling guesswork is needed. */
/**
 * Candle cache.
 *
 * A 180-day sweep across thirteen pairs fetches ~2.5M minute bars, which
 * takes about twenty minutes — and a parameter sweep is five of those back
 * to back over identical data. The candles do not change between runs, so
 * they are written to disk once and reused. Delete .backtest-cache/ to
 * force a refetch.
 */
const CACHE_DIR = join(process.cwd(), ".backtest-cache");

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const file = join(CACHE_DIR, `${key}.json`);
  try {
    return Promise.resolve(JSON.parse(readFileSync(file, "utf8")) as T);
  } catch {
    return load().then((rows) => {
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(rows));
      } catch {
        // A cache that cannot be written costs time, not correctness.
      }
      return rows;
    });
  }
}

async function loadMinuteHistoryOanda(pair: string, from: Date, to: Date): Promise<Candle[]> {
  const key = [pair, "1m", from.getTime(), to.getTime()].join("-");
  let hit = true;
  const rows = await cached<Candle[]>(key, async () => {
    hit = false;
    return fetchOandaRange(OANDA_TOKEN, pair, "1m", from.getTime(), to.getTime(), {
      environment: OANDA_ENV,
    });
  });
  const span = rows.length
    ? ` (${new Date(rows[0].t).toISOString().slice(0, 10)} → ${new Date(rows[rows.length - 1].t).toISOString().slice(0, 10)})`
    : "";
  console.log(`   ${rows.length.toLocaleString()} m1 bars ${hit ? "from cache" : "via OANDA"}${span}`);
  return rows;
}

/** Two years of daily bars is enough for the M/W/D bias context. */
async function loadDailyContextOanda(pair: string, to: Date): Promise<Candle[]> {
  const fromMs = to.getTime() - 730 * 86400_000;
  const key = [pair, "1d", fromMs, to.getTime()].join("-");
  return cached<Candle[]>(key, () =>
    fetchOandaRange(OANDA_TOKEN, pair, "1d", fromMs, to.getTime(), { environment: OANDA_ENV }));
}

/**
 * Days to shift the end of the scan window back from today. Lets the same
 * window length be replayed over two disjoint periods, so a pair that looks
 * weak can be checked against a second sample before anything is dropped.
 */
const END_OFFSET_DAYS = Math.max(0, Number(process.env.BACKTEST_END_OFFSET_DAYS ?? "0") || 0);

/** How many entry-TF candles a pending limit at the retest close stays live. */
const LIMIT_WINDOW_CANDLES = 2;

/**
 * Which timeframes must agree for a continuation setup to count. Weekly/daily/
 * 4H is the chain the mentorship gives for a storyline started on the weekly:
 * "you need the daily and the four hours". The entry timeframe is where the
 * setup is looked for, not part of the bias gate.
 */
const CONT_GATE = (process.env.BACKTEST_CONT_GATE ?? "w1,d1,h4")
  .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const CONT_MIN_TOUCHES = Number(process.env.BACKTEST_CONT_MIN_TOUCHES ?? CONT_PARAMS.minTouches);
const CONT_MAX_DEPTH = Number(process.env.BACKTEST_CONT_MAX_DEPTH ?? CONT_PARAMS.maxRetraceDepth);
const CONT_RR = Number(process.env.BACKTEST_CONT_RR ?? CONT_PARAMS.rr);
/**
 * Where the impulsive leg is measured from for the shallow-retracement test.
 * He never says; the two readings disagree, so the sweep decides.
 */
const CONT_LEG_ORIGIN = (process.env.BACKTEST_CONT_LEG_ORIGIN ?? CONT_PARAMS.legOrigin) as "break" | "level";
/**
 * The "impulsive move" test. Off by default on purpose — he calls it the
 * blueprint and never numbers it, so the baseline run measures the setups
 * without it and reports their distribution. Pick the threshold from that,
 * not from a guess.
 */
const CONT_MIN_BODY_PCT = Number(process.env.BACKTEST_CONT_MIN_BODY_PCT ?? CONT_PARAMS.minBreakBodyPct);
const CONT_MIN_BREAK_ATR = Number(process.env.BACKTEST_CONT_MIN_BREAK_ATR ?? CONT_PARAMS.minBreakAtrMult);
/** Require liquidity resting on the far side of the level. Part of the definition. */
const CONT_REQUIRE_LIQ = (process.env.BACKTEST_CONT_REQUIRE_LIQ ?? String(CONT_PARAMS.requireLiquidity)) !== "false";
const CONT_ENABLED = CONT_GATE.length > 0;
/** Confirmation entry — the second model, traded when the first was missed. */
const CONF_RR = Number(process.env.BACKTEST_CONF_RR ?? CONF_PARAMS.rr);
const CONF_STOP_PIPS = Number(process.env.BACKTEST_CONF_STOP_PIPS ?? "1");
const CONF_LOOKBACK = Number(process.env.BACKTEST_CONF_LOOKBACK ?? CONF_PARAMS.setupLookback);
/**
 * Off by default until the model is right. The first 180d run produced 45,652
 * entries across thirteen pairs. He describes taking one or two trades a week,
 * which is on the order of fifty over the same window — so this is firing
 * roughly nine hundred times too often and is not his model yet. What is
 * missing is the condition that price is reacting from a higher-timeframe key
 * level; without it the trigger reduces to "any close back above a recent low",
 * which happens constantly. Left in place, gated off, so the gap is visible.
 */
const CONF_ENABLED = (process.env.BACKTEST_CONF ?? "false") === "true";

async function replay(
  pair: string, days: number, strategy = defaultStrategy(),
): Promise<{ origin: Trade[]; continuation: Trade[]; confirmation: Trade[] }> {
  const useOanda = SOURCE === "oanda";
  const code = CODES[pair] ?? pair;
  if (!useOanda && !CODES[pair]) throw new Error(`no Duka code for ${pair}`);
  const now = new Date(Date.now() - END_OFFSET_DAYS * 86400_000);
  const scanStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days);
  const warmupStart = scanStart - 10 * 86400_000;

  const span = `${new Date(scanStart).toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`;
  console.log(`\n=== ${pair} (${useOanda ? "OANDA" : code}) — ${days}d [${span}]`);
  const m1 = useOanda
    ? await loadMinuteHistoryOanda(pair, new Date(warmupStart), now)
    : await loadMinuteHistory(code, new Date(warmupStart), now);
  const d1 = useOanda
    ? await loadDailyContextOanda(pair, now)
    : await loadDailyContext(code, now.getUTCFullYear());
  if (!useOanda) console.log(`   ${m1.length.toLocaleString()} m1 bars, ${d1.length} d1 bars`);
  if (!m1.length) {
    console.log(`   !! no bars returned — skipping ${pair}`);
    // Must match the normal return shape. Returning a bare [] here makes
    // `r.origin` undefined in the caller, and spreading undefined throws —
    // so one pair with no bars would abort the entire replay.
    return { origin: [], continuation: [], confirmation: [] };
  }

  const m30 = resampleCandles(m1, TF_SECONDS["30m"]);
  const h1 = resampleCandles(m1, TF_SECONDS["1h"]);
  const w1 = resampleCalendar(d1, "W");

  const seen = new Set<string>();
  const trades: Trade[] = [];
  // Why a replay produced nothing is invisible without these: a silent zero
  // looks identical whether the window was empty or every tick was gated.
  let ticks = 0;
  const skip = { base: 0, h4: 0, d1: 0, window: 0 };
  // The engine's own funnel counters, aggregated exactly as the coverage
  // audit reports them. Without these a replay that finds nothing is
  // indistinguishable from a replay that never ran the funnel.
  const fun: Record<string, number> = {};
  // Continuation shadow state, kept apart from the origin trades so the two
  // models never contaminate each other's numbers.
  const contSeen = new Set<string>();
  const contDiag: Record<string, number> = {};
  const contTrades: Trade[] = [];
  const contGateSeen: Record<string, number> = {};
  let gateCache: { key: string; dir: ReturnType<typeof multiTfGate> } = { key: "", dir: null };
  const confSeen = new Set<string>();
  const confTrades: Trade[] = [];
  /** Third-candle tallies, so the 80-90% claim gets counted rather than trusted. */
  const confThird: Record<string, number> = {};
  const bump = (k: string, n?: number) => { fun[k] = (fun[k] ?? 0) + (n ?? 0); };
  // every 30m candle close in the scan window is a production tick
  for (let i = 0; i < m30.length; i++) {
    const close = m30[i].t + 1_800_000;
    if (close < scanStart || close > now.getTime()) { skip.window++; continue; }

    // m30 is sorted and this loop is chronological; slicing avoids rescanning
    // the entire history for every production tick.
    const end = i + 1;
    const base = m30.slice(Math.max(0, end - 1010), end); // prod: baseCandlesLimit
    ticks++;
    if (base.length < 40) { skip.base++; continue; }                          // prod: minCandles
    const h4 = dropIncomplete(resampleCandles(base, TF_SECONDS["4h"]), TF_SECONDS["4h"], close);
    if (h4.length < 30) { skip.h4++; continue; }                              // prod gate
    const d1t = d1.filter((c) => c.t + 86400_000 <= close).slice(-400);       // prod: candlesLimit
    if (d1t.length < 25) { skip.d1++; continue; }
    const snaps = storylineSeries(d1t, h4, strategy);

    // Continuation bias gate. Weekly/daily/4H only change when one of their
    // own candles closes, so the result is cached on those close times —
    // otherwise every tick would recompute three swing scans for nothing.
    if (CONT_ENABLED) {
      const gateKey = [w1.at(-1)?.t ?? 0, d1t.at(-1)?.t ?? 0, h4.at(-1)?.t ?? 0].join("|");
      if (gateKey !== gateCache.key) {
        const byName: Record<string, Candle[]> = { w1, d1: d1t, h4 };
        const chosen = CONT_GATE.map((k) => byName[k]).filter((c): c is Candle[] => Boolean(c) && c.length > 0);
        gateCache = { key: gateKey, dir: multiTfGate(chosen) };
      }
      contGateSeen[gateCache.dir ?? "none"] = (contGateSeen[gateCache.dir ?? "none"] ?? 0) + 1;
    }

    const tfs: [string, Candle[], number][] = [["30m", base, close]];
    if (close % 3_600_000 === 0) {                                            // 1h boundary
      const h1s = dropIncomplete(resampleCandles(base, 3600), 3600, close);
      tfs.push(["1h", h1s, close]);
    }
    for (const [tf, candles, nowMs] of tfs) {
      const res = scanEntry({
        pair, entryTf: tf, tfSeconds: TF_SECONDS[tf], candles, snaps,
        cfg: strategy, mode: "paper", provider: "oanda",
      });
      const alerts = res.alerts;
      const d = res.diagnostics;
      const dRec = d as unknown as Record<string, number | undefined>;
      for (const k of ["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST"]) bump(k, dRec[k] ?? 0);
      bump("cand", d.retestCandidates ?? 0);
      bump("noFvg", d.retestNoFvg ?? 0);
      bump("fvg", d.retestWithFvg ?? 0);
      bump("risk", d.riskRejects ?? 0);
      bump("tgt", d.targetRejects ?? 0);
      bump("conf", d.confirmedAlerts ?? 0);
      if (CONT_ENABLED && gateCache.dir) {
        const tfCandles = tf === "1h" ? h1 : m30;
        for (const cs of findContinuationSetups(tfCandles, strategy, gateCache.dir, {
          ...CONT_PARAMS,
          minTouches: CONT_MIN_TOUCHES,
          maxRetraceDepth: CONT_MAX_DEPTH,
          rr: CONT_RR,
          legOrigin: CONT_LEG_ORIGIN,
          minBreakBodyPct: CONT_MIN_BODY_PCT,
          minBreakAtrMult: CONT_MIN_BREAK_ATR,
          requireLiquidity: CONT_REQUIRE_LIQ,
        }, contDiag)) {
          if (contSeen.has(cs.setupId)) continue;
          contSeen.add(cs.setupId);
          const after = tfCandles.filter((c) => c.t >= cs.time);
          const oc = evaluateSignal(cs.direction, cs.entry, cs.stop, cs.tp, after, 120);
          contTrades.push({
            pair, tf, setupId: cs.setupId,
            entryTime: new Date(cs.time).toISOString().slice(0, 16).replace("T", " "),
            entry: cs.entry, stop: cs.stop, tp: cs.tp,
            status: oc?.status ?? "OPEN",
            exit: oc?.exitPrice ?? after[after.length - 1]?.c ?? NaN,
            exitTime: oc ? new Date(oc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
            r: oc?.rMultiple ?? NaN,
            limitStatus: "OPEN", limitEntry: cs.entry, limitExitTime: "-", limitR: NaN,
            marketStatus: "OPEN", marketEntry: cs.entry, marketExitTime: "-", marketR: NaN,
            bodyPct: cs.bodyPct, bodyAtr: cs.bodyAtr,
          });
        }
      }
      if (CONF_ENABLED && gateCache.dir) {
        const tfCandles = tf === "1h" ? h1 : m30;
        for (const ce of findConfirmationEntries(tfCandles, gateCache.dir, {
          ...CONF_PARAMS, rr: CONF_RR, setupLookback: CONF_LOOKBACK,
          stopBuffer: CONF_STOP_PIPS * pipSize(pair),
        })) {
          if (confSeen.has(ce.setupId)) continue;
          confSeen.add(ce.setupId);
          const after = tfCandles.filter((c) => c.t >= ce.time);
          const oc = evaluateSignal(ce.direction, ce.entry, ce.stop, ce.tp, after, 120);
          const third = thirdCandleOutcome(tfCandles, ce);
          confThird[third] = (confThird[third] ?? 0) + 1;
          confTrades.push({
            pair, tf, setupId: ce.setupId,
            entryTime: new Date(ce.time).toISOString().slice(0, 16).replace("T", " "),
            entry: ce.entry, stop: ce.stop, tp: ce.tp,
            status: oc?.status ?? "OPEN",
            exit: oc?.exitPrice ?? after[after.length - 1]?.c ?? NaN,
            exitTime: oc ? new Date(oc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
            r: oc?.rMultiple ?? NaN,
            limitStatus: "OPEN", limitEntry: ce.entry, limitExitTime: "-", limitR: NaN,
            marketStatus: "OPEN", marketEntry: ce.entry, marketExitTime: "-", marketR: NaN,
            bodyPct: third === "played_out" ? 1 : third === "internal_liquidity" ? 0 : NaN,
          });
        }
      }
      for (const a of alerts) {
        if (seen.has(a.setupId)) continue;                                    // prod dedupe
        seen.add(a.setupId);
        const tfCandles = tf === "1h" ? h1 : m30;
        const after = tfCandles.filter((c) => c.t >= a.candleCloseTime);      // prod semantics
        const oc = evaluateSignal(a.direction, a.entry, a.stopLoss, a.tpInternal, after, 120);
        // Two execution models, both off the price production actually quotes.
        //
        // notify.ts instructs a pending limit AT THE RETEST CLOSE (a.entry), not
        // at the key level. An earlier revision used the key-level zone midpoint;
        // that sits on top of the stop, so every fill was entered at its own stop
        // and returned exactly -1R. The limit belongs at a.entry.
        //
        // A limit fills only if price trades back through a.entry within the
        // window; if price runs away the order never fills and there is no
        // trade. A market order always fills, at the next candle's open.
        const limitEntry = a.entry;
        const fillIndex = after.slice(0, LIMIT_WINDOW_CANDLES)
          .findIndex((c) => a.direction === "LONG" ? c.l <= limitEntry : c.h >= limitEntry);
        const limitOc = fillIndex >= 0
          ? evaluateSignal(a.direction, limitEntry, a.stopLoss, a.tpInternal, after.slice(fillIndex), 120)
          : null;
        const mktCandle = after[0];
        const marketEntry = mktCandle?.o ?? a.entry;
        const marketOc = mktCandle
          ? evaluateSignal(a.direction, marketEntry, a.stopLoss, a.tpInternal, after, 120)
          : null;
        trades.push({
          pair, tf, setupId: a.setupId,
          entryTime: new Date(a.candleCloseTime).toISOString().slice(0, 16).replace("T", " "),
          entry: a.entry, stop: a.stopLoss, tp: a.tpInternal,
          status: oc?.status ?? "OPEN",
          exit: oc?.exitPrice ?? after[after.length - 1]?.c ?? NaN,
          exitTime: oc ? new Date(oc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
          r: oc?.rMultiple ?? NaN,
          limitStatus: limitOc?.status ?? (fillIndex >= 0 ? "OPEN" : "NO_FILL"),
          limitEntry,
          limitExitTime: limitOc ? new Date(limitOc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
          limitR: limitOc?.rMultiple ?? NaN,
          marketStatus: marketOc?.status ?? "OPEN",
          marketEntry,
          marketExitTime: marketOc ? new Date(marketOc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
          marketR: marketOc?.rMultiple ?? NaN,
        });
      }
    }
  }
  console.log(
    `   ticks ${ticks} (skipped: outside window ${skip.window}, short base ${skip.base}, ` +
      `short h4 ${skip.h4}, short d1 ${skip.d1}) → ${trades.length} alerts`,
  );
  if (ticks) {
    const keys = ["MAP", "TOUCH", "SWEEP", "SHIFT", "RETEST", "cand", "noFvg", "fvg", "risk", "tgt", "conf"];
    console.log("   funnel: " + keys.map((k) => `${k} ${fun[k] ?? 0}`).join("  "));
  }
  const gateSummary = Object.entries(contGateSeen).map(([k, v]) => `${k} ${v}`).join("  ");
  if (CONT_ENABLED) {
    console.log(`   cont gate: ${gateSummary || "n/a"} · setups ${contTrades.length}`);
    // Which rule rejected what. Without this, "0 setups" cannot be acted on.
    const order = ["levels", "noFvg", "wrongDir", "touches", "depth", "bodyPct", "bodyAtr", "liquidity", "rebalance", "risk", "emitted"];
    console.log("   cont rejects: " + order.map((k) => `${k} ${contDiag[k] ?? 0}`).join("  "));
  }
  const thirdSummary = Object.entries(confThird).map(([k, v]) => `${k} ${v}`).join("  ");
  if (CONF_ENABLED) console.log(`   conf entries ${confTrades.length} · third candle: ${thirdSummary || "n/a"}`);
  return { origin: trades, continuation: contTrades, confirmation: confTrades };
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

function limitShadowRows(rows: Trade[]): Trade[] {
  return rows.map((t) => ({
    ...t,
    entry: t.limitEntry,
    status: t.limitStatus,
    exitTime: t.limitExitTime,
    r: t.limitR,
  }));
}

function marketShadowRows(rows: Trade[]): Trade[] {
  return rows.map((t) => ({
    ...t,
    entry: t.marketEntry,
    status: t.marketStatus,
    exitTime: t.marketExitTime,
    r: t.marketR,
  }));
}

/**
 * OANDA only.
 *
 * Dukascopy remains a real provider in the worker (providerForPair), but its
 * feed returns no bars for every instrument. Left as the backtest's fallback
 * it produced a complete report — per-pair tables, totals, an execution
 * comparison — in which every figure was zero. That reads like a measured
 * result rather than a broken fetch, which is the worst failure mode
 * available. Require OANDA and stop if it is missing.
 */
const SOURCE = (process.env.BACKTEST_SOURCE ?? "oanda").toLowerCase();

async function main() {
  const args = process.argv.slice(2);
  let days = 60;
  let pairs = DEFAULT_PAIRS;
  if (args.length && /^[A-Z]/.test(args[0])) { pairs = args[0].split(","); args.shift(); }
  if (args.length && /^\d+$/.test(args[0])) days = Number(args[0]);

  if (SOURCE !== "oanda") {
    console.error(
      `BACKTEST_SOURCE must be 'oanda' (got '${SOURCE}').\n` +
      `The Dukascopy feed returns no bars for any instrument.`,
    );
    process.exit(1);
  }
  if (!OANDA_TOKEN) {
    console.error(
      "OANDA_API_TOKEN (or OANDA_API_KEY) is not set, and there is no working fallback.\n" +
      "  export OANDA_API_TOKEN=<token>",
    );
    process.exit(1);
  }
  console.log(`source: ${SOURCE}`);

  const requestedMinTpR = Number(process.env.BACKTEST_MIN_TP_R ?? "");
  const strategy = Number.isFinite(requestedMinTpR) && requestedMinTpR > 0
    ? { ...defaultStrategy(), minTpR: requestedMinTpR }
    : defaultStrategy();   // the SAME gates the live worker uses
  if (strategy.minTpR !== defaultStrategy().minTpR) {
    console.log(`
*** BACKTEST OVERRIDE: minTpR=${strategy.minTpR} (research comparison only) ***`);
  }
  // scanEntry logs every storyline transition, which is useful in production
  // but can overwhelm a long replay. Opt in with BACKTEST_VERBOSE=1.
  const originalInfo = console.info;
  if (process.env.BACKTEST_VERBOSE !== "1") console.info = () => {};
  const all: Trade[] = [];
  const contAll: Trade[] = [];
  const confAll: Trade[] = [];
  try {
    for (const pair of pairs) {
      const r = await replay(pair, days, strategy);
      all.push(...r.origin);
      contAll.push(...r.continuation);
      confAll.push(...r.confirmation);
    }
  } finally {
    console.info = originalInfo;
  }

  const cols = ["pair", "alerts", "TP", "SL", "EXP", "open", "win%", "netR", "avgR", "PF", "maxDD-R", "loseStrk"];
  console.log(`\n${cols.map((c) => c.padStart(9)).join("")}`);
  let lines = `# TAYO walk-forward replay — last ${days} days (real Dukascopy data, live-engine gates)\n\n`;
  const emit = (spreadAdj: boolean) => {
    const block: string[] = [];
    block.push(`| pair | alerts | TP | SL | EXPIRED | open | win% | netR | avgR | PF | maxDD (R) | lose streak |`);
    block.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const pair of pairs) {
      const rows = all.filter((t) => t.pair === pair);
      const s = stats(rows, spreadAdj);
      const line = [pair, String(s.alerts), String(s.tp), String(s.sl), String(s.expired), String(s.open),
        f(s.winrate, 1), f(s.finalR, 1), f(s.avgR), f(s.pf), f(s.maxDD), String(s.lossStreak)];
      console.log(line.map((c) => c.padStart(9)).join(""));
      block.push(`| ${line.join(" | ")} |`);
    }
    const t = stats(all, spreadAdj);
    const tot = ["TOTAL", String(t.alerts), String(t.tp), String(t.sl), String(t.expired), String(t.open),
      f(t.winrate, 1), f(t.finalR, 1), f(t.avgR), f(t.pf), f(t.maxDD), String(t.lossStreak)];
    console.log(tot.map((c) => c.padStart(9)).join(""));
    block.push(`| **${tot.join(" | ")}** |`);
    const riskNote = `max drawdown **${f(t.maxDD)}R** (${t.ddFrom} → ${t.ddTo} UTC) · ` +
      `≈${f(t.maxDD, 1)}% at 1% risk/trade · longest losing streak **${t.lossStreak}** ` +
      `· longest win streak ${t.winStreak} · net ${f(t.finalR, 1)}R over window`;
    console.log(`\n${riskNote.replace(/\*\*/g, "")}`);
    return { block: block.join("\n"), riskNote };
  };

  const missing = pairs.filter((p2) => SPREAD_EST[p2] === undefined);
  if (missing.length) {
    console.log(
      `\n!! No spread estimate for: ${missing.join(", ")}.` +
        ` Their "spread-adjusted" figures equal raw (cost treated as 0), so those rows understate real cost.`,
    );
  }

  const raw = emit(false);
  const adj = emit(true);
  lines += `### Raw fills (mid touch)\n\n${raw.block}\n\n`;
  lines += `### Spread-adjusted (est. per-pair spread cost, 2× round trip)\n\n${adj.block}\n\n`;

  // Three execution models off the SAME alerts, so the only thing that varies
  // is how the trade is entered.
  //   1. pending limit at the retest close — what notify.ts instructs. Fills
  //      only if price trades back through that price; runners are missed.
  //   2. market at the next candle's open — always filled, pays the gap.
  //   3. entry at the retest close, assumed always filled — the main table
  //      above. Included so the other two can be read against it.
  const execNote = (rows: Trade[], spreadAdj: boolean, filled: number) => {
    const s = stats(rows, spreadAdj);
    const pct = all.length ? ((filled / all.length) * 100).toFixed(1) : "-";
    return `filled ${filled}/${all.length} (${pct}%) · avg ${f(s.avgR)}R · PF ${f(s.pf)} · ` +
      `maxDD ${f(s.maxDD)}R · net ${f(s.finalR)}R`;
  };
  const limitUnfilled = all.filter((t) => t.limitStatus === "NO_FILL").length;
  const limitFilled = all.length - limitUnfilled;

  console.log(`\nEXECUTION COMPARISON — same ${all.length} alerts, three ways to get in:`);
  const execLines: string[] = [];
  for (const [label, adj] of [["raw ", false], ["adj ", true]] as const) {
    const models: [string, string][] = [
      [`1. pending limit @ retest close (${LIMIT_WINDOW_CANDLES} candles)`,
        execNote(limitShadowRows(all), adj, limitFilled)],
      ["2. market @ next open                    ", execNote(marketShadowRows(all), adj, all.length)],
      ["3. entry @ retest close, always filled   ", execNote(all, adj, all.length)],
    ];
    if (adj) console.log("");
    for (const [name, note] of models) console.log(`   ${label} ${name} : ${note}`);
    for (const [name, note] of models) execLines.push(`- ${label.trim()} ${name.trim()} : ${note}`);
  }
  if (limitUnfilled > 0)
    console.log(`\n   ${limitUnfilled} alerts never filled the limit — price ran away. No trade, no loss.`);

  lines += `\n## Execution comparison — same ${all.length} alerts, three entry models\n\n`;
  lines += `Model 1 is what production instructs (notify.ts: pending limit at the retest\n` +
    `close). Model 2 is the alternative. Model 3 is the main table above, included\n` +
    `as the reference.\n\n${execLines.join("\n")}\n\n`;
  lines += `\n## Risk over time (raw / spread-adjusted)\n\n- raw: ${raw.riskNote}\n- adj: ${adj.riskNote}\n\n`;
  lines += `\n## Trades (pair, tf, entry time UTC, entry → exit, status, R)\n\n`;
  lines += `| pair | tf | entry time | entry | stop | tp | status | exit | exit time | R |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of all) {
    lines += `| ${r.pair} | ${r.tf} | ${r.entryTime} | ${r.entry} | ${r.stop} | ${r.tp} | ${r.status} | ${Number.isFinite(r.exit) ? r.exit : "-"} | ${r.exitTime} | ${Number.isFinite(r.r) ? r.r.toFixed(2) : "-"} |\n`;
  }

  // ── Continuation shadow ──────────────────────────────────────────────
  // The second model from the mentorship, measured beside the origin model
  // rather than in place of it. Reported even when it finds nothing: a zero
  // is the answer that tells us which parameter to relax.
  if (CONT_ENABLED) {
    const cs = stats(contAll, true);
    const gateStr = CONT_GATE.join("→");
    console.log(`\nCONTINUATION SHADOW — ${contAll.length} setups ` +
      `(gate ${gateStr}, minTouches ${CONT_MIN_TOUCHES}, maxDepth ${CONT_MAX_DEPTH}, ` +
      `legOrigin ${CONT_LEG_ORIGIN}, minBodyPct ${CONT_MIN_BODY_PCT}, ` +
      `minBreakAtr ${CONT_MIN_BREAK_ATR}, requireLiquidity ${CONT_REQUIRE_LIQ}, rr ${CONT_RR}R)`);
    const cHead = `adj  net ${f(cs.finalR)}R · PF ${f(cs.pf)} · win ${f(cs.winrate, 1)}% · ` +
      `maxDD ${f(cs.maxDD)}R · closed ${cs.tp + cs.sl}/${contAll.length}`;
    console.log(contAll.length ? `   ${cHead}` : "   no setups — relax a parameter, do not assume the model is dead");
    const byPair = new Map<string, Trade[]>();
    for (const t of contAll) byPair.set(t.pair, [...(byPair.get(t.pair) ?? []), t]);
    const pairLines: string[] = [];
    for (const [pair, rows] of [...byPair].sort((a, b) => b[1].length - a[1].length)) {
      const ps = stats(rows, true);
      const line = `${pair.padEnd(8)} setups ${String(rows.length).padStart(4)} · net ${f(ps.finalR)}R · PF ${f(ps.pf)}`;
      console.log(`   ${line}`);
      pairLines.push(`- ${line}`);
    }

    // How impulsive the breaks actually were. Without this the only way to
    // choose a threshold is to guess one and re-run.
    const pct = (xs: number[], q: number) => {
      const v = xs.slice().sort((a, b) => a - b);
      return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : NaN;
    };
    // Number.isFinite does not narrow `number | undefined`, and these fields
    // are absent on the origin-model rows.
    const num = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);
    const bp = contAll.map((t) => t.bodyPct).filter(num);
    const ba = contAll.map((t) => t.bodyAtr).filter(num);
    const distStr = bp.length
      ? `break-candle body/range  p10 ${f(pct(bp, 0.10), 2)}  p50 ${f(pct(bp, 0.50), 2)}  p90 ${f(pct(bp, 0.90), 2)}\n` +
        `   break-candle body/ATR    p10 ${f(pct(ba, 0.10), 2)}  p50 ${f(pct(ba, 0.50), 2)}  p90 ${f(pct(ba, 0.90), 2)}`
      : "no setups to measure";
    console.log(`   impulsive-move distribution:`);
    console.log(`   ${distStr}`);

    lines += `\n## Continuation shadow — the second model\n\n` +
      `The origin model above is sweep → shift → retest. This is the other model: a key\n` +
      `level that held, was then disrespected with an impulsive move, and now overlaps an\n` +
      `imbalance. It is a shadow — no live alert uses it.\n\n` +
      `Gate: ${gateStr} must all agree on the most recent break of structure\n` +
      `(close-to-close, the line-chart body-to-body test). minTouches ${CONT_MIN_TOUCHES},\n` +
      `maxRetraceDepth ${CONT_MAX_DEPTH}, legOrigin ${CONT_LEG_ORIGIN}, target ${CONT_RR}R.\n\n` +
      `Impulsive-move filter: minBodyPct ${CONT_MIN_BODY_PCT}, minBreakAtr ${CONT_MIN_BREAK_ATR}.\n\n` +
      `Distribution of the break candles that produced these setups, so a threshold\n` +
      `can be chosen from what the market actually did rather than guessed:\n\n` +
      `    ${distStr.replace(/\n/g, "\n    ")}\n\n` +
      `- setups found: ${contAll.length}\n- ${cHead}\n${pairLines.join("\n")}\n\n`;
  }

  // ── Confirmation entry shadow ────────────────────────────────────────
  if (CONF_ENABLED) {
    const cf = stats(confAll, true);
    console.log(`\nCONFIRMATION SHADOW — ${confAll.length} entries ` +
      `(rr ${CONF_RR}, stop ${CONF_STOP_PIPS} pip, lookback ${CONF_LOOKBACK})`);
    console.log(confAll.length
      ? `   adj  net ${f(cf.finalR)}R · PF ${f(cf.pf)} · win ${f(cf.winrate, 1)}% · ` +
        `maxDD ${f(cf.maxDD)}R · closed ${cf.tp + cf.sl}/${confAll.length}`
      : "   no entries — the bias gate or the lookback is the constraint");
    // The 80-90% figure is a claim about the third candle. Counted here.
    const played = confAll.filter((t) => t.bodyPct === 1).length;
    const internal = confAll.filter((t) => t.bodyPct === 0).length;
    const resolved = played + internal;
    const thirdStr = resolved
      ? `played out ${played}/${resolved} (${((played / resolved) * 100).toFixed(1)}%) · ` +
        `internal liquidity ${internal}/${resolved} — he claims 80-90%`
      : "third candle unresolved for every entry";
    console.log(`   ${thirdStr}`);

    lines += `\n## Confirmation entry shadow — the second model\n\n` +
      `Traded when the continuation setup already moved. On the entry timeframe: a setup\n` +
      `candle whose extreme is swept, the sweep closing back inside, the opposite extreme\n` +
      `still standing. Stop ${CONF_STOP_PIPS} pip beyond the swept extreme, target ${CONF_RR}R.\n\n` +
      `- entries: ${confAll.length}\n` +
      `- adj net ${f(cf.finalR)}R · PF ${f(cf.pf)} · win ${f(cf.winrate, 1)}% · maxDD ${f(cf.maxDD)}R\n` +
      `- ${thirdStr}\n\n`;
  }

  const name = `backtest-report-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(name, lines);
  console.log(`\nreport written: ${name}\n(alert = entry that would have alerted; win% over TP+SL only; PF = Σwins/Σ|losses|)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
