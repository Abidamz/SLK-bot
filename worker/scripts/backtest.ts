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
import { defaultStrategy, minStopDistance, pipSize, TF_SECONDS, type StrategyConfig } from "../src/config";
import { resampleCandles, dropIncomplete, calendarSeriesComplete, keyLevels } from "../src/features";
import { biasGate, storylineTiers, type BiasEvidence, type BiasTier } from "../src/bias_gate";
import { EMPTY_NAVIGATOR, navigatorState, type NavigatorState } from "../src/navigator";
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
import { alertMix, simulate } from "../src/prop_sim";
import {
  corrMatrix, dailyRByPair, dropRedundant, maxPair, meanPairwiseCorrelation,
} from "../src/portfolio";
import {
  SPREAD_EST, capPerDay, challengeVerdict, dailyRisk, directionGroups, entryTfGroups, f,
  limitShadowRows, marketShadowRows, monthlyBuckets, oosReport, riskForLimit, stats,
  type Trade,
} from "../src/replay_stats";
import { emptyBucket, renderSweepTable, sweepRows, targetPrice, type SweepBucket }
  from "../src/target_sweep";
import type { Alert, Candle, Direction, KeyLevel } from "../src/types";

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
/**
 * Pairs the replay scans by default, cut from thirteen to the three that the
 * 180d OANDA replay showed spread-adjusted positive in both the full window
 * and the older 90d sub-window — see docs/BACKTEST_FINDINGS_2026-10-11.md and
 * the matching cut to PAIRS in wrangler.jsonc.
 *
 * The ten Deriv synthetics cannot be replayed here at all: this script
 * requires OANDA, which does not carry them, so no backtest can ever produce
 * a result for them in either direction.
 *
 * To scan the full institutional set again, pass it explicitly:
 *   npx tsx scripts/backtest.ts AUDJPY,EURJPY,GBPJPY,USDJPY,USDCAD,JAPAN225,NAS100,EURUSD,GBPUSD,NZDUSD,XAUUSD,US30,GER40 180
 */
const DEFAULT_PAIRS = ["JAPAN225", "NAS100", "EURUSD", "XAUUSD"];


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


/**
 * Read KEY=VALUE pairs from a .env file, for keys not already in the
 * environment.
 *
 * It exists for one reason: a Codespace restart drops exported variables, and
 * re-exporting a token by hand every time is how a truncated paste ends up
 * looking like a revoked credential. Values already in process.env win, so an
 * explicit export still overrides the file.
 *
 * Deliberately tiny and dependency-free — a real dotenv package is not worth
 * pulling in for this. The file itself is gitignored (bare `.env` in
 * .gitignore matches at any depth), so the token never enters the repo.
 */
function loadDotEnv(): void {
  for (const path of [join(process.cwd(), ".env"), join(process.cwd(), "..", ".env")]) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue; // no file here — not an error
    }
    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key]) continue;
      const quoted = /^(".*"|.*)$/s.exec(raw)?.[1] ?? raw;
      process.env[key] =
        (quoted.startsWith('"') && quoted.endsWith('"')) ||
        (quoted.startsWith("'") && quoted.endsWith("'"))
          ? quoted.slice(1, -1)
          : quoted;
    }
  }
}
loadDotEnv();

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
const CONT_LEG_ORIGIN = (process.env.BACKTEST_CONT_LEG_ORIGIN ?? CONT_PARAMS.legOrigin) as "break" | "level" | "swing";
const CONT_IMPULSE_LOOKBACK = Number(process.env.BACKTEST_CONT_IMPULSE_LOOKBACK ?? CONT_PARAMS.impulseLookback);
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
/**
 * The bias navigator: the mandatory monthly → weekly → daily chain from
 * src/navigator.ts as a hard permission filter. Entries whose direction the
 * chain does not permit are refused after the scan, and the refusal reasons
 * are tallied so a run shows WHY the book shrank, not just that it did.
 *
 * Acceptance is pre-committed, not vibe-checked: the filtered 360d book must
 * reach 0.8 R/alert without dropping below ~5 alerts per month, AND no
 * calendar month may close worse than -2R at 0.75% risk. Miss the first bar
 * but clear the 0.30R gate with flat bad months and the result comes back to
 * the owner rather than being silently relaxed.
 */
const NAV_ENABLED = (process.env.BACKTEST_NAVIGATOR ?? "false") === "true";
/**
 * The breakeven instruction that ships in every alert: move the stop to entry
 * at +1.5R. evaluateSignal models it and it is on by default, so the headline
 * figures are the strategy subscribers are actually told to trade. Set
 * BACKTEST_BE=false to measure the same alerts with a fixed stop instead —
 * the difference is what that one line of the alert is worth.
 */
const BE_ENABLED = (process.env.BACKTEST_BE ?? "true") !== "false";
const BE_TRIGGER_R = Number(process.env.BACKTEST_BE_TRIGGER_R ?? 1.5);

/**
 * Which timeframes the replay scans for entries.
 *
 * Defaults to "30m,1h" - exactly what the replay has always done. Note that
 * this does NOT match production, where ENTRY_TFS is "15m,30m,1h": the replay
 * has never scanned 15m, so its alert count has always understated the live one.
 *
 * Set BACKTEST_ENTRY_TFS="30m,1h,2h" to add the 2H arm. The 2H is the entry
 * timeframe the methodology specifies - after the 4H breakout you drop exactly
 * one timeframe, and both entry models run on the 2H - whereas production
 * scans three timeframes below that. The per-entry-TF table in the report is
 * what settles whether the difference matters.
 *
 * 15m moves the tick loop itself: with 15m requested, every 15m close becomes a
 * production tick (double the ticks of a 30m walk), the 15m arm reads the tick
 * window directly, the 30m arm reads a pointer-truncated 30m window, and the
 * higher arms resample from the 15m base - mirroring production, which scans
 * 15m as its finest entry timeframe.
 */
const ENTRY_TFS = (process.env.BACKTEST_ENTRY_TFS ?? "30m,1h")
  .split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Prop-firm challenge parameters. Subscribers trade funded accounts, so the
 * question that decides whether this is usable is not "what did it make over
 * 180 days" but "would it have passed a 30-day challenge, at the risk we would
 * tell someone to run, without touching the daily or overall limit".
 *
 * Defaults are the tightest common set: 8% target, 3% daily, 5% overall.
 */
const PROP_TARGET = Number(process.env.BACKTEST_PROP_TARGET ?? 8);

/**
 * Out-of-sample split. Selecting the instruments that performed best across a
 * window and then quoting that same window as the expected result reports the
 * maximum of a sample as if it were its mean. So the report also shows what the
 * chosen instruments did on the later part of the window, which played no part
 * in choosing them. 0 disables the block.
 */
const OOS_DAYS = Number(process.env.BACKTEST_OOS_DAYS ?? 120);
const OOS_MIN_ALERTS = Number(process.env.BACKTEST_OOS_MIN_ALERTS ?? 10);

/**
 * Portfolio layer. Correlation has always been an assumption fed to the prop sim
 * - 0 for "independent", 0.3 for "somewhat correlated". Measuring it matters
 * because the entire case for running many instruments is that their bad days do
 * not arrive together.
 */
const CORR_THRESHOLD = Number(process.env.BACKTEST_CORR_THRESHOLD ?? 0.7);
const DAILY_LOSS_CAP = Number(process.env.BACKTEST_DAILY_LOSS_CAP ?? 2);
const PROP_TRIALS = Number(process.env.BACKTEST_PROP_TRIALS ?? 20000);
const PROP_DAILY = Number(process.env.BACKTEST_PROP_DAILY ?? 3);
const PROP_TOTAL = Number(process.env.BACKTEST_PROP_TOTAL ?? 5);
const RISK_PCTS = (process.env.BACKTEST_RISK_PCTS ?? "0.5,0.75,1")
  .split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
/**
 * Most trades to take per calendar day, 0 = uncapped. A prop-firm tool: it
 * bounds the worst single day so risk per trade can be raised without touching
 * the daily limit. It costs expectancy - suppressed alerts were all positive EV
 * - so it is only worth running when the daily limit is what binds.
 */
const MAX_TRADES_PER_DAY = Number(process.env.BACKTEST_MAX_TRADES_PER_DAY ?? 0);

/**
 * Target sweep: re-score the SAME alert set at other R multiples of the same
 * stop distance, e.g. "1,1.5,2,2.5,3,3.5,4,5". Empty disables it.
 *
 * This exists because "can we win 3 trades in 5" cannot be answered from the
 * headline win rate alone. Win rate and R:R move against each other by
 * construction: at 1:3 break-even is a 25% win rate, so a 60% win rate is only
 * impressive next to the target it was measured at. Sweeping the target shows
 * the whole curve on identical alerts - the only thing that changes is where
 * the target sits - so a point on it can be compared to the shipped setting
 * without re-running the scan or changing which setups fired.
 */
const TARGET_SWEEP = (process.env.BACKTEST_TARGET_SWEEP ?? "")
  .split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0)
  .sort((a, b) => a - b);

/** Accumulated across every pair, so it lives at module scope: the per-pair
 *  replay is its own function and returns only its trade arrays, while the
 *  table is printed once at the end from the whole book. Keyed by target R. */
const sweepAcc = new Map<number, SweepBucket>();
for (const rr of TARGET_SWEEP) sweepAcc.set(rr, emptyBucket());
for (const tf of ENTRY_TFS) {
  if (tf !== "15m" && tf !== "30m" && tf !== "1h" && tf !== "2h") {
    throw new Error(`BACKTEST_ENTRY_TFS: "${tf}" is not one of 15m, 30m, 1h, 2h`);
  }
}

/**
 * Every BACKTEST_* variable this script reads, so that an unrecognised one can
 * be refused instead of silently ignored.
 *
 * That silence is the dangerous part. Running BACKTEST_ENTRY_TFS=30m,1h,2h
 * against a checkout from before the knob existed prints a complete,
 * plausible-looking report that quietly contains no 2H trades at all, and
 * nothing in the output says the request was dropped. A typo in a knob name
 * fails the same way. test/backtest_knobs.test.ts asserts this list matches
 * the variables the source actually reads, so it cannot drift.
 */
const KNOWN_BACKTEST_VARS = [
  "BACKTEST_BE", "BACKTEST_BE_TRIGGER_R", "BACKTEST_BIAS",
  "BACKTEST_BIAS_CONFIRM_LOOKBACK", "BACKTEST_BIAS_LEVEL_KINDS",
  "BACKTEST_BIAS_MIN_TOUCHES", "BACKTEST_BIAS_ORIGIN_LOOKBACK",
  "BACKTEST_BIAS_SWEPT_LOOKBACK", "BACKTEST_CONF", "BACKTEST_CONF_LOOKBACK",
  "BACKTEST_CONF_RR", "BACKTEST_CONF_STOP_PIPS", "BACKTEST_CONT_GATE",
  "BACKTEST_CONT_IMPULSE_LOOKBACK", "BACKTEST_CONT_LEG_ORIGIN",
  "BACKTEST_CONT_MAX_DEPTH", "BACKTEST_CONT_MIN_BODY_PCT",
  "BACKTEST_CONT_MIN_BREAK_ATR", "BACKTEST_CONT_MIN_TOUCHES",
  "BACKTEST_CONT_REQUIRE_LIQ", "BACKTEST_CONT_RR", "BACKTEST_END_OFFSET_DAYS",
  "BACKTEST_NAVIGATOR", "BACKTEST_REJECT_CLOSE", "BACKTEST_INDUCEMENT",
  "BACKTEST_ENTRY_TFS", "BACKTEST_FLIP_DIRECTION_AWARE",
  "BACKTEST_FLIP_IMPULSE_ATR",
  "BACKTEST_MIN_STOP_PIPS", "BACKTEST_MIN_TP_R",
  "BACKTEST_OOS_DAYS", "BACKTEST_OOS_MIN_ALERTS",
  "BACKTEST_CORR_THRESHOLD", "BACKTEST_DAILY_LOSS_CAP", "BACKTEST_PROP_TRIALS",
  "BACKTEST_MAX_STOP_PIPS", "BACKTEST_MAX_TRADES_PER_DAY",
  "BACKTEST_PROP_DAILY", "BACKTEST_PROP_TARGET",
  "BACKTEST_PROP_TOTAL",
  "BACKTEST_RISK_PCTS", "BACKTEST_SOURCE", "BACKTEST_TARGET_SWEEP",
  "BACKTEST_VERBOSE",
] as const;

const unknownBacktestVars = Object.keys(process.env)
  .filter((k) => k.startsWith("BACKTEST_") && !(KNOWN_BACKTEST_VARS as readonly string[]).includes(k))
  .sort();
if (unknownBacktestVars.length) {
  throw new Error(
    `Unknown BACKTEST_* variable(s): ${unknownBacktestVars.join(", ")}.\n` +
    `This script reads: ${[...KNOWN_BACKTEST_VARS].sort().join(", ")}.\n` +
    `If you expected one of these to exist, this checkout predates it — git pull.`
  );
}

/**
 * The storyline bias gate, measured side by side with multiTfGate rather than
 * swapped in blind.
 *
 * multiTfGate asks for a breakout on every timeframe at once and asks for no
 * rejection and no candle closure anywhere. The rule as taught is the other
 * way round: rejection and closure on the timeframe the bias is built from,
 * then one of three confirmations exactly one timeframe below it. These are
 * not two settings of the same filter — they disagree on kind, so the first
 * question is how often each one fires and how often they agree.
 */
const BIAS_ENABLED = (process.env.BACKTEST_BIAS ?? "true") === "true";
/**
 * Which key-level kinds the gate may reject from. DECISION is excluded by
 * default: it is a single wide-range candle's body, kept in keyLevels so the
 * pre-existing behaviour is not silently discarded, and it is not a key level
 * in the teaching. OC is included and is the knob to watch — keyLevels emits
 * one for every consecutive pair of overlapping bodies, which is most bars, so
 * a gate that rejects from any OC level will find a rejection almost every
 * candle. The level counts are printed per pair so the volume is visible
 * rather than inferred.
 */
const LEVEL_KIND_NAMES: KeyLevel["kind"][] = ["A", "V", "OC", "DECISION"];
const BIAS_KIND_TOKENS = (process.env.BACKTEST_BIAS_LEVEL_KINDS ?? "A,V,OC")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const BIAS_LEVEL_KINDS = new Set<KeyLevel["kind"]>(
  BIAS_KIND_TOKENS.filter((s): s is KeyLevel["kind"] => LEVEL_KIND_NAMES.includes(s as KeyLevel["kind"])),
);
/** Tokens that were not a real key-level kind, so a typo cannot silently mean "no levels". */
const BIAS_KIND_IGNORED = BIAS_KIND_TOKENS.filter((s) => !BIAS_LEVEL_KINDS.has(s as KeyLevel["kind"]));
/** Require a level to have been touched at least this often before it can sponsor a rejection. */
const BIAS_MIN_TOUCHES = Number(process.env.BACKTEST_BIAS_MIN_TOUCHES ?? 0);
const BIAS_ORIGIN_LOOKBACK = Number(process.env.BACKTEST_BIAS_ORIGIN_LOOKBACK ?? 4);
const BIAS_CONFIRM_LOOKBACK = Number(process.env.BACKTEST_BIAS_CONFIRM_LOOKBACK ?? 6);
const BIAS_SWEPT_LOOKBACK = Number(process.env.BACKTEST_BIAS_SWEPT_LOOKBACK ?? 12);

/** Per-tier tally of what the gate did, aggregated across pairs in main(). */
interface BiasSummary {
  ticks: number;
  /** Gate direction per tick, including "none" for no bias. */
  dirs: Record<string, number>;
  /** Which of the three confirmations fired. */
  kinds: Record<string, number>;
  /** Which adjacent timeframe pair produced the storyline, e.g. "w1>d1". */
  pairs: Record<string, number>;
  /** multiTfGate direction | biasGate direction, per tick. */
  agree: Record<string, number>;
  /** Key levels available on each tier, from the most recent refresh. */
  levels: Record<string, number>;
}

const emptyBias = (): BiasSummary =>
  ({ ticks: 0, dirs: {}, kinds: {}, pairs: {}, agree: {}, levels: {} });

function mergeBias(into: BiasSummary, add: BiasSummary): BiasSummary {
  const bumpAll = (a: Record<string, number>, b: Record<string, number>) => {
    for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v;
  };
  into.ticks += add.ticks;
  bumpAll(into.dirs, add.dirs);
  bumpAll(into.kinds, add.kinds);
  bumpAll(into.pairs, add.pairs);
  bumpAll(into.agree, add.agree);
  for (const [k, v] of Object.entries(add.levels)) into.levels[k] = v;
  return into;
}

/**
 * The four timeframes the storyline binds, highest first, each with the key
 * levels marked on it. biasGate walks adjacent pairs, so this ordering *is*
 * the rule: a monthly storyline confirms on the weekly, a weekly on the daily,
 * a daily on the 4H.
 *
 * The monthly tier is the navigator. It is offered but not required, because a
 * storyline legitimately starts on the weekly or the daily when the monthly is
 * unclear — and on a 730-day daily load there are only about two dozen monthly
 * candles to read it from.
 */
function biasTiers(
  d1c: Candle[], d1t: Candle[], w1t: Candle[], h4: Candle[], close: number, cfg: StrategyConfig,
): BiasTier[] {
  return storylineTiers([
    { tf: "mo", candles: calendarSeriesComplete(d1c, "M", close) },
    { tf: "w1", candles: w1t },
    { tf: "d1", candles: d1t },
    { tf: "h4", candles: h4 },
  ], cfg, { kinds: [...BIAS_LEVEL_KINDS], minTouches: BIAS_MIN_TOUCHES });
}

const fmtCounts = (rec: Record<string, number>): string =>
  Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("  ") || "n/a";

async function replay(
  pair: string, days: number, strategy = defaultStrategy(),
): Promise<{ origin: Trade[]; continuation: Trade[]; confirmation: Trade[]; bias: BiasSummary }> {
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
    return { origin: [], continuation: [], confirmation: [], bias: emptyBias() };
  }

  const m15 = resampleCandles(m1, TF_SECONDS["15m"]);
  const m30 = resampleCandles(m1, TF_SECONDS["30m"]);
  const h1 = resampleCandles(m1, TF_SECONDS["1h"]);
  const h2 = resampleCandles(m1, TF_SECONDS["2h"]);
  // Full-window series per entry timeframe, used to resolve an outcome forward
  // from a detection time. This replaces a `tf === "1h" ? h1 : m30` ternary
  // that appeared three times and would have silently handed a 2H scan the 30m
  // series instead of the 2H one.
  const entrySeries: Record<string, Candle[]> = { "15m": m15, "30m": m30, "1h": h1, "2h": h2 };
  // The weekly and monthly series are built inside the tick loop, from the
  // daily bars that had actually closed by then. Building them once from the
  // full daily load — as the weekly series used to be — hands the gate the
  // whole rest of the window, including weeks that had not started.

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
  let contUnfilled = 0;
  const contGateSeen: Record<string, number> = {};
  let gateCache: { key: string; dir: ReturnType<typeof multiTfGate> } = { key: "", dir: null };
  const bias = emptyBias();
  let biasCache: { key: string; ev: BiasEvidence | null } = { key: "", ev: null };
  let navCache: { key: string; st: NavigatorState } = { key: "", st: EMPTY_NAVIGATOR };
  const nav = { ticks: 0, refused: 0, reasons: {} as Record<string, number>, dirs: {} as Record<string, number> };
  // Setups whose FIRST emission the chain refused. Alerts re-emit on every
  // tick their pending limit lives, so a refused setup must stay refused or
  // it resurrects on a later permitted tick.
  const navRejected = new Set<string>();
  const confSeen = new Set<string>();
  const confTrades: Trade[] = [];
  /** Third-candle tallies, so the 80-90% claim gets counted rather than trusted. */
  const confThird: Record<string, number> = {};
  const bump = (k: string, n?: number) => { fun[k] = (fun[k] ?? 0) + (n ?? 0); };
  // Every close of the finest requested entry timeframe in the scan window is
  // a production tick: 30m by default, 15m when the 15m arm is requested —
  // production scans 15m, so a replay without it understates the live book.
  const tick15 = ENTRY_TFS.includes("15m");
  const tickSeries = tick15 ? m15 : m30;
  const tickStep = tick15 ? 900_000 : 1_800_000;
  let m30Ptr = 0;
  for (let i = 0; i < tickSeries.length; i++) {
    const close = tickSeries[i].t + tickStep;
    if (close < scanStart || close > now.getTime()) { skip.window++; continue; }

    // The tick series is sorted and this loop is chronological; slicing avoids
    // rescanning the entire history for every production tick.
    const end = i + 1;
    const base = tickSeries.slice(Math.max(0, end - 1010), end); // prod: baseCandlesLimit
    // On 15m ticks the 30m arm needs its own truncated window: a pointer
    // advanced to the 30m candles closed by this tick, same 1010-candle shape.
    let base30 = base;
    if (tick15) {
      while (m30Ptr < m30.length && m30[m30Ptr].t + 1_800_000 <= close) m30Ptr++;
      base30 = m30.slice(Math.max(0, m30Ptr - 1010), m30Ptr);
    }
    ticks++;
    if (base.length < 40) { skip.base++; continue; }                          // prod: minCandles
    const h4 = dropIncomplete(resampleCandles(base, TF_SECONDS["4h"]), TF_SECONDS["4h"], close);
    if (h4.length < 30) { skip.h4++; continue; }                              // prod gate
    const d1c = d1.filter((c) => c.t + 86400_000 <= close);                   // complete days only
    const d1t = d1c.slice(-400);                                              // prod: candlesLimit
    if (d1t.length < 25) { skip.d1++; continue; }
    const snaps = storylineSeries(d1t, h4, strategy);

    // Both gates read the same timeframes, and those only change when one of
    // their own candles closes, so both results are cached on the daily and 4H
    // close times — otherwise every 30-minute tick would recompute swing
    // scans, key levels and calendar resampling for nothing. The weekly and
    // monthly series are pure functions of the daily series, so a daily close
    // is the finest granularity at which they can change either.
    const tfKey = [d1t.at(-1)?.t ?? 0, h4.at(-1)?.t ?? 0].join("|");
    if (tfKey !== gateCache.key) {
      const w1t = calendarSeriesComplete(d1c, "W", close);
      const byName: Record<string, Candle[]> = { w1: w1t, d1: d1t, h4 };
      gateCache = {
        key: tfKey,
        dir: CONT_ENABLED
          ? multiTfGate(CONT_GATE.map((k) => byName[k]).filter((c): c is Candle[] => Boolean(c) && c.length > 0))
          : null,
      };
      if (BIAS_ENABLED) {
        const tiers = biasTiers(d1c, d1t, w1t, h4, close, strategy);
        biasCache = {
          key: tfKey,
          ev: biasGate(tiers, {
            originLookback: BIAS_ORIGIN_LOOKBACK,
            confirmLookback: BIAS_CONFIRM_LOOKBACK,
            sweptLookback: BIAS_SWEPT_LOOKBACK,
          }),
        };
        for (const t of tiers) bias.levels[t.tf] = t.levels.length;
      }
      if (NAV_ENABLED) {
        // Navigator state is a pure function of complete dailies, so it is
        // recomputed exactly once per daily close inside this cache block —
        // cron-shaped, never per tick. Daily key levels enable the third
        // confirmation form (disrespected level tapped and closed through);
        // without them the chain would sit out more than the teaching does.
        const mo = calendarSeriesComplete(d1c, "M", close);
        navCache = {
          key: tfKey,
          st: navigatorState(mo, w1t, d1t, { levels: keyLevels(d1t, strategy) }),
        };
      }
    }
    if (NAV_ENABLED) {
      nav.ticks++;
      nav.reasons[navCache.st.reason] = (nav.reasons[navCache.st.reason] ?? 0) + 1;
      const pd = navCache.st.permitted ?? "none";
      nav.dirs[pd] = (nav.dirs[pd] ?? 0) + 1;
    }
    if (CONT_ENABLED) {
      contGateSeen[gateCache.dir ?? "none"] = (contGateSeen[gateCache.dir ?? "none"] ?? 0) + 1;
    }
    if (BIAS_ENABLED) {
      const ev = biasCache.ev;
      bias.ticks++;
      bias.dirs[ev?.dir ?? "none"] = (bias.dirs[ev?.dir ?? "none"] ?? 0) + 1;
      if (ev) {
        bias.kinds[ev.confirmation] = (bias.kinds[ev.confirmation] ?? 0) + 1;
        const pk = `${ev.originTf}>${ev.confirmTf}`;
        bias.pairs[pk] = (bias.pairs[pk] ?? 0) + 1;
      }
      // Agreement matrix: multiTfGate direction | biasGate direction. The
      // diagonal is the two rules saying the same thing; the off-diagonal
      // cells are where they disagree, which is the whole point of running
      // them side by side.
      const k = `${gateCache.dir ?? "none"}|${ev?.dir ?? "none"}`;
      bias.agree[k] = (bias.agree[k] ?? 0) + 1;
    }

    // The finest arm reads the tick window directly rather than a resample of
    // it, so the default run stays identical to every result recorded before
    // this knob existed. On 15m ticks the 30m arm reads its pointer-truncated
    // window. Every coarser arm is resampled from `base` and truncated to the
    // candles that had closed by `close` - the same split the 1h arm used.
    const tfs: [string, Candle[], number][] = [];
    if (ENTRY_TFS.includes("15m") && tick15) tfs.push(["15m", base, close]);
    if (ENTRY_TFS.includes("30m")) tfs.push(["30m", base30, close]);
    for (const tf of ENTRY_TFS) {
      if (tf === "30m" || tf === "15m") continue;
      const secs = TF_SECONDS[tf];
      if (close % (secs * 1000) !== 0) continue;                              // no candle closed on this tf yet
      tfs.push([tf, dropIncomplete(resampleCandles(base, secs), secs, close), close]);
    }
    for (const [tf, candles, nowMs] of tfs) {
      const res = scanEntry({
        pair, entryTf: tf, tfSeconds: TF_SECONDS[tf], candles, snaps,
        cfg: strategy, mode: "paper", provider: "oanda",
      });
      const alerts = res.alerts;
      if (NAV_ENABLED && alerts.length) {
        // The sit-out switch gates a setup at its FIRST emission: an
        // unconfirmed chain refuses everything, a confirmed chain refuses
        // the opposite direction. Later re-emissions of a refused setup
        // stay refused via navRejected.
        const perm = navCache.st.permitted;
        const keep: typeof alerts = [];
        for (const a of alerts) {
          const id = a.setupId;
          if (navRejected.has(id)) continue;
          if (perm && a.direction === perm) { keep.push(a); continue; }
          if (!seen.has(id)) nav.refused++;
          navRejected.add(id);
        }
        alerts.length = 0;
        alerts.push(...keep);
      }
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
        // Detect on `candles` — the series truncated to this tick — never on the
        // full m30/h1. Scanning the whole window at every tick is look-ahead: it
        // detects setups from candles that have not happened yet, stamps them
        // with the timestamp of the last bar in the dataset, and leaves nothing
        // after them to evaluate. That is what left 31 of 33 setups stuck OPEN.
        // The full series is used below, and only to resolve outcomes forward
        // from the detection time — the same split the origin model uses.
        const tfCandles = entrySeries[tf];
        // Detect on the 4 HOURS, not the entry timeframe. The continuation
        // setup is a higher-timeframe construct — the key level, the impulsive
        // break and the imbalance all live on the 4H, which is why the 4H is
        // the vantage point when the weekly and daily are unclear. Running the
        // same rules over 30-minute bars multiplies the bar count by eight and
        // produced ~28,000 "setups" over 180 days against a stated rate of one
        // or two a week. Outcomes are still resolved on the finer series below,
        // so stop and target hits are not blurred to 4-hour granularity.
        for (const cs of findContinuationSetups(h4, strategy, gateCache.dir, {
          ...CONT_PARAMS,
          minTouches: CONT_MIN_TOUCHES,
          maxRetraceDepth: CONT_MAX_DEPTH,
          rr: CONT_RR,
          legOrigin: CONT_LEG_ORIGIN,
          impulseLookback: CONT_IMPULSE_LOOKBACK,
          minBreakBodyPct: CONT_MIN_BODY_PCT,
          minBreakAtrMult: CONT_MIN_BREAK_ATR,
          requireLiquidity: CONT_REQUIRE_LIQ,
          minStop: minStopDistance(pair, strategy.minStopPips ?? 10),
        }, contDiag)) {
          if (contSeen.has(cs.setupId)) continue;
          contSeen.add(cs.setupId);
          // cs.time is the OPEN of the last complete 4-hour candle. Resolving
          // from there places the limit inside a candle whose contents were
          // just used to detect the setup — the look-ahead this script already
          // had once, one timeframe down. Start at its close.
          const after = m30.filter((c) => c.t >= cs.time + TF_SECONDS["4h"] * 1000);
          // evaluateSignal resolves TP/SL from the first candle in the window
          // whether or not the limit ever filled; fillConfirmed is recorded but
          // never gates anything. A continuation setup is detected precisely
          // because price has already pulled back through the level, so the
          // setups that go on to reach the target are exactly the ones where
          // price left and never came back to fill the order. Ungated, those
          // non-trades are booked as wins — which is what produced a 54.8%
          // strike rate at a 3R target. Require the fill and resolve from it,
          // as the origin model's limit execution does.
          const fillIndex = after.slice(0, LIMIT_WINDOW_CANDLES)
            .findIndex((c) => cs.direction === "LONG" ? c.l <= cs.entry : c.h >= cs.entry);
          if (fillIndex < 0) contUnfilled++;
          const oc = fillIndex >= 0
            ? evaluateSignal(cs.direction, cs.entry, cs.stop, cs.tp, after.slice(fillIndex), 120)
            : null;
          // Second execution model: market at the first 30-minute open after
          // the detection candle closes. At detection price is already at the
          // level, so this is the trade you could actually have taken without
          // waiting for a re-touch. Worth measuring because the origin model
          // shows the gap between the two is decisive on the same alerts —
          // -1.43R as a limit against +5.43R always filled.
          const mktCandle = after[0];
          const mktEntry = mktCandle?.o ?? NaN;
          const mktRisk = Number.isFinite(mktEntry)
            ? (cs.direction === "LONG" ? mktEntry - cs.stop : cs.stop - mktEntry)
            : NaN;
          const mktTp = Number.isFinite(mktRisk) && mktRisk > 0
            ? (cs.direction === "LONG" ? mktEntry + mktRisk * CONT_RR : mktEntry - mktRisk * CONT_RR)
            : NaN;
          const mktOc = Number.isFinite(mktTp)
            ? evaluateSignal(cs.direction, mktEntry, cs.stop, mktTp, after, 120)
            : null;
          contTrades.push({
            pair, tf, setupId: cs.setupId, dir: cs.direction,
            entryTime: new Date(cs.time).toISOString().slice(0, 16).replace("T", " "),
            entry: cs.entry, stop: cs.stop, tp: cs.tp,
            status: oc?.status ?? "OPEN",
            exit: oc?.exitPrice ?? after[after.length - 1]?.c ?? NaN,
            exitTime: oc ? new Date(oc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
            r: oc?.rMultiple ?? NaN,
            limitStatus: oc?.status ?? "OPEN", limitEntry: cs.entry,
            limitExitTime: oc ? new Date(oc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
            limitR: oc?.rMultiple ?? NaN,
            marketStatus: mktOc?.status ?? "OPEN", marketEntry: mktEntry,
            marketExitTime: mktOc ? new Date(mktOc.exitTime).toISOString().slice(0, 16).replace("T", " ") : "-",
            marketR: mktOc?.rMultiple ?? NaN,
            bodyPct: cs.bodyPct, bodyAtr: cs.bodyAtr,
          });
        }
      }
      if (CONF_ENABLED && gateCache.dir) {
        const tfCandles = entrySeries[tf];
        for (const ce of findConfirmationEntries(candles, gateCache.dir, {
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
            pair, tf, setupId: ce.setupId, dir: ce.direction,
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
        const tfCandles = entrySeries[tf];
        const after = tfCandles.filter((c) => c.t >= a.candleCloseTime);      // prod semantics
        const oc = evaluateSignal(a.direction, a.entry, a.stopLoss, a.tpInternal, after, 120,
          false, BE_TRIGGER_R, BE_ENABLED);
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
          ? evaluateSignal(a.direction, limitEntry, a.stopLoss, a.tpInternal, after.slice(fillIndex), 120,
            false, BE_TRIGGER_R, BE_ENABLED)
          : null;
        const mktCandle = after[0];
        const marketEntry = mktCandle?.o ?? a.entry;
        const marketOc = mktCandle
          ? evaluateSignal(a.direction, marketEntry, a.stopLoss, a.tpInternal, after, 120,
            false, BE_TRIGGER_R, BE_ENABLED)
          : null;
        trades.push({
          pair, tf, setupId: a.setupId, dir: a.direction,
          biasDir: biasCache.ev?.dir ?? "none",
          biasKind: biasCache.ev?.confirmation ?? "",
          mtfDir: gateCache.dir ?? "none",
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

        // Target sweep. Same entry, same stop, same candle window, same
        // evaluateSignal - only the target moves, so any difference in the
        // table below is the target's doing and nothing else's.
        for (const rr of TARGET_SWEEP) {
          const tp = targetPrice(a.direction, a.entry, a.stopLoss, rr);
          const o2 = evaluateSignal(a.direction, a.entry, a.stopLoss, tp, after, 120,
            false, BE_TRIGGER_R, BE_ENABLED);
          const b = sweepAcc.get(rr)!;
          b.n++;
          if (!o2 || o2.status === "OPEN" || o2.status === "EXPIRED") { b.open++; continue; }
          if (o2.status === "TP_HIT") b.tp++;
          else if (o2.status === "SL_HIT") b.sl++;
          else if (o2.status === "BE_HIT") b.be++;
          else b.open++;
          if (Number.isFinite(o2.rMultiple)) b.r += o2.rMultiple;
        }
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
    console.log(`   cont gate: ${gateSummary || "n/a"} · setups ${contTrades.length} · limit never filled ${contUnfilled}`);
    // Which rule rejected what. Without this, "0 setups" cannot be acted on.
    const order = ["levels", "noFvg", "wrongDir", "touches", "depth", "bodyPct", "bodyAtr", "liquidity", "rebalance", "risk", "emitted"];
    console.log("   cont rejects: " + order.map((k) => `${k} ${contDiag[k] ?? 0}`).join("  "));
  }
  const thirdSummary = Object.entries(confThird).map(([k, v]) => `${k} ${v}`).join("  ");
  if (CONF_ENABLED) console.log(`   conf entries ${confTrades.length} · third candle: ${thirdSummary || "n/a"}`);
  if (BIAS_ENABLED) {
    const fired = bias.ticks - (bias.dirs.none ?? 0);
    const pct = bias.ticks ? ((fired / bias.ticks) * 100).toFixed(1) : "0.0";
    console.log(
      `   bias gate: fired ${fired}/${bias.ticks} ticks (${pct}%) · ${fmtCounts(bias.dirs)}` +
        ` · levels ${fmtCounts(bias.levels)}`,
    );
    console.log(`   bias conf: ${fmtCounts(bias.kinds)} · tiers ${fmtCounts(bias.pairs)}`);
  }
  if (NAV_ENABLED) {
    console.log(
      `   navigator: permitted ${fmtCounts(nav.dirs)} · reasons ${fmtCounts(nav.reasons)}` +
        ` · refused ${nav.refused} alerts of ${nav.ticks} ticks`,
    );
  }
  return { origin: trades, continuation: contTrades, confirmation: confTrades, bias };
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
  // Order-independent, and anything unrecognised is a hard error. The previous
  // version tested only args[0] and silently fell through: an unset shell
  // variable expands to an empty argument, which matched neither pattern, was
  // never shifted, and swallowed the day count behind it - producing a 60-day
  // default run from a command line that plainly said 360. A plausible-looking
  // report from the wrong window is worse than a crash.
  const PAIR_LIST = /^[A-Z][A-Z0-9]*(,[A-Z][A-Z0-9]*)*$/;
  for (const a of args) {
    if (/^\d+$/.test(a)) { days = Number(a); continue; }
    if (PAIR_LIST.test(a)) { pairs = a.split(","); continue; }
    console.error(
      `Unrecognised argument: ${JSON.stringify(a)}\n` +
      `  usage: npx tsx scripts/backtest.ts [PAIR1,PAIR2,...] [days]\n` +
      (a === ""
        ? `  An empty argument usually means an unset shell variable - if you\n` +
          `  meant $UNIVERSE, run the export first, or paste the list literally.`
        : `  Pairs are comma-separated uppercase names; days is a bare number.`),
    );
    process.exit(1);
  }

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
  console.log(`entry tfs : ${ENTRY_TFS.join(", ")}`);
  console.log(`breakeven : ${BE_ENABLED ? `armed at +${f(BE_TRIGGER_R, 2)}R (as the alert instructs)` : "OFF — fixed stop"}`);
  if (BIAS_ENABLED && BIAS_KIND_IGNORED.length) {
    console.log(`!! BACKTEST_BIAS_LEVEL_KINDS: ignoring unknown kind(s) ${BIAS_KIND_IGNORED.join(", ")} ` +
      `(valid: ${LEVEL_KIND_NAMES.join(", ")}) — using ${[...BIAS_LEVEL_KINDS].join("/") || "NONE"}`);
  }

  const requestedMinTpR = Number(process.env.BACKTEST_MIN_TP_R ?? "");
  /**
   * The stop floor. Worth sweeping because cost is charged as
   * spread / stopDistance, so a tight stop is what makes the round trip
   * expensive in R — and costs were 19.19R of 22.51R gross on the 180d run,
   * 85% of the edge. Note the tension this exposes: 10 pips is a FLOOR here,
   * while the teaching's "my highest stop loss I can go for every trade is 10
   * pips" is a CEILING. defaultStrategy() does not read MIN_STOP_PIPS (that
   * happens in loadConfig, which the replay does not use), so the override has
   * to be applied here.
   *
   * Measured before recommending a sweep: minStopDistance takes
   * max(floor, minStopPips), and the floors swallow the knob for two of the
   * three pairs now on the watchlist. JAPAN225 holds at 50 points for any
   * minStopPips <= 50 and NAS100 at 25 for any value <= 25, so only EURUSD
   * (linear, 0.0001 per pip) responds in the useful range. Sweeping this on
   * the current watchlist changes one pair out of three.
   */
  const requestedMinStop = Number(process.env.BACKTEST_MIN_STOP_PIPS ?? "");
  /** FX stop ceiling in pips. Rejections are a volume cost, so this is an A/B
   *  knob rather than a default: run the same window with and without it. */
  const requestedMaxStop = Number(process.env.BACKTEST_MAX_STOP_PIPS ?? "");
  /**
   * A flipped level changed role, and the role has a direction. Off by default
   * in production, so this is how the change gets measured before it is shipped:
   * run the same window with and without it and compare. See
   * test/flip_direction.test.ts for what it does to origin selection.
   */
  const flipRaw = process.env.BACKTEST_FLIP_DIRECTION_AWARE;
  const flipAware = (flipRaw ?? "").trim().toLowerCase() === "true";
  /** Minimum breaking-candle body, in ATR, for a level to count as disrespected.
   *  Unset reproduces the shipped "any close beyond the zone" behaviour, so the
   *  A/B is the same window with and without the impulse requirement. */
  const flipImpulse = Number(process.env.BACKTEST_FLIP_IMPULSE_ATR ?? "");
  const strategy: StrategyConfig = {
    ...defaultStrategy(),
    requireRejectionClose: (process.env.BACKTEST_REJECT_CLOSE ?? "false") === "true",
    requireInducement: (process.env.BACKTEST_INDUCEMENT ?? "false") === "true",
    ...(flipRaw !== undefined ? { flipDirectionAware: flipAware } : {}),
    ...(Number.isFinite(flipImpulse) && flipImpulse > 0 ? { flipImpulseAtr: flipImpulse } : {}),
    ...(Number.isFinite(requestedMinTpR) && requestedMinTpR > 0 ? { minTpR: requestedMinTpR } : {}),
    ...(Number.isFinite(requestedMinStop) && requestedMinStop > 0 ? { minStopPips: requestedMinStop } : {}),
    ...(Number.isFinite(requestedMaxStop) && requestedMaxStop > 0 ? { maxStopPips: requestedMaxStop } : {}),
  };
  if (Number.isFinite(flipImpulse) && flipImpulse > 0) {
    console.log(`\n*** BACKTEST OVERRIDE: flipImpulseAtr=${flipImpulse} (research comparison only) ***`);
  }
  if (flipRaw !== undefined) {
    console.log(`\n*** BACKTEST OVERRIDE: flipDirectionAware=${flipAware} (research comparison only) ***`);
  }
  for (const [name, val] of [["minTpR", requestedMinTpR], ["minStopPips", requestedMinStop], ["maxStopPips", requestedMaxStop]] as const) {
    if (Number.isFinite(val) && val > 0) {
      console.log(`\n*** BACKTEST OVERRIDE: ${name}=${val} (research comparison only) ***`);
    }
  }
  // scanEntry logs every storyline transition, which is useful in production
  // but can overwhelm a long replay. Opt in with BACKTEST_VERBOSE=1.
  const originalInfo = console.info;
  if (process.env.BACKTEST_VERBOSE !== "1") console.info = () => {};
  const all: Trade[] = [];
  const contAll: Trade[] = [];
  const confAll: Trade[] = [];
  const biasAll = emptyBias();
  try {
    for (const pair of pairs) {
      const r = await replay(pair, days, strategy);
      all.push(...r.origin);
      contAll.push(...r.continuation);
      confAll.push(...r.confirmation);
      mergeBias(biasAll, r.bias);
    }
  } finally {
    console.info = originalInfo;
  }

  const cols = ["pair", "alerts", "TP", "SL", "BE", "EXP", "open", "win%", "netR", "avgR", "PF", "maxDD-R", "loseStrk"];
  console.log(`\n${cols.map((c) => c.padStart(9)).join("")}`);
  let lines = `# TAYO walk-forward replay — last ${days} days (real Dukascopy data, live-engine gates)\n\n`;
  const emit = (spreadAdj: boolean) => {
    const block: string[] = [];
    block.push(`| pair | alerts | TP | SL | BE | EXPIRED | open | win% | netR | avgR | PF | maxDD (R) | lose streak |`);
    block.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const pair of pairs) {
      const rows = all.filter((t) => t.pair === pair);
      const s = stats(rows, spreadAdj);
      const line = [pair, String(s.alerts), String(s.tp), String(s.sl), String(s.be), String(s.expired), String(s.open),
        f(s.winrate, 1), f(s.finalR, 1), f(s.avgR), f(s.pf), f(s.maxDD), String(s.lossStreak)];
      console.log(line.map((c) => c.padStart(9)).join(""));
      block.push(`| ${line.join(" | ")} |`);
    }
    const t = stats(all, spreadAdj);
    const tot = ["TOTAL", String(t.alerts), String(t.tp), String(t.sl), String(t.be), String(t.expired), String(t.open),
      f(t.winrate, 1), f(t.finalR, 1), f(t.avgR), f(t.pf), f(t.maxDD), String(t.lossStreak)];
    console.log(tot.map((c) => c.padStart(9)).join(""));
    block.push(`| **${tot.join(" | ")}** |`);

    // Per entry timeframe. Every origin trade has always carried its `tf`; it
    // was simply never grouped by. This is the table that says whether the
    // entries belong where production puts them.
    if (ENTRY_TFS.length > 1) {
      console.log("");
      const tfBlock = [
        `| entry tf | alerts | TP | SL | BE | EXPIRED | open | win% | netR | avgR | PF | maxDD (R) | lose streak |`,
        `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
      ];
      for (const [etf, rows] of entryTfGroups(all, ENTRY_TFS)) {
        const s2 = stats(rows, spreadAdj);
        const line = [etf, String(s2.alerts), String(s2.tp), String(s2.sl), String(s2.be), String(s2.expired),
          String(s2.open), f(s2.winrate, 1), f(s2.finalR, 1), f(s2.avgR), f(s2.pf), f(s2.maxDD), String(s2.lossStreak)];
        console.log(line.map((c) => c.padStart(9)).join(""));
        tfBlock.push(`| ${line.join(" | ")} |`);
      }
      block.push("", ...tfBlock);
    }

    // Per direction. Live delivery looked one-sided, and the replay is the only
    // place with enough trades to say whether that is the market's regime over
    // the window or a defect in how direction is chosen. Same columns as the
    // per-timeframe table so the two can be read against each other.
    {
      console.log("");
      const dirRows = directionGroups(all);
      const dirBlock = [
        `| direction | alerts | TP | SL | BE | EXPIRED | open | win% | netR | avgR | PF | maxDD (R) | lose streak |`,
        `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
      ];
      const named = all.filter((t2) => t2.dir === "LONG" || t2.dir === "SHORT").length;
      const header = `DIRECTION SPLIT — ${all.length} alerts total`;
      console.log(header);
      for (const [dirName, rows] of dirRows) {
        const s3 = stats(rows, spreadAdj);
        // Share of the labelled book, not of all alerts, so an UNKNOWN group
        // cannot quietly shrink both sides and make the split look closer.
        const share = named > 0 && dirName !== "UNKNOWN"
          ? `${f((rows.length / named) * 100, 1)}%` : "n/a";
        const line = [`${dirName} ${share}`, String(s3.alerts), String(s3.tp), String(s3.sl), String(s3.be),
          String(s3.expired), String(s3.open), f(s3.winrate, 1), f(s3.finalR, 1), f(s3.avgR), f(s3.pf),
          f(s3.maxDD), String(s3.lossStreak)];
        console.log(line.map((c) => c.padStart(11)).join(""));
        dirBlock.push(`| ${line.join(" | ")} |`);
      }
      block.push("", "```", header, "```", "", ...dirBlock);
    }

    const riskNote = `max drawdown **${f(t.maxDD)}R** (${t.ddFrom} → ${t.ddTo} UTC) · ` +
      `≈${f(t.maxDD, 1)}% at 1% risk/trade · longest losing streak **${t.lossStreak}** ` +
      `· longest win streak ${t.winStreak} · breakeven scratches **${t.be}** ` +
      `(${f(t.scratchPct, 1)}% of resolved) · net ${f(t.finalR, 1)}R over window`;
    console.log(`\n${riskNote.replace(/\*\*/g, "")}`);

    // Prop-firm limits are a DAILY cap (commonly 3%) and an OVERALL cap
    // (commonly 5%), and neither is the whole-window maxDD above. A book can
    // sit inside the overall limit and still lose a funded account in one
    // session, so the sizing a subscriber can actually run is set by the daily
    // figure. worstDayLoss is measured from the start of the day; firms that
    // trail the limit from the day's high-water mark will see more.
    const dr = dailyRisk(all, spreadAdj);
    const pct = (x: number) => (Number.isFinite(x) ? `${f(x, 2)}%` : "n/a");
    const propNote =
      `daily risk — ${dr.days} days with a close · worst intraday loss ${f(dr.worstDayLoss)}R ` +
      `(${dr.worstDayLossDate}) · worst day close ${f(dr.worstDayClose)}R (${dr.worstDayCloseDate}) · ` +
      `worst 3-day ${f(dr.worst3Day)}R · worst 5-day ${f(dr.worst5Day)}R`;
    const sizingNote =
      `   max risk/trade that held: 3% daily ${pct(riskForLimit(dr.worstDayLoss, 3))} · ` +
      `5% overall ${pct(riskForLimit(t.maxDD, 5))}`;
    console.log(propNote);
    console.log(sizingNote);
    block.push("", propNote, sizingNote.trim());

    // Would each month have passed a challenge? A 180-day aggregate averages
    // six challenges into one number and reports the drawdown of the whole
    // window, which is not the limit a firm enforces. This gives six samples.
    const months = monthlyBuckets(all, spreadAdj);
    if (months.length) {
      const chLines = [`PROP CHALLENGE — monthly windows, target ${PROP_TARGET}% · daily ${PROP_DAILY}% · overall ${PROP_TOTAL}%`];
      for (const risk of RISK_PCTS) {
        const verdicts = months.map((m) => challengeVerdict(m, risk, {
          targetPct: PROP_TARGET, dailyPct: PROP_DAILY, totalPct: PROP_TOTAL,
        }));
        const passed = verdicts.filter((v) => v.pass).length;
        chLines.push(
          `   risk ${f(risk, 2)}%/trade : ${passed}/${months.length} months pass · ` +
          `worst day ${f(Math.max(...months.map((m) => m.worstDay * risk)), 2)}% · ` +
          `worst month ${f(Math.min(...months.map((m) => m.netR * risk)), 2)}%`);
      }
      const mid = RISK_PCTS.length ? RISK_PCTS[Math.floor(RISK_PCTS.length / 2)] : 1;
      chLines.push(`   per month at ${f(mid, 2)}% risk:`);
      for (const m of months) {
        const v = challengeVerdict(m, mid, {
          targetPct: PROP_TARGET, dailyPct: PROP_DAILY, totalPct: PROP_TOTAL,
        });
        chLines.push(
          `      ${m.month}  ${String(m.alerts).padStart(3)} alerts  netR ${f(m.netR, 1).padStart(6)}  ` +
          `maxDD ${f(m.maxDD, 2).padStart(5)}R  worstDay ${f(m.worstDay, 2).padStart(5)}R  ` +
          `${v.pass ? "PASS" : "FAIL"} — ${v.reason}`);
      }
      const ch = chLines.join("\n");
      console.log("\n" + ch);
      block.push("", "```", ch, "```");
    }


    // Out-of-sample split. Sits inside emit() so it is printed and written for
    // both the raw and the spread-adjusted pass, like the rest of the report.
    // Both books, not just the shipped one. The continuation shadow is where
    // the eye-catching per-instrument numbers came from, and judging it only on
    // the window that produced them is how a hot streak gets mistaken for an
    // edge - XAUUSD printed +1.317R/setup over 60 days and +0.136R/setup over
    // the year, which is the luckiest of sixteen at 2.4 sigma, a result pure
    // chance produces 13% of the time.
    for (const [bookName, bookRows] of [["ORIGIN", all], ["CONTINUATION", contAll]] as const) {
      if (OOS_DAYS <= 0 || !bookRows.length) continue;
      const oos = oosReport(bookRows, spreadAdj, { heldOutDays: OOS_DAYS, minAlerts: OOS_MIN_ALERTS });
      const sel = Number.isFinite(oos.splitTime)
        ? new Date(oos.splitTime).toISOString().slice(0, 10) : "n/a";
      // If the held-out window is at least as long as the run, the split lands
      // before the data starts and every trade is "held out" - the block then
      // looks like a result while measuring nothing.
      const selEmpty = oos.instruments.every((i) => i.selAlerts === 0);
      if (selEmpty) {
        console.log(
          `\n!! OUT-OF-SAMPLE (${bookName}): no selection-period trades at all. BACKTEST_OOS_DAYS=${OOS_DAYS} ` +
          `is at least as long as this run's window, so there is nothing to select on. ` +
          `Lengthen the run or lower BACKTEST_OOS_DAYS.`,
        );
      }
      const L = [
        `OUT-OF-SAMPLE [${bookName}] - picked on entries before ${sel}, judged on the ${OOS_DAYS}d after`,
        `   picking needs >= ${OOS_MIN_ALERTS} alerts and positive R/alert; the ranking never sees the held-out window`,
        `   pair       sel alerts  sel R/alert  |  oos alerts  oos R/alert   picked`,
      ];
      for (const i of oos.instruments) {
        L.push(
          `   ${i.pair.padEnd(10)}${String(i.selAlerts).padStart(6)}${f(i.selExp).padStart(13)}  |` +
          `${String(i.oosAlerts).padStart(12)}${f(i.oosExp).padStart(13)}   ${i.selected ? "yes" : "-"}`,
        );
      }
      L.push(`   picked ${oos.selectedPairs.length} of ${oos.instruments.length}: ${oos.selectedPairs.join(", ") || "none"}`);
      L.push(`   HELD-OUT RESULT of the picked book : ${oos.oosAlerts} alerts - net ${f(oos.oosNet, 1)}R - ${f(oos.oosExp)}R/alert`);
      L.push(`   whole book over the same window    : ${oos.allOosAlerts} alerts - net ${f(oos.allOosNet, 1)}R`);
      L.push(`   The "picked" line is the answer. The per-pair table above merges both`);
      L.push(`   periods, so it cannot separate a durable edge from one instrument`);
      L.push(`   having a good quarter.`);
      const o = L.join("\n");
      console.log("\n" + o);
      block.push("", "```", o, "```");
    }

    // Portfolio: measured correlation, redundancy drop, and the prop sim driven
    // by the book's own mix rather than an assumed one.
    if (all.length) {
      const series = dailyRByPair(all, spreadAdj);
      const cm = corrMatrix(series);
      const meanR = meanPairwiseCorrelation(cm);
      const top = maxPair(cm);
      const mix = alertMix(all, spreadAdj);
      const months = new Set(all.map((t) => t.entryTime.slice(0, 7))).size || 1;
      const nPairs = new Set(all.map((t) => t.pair)).size || 1;
      const perMonth = all.length / months / nPairs;
      const exp = mix.winRate * mix.targetR - mix.lossRate;
      // NaN means the series were too flat or too few to correlate. Falling back
      // to 0 assumes independence, so it is labelled rather than silent.
      const corrUsed = Number.isFinite(meanR) ? meanR : 0;
      const expectancy: Record<string, number> = {};
      for (const pr of Object.keys(series)) {
        const rows = all.filter((t) => t.pair === pr);
        const st = stats(rows, spreadAdj);
        expectancy[pr] = st.alerts ? st.finalR / st.alerts : NaN;
      }
      const red = dropRedundant({ expectancy, corr: cm, threshold: CORR_THRESHOLD });

      const P = [
        `PORTFOLIO - ${nPairs} instruments - correlation measured from daily realised R`,
        `   mean pairwise r ${f(corrUsed, 3)}${Number.isFinite(meanR) ? "" : "  (not computable - assumed 0, i.e. independent)"}`,
        top ? `   most correlated pair  ${top.a} / ${top.b}  r=${f(top.r, 3)}` : "",
        `   redundancy drop at r>=${f(CORR_THRESHOLD, 2)}: kept ${red.kept.length}, dropped ${red.dropped.length}` +
          (red.dropped.length ? ` (${red.dropped.map((d) => `${d.pair} via ${d.becauseOf} ${f(d.r, 2)}`).join("; ")})` : ""),
        `   Sparse series attenuate r toward 0, so read this as a LOWER bound on`,
        `   correlation and prefer the pessimistic reading.`,
        ``,
        `MONTE CARLO - the book's own mix, ${DAILY_LOSS_CAP}-loss daily cap, ${PROP_TRIALS} trials`,
        `   mix win ${(mix.winRate * 100).toFixed(1)}% loss ${(mix.lossRate * 100).toFixed(1)}% scratch ${(mix.scratchRate * 100).toFixed(1)}% @ ${f(mix.targetR)}R  =>  ${exp >= 0 ? "+" : ""}${f(exp)}R/trade`,
        `   alerts/month/instrument ${f(perMonth)} (${all.length} alerts / ${months} mo / ${nPairs} pairs)`,
        `   risk      pass    blown   neither   avg trades`,
      ].filter(Boolean);
      for (const risk of RISK_PCTS) {
        const r = simulate({
          mix, rules: { targetPct: PROP_TARGET, dailyPct: PROP_DAILY, overallPct: PROP_TOTAL, tradingDays: 21 },
          instruments: nPairs, alertsPerMonthPerInstrument: perMonth, riskPct: risk,
          correlation: corrUsed, dailyLossCap: DAILY_LOSS_CAP, trials: PROP_TRIALS, seed: 20261011,
        });
        P.push(
          `   ${risk.toFixed(2)}%${r.passRate.toFixed(1).padStart(9)}%${r.blownRate.toFixed(1).padStart(8)}%` +
          `${r.neitherRate.toFixed(1).padStart(9)}%${r.avgTrades.toFixed(1).padStart(12)}`,
        );
      }
      const po = P.join("\n");
      console.log("\n" + po);
      block.push("", "```", po, "```");
    }

    return { block: block.join("\n"), riskNote };
  };

  const missing = pairs.filter((p2) => SPREAD_EST[p2] === undefined);
  if (missing.length) {
    console.log(
      `\n!! No spread estimate for: ${missing.join(", ")}.` +
        ` Their "spread-adjusted" figures equal raw (cost treated as 0), so those rows understate real cost.`,
    );
  }

  // Applied to the whole book, not per pair: a subscriber's account sees one
  // stream of alerts across every instrument, so that is the stream the cap
  // has to bound. The suppressed count is printed because a cap that quietly
  // removed half the book would look like an improvement in every ratio.
  if (MAX_TRADES_PER_DAY > 0) {
    for (const [label, bucket] of [["origin", all], ["continuation", contAll], ["confirmation", confAll]] as const) {
      const before = bucket.length;
      const kept = capPerDay(bucket, MAX_TRADES_PER_DAY);
      bucket.length = 0;
      bucket.push(...kept);
      if (label === "origin" || before !== kept.length) {
        console.log(
          `\n*** BACKTEST_MAX_TRADES_PER_DAY=${MAX_TRADES_PER_DAY} — ${label}: ` +
          `${before} -> ${kept.length} alerts (${before - kept.length} suppressed) ***`);
      }
    }
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

  // ── Bias gate ────────────────────────────────────────────────────────
  // The storyline rule, measured against the gate the continuation model
  // already uses. Fire rate and agreement first, because a gate that fires on
  // every tick or on none of them needs no further measurement. Then what it
  // would do to the origin book — split across the two halves of the window,
  // because an unsplit filter result on this data has already changed sign
  // between halves once, and a filter that only works in one regime is not a
  // filter.
  if (BIAS_ENABLED) {
    const fired = biasAll.ticks - (biasAll.dirs.none ?? 0);
    const firePct = biasAll.ticks ? (fired / biasAll.ticks) * 100 : NaN;
    console.log(`\nBIAS GATE — ${fired}/${biasAll.ticks} ticks carry a bias (${f(firePct, 1)}%) ` +
      `· levels ${[...BIAS_LEVEL_KINDS].join("/") || "none"} minTouches ${BIAS_MIN_TOUCHES} ` +
      `· originLookback ${BIAS_ORIGIN_LOOKBACK} confirmLookback ${BIAS_CONFIRM_LOOKBACK} ` +
      `sweptLookback ${BIAS_SWEPT_LOOKBACK}`);
    console.log(`   direction    : ${fmtCounts(biasAll.dirs)}`);
    console.log(`   confirmation : ${fmtCounts(biasAll.kinds)}`);
    console.log(`   origin>conf  : ${fmtCounts(biasAll.pairs)}`);
    console.log(`   levels/tier  : ${fmtCounts(biasAll.levels)}`);
    const agreeKeys = Object.keys(biasAll.agree).sort();
    let both = 0; let same = 0;
    for (const k of agreeKeys) {
      const [mtf, bg] = k.split("|");
      if (mtf === "none" || bg === "none") continue;
      both += biasAll.agree[k];
      if (mtf === bg) same += biasAll.agree[k];
    }
    console.log(`   vs multiTfGate — both fired on ${both} ticks, same direction on ${same} ` +
      `(${both ? f((same / both) * 100, 1) + "%" : "-"})`);
    for (const k of agreeKeys) console.log(`      ${(k + " ").padEnd(16)}${biasAll.agree[k]}`);

    // What the gate would do to the alerts the live engine already produces.
    const bucket = (want: "agree" | "oppose" | "none"): Trade[] => all.filter((t) => {
      const b = t.biasDir ?? "none";
      if (b === "none") return want === "none";
      if (want === "none" || !t.dir) return false;
      return (b === t.dir) === (want === "agree");
    });
    const midIso = new Date(Date.now() - END_OFFSET_DAYS * 86400_000 - (days / 2) * 86400_000)
      .toISOString().slice(0, 10);
    const agreeRow = (label: string, rows: Trade[]): string => {
      const s = stats(rows, true);
      const older = stats(rows.filter((t) => t.entryTime.slice(0, 10) < midIso), true);
      const recent = stats(rows.filter((t) => t.entryTime.slice(0, 10) >= midIso), true);
      return `${label.padEnd(8)} ${String(rows.length).padStart(4)} alerts · net ${f(s.finalR)}R · ` +
        `PF ${f(s.pf)} · win ${f(s.winrate, 1)}%  || older half ${older.tp + older.sl} closed ` +
        `${f(older.finalR)}R · recent half ${recent.tp + recent.sl} closed ${f(recent.finalR)}R`;
    };
    const agreeLines: string[] = [];
    console.log(`   origin book by gate agreement (adj, window split at ${midIso}):`);
    for (const [label, want] of [["agrees", "agree"], ["opposes", "oppose"], ["no bias", "none"]] as const) {
      const line = agreeRow(label, bucket(want));
      console.log(`      ${line}`);
      agreeLines.push(`- ${line}`);
    }

    lines += `\n## Bias gate — the storyline rule, measured\n\n` +
      `multiTfGate wants a breakout on every timeframe at once and asks for no rejection\n` +
      `and no candle closure anywhere. biasGate wants rejection and closure on the origin\n` +
      `timeframe and one of three confirmations exactly one timeframe below it. Both ran on\n` +
      `every tick of this replay.\n\n` +
      `- ticks with a bias: ${fired}/${biasAll.ticks} (${f(firePct, 1)}%)\n` +
      `- direction: ${fmtCounts(biasAll.dirs)}\n- confirmation: ${fmtCounts(biasAll.kinds)}\n` +
      `- origin>confirm tier: ${fmtCounts(biasAll.pairs)}\n- key levels per tier: ${fmtCounts(biasAll.levels)}\n` +
      `- level kinds ${[...BIAS_LEVEL_KINDS].join("/")} · minTouches ${BIAS_MIN_TOUCHES} · ` +
      `lookbacks ${BIAS_ORIGIN_LOOKBACK}/${BIAS_CONFIRM_LOOKBACK}/${BIAS_SWEPT_LOOKBACK}\n` +
      `- vs multiTfGate: both fired on ${both} ticks, same direction on ${same}\n` +
      `- agreement cells (multiTfGate|biasGate): ${agreeKeys.map((k) => `${k} ${biasAll.agree[k]}`).join(", ")}\n\n` +
      `Origin book split by whether the gate agreed, spread-adjusted, with the window\n` +
      `halved so a regime-only result cannot hide in the total:\n\n${agreeLines.join("\n")}\n\n`;
  }

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
      `legOrigin ${CONT_LEG_ORIGIN}, impulseLookback ${CONT_IMPULSE_LOOKBACK}, minBodyPct ${CONT_MIN_BODY_PCT}, ` +
      `minBreakAtr ${CONT_MIN_BREAK_ATR}, requireLiquidity ${CONT_REQUIRE_LIQ}, rr ${CONT_RR}R)`);
    const cHead = `adj  net ${f(cs.finalR)}R · PF ${f(cs.pf)} · win ${f(cs.winrate, 1)}% · ` +
      `maxDD ${f(cs.maxDD)}R · closed ${cs.tp + cs.sl}/${contAll.length}`;
    console.log(contAll.length ? `   ${cHead}` : "   no setups — relax a parameter, do not assume the model is dead");
    // Same setups, entered at market instead of waiting for the limit to fill.
    const cm = stats(marketShadowRows(contAll), true);
    console.log(`   market @ next 30m open : net ${f(cm.finalR)}R · PF ${f(cm.pf)} · ` +
      `win ${f(cm.winrate, 1)}% · closed ${cm.tp + cm.sl}/${contAll.length}`);
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

  if (TARGET_SWEEP.length) {
    const cur = stats(all, false);  // raw, like the sweep rows - not spread-adjusted
    const rows = sweepRows(TARGET_SWEEP, sweepAcc);
    const sw = renderSweepTable(
      rows, cur.alerts ? cur.finalR / cur.alerts : NaN, cur.alerts).join("\n");
    console.log("\n" + sw);
    lines += `\n## Target sweep\n\n\`\`\`\n${sw}\n\`\`\`\n`;
  }

  const name = `backtest-report-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(name, lines);
  console.log(`\nreport written: ${name}\n(alert = entry that would have alerted; win% over TP+SL only; PF = Σwins/Σ|losses|)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
