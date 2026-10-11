/**
 * Replay book-keeping: the trade row shape and the statistics the walk-forward
 * replay reports.
 *
 * This lives in src/ rather than in scripts/backtest.ts for one reason — the
 * base tsconfig covers src/ and test/ with `"types": []`, so a test can import
 * this and be typechecked, whereas importing the script would drag Node
 * globals into a config that deliberately excludes them. The accounting here
 * is exactly where a silent error is most expensive: it is what turns a
 * replay into the numbers a decision gets made from.
 */

/** ESTIMATE of typical spread, in price units. Conservative averages, NOT measured. */
export const SPREAD_EST: Record<string, number> = {
  EURUSD: 0.00002, GBPUSD: 0.00004, XAUUSD: 0.40, USDZAR: 0.0025,
  US30: 4.0, GER40: 1.2, JAPAN225: 8.0, NAS100: 1.5,
  USDJPY: 0.015, AUDJPY: 0.02, GBPJPY: 0.03, EURJPY: 0.02,
  USDCAD: 0.00002, NZDUSD: 0.00003,
};

export interface Trade {
  pair: string; tf: string; setupId: string;
  entryTime: string; entry: number; stop: number; tp: number;
  status: string; exit: number; exitTime: string; r: number;
  limitStatus: string; limitEntry: number; limitExitTime: string; limitR: number;
  marketStatus: string; marketEntry: number; marketExitTime: string; marketR: number;
  /** Continuation shadow only: how impulsive the break candle was. */
  bodyPct?: number; bodyAtr?: number;
  /**
   * Direction of the setup. Stored explicitly so the origin book can be split
   * by whether the bias gate agreed with it; reading it back from the ordering
   * of entry/stop/tp would be one more thing to get wrong.
   */
  dir?: "LONG" | "SHORT";
  /** Bias-gate shadow: the gate's state at the tick this setup was produced. */
  biasDir?: string; biasKind?: string; mtfDir?: string;
}

/**
 * Groups trade rows by entry timeframe, in the caller's order, omitting groups
 * with no rows.
 *
 * Every origin row has carried its entry timeframe since the beginning; nothing
 * ever grouped by it, which is why the replay could never answer the one
 * structural question the entry model turns on. It lives here rather than in
 * scripts/backtest.ts because the replay needs OANDA and cannot be run in CI,
 * whereas this can.
 */
export function entryTfGroups(rows: Trade[], order: string[]): [string, Trade[]][] {
  const out: [string, Trade[]][] = [];
  const named = new Set<string>();
  for (const tf of order) {
    named.add(tf);
    const g = rows.filter((t) => t.tf === tf);
    if (g.length) out.push([tf, g]);
  }
  // A timeframe nobody asked for still gets a row. Dropping it would let the
  // breakdown look complete while quietly omitting trades from the total.
  for (const tf of [...new Set(rows.map((t) => t.tf))]) {
    if (!named.has(tf)) out.push([tf, rows.filter((t) => t.tf === tf)]);
  }
  return out;
}

/**
 * Daily risk profile — the constraint subscribers are actually funded against.
 *
 * maxDD above is a whole-window, closed-trade figure. A prop firm enforces two
 * different limits: a DAILY one, commonly 3%, and an overall one, commonly 5%.
 * A book can sit comfortably inside the overall limit and still lose the
 * account on a single bad session, so the window figure cannot size for
 * either. This measures the daily one from the trades themselves.
 *
 * worstDayLoss is measured from each day's opening cumulative R, which is how
 * most firms define the daily limit (loss against the balance at the start of
 * the day). Firms that trail the limit from the day's high-water mark instead
 * will see a larger number than this reports, so treat it as the optimistic
 * reading of the two conventions.
 *
 * Rolling windows count days that had at least one close, not calendar days —
 * on a sparse book a calendar-day window is almost always empty and says
 * nothing about clustering.
 */
export interface DailyRisk {
  days: number;
  worstDayLoss: number;
  worstDayLossDate: string;
  worstDayClose: number;
  worstDayCloseDate: string;
  /** Worst net R across a rolling window of days that had trades. NaN when
   *  the book has fewer such days than the window, so the report renders "-"
   *  rather than a 0 that reads as "no loss". */
  worst3Day: number;
  worst5Day: number;
}

export function dailyRisk(rows: Trade[], spreadAdj: boolean): DailyRisk {
  const closed = rows
    .map((t) => applySpread(t, spreadAdj))
    .filter((t) => t.status !== "OPEN" && Number.isFinite(t.r) && t.exitTime !== "-")
    .sort((a, b) => (a.exitTime + a.setupId).localeCompare(b.exitTime + b.setupId));

  let worstDayLoss = 0, worstDayLossDate = "-";
  const byDay = new Map<string, number>();
  let day = "", cum = 0, minCum = 0;
  for (const t of closed) {
    const d = t.exitTime.slice(0, 10);
    if (d !== day) { day = d; cum = 0; minCum = 0; }
    cum += t.r;
    if (cum < minCum) minCum = cum;
    if (-minCum > worstDayLoss) { worstDayLoss = -minCum; worstDayLossDate = d; }
    byDay.set(d, (byDay.get(d) ?? 0) + t.r);
  }

  const days = [...byDay.keys()].sort();
  const net = days.map((d) => byDay.get(d) as number);
  // The lowest day close, positive or not. Seeding this at 0 - the natural
  // thing to write - makes a book whose worst day was still profitable report
  // 0, which is indistinguishable from "no data".
  let worstDayClose = 0, worstDayCloseDate = "-";
  if (net.length) {
    worstDayClose = Math.min(...net);
    worstDayCloseDate = days[net.indexOf(worstDayClose)];
  }
  // NaN, not 0, when there are fewer days than the window: "not enough history
  // for this window" and "a window that broke even" are different facts, and
  // f() already renders NaN as "-".
  const roll = (k: number): number => {
    if (net.length < k) return NaN;
    let worst = Infinity;
    for (let i = 0; i + k <= net.length; i++) {
      const sum = net.slice(i, i + k).reduce((a, b) => a + b, 0);
      if (sum < worst) worst = sum;
    }
    return worst;
  };

  return {
    days: days.length, worstDayLoss, worstDayLossDate,
    worstDayClose, worstDayCloseDate, worst3Day: roll(3), worst5Day: roll(5),
  };
}

/**
 * Largest risk-per-trade, as a percent of account, that keeps an observed
 * worst-case loss inside a limit. Infinity means the worst case on this data
 * was not a loss, so the limit does not bind — which on a short book is a
 * warning about the sample, not a licence to size up.
 *
 * worstR is a MAGNITUDE, >= 0, which is the convention dailyRisk().worstDayLoss
 * and stats().maxDD both use. This originally took a signed loss, and the report
 * passed it magnitudes, so every call returned Infinity and the sizing line
 * printed "n/a" on every run it was ever used on. Unit tests missed it because
 * they fed the function the signed values its own comment described and never
 * the values its only caller produces.
 */
export function riskForLimit(worstR: number, limitPct: number): number {
  return worstR > 0 ? limitPct / worstR : Infinity;
}

/**
 * Keeps at most `max` trades per calendar day, taken in entry order.
 *
 * A daily trade cap is a prop-firm tool, not an edge: it exists to bound the
 * worst single day so risk per trade can be raised. It costs expectancy,
 * because every suppressed alert had positive expected value, so it is only
 * worth it when the daily limit - not the return - is what binds.
 *
 * Entry order is the only rule that is actually implementable live. Choosing
 * the day's best trade in hindsight would report a number nobody could trade,
 * and the first alert is what a subscriber acting on notifications would take.
 */
export function capPerDay(rows: Trade[], max: number): Trade[] {
  if (!Number.isFinite(max) || max <= 0) return rows;
  const ordered = [...rows].sort((a, b) =>
    (a.entryTime + a.setupId).localeCompare(b.entryTime + b.setupId));
  const seen = new Map<string, number>();
  const out: Trade[] = [];
  for (const t of ordered) {
    const d = t.entryTime.slice(0, 10);
    const n = seen.get(d) ?? 0;
    if (n >= max) continue;
    seen.set(d, n + 1);
    out.push(t);
  }
  return out;
}

/** One calendar month of closed trades, with the three figures a prop firm tests. */
export interface MonthBucket {
  month: string;
  alerts: number;
  netR: number;
  maxDD: number;
  worstDay: number;
}

/**
 * Splits the book into calendar months of closed trades.
 *
 * "Pass a challenge within a month" is a monthly question, and a 180-day
 * aggregate cannot answer it: it averages six challenges into one number and
 * reports the drawdown of the whole window rather than the worst month in it.
 * This gives six samples of the thing actually being asked.
 *
 * Spread is charged once here; the per-month calls below pass spreadAdj=false
 * so it is not charged twice.
 */
export function monthlyBuckets(rows: Trade[], spreadAdj: boolean): MonthBucket[] {
  const closed = rows
    .map((t) => applySpread(t, spreadAdj))
    .filter((t) => t.status !== "OPEN" && Number.isFinite(t.r) && t.exitTime !== "-");
  const byMonth = new Map<string, Trade[]>();
  for (const t of closed) {
    const m = t.exitTime.slice(0, 7);
    const arr = byMonth.get(m);
    if (arr) arr.push(t); else byMonth.set(m, [t]);
  }
  return [...byMonth.keys()].sort().map((month) => {
    const rs = byMonth.get(month) as Trade[];
    return {
      month, alerts: rs.length, netR: stats(rs, false).finalR,
      maxDD: stats(rs, false).maxDD, worstDay: dailyRisk(rs, false).worstDayLoss,
    };
  });
}

/** Prop-firm challenge limits, in percent of the starting balance. */
export interface PropLimits {
  targetPct: number;
  dailyPct: number;
  totalPct: number;
}

/**
 * Would this month have passed a challenge at the given risk per trade?
 *
 * Reasons are returned in the order a firm would hit them. A daily breach ends
 * the account immediately, so it is reported even in a month that made the
 * target - a month that made 12% and blew the daily limit on the way is a
 * failure, and reporting it as a pass is how a backtest starts lying.
 */
export function challengeVerdict(
  m: MonthBucket, riskPct: number, lim: PropLimits,
): { pass: boolean; reason: string } {
  const ret = m.netR * riskPct, dd = m.maxDD * riskPct, day = m.worstDay * riskPct;
  if (day >= lim.dailyPct) return { pass: false, reason: `daily ${f(day, 2)}% >= ${lim.dailyPct}%` };
  if (dd >= lim.totalPct) return { pass: false, reason: `total ${f(dd, 2)}% >= ${lim.totalPct}%` };
  if (ret < lim.targetPct) return { pass: false, reason: `made ${f(ret, 2)}% < ${lim.targetPct}%` };
  return { pass: true, reason: `made ${f(ret, 2)}%, worst day ${f(day, 2)}%, max DD ${f(dd, 2)}%` };
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

/**
 * Charges a trade's round-trip spread against its R. Hoisted out of stats() so
 * that every statistic - the book totals and the daily risk profile alike -
 * costs trades the same way. Divergence here would make the daily limit look
 * safer than the equity curve it is supposed to describe.
 */
function applySpread(t: Trade, spreadAdj: boolean): Trade {
  if (!spreadAdj || t.status === "OPEN" || !Number.isFinite(t.r)) return t;
  const riskDist = Math.abs(t.entry - t.stop);
  const spread = SPREAD_EST[t.pair] ?? 0;
  const costR = riskDist > 0 ? spread / riskDist : 0;
  return { ...t, r: t.r - 2 * costR };
}

export function stats(rows: Trade[], spreadAdj: boolean) {
  const rowsA = rows.map((t) => applySpread(t, spreadAdj));
  const tp = rowsA.filter((r) => r.status === "TP_HIT");
  const sl = rowsA.filter((r) => r.status === "SL_HIT");
  const ex = rowsA.filter((r) => r.status === "EXPIRED");
  // evaluateSignal resolves a trade that armed breakeven at +1.5R and was then
  // taken out at entry as BE_HIT with rMultiple 0. Counting only TP/SL/EXPIRED
  // files those scratches under `open`, which reports a live position where
  // there was a closed one — and hides how much work the breakeven
  // instruction that ships in every alert is actually doing.
  const be = rowsA.filter((r) => r.status === "BE_HIT");
  const closed = [...tp, ...sl];
  const r = closed.map((t) => t.r);
  const wins = tp.map((t) => t.r);
  const losses = sl.map((t) => Math.abs(t.r));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    alerts: rowsA.length, tp: tp.length, sl: sl.length, be: be.length, expired: ex.length,
    open: rowsA.length - tp.length - sl.length - be.length - ex.length,
    winrate: closed.length ? (tp.length / closed.length) * 100 : NaN,
    /** Breakeven scratches as a share of everything that resolved. */
    scratchPct: (tp.length + sl.length + be.length)
      ? (be.length / (tp.length + sl.length + be.length)) * 100
      : NaN,
    avgR: r.length ? sum(r) / r.length : NaN,
    pf: losses.length && sum(losses) > 0 ? sum(wins) / sum(losses) : NaN,
    ...rack(rowsA),
  };
}

export const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");

/** The same alerts re-read as if each had been entered on the pending limit. */
export function limitShadowRows(rows: Trade[]): Trade[] {
  return rows.map((t) => ({
    ...t,
    entry: t.limitEntry,
    status: t.limitStatus,
    exitTime: t.limitExitTime,
    r: t.limitR,
  }));
}

/** The same alerts re-read as if each had been entered at market, next open. */
export function marketShadowRows(rows: Trade[]): Trade[] {
  return rows.map((t) => ({
    ...t,
    entry: t.marketEntry,
    status: t.marketStatus,
    exitTime: t.marketExitTime,
    r: t.marketR,
  }));
}
