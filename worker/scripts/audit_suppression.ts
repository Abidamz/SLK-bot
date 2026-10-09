/** Read-only ledger audit: what is being suppressed, and what those setups
 *  went on to return.
 *
 *  Answers two open questions with the same pull:
 *    1. Which suppression reason is actually costing R? (The cooldown was
 *       assumed dominant for a long time before it was ever counted.)
 *    2. Do HTF_CONFLICT setups win or lose? (Migration 0009 persists
 *       shadow_classification; deciding whether to widen the HTF conflict
 *       gate beyond Deriv synthetics depends on this.)
 *
 *  Nothing here is fabricated. Every figure comes from stored slk_alerts rows,
 *  and unresolved (still OPEN) setups are reported separately rather than
 *  counted as zero.
 *
 *  Usage:
 *    cd worker
 *    TAYO_ADMIN_KEY=... npx tsx scripts/audit_suppression.ts
 *    TAYO_ADMIN_KEY=... TAYO_BASE_URL=https://... npx tsx scripts/audit_suppression.ts
 *
 *  Requires the owner read key (/alerts is authed).
 */

// The worker GitHub Actions deploys: wrangler.jsonc names it tayo-alert-worker,
// so its URL is https://tayo-alert-worker.<subdomain>.workers.dev. If your
// alerts live on the pre-rename worker instead, override with
// TAYO_BASE_URL=https://slk-alert-worker.<subdomain>.workers.dev
const BASE = process.env.TAYO_BASE_URL ?? "https://tayo-alert-worker.abidogundamilola.workers.dev";
const KEY = process.env.TAYO_ADMIN_KEY ?? "";

type Row = {
  pair?: string;
  timeframe?: string;
  direction?: string;
  status?: string;
  alertStatus?: string;
  rMultiple?: number | null;
  suppressReason?: string | null;
  shadowClassification?: string | null;
  /** Migration 0010. 1 = the pending limit at entry would have filled,
   *  0 = resolved without ever touching entry, null = not recorded. */
  fillConfirmed?: number | null;
};

interface Bucket {
  count: number;
  resolved: number;
  open: number;
  wins: number;
  losses: number;
  scratched: number;
  netR: number;
}

const empty = (): Bucket => ({
  count: 0, resolved: 0, open: 0, wins: 0, losses: 0, scratched: 0, netR: 0,
});

function accumulate(b: Bucket, r: Row): void {
  b.count++;
  const rMultiple = typeof r.rMultiple === "number" ? r.rMultiple : null;
  if (r.status === "OPEN" || rMultiple === null) { b.open++; return; }
  b.resolved++;
  b.netR += rMultiple;
  if (rMultiple > 0) b.wins++;
  else if (rMultiple < 0) b.losses++;
  else b.scratched++;
}

const pct = (n: number, d: number): string =>
  d ? `${Math.round((n / d) * 1000) / 10}%` : "n/a";

function render(title: string, buckets: Map<string, Bucket>): void {
  console.log(`\n=== ${title} ===`);
  if (!buckets.size) { console.log("  (no rows)"); return; }
  const rows = [...buckets.entries()].sort((a, b) => b[1].netR - a[1].netR);
  const pad = Math.max(...rows.map(([k]) => k.length), 12);
  console.log(
    "  " + "group".padEnd(pad) +
    "n".padStart(5) +
    "res".padStart(5) +
    "open".padStart(6) +
    "win".padStart(5) +
    "BE".padStart(4) +
    "loss".padStart(6) +
    "netR".padStart(10) +
    "avgR".padStart(8) +
    "win%".padStart(8),
  );
  for (const [key, b] of rows) {
    const avgR = b.resolved ? b.netR / b.resolved : NaN;
    const winRate = b.resolved ? (b.wins / b.resolved) * 100 : NaN;
    console.log(
      "  " + key.padEnd(pad) +
      String(b.count).padStart(5) +
      String(b.resolved).padStart(5) +
      String(b.open).padStart(6) +
      String(b.wins).padStart(5) +
      String(b.scratched).padStart(4) +
      String(b.losses).padStart(6) +
      b.netR.toFixed(2).padStart(10) +
      (Number.isNaN(avgR) ? "-" : avgR.toFixed(2)).padStart(8) +
      (Number.isNaN(winRate) ? "-" : winRate.toFixed(0)).padStart(8),
    );
  }
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("Set TAYO_ADMIN_KEY to the owner read key ( /alerts is authed ).");
    process.exit(1);
  }
  const url = `${BASE}/alerts?includeSuppressed=true&limit=200&key=${encodeURIComponent(KEY)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`/alerts returned ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  // /alerts returns { items: [...] }. Older builds returned { alerts: [...] },
  // so accept either shape rather than silently reporting zero.
  const body = (await res.json()) as { items?: Row[]; alerts?: Row[] } | Row[];
  const rows: Row[] = Array.isArray(body) ? body : (body.items ?? body.alerts ?? []);
  console.log(`Fetched ${rows.length} stored alerts from ${BASE}`);

  // Overall, so the grouped figures have a denominator.
  const overall = empty();
  for (const r of rows) accumulate(overall, r);
  render("ALL STORED ALERTS", new Map([["all", overall]]));

  const byReason = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.suppressReason ?? (r.alertStatus === "SUPPRESSED" ? "(suppressed, no reason)" : "delivered");
    if (!byReason.has(key)) byReason.set(key, empty());
    accumulate(byReason.get(key)!, r);
  }
  render("BY SUPPRESSION REASON", byReason);

  const byClass = new Map<string, Bucket>();
  for (const r of rows) {
    // Null means "not recorded" (pre-migration-0009 row), never "no conflict".
    const key = r.shadowClassification ?? "(not recorded)";
    if (!byClass.has(key)) byClass.set(key, empty());
    accumulate(byClass.get(key)!, r);
  }
  render("BY SHADOW CLASSIFICATION (migration 0009)", byClass);

  // By entry timeframe. The same-level dedupe suppresses the *later* timeframe
  // on a shared origin level, on the reasoning that the first to confirm has the
  // better entry. Whether that is actually right is an empirical question this
  // table is here to answer: if 1h materially outperforms 15m, the rule should
  // flip to prefer the higher timeframe instead.
  const byTf = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.timeframe ?? "(unknown)";
    if (!byTf.has(key)) byTf.set(key, empty());
    accumulate(byTf.get(key)!, r);
  }
  render("BY ENTRY TIMEFRAME (validates the same-level dedupe rule)", byTf);

  // Fill rate. Every alert tells subscribers to place a pending limit at the
  // entry price, but a limit only fills if price trades back through entry —
  // it never does on the cleanest winners, the ones that run without looking
  // back. So the ledger's R is the R of a hypothetical fill, not the R of
  // acting on the notification. This quantifies the gap.
  const scored = rows.filter(
    (r) => r.fillConfirmed !== null && r.fillConfirmed !== undefined
      && r.status !== "OPEN" && typeof r.rMultiple === "number",
  );
  if (scored.length) {
    const filled = scored.filter((r) => r.fillConfirmed === 1);
    const netAll = scored.reduce((s, r) => s + (r.rMultiple ?? 0), 0);
    const netFilled = filled.reduce((s, r) => s + (r.rMultiple ?? 0), 0);
    const winners = scored.filter((r) => (r.rMultiple ?? 0) > 0);
    const winnersFilled = winners.filter((r) => r.fillConfirmed === 1);
    console.log(`\n=== PENDING-LIMIT FILL RATE (migration 0010) ===`);
    console.log(`  Scored rows          : ${scored.length}`);
    console.log(`  Limit would fill     : ${filled.length} (${pct(filled.length, scored.length)})`);
    console.log(`  Never filled         : ${scored.length - filled.length}`);
    console.log(`  Net R as recorded    : ${netAll.toFixed(2)}R  (assumes every setup filled)`);
    console.log(`  Net R filled only    : ${netFilled.toFixed(2)}R  (what a limit-taker captured)`);
    if (winners.length) {
      console.log(
        `  Winners that filled  : ${winnersFilled.length}/${winners.length}` +
        ` — ${winners.length - winnersFilled.length} winner(s) ran without retracing to entry` +
        ` and were never entered`,
      );
    }
  } else {
    console.log(
      `\n=== PENDING-LIMIT FILL RATE ===\n  No rows carry fill_confirmed yet. ` +
      `Only outcomes resolved after migration 0010 record it; older rows are null, not zero.`,
    );
  }

  const recorded = rows.filter((r) => r.shadowClassification).length;
  console.log(
    `\n${recorded}/${rows.length} rows carry a classification. ` +
    "Only rows written after migration 0009 (2026-10-08) do; null means not recorded, not 'no conflict'.",
  );
  console.log(
    "Unresolved (OPEN) setups are excluded from netR/avgR/win% rather than counted as zero, " +
    "so early readings move as outcomes land.",
  );
}

void main();
