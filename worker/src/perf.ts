/** Replay performance math — PURE, network-free, unit-testable.
 *
 *  Shared by `scripts/backtest.ts` (walk-forward replay over real Dukascopy
 *  candles) and its unit tests. Keeping the arithmetic here (instead of
 *  inline in the script) is what lets the drawdown/streak/cost numbers be
 *  tested without fetching a single candle.
 *
 *  Nothing here is a performance claim: it only summarises rows the replay
 *  produced. Empty inputs return NaN/0 rather than invented figures. */
export interface TradeRow {
  pair: string;
  tf: string;
  status: string;   // TP_HIT | SL_HIT | EXPIRED | OPEN
  entry: number;
  stop: number;
  exit: number;
  exitTime: string; // "YYYY-MM-DD HH:MM" UTC, "-" when unresolved
  exitMs: number;   // NaN when unresolved (sorting key)
  r: number;        // raw R multiple, NaN when unresolved
}

/** Estimated round-trip spread cost per instrument, in PRICE units.
 *
 *  ⚠️ ESTIMATE — a typical, not measured, spread. Dukascopy history is BID
 *  mid-ish and the replay has no tick data, so this is the honest way to
 *  show the direction and rough size of the cost, not an exact fill model.
 *  It excludes slippage, commissions and overnight financing. */
export const SPREAD_EST: Record<string, number> = {
  EURUSD: 0.00002,
  GBPUSD: 0.00004,
  XAUUSD: 0.40,
  USDZAR: 0.0025,
  US30: 4.0,
  GER40: 1.2,
  JAPAN225: 8.0,
};

export function spreadFor(pair: string): number {
  return SPREAD_EST[pair.toUpperCase().replace("/", "").replace("=X", "")] ?? 0;
}

/** R after subtracting a round-trip spread, expressed in R units:
 *  cost(R) = spread(price) / risk(price). NaN when the row never closed. */
export function rAfterCost(row: TradeRow, spreadPrice = spreadFor(row.pair)): number {
  const risk = Math.abs(row.entry - row.stop);
  if (!Number.isFinite(row.r) || !Number.isFinite(risk) || risk <= 0) return NaN;
  return row.r - spreadPrice / risk;
}

export interface EquityPoint {
  exitTime: string;
  pair: string;
  tf: string;
  r: number;    // trade R (cost-adjusted in the adjusted view)
  cum: number;  // cumulative R after this trade
  peak: number; // running peak of cum (starts at 0)
  dd: number;   // peak − cum (≥ 0)
}

export interface PerfSummary {
  alerts: number;
  tp: number;
  sl: number;
  expired: number;
  open: number;
  /** share (0–100) of closed trades whose R is > 0 after cost */
  winRate: number;
  avgR: number;
  pf: number;
  maxDdR: number;     // worst peak→trough on the exit-ordered equity curve
  ddFrom: string;     // exit time of the equity peak the drawdown started from
  ddTo: string;       // exit time of the trough
  loseStreak: number; // longest run of consecutive losing trades
  winStreak: number;  // longest run of consecutive winning trades
  curve: EquityPoint[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Exit-ordered equity curve + max drawdown + streaks for one set of rows.
 *  Only TP_HIT/SL_HIT rows with a finite R are on the curve (matches the
 *  baseline: win% and PF are quoted over TP+SL, EXPIRED is reported apart). */
export function summarize(rows: TradeRow[], opts: { spread?: boolean } = {}): PerfSummary {
  const spread = opts.spread ?? false;
  const closed = rows
    .filter((r) => (r.status === "TP_HIT" || r.status === "SL_HIT") && Number.isFinite(r.r))
    .sort((a, b) => (Number.isFinite(a.exitMs) ? a.exitMs : 0) - (Number.isFinite(b.exitMs) ? b.exitMs : 0));

  const withR = closed
    .map((row) => ({ row, r: spread ? rAfterCost(row) : row.r }))
    .filter((x) => Number.isFinite(x.r));

  const rs = withR.map((x) => x.r);
  const wins = rs.filter((x) => x > 0);
  const losses = rs.filter((x) => x < 0);

  // ---- exit-ordered equity curve, peak → trough drawdown ----
  const curve: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  let maxDdR = 0;
  let ddFrom = "-";
  let ddTo = "-";
  let peakAt = "(start)";
  for (const { row, r } of withR) {
    cum += r;
    if (cum > peak) { peak = cum; peakAt = row.exitTime; }
    const dd = peak - cum;
    if (dd > maxDdR) { maxDdR = dd; ddFrom = peakAt; ddTo = row.exitTime; }
    curve.push({ exitTime: row.exitTime, pair: row.pair, tf: row.tf, r, cum, peak, dd });
  }

  // ---- longest losing / winning runs on the same (exit-ordered) series ----
  let loseStreak = 0, winStreak = 0, curLose = 0, curWin = 0;
  for (const r of rs) {
    if (r < 0) { curLose++; curWin = 0; } else if (r > 0) { curWin++; curLose = 0; } else { curLose = 0; curWin = 0; }
    if (curLose > loseStreak) loseStreak = curLose;
    if (curWin > winStreak) winStreak = curWin;
  }

  const tp = rows.filter((r) => r.status === "TP_HIT").length;
  const sl = rows.filter((r) => r.status === "SL_HIT").length;
  const expired = rows.filter((r) => r.status === "EXPIRED").length;

  return {
    alerts: rows.length,
    tp, sl, expired,
    open: rows.length - tp - sl - expired,
    winRate: rs.length ? (wins.length / rs.length) * 100 : NaN,
    avgR: rs.length ? sum(rs) / rs.length : NaN,
    pf: losses.length && sum(losses) < 0 ? sum(wins) / Math.abs(sum(losses)) : NaN,
    maxDdR, ddFrom, ddTo, loseStreak, winStreak, curve,
  };
}
