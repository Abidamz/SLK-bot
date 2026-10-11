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

export function stats(rows: Trade[], spreadAdj: boolean) {
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
