/**
 * Reads the shadow ledger — every setup the engine rejected — and asks the
 * question the coverage audit cannot answer on its own.
 *
 * Coverage shows eleven pairs reaching the retest stage and confirming
 * nothing. The identity  cand == riskRejects + targetRejects + confirmed
 * holds for every pair, so nothing is disappearing: every candidate is
 * rejected by either the risk band or the target floor. What coverage cannot
 * say is whether those rejections were correct.
 *
 * This script answers that with outcomes. Each shadow row carries the R that
 * WAS available (hypotheticalRr) and, once the hypothetical trade resolves,
 * what it actually returned (rMultiple). So for any candidate floor we can
 * count how many rejections would have been taken, and whether taking them
 * would have made money.
 *
 * That makes the MIN_TP_R question measurable rather than a matter of taste.
 *
 * Reporting only. Nothing here changes a gate or emits anything.
 *
 * Usage:  TAYO_ADMIN_KEY=... npm run audit:shadow
 */

// The worker GitHub Actions deploys: wrangler.jsonc names it tayo-alert-worker,
// so its URL is https://tayo-alert-worker.<subdomain>.workers.dev. If your
// alerts live on the pre-rename worker instead, override with
// TAYO_BASE_URL=https://slk-alert-worker.<subdomain>.workers.dev
const BASE = process.env.TAYO_BASE_URL ?? "https://tayo-alert-worker.abidogundamilola.workers.dev";
const KEY = process.env.TAYO_ADMIN_KEY ?? "";

// The floor currently in production. MIN_TP_R in wrangler.jsonc.
const CURRENT_FLOOR = 2.5;

interface ShadowRow {
  pair?: string;
  rejectReason?: string | null;
  hypotheticalRr?: number | null;
  status?: string | null;
  rMultiple?: number | null;
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("Set TAYO_ADMIN_KEY to the owner read key ( /api/shadow-ledger is authed ).");
    process.exit(1);
  }

  const url = `${BASE}/api/shadow-ledger?limit=5000&key=${encodeURIComponent(KEY)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`/api/shadow-ledger returned ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const body = (await res.json()) as { rows?: ShadowRow[]; available?: boolean; aggregate?: unknown };
  if (body.available === false) {
    console.error("Shadow ledger is not available on this deployment (table missing).");
    process.exit(1);
  }
  const rows = body.rows ?? [];
  console.log(`Fetched ${rows.length} shadow rows from ${BASE}`);
  if (!rows.length) {
    console.log("\nNo shadow rows. Either nothing has been rejected yet, or the ledger predates this build.");
    return;
  }

  // A row only tells us about outcomes once its hypothetical trade resolved.
  const resolved = rows.filter(
    (r) => r.status && r.status !== "OPEN" && Number.isFinite(r.rMultiple as number),
  );
  console.log(`  ${resolved.length} have resolved to an outcome; ${rows.length - resolved.length} still open.`);

  const byPair = new Map<
    string,
    { total: number; targetFloor: number; noRetest: number; resolved: number; wins: number; netR: number; rrSum: number }
  >();
  const blank = () => ({ total: 0, targetFloor: 0, noRetest: 0, resolved: 0, wins: 0, netR: 0, rrSum: 0 });

  for (const r of rows) {
    const pair = r.pair ?? "?";
    const e = byPair.get(pair) ?? blank();
    e.total++;
    if (r.rejectReason === "TARGET_FLOOR") e.targetFloor++;
    else if (r.rejectReason === "NO_RETEST") e.noRetest++;
    const rr = r.hypotheticalRr;
    if (Number.isFinite(rr as number)) e.rrSum += rr as number;
    if (r.status && r.status !== "OPEN" && Number.isFinite(r.rMultiple as number)) {
      e.resolved++;
      const m = r.rMultiple as number;
      e.netR += m;
      if (m > 0) e.wins++;
    }
    byPair.set(pair, e);
  }

  console.log(
    "\n  " + "pair".padEnd(10) + "rejected".padStart(9) + "tgtFloor".padStart(9) +
      "noRetest".padStart(9) + "resolved".padStart(9) + "win%".padStart(7) +
      "netR".padStart(9) + "avgRoffered".padStart(12),
  );
  const sorted = [...byPair.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [pair, e] of sorted) {
    console.log(
      "  " + pair.padEnd(10) +
        String(e.total).padStart(9) +
        String(e.targetFloor).padStart(9) +
        String(e.noRetest).padStart(9) +
        String(e.resolved).padStart(9) +
        (e.resolved ? `${((100 * e.wins) / e.resolved).toFixed(0)}%` : "-").padStart(7) +
        (e.resolved ? e.netR.toFixed(2) : "-").padStart(9) +
        (e.total ? (e.rrSum / e.total).toFixed(2) : "-").padStart(12),
    );
  }

  // The counterfactual. For each candidate floor, take every shadow row whose
  // offered R cleared it, and read what those trades actually returned.
  // Rows that were rejected for NO_RETEST carry no tradeable target, so they
  // are excluded: lowering the floor does not rescue them.
  const floorRows = rows.filter((r) => r.rejectReason === "TARGET_FLOOR");
  const floors = [1.5, 2.0, 2.25, CURRENT_FLOOR, 3.0];

  console.log("\n=== IF THE TARGET FLOOR WERE LOWERED (TARGET_FLOOR rejections only) ===");
  console.log("  Reads only rows whose offered R cleared the floor, and totals what they returned.");
  console.log(
    "\n  " + "floor".padEnd(9) + "wouldPass".padStart(10) + "resolved".padStart(9) +
      "win%".padStart(7) + "netR".padStart(9) + "avgR".padStart(8) + "  note",
  );

  for (const f of floors) {
    const pass = floorRows.filter((r) => Number.isFinite(r.hypotheticalRr as number) && (r.hypotheticalRr as number) >= f);
    const done = pass.filter((r) => r.status && r.status !== "OPEN" && Number.isFinite(r.rMultiple as number));
    const wins = done.filter((r) => (r.rMultiple as number) > 0).length;
    const netR = done.reduce((s, r) => s + (r.rMultiple as number), 0);
    const avgR = done.length ? netR / done.length : 0;
    let note = "";
    if (Math.abs(f - CURRENT_FLOOR) < 1e-9) note = "current setting";
    else if (done.length && netR > 0) note = "would have added R";
    else if (done.length && netR <= 0) note = "would have lost R";
    console.log(
      "  " + `${f}R`.padEnd(9) +
        String(pass.length).padStart(10) +
        String(done.length).padStart(9) +
        (done.length ? `${((100 * wins) / done.length).toFixed(0)}%` : "-").padStart(7) +
        (done.length ? netR.toFixed(2) : "-").padStart(9) +
        (done.length ? avgR.toFixed(2) : "-").padStart(8) +
        "  " + note,
    );
  }

  console.log(
    "\nCaveat: shadow rows are hypothetical trades, not fills. They carry the same\n" +
      "pending-limit fill caveat as live alerts: a winner that ran without ever\n" +
      "trading back to entry may be credited here without ever having been\n" +
      "fillable. Read netR as an upper bound on what the floor change would add.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
