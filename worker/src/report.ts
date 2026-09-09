/** Markdown rendering for the replay report — kept here (not inside
 *  `scripts/backtest.ts`) for two reasons: the backtest script imports
 *  `node:fs`, so a test importing it would drag Node globals into the
 *  Worker's typecheck (which has no `@types/node` by design), and the
 *  layout is pure string work that deserves its own tests.
 *
 *  Nothing here is performance reporting on its own — it only formats rows
 *  the replay produced. */
import type { PerfSummary } from "./perf";

export const COLS = ["pair", "alerts", "TP", "SL", "EXP", "open", "win%", "avgR", "PF", "maxDD-R", "loseStrk"];

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");

export function row(pair: string, s: PerfSummary): string[] {
  return [pair, String(s.alerts), String(s.tp), String(s.sl), String(s.expired), String(s.open),
    f(s.winRate, 1), f(s.avgR), f(s.pf), f(s.maxDdR), String(s.loseStreak)];
}

export function tableLines(rows: string[][]): string {
  return rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
}

export function pad(r: string[]): string {
  return r.map((c) => c.padStart(9)).join("");
}

/** Exit-ordered equity curve table + the two risk lines, for one view. */
export function riskSection(title: string, s: PerfSummary): string {
  let out = `\n### ${title}\n\n`;
  if (!s.curve.length) {
    out += "_no closed trades with a finite R — nothing to plot._\n";
    return out;
  }
  out += "| # | exit time UTC | pair | tf | R | cum R | peak | DD |\n|---|---|---|---|---|---|---|---|\n";
  s.curve.forEach((p, i) => {
    out += `| ${i + 1} | ${p.exitTime} | ${p.pair} | ${p.tf} | ${p.r.toFixed(2)} | ${p.cum.toFixed(2)} | ${p.peak.toFixed(2)} | ${p.dd.toFixed(2)} |\n`;
  });
  out += `\n- Max drawdown: **${s.maxDdR.toFixed(2)}R** (equity peak ${s.ddFrom} → trough ${s.ddTo})\n`;
  out += `- Longest losing streak: **${s.loseStreak}** · longest winning streak: **${s.winStreak}**\n`;
  return out;
}
