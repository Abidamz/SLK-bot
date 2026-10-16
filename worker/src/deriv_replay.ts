import type { Trade } from "./replay_stats";

const DAY_MS = 86_400_000;

export interface DerivHoldoutSplit {
  splitTime: number;
  endTime: number;
  /** Outcomes that entered and were fully resolved before the holdout boundary. */
  development: Trade[];
  /** Setups first entered inside the held-out window, including unresolved ones. */
  holdout: Trade[];
  /** Pre-boundary rows whose result crosses the boundary or is still unresolved. */
  purged: number;
  /** Rows with invalid entry times or entries after the fixed replay end. */
  ignored: number;
}

function parseReplayUtc(value: string): number {
  if (!value || value === "-") return NaN;
  const iso = value.replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
}

/**
 * Make a fixed, chronological Deriv holdout. Development outcomes must both
 * enter and resolve before the boundary; trades that cross it are purged so
 * their holdout price path cannot influence development statistics. The test
 * window is fixed to `now`, not to the last signal that happened to occur.
 */
export function splitDerivHoldout(
  rows: Trade[],
  opts: { heldOutDays: number; now: number },
): DerivHoldoutSplit {
  if (!Number.isFinite(opts.now)) throw new Error("now must be a finite timestamp");
  if (!Number.isInteger(opts.heldOutDays) || opts.heldOutDays <= 0) {
    throw new Error("heldOutDays must be a positive integer");
  }

  const endTime = opts.now;
  const splitTime = endTime - opts.heldOutDays * DAY_MS;
  const development: Trade[] = [];
  const holdout: Trade[] = [];
  let purged = 0;
  let ignored = 0;

  for (const row of rows) {
    const entryTime = parseReplayUtc(row.entryTime);
    if (!Number.isFinite(entryTime) || entryTime > endTime) {
      ignored++;
      continue;
    }

    if (entryTime >= splitTime) {
      holdout.push(row);
      continue;
    }

    const exitTime = parseReplayUtc(row.exitTime);
    if (row.status !== "OPEN" && Number.isFinite(exitTime) && exitTime < splitTime) {
      development.push(row);
    } else {
      purged++;
    }
  }

  return { splitTime, endTime, development, holdout, purged, ignored };
}

/** Charge a transparent round-trip spread scenario as a fraction of initial R. */
export function applyDerivSpreadScenario(rows: Trade[], fractionOfRisk: number): Trade[] {
  if (!Number.isFinite(fractionOfRisk) || fractionOfRisk < 0) {
    throw new Error("fractionOfRisk must be finite and non-negative");
  }
  return rows.map((trade) => {
    if (trade.status === "OPEN" || !Number.isFinite(trade.r)) return trade;
    const riskDistance = Math.abs(trade.entry - trade.stop);
    return riskDistance > 0 ? { ...trade, r: trade.r - 2 * fractionOfRisk } : trade;
  });
}

export function derivDeliveryCooldownActive(
  previousTime: number | undefined, currentTime: number, minutes: number,
): boolean {
  return previousTime !== undefined && currentTime - previousTime < minutes * 60_000;
}

export function derivCrossTimeframeDuplicate(
  previous: { tf: string; time: number }[], currentTf: string, currentTime: number, minutes: number,
): boolean {
  const cooldownMs = minutes * 60_000;
  return previous.some((entry) => entry.tf !== currentTf && currentTime - entry.time < cooldownMs);
}
