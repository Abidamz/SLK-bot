/** Read-only coverage audit: which configured pairs are actually producing
 *  signal, and where the silent ones are dying.
 *
 *  23 pairs are configured, but only a handful have ever produced a stored
 *  alert. Every static cause has been ruled out in source — providerForPair()
 *  routes correctly, all ten synthetics have DERIV_SYMBOLS entries, every
 *  silent institutional pair has an OANDA/Dukascopy mapping, and the synthetics
 *  1H-primary logic is sound. So the question is runtime-only, and splits three
 *  ways for each pair:
 *
 *    1. NEVER_SCANNED            — absent from the funnel entirely
 *    2. SCANNED_NO_LEVELS        — scanned, but no origin level was ever armed
 *                                  (points at candles: feed, credits, instrument)
 *    3. LEVELS_NO_CONFIRMATION   — levels armed, but the funnel never reached a
 *                                  confirmation (model reality, not a bug)
 *    4. PRODUCING                — has confirmed alerts
 *
 *  Only #1 and #2 are fixable infrastructure problems; #3 would mean the 10R
 *  target needs levers other than coverage.
 *
 *  Usage:
 *    cd worker
 *    TAYO_ADMIN_KEY=... npx tsx scripts/audit_coverage.ts
 *    TAYO_ADMIN_KEY=... TAYO_BASE_URL=https://... TAYO_AUDIT_DAYS=31 npx tsx scripts/audit_coverage.ts
 *
 *  Requires the owner key (/api/scan-audit and /alerts are both authed).
 */

import { readFileSync } from "node:fs";

const BASE = process.env.TAYO_BASE_URL ?? "https://slk-bot.slk-bot-4c2.workers.dev";
const KEY = process.env.TAYO_ADMIN_KEY ?? "";
const DAYS = process.env.TAYO_AUDIT_DAYS ?? "31";

interface FunnelRow {
  pair: string;
  timeframe: string;
  scanRows: number;
  replay: {
    MAP?: number; TOUCH?: number; SWEEP?: number; SHIFT?: number; RETEST?: number;
    INVALID?: number; EXPIRED?: number;
    retestCandidates?: number; riskRejects?: number; targetRejects?: number;
    confirmedAlerts?: number;
  };
}

interface ScanAudit {
  scan?: {
    scanRows?: number;
    activeScanRows?: number;
    scanErrorRows?: number;
    errorCategories?: { staleFeed?: number; rateLimitOrCredits?: number; networkOrTimeout?: number; other?: number };
    firstScanUtc?: string | null;
    lastScanUtc?: string | null;
    byPairTimeframe?: FunnelRow[];
    storedAlertsByDay?: { pair?: string; count?: number }[];
  };
}

type Verdict = "PRODUCING" | "STALE_PRODUCER" | "LEVELS_NO_CONFIRMATION" | "SCANNED_NO_LEVELS" | "NEVER_SCANNED";

const EXPLANATION: Record<Verdict, string> = {
  PRODUCING: "fine",
  STALE_PRODUCER: "has stored alerts but nothing in the window — check whether it stopped being scanned",
  LEVELS_NO_CONFIRMATION: "levels armed, funnel never confirmed — likely model reality",
  SCANNED_NO_LEVELS: "scanned but no level ever armed — suspect candles/feed",
  NEVER_SCANNED: "never appeared in the funnel — suspect scheduling or batching",
};

/** Configured watchlist, read from wrangler.jsonc so it can never drift. */
function configuredPairs(): string[] {
  try {
    const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const m = raw.match(/"PAIRS"\s*:\s*"([^"]+)"/);
    if (m) return m[1].split(",").map((p) => p.trim()).filter(Boolean);
  } catch {
    /* fall through to env */
  }
  return (process.env.TAYO_PAIRS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(KEY)}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status} ${res.statusText}`);
  return res.json();
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("Set TAYO_ADMIN_KEY to the owner read key ( /api/scan-audit and /alerts are authed ).");
    process.exit(1);
  }

  const [audit, alertsBody] = await Promise.all([
    getJson(`/api/scan-audit?days=${encodeURIComponent(DAYS)}`) as Promise<ScanAudit>,
    getJson("/alerts?includeSuppressed=true&limit=200"),
  ]);

  const scan = audit.scan ?? {};
  const funnel = scan.byPairTimeframe ?? [];
  const alerts = (alertsBody as { alerts?: { pair?: string }[] }).alerts ?? [];

  console.log(`Window: last ${DAYS} days   (${scan.firstScanUtc ?? "?"} → ${scan.lastScanUtc ?? "?"})`);
  console.log(`Scan rows: ${scan.scanRows ?? 0} total, ${scan.activeScanRows ?? 0} active, ${scan.scanErrorRows ?? 0} with errors`);
  const ec = scan.errorCategories;
  if (ec) {
    console.log(
      `Error categories: staleFeed=${ec.staleFeed ?? 0} rateLimitOrCredits=${ec.rateLimitOrCredits ?? 0} ` +
      `networkOrTimeout=${ec.networkOrTimeout ?? 0} other=${ec.other ?? 0}`,
    );
  }
  console.log(`Funnel rows: ${funnel.length}   Stored alerts (all time): ${alerts.length}`);

  // Aggregate the per-pair/timeframe funnel into per-pair totals.
  const byPair = new Map<string, {
    scanRows: number; timeframes: Set<string>;
    MAP: number; TOUCH: number; SWEEP: number; SHIFT: number; RETEST: number;
    riskRejects: number; targetRejects: number; confirmedAlerts: number;
  }>();
  const blank = () => ({
    scanRows: 0, timeframes: new Set<string>(),
    MAP: 0, TOUCH: 0, SWEEP: 0, SHIFT: 0, RETEST: 0,
    riskRejects: 0, targetRejects: 0, confirmedAlerts: 0,
  });
  for (const row of funnel) {
    const e = byPair.get(row.pair) ?? blank();
    e.scanRows += row.scanRows ?? 0;
    e.timeframes.add(row.timeframe);
    const r = row.replay ?? {};
    e.MAP += r.MAP ?? 0;
    e.TOUCH += r.TOUCH ?? 0;
    e.SWEEP += r.SWEEP ?? 0;
    e.SHIFT += r.SHIFT ?? 0;
    e.RETEST += r.RETEST ?? 0;
    e.riskRejects += r.riskRejects ?? 0;
    e.targetRejects += r.targetRejects ?? 0;
    e.confirmedAlerts += r.confirmedAlerts ?? 0;
    byPair.set(row.pair, e);
  }

  const storedByPair = new Map<string, number>();
  for (const a of alerts) {
    if (!a.pair) continue;
    storedByPair.set(a.pair, (storedByPair.get(a.pair) ?? 0) + 1);
  }

  const pairs = configuredPairs();
  if (!pairs.length) {
    console.error("Could not read PAIRS from wrangler.jsonc; set TAYO_PAIRS instead.");
    process.exit(1);
  }

  console.log(
    "\n  " + "pair".padEnd(10) + "verdict".padEnd(24) +
    "scans".padStart(7) + "tfs".padStart(6) +
    "MAP".padStart(7) + "TOUCH".padStart(7) + "SWEEP".padStart(7) + "SHIFT".padStart(7) +
    "RETST".padStart(7) + "conf".padStart(6) + "risk".padStart(6) + "stored".padStart(8),
  );

  const counts: Record<Verdict, number> = {
    PRODUCING: 0, STALE_PRODUCER: 0, LEVELS_NO_CONFIRMATION: 0, SCANNED_NO_LEVELS: 0, NEVER_SCANNED: 0,
  };
  const rows = pairs.map((pair) => {
    const e = byPair.get(pair);
    const stored = storedByPair.get(pair) ?? 0;
    // Stored alerts are all-time while the funnel is windowed, so a pair with
    // history but no recent activity is its own verdict — otherwise it reads as
    // NEVER_SCANNED and hides the fact that it used to produce.
    let verdict: Verdict;
    if ((e?.confirmedAlerts ?? 0) > 0) verdict = "PRODUCING";
    else if (stored > 0) verdict = "STALE_PRODUCER";
    else if (!e || e.scanRows === 0) verdict = "NEVER_SCANNED";
    else if (e.MAP === 0) verdict = "SCANNED_NO_LEVELS";
    else verdict = "LEVELS_NO_CONFIRMATION";
    counts[verdict]++;
    return { pair, verdict, e, stored };
  });

  const order: Record<Verdict, number> = {
    PRODUCING: 0, STALE_PRODUCER: 1, LEVELS_NO_CONFIRMATION: 2, SCANNED_NO_LEVELS: 3, NEVER_SCANNED: 4,
  };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.pair.localeCompare(b.pair));

  for (const { pair, verdict, e, stored } of rows) {
    console.log(
      "  " + pair.padEnd(10) + verdict.padEnd(24) +
      String(e?.scanRows ?? 0).padStart(7) +
      ([...(e?.timeframes ?? [])].sort().join("/") || "-").padStart(6) +
      String(e?.MAP ?? 0).padStart(7) +
      String(e?.TOUCH ?? 0).padStart(7) +
      String(e?.SWEEP ?? 0).padStart(7) +
      String(e?.SHIFT ?? 0).padStart(7) +
      String(e?.RETEST ?? 0).padStart(7) +
      String(e?.confirmedAlerts ?? 0).padStart(6) +
      String(e?.riskRejects ?? 0).padStart(6) +
      String(stored).padStart(8),
    );
  }

  console.log("\n=== SUMMARY ===");
  for (const v of ["PRODUCING", "STALE_PRODUCER", "LEVELS_NO_CONFIRMATION", "SCANNED_NO_LEVELS", "NEVER_SCANNED"] as Verdict[]) {
    console.log(`  ${counts[v].toString().padStart(3)}  ${v.padEnd(24)} ${EXPLANATION[v]}`);
  }

  // Pairs producing in the funnel but absent from the configured list are worth
  // flagging: they mean the watchlist changed under us.
  const configured = new Set(pairs);
  const extra = [...byPair.keys()].filter((p) => !configured.has(p));
  if (extra.length) console.log(`\nIn funnel but not configured: ${extra.sort().join(", ")}`);

  console.log(
    "\nCaveat: funnel figures are replay counts over the audit window, not unique setups. " +
    "The window is capped at 31 days by /api/scan-audit, so 'NEVER_SCANNED' means 'not scanned in the window', " +
    "not 'never scanned ever'. Stored-alert counts are all-time.",
  );
}

void main().catch((err: unknown) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
