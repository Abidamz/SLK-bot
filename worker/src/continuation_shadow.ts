/**
 * Forward-only paper capture for the separate continuation model.
 *
 * This module never creates alerts/events or calls an execution adapter. The
 * capture is explicitly opt-in, paper-mode-only, limited to the approved
 * institutional research universe, and written to the owner-only shadow
 * experiment ledger. The first enabled scan seeds a close-time cursor and does
 * not backfill historical candidates.
 */
import { minStopDistance, type StrategyConfig } from "./config";
import { calendarSeriesComplete, dropIncomplete } from "./features";
import {
  DEFAULT_CONTINUATION_PARAMS,
  findContinuationSetups,
  multiTfGate,
  type ContinuationSetup,
} from "./continuation";
import {
  continuationDemoPendingKey,
  createPendingContinuationDemoGroup,
  evaluateContinuationDemoEntry,
  parsePendingContinuationDemoGroup,
  type ContinuationDemoEntry,
  type PendingContinuationDemoCandidate,
} from "./continuation_demo_entries";
import type { Store } from "./store";
import { CONTINUATION_SETUP_V1_SOURCE_PREFIX, type Candle, type Direction, type ShadowExperimentCapture } from "./types";

export const CONTINUATION_SETUP_TIMEFRAME = "4h";
/** Outcome candles mirror the continuation replay's 120-bar M30 horizon. */
export const CONTINUATION_OUTCOME_TIMEFRAME = "30m";
export const CONTINUATION_SHADOW_TF_MS = 4 * 60 * 60 * 1000;
export const CONTINUATION_SHADOW_CURSOR_PREFIX = "continuation-shadow:v1:last-h4-close:";

/** The approved seven-symbol institutional research universe. Synthetics and
 *  an unconfirmed Australian index symbol are deliberately excluded. */
export const CONTINUATION_SHADOW_PAIRS = new Set([
  "JAPAN225",
  "NAS100",
  "EURUSD",
  "XAUUSD",
  "NETHERLANDS25",
  "EURJPY",
  "US30",
]);

export type ContinuationShadowRunState =
  | "disabled"
  | "out_of_universe"
  | "insufficient_data"
  | "awaiting_close"
  | "baseline"
  | "unchanged"
  | "processed"
  | "ledger_unavailable"
  | "persistence_failed";

export interface ContinuationShadowRunResult {
  state: ContinuationShadowRunState;
  pair: string;
  bias: Direction | null;
  latestCloseTime: number | null;
  captures: ShadowExperimentCapture[];
  inserted: number;
  /** Captures newly inserted in this call; used for deduplicated private notices. */
  insertedCaptures: ShadowExperimentCapture[];
  /** Fresh, manually actionable demo references. They are never order instructions. */
  demoEntries: ContinuationDemoEntry[];
}

function result(
  state: ContinuationShadowRunState,
  pair: string,
  extras: Partial<ContinuationShadowRunResult> = {},
): ContinuationShadowRunResult {
  return {
    state,
    pair,
    bias: null,
    latestCloseTime: null,
    captures: [],
    inserted: 0,
    insertedCaptures: [],
    demoEntries: [],
    ...extras,
  };
}

/** The continuation gate is the completed weekly, daily and H4 breakout
 *  sequence documented by continuation.ts. The still-forming calendar week is
 *  excluded so the gate never reads an unfinished weekly candle. */
export function continuationShadowBias(
  daily: Candle[],
  h4: Candle[],
  now: number,
): Direction | null {
  const completedDaily = dropIncomplete(daily, 24 * 60 * 60, now);
  const weekly = calendarSeriesComplete(completedDaily, "W", now);
  return multiTfGate([weekly, completedDaily, h4]);
}

/** Build captures only when the first limit-touch candle is the latest closed
 *  H4 candle. That avoids turning an old rebalance into a fresh forward entry. */
export function buildContinuationShadowExperiments(args: {
  pair: string;
  h4: Candle[];
  bias: Direction | null;
  cfg: StrategyConfig;
  now: number;
}): ShadowExperimentCapture[] {
  const { pair, h4, bias, cfg, now } = args;
  if (!CONTINUATION_SHADOW_PAIRS.has(pair) || !bias || h4.length < 40) return [];
  const last = h4[h4.length - 1];
  const closeTime = last.t + CONTINUATION_SHADOW_TF_MS;
  if (!Number.isFinite(last.t) || closeTime > now) return [];

  // Keep the continuation model's documented baseline settings. The stop floor
  // is instrument-specific, matching the historical continuation replay; no
  // research sweep or live strategy threshold is read here.
  const params = {
    ...DEFAULT_CONTINUATION_PARAMS,
    minStop: minStopDistance(pair, cfg.minStopPips ?? 10),
  };
  return findContinuationSetups(h4, cfg, bias, params)
    .filter((setup) => setup.entryTouchTime === last.t)
    .map((setup) => continuationSetupToShadowExperiment(pair, setup, closeTime))
    .filter((capture): capture is ShadowExperimentCapture => capture !== null);
}

/** Convert one model setup to a stable row in the isolated paper ledger. */
export function continuationSetupToShadowExperiment(
  pair: string,
  setup: ContinuationSetup,
  candleCloseTime: number,
): ShadowExperimentCapture | null {
  const risk = setup.direction === "LONG" ? setup.entry - setup.stop : setup.stop - setup.entry;
  const reward = setup.direction === "LONG" ? setup.tp - setup.entry : setup.entry - setup.tp;
  if (!(risk > 0) || !(reward > 0) || !Number.isFinite(risk) || !Number.isFinite(reward)) return null;
  const rr = reward / risk;
  if (!Number.isFinite(rr) || rr <= 0 || !Number.isFinite(candleCloseTime)) return null;

  // The setup is detected on H4, while the existing outcome resolver reads
  // 120 M30 candles. Keep both timeframes explicit: entryTf selects the M30
  // resolver feed; the stable source ID records the H4 setup origin.
  const sourceSetupId = `${CONTINUATION_SETUP_V1_SOURCE_PREFIX}${pair}:${CONTINUATION_SETUP_TIMEFRAME}:M30_OUTCOME:${setup.setupId}`;
  return {
    experimentId: sourceSetupId,
    sourceSetupId,
    variant: "CONTINUATION_SETUP_V1",
    pair,
    entryTf: CONTINUATION_OUTCOME_TIMEFRAME,
    direction: setup.direction,
    entry: setup.entry,
    stopLoss: setup.stop,
    target: setup.tp,
    rr,
    // The limit touch is confirmed at this H4 candle's close. M30 outcome
    // checking starts at that boundary, so same-H4-bar ordering is not guessed.
    candleCloseTime,
  };
}

async function processPendingDemoEntries(args: {
  store: Pick<Store, "getKv" | "setKv">;
  pair: string;
  m30Candles: Candle[];
  nextOpenCandles: Candle[];
  now: number;
}): Promise<ContinuationDemoEntry[]> {
  const { store, pair, m30Candles, nextOpenCandles, now } = args;
  const key = continuationDemoPendingKey(pair);
  const pending = parsePendingContinuationDemoGroup(await store.getKv(key));
  if (!pending || pending.pair !== pair) return [];
  if (now >= pending.expiresAt) {
    await store.setKv(key, "");
    console.info(JSON.stringify({
      level: "info", msg: "continuation_demo.pending_expired", pair, expiresAt: pending.expiresAt,
    }));
    return [];
  }

  const demoEntries: ContinuationDemoEntry[] = [];
  const remaining: PendingContinuationDemoCandidate[] = [];
  for (const candidate of pending.candidates) {
    const evaluation = evaluateContinuationDemoEntry({
      capture: candidate.capture,
      m30Candles,
      nextOpenCandles,
      now,
      expiresAt: pending.expiresAt,
      ignoreTriggerCloseTime: candidate.ignoreTriggerCloseTime,
    });
    if (evaluation.state === "ready") {
      demoEntries.push(evaluation.entry);
      console.info(JSON.stringify({
        level: "info", msg: "continuation_demo.trigger_ready", pair,
        experimentId: candidate.capture.experimentId,
        triggerCandleCloseTime: evaluation.entry.triggerCandleCloseTime,
        entryTime: evaluation.entry.entryTime,
        entryPrice: evaluation.entry.entryPrice,
        rr: evaluation.entry.rr,
      }));
      continue;
    }

    if (evaluation.state === "stale_trigger" || evaluation.state === "invalid_levels") {
      remaining.push({
        ...candidate,
        ignoreTriggerCloseTime: Math.max(candidate.ignoreTriggerCloseTime ?? 0, evaluation.triggerCandleCloseTime),
      });
      if (evaluation.state === "stale_trigger") {
        console.info(JSON.stringify({
          level: "info", msg: "continuation_demo.trigger_missed", pair,
          experimentId: candidate.capture.experimentId,
          triggerCandleCloseTime: evaluation.triggerCandleCloseTime,
          reason: "next_open_outside_one_minute_window",
        }));
      } else {
        console.info(JSON.stringify({
          level: "info", msg: "continuation_demo.trigger_skipped", pair,
          experimentId: candidate.capture.experimentId,
          triggerCandleCloseTime: evaluation.triggerCandleCloseTime,
          reason: "next_open_invalidates_fixed_h4_levels",
        }));
      }
      continue;
    }

    remaining.push(candidate);
  }

  if (!remaining.length) {
    await store.setKv(key, "");
  } else {
    await store.setKv(key, JSON.stringify({ ...pending, candidates: remaining }));
  }
  return demoEntries;
}

/** Process a new H4 close and any active post-H4 M30 setup watches. The first
 *  call only establishes the forward-test baseline. Candidate rows are retried
 *  at the same close if the isolated ledger is missing or a write fails; the
 *  cursor advances only after writes succeed. */
export async function runContinuationShadowForwardTest(args: {
  store: Pick<Store, "getKv" | "setKv" | "getShadowExperimentLedger" | "insertShadowExperiment">;
  pair: string;
  daily: Candle[];
  h4: Candle[];
  /** Completed M30 trigger candles only. */
  m30Candles?: Candle[];
  /** Base-provider candles; may contain the newly opened M30 interval. */
  nextOpenCandles?: Candle[];
  cfg: StrategyConfig;
  now: number;
  enabled: boolean;
  mode: string;
  /** Only process/store manual-entry watches while the private DM route is enabled. */
  demoEntriesEnabled?: boolean;
}): Promise<ContinuationShadowRunResult> {
  const { store, pair, daily, h4, cfg, now } = args;
  if (!args.enabled || args.mode.toLowerCase() !== "paper") return result("disabled", pair);
  if (!CONTINUATION_SHADOW_PAIRS.has(pair)) return result("out_of_universe", pair);

  // Resolve existing H4 watches before checking whether a new H4 candle is
  // available. A transient H4/history gap must not block a fresh M30 trigger.
  let demoEntries = args.demoEntriesEnabled
    ? await processPendingDemoEntries({
      store,
      pair,
      m30Candles: args.m30Candles ?? [],
      nextOpenCandles: args.nextOpenCandles ?? [],
      now,
    })
    : [];

  if (h4.length < 40 || !daily.length) return result("insufficient_data", pair, { demoEntries });

  const last = h4[h4.length - 1];
  const latestCloseTime = last.t + CONTINUATION_SHADOW_TF_MS;
  if (!Number.isFinite(latestCloseTime) || latestCloseTime > now) {
    return result("awaiting_close", pair, { latestCloseTime, demoEntries });
  }

  const cursorKey = `${CONTINUATION_SHADOW_CURSOR_PREFIX}${pair}`;
  const previousRaw = await store.getKv(cursorKey);
  const previousCloseTime = previousRaw === null ? NaN : Number(previousRaw);
  if (!Number.isFinite(previousCloseTime) || previousCloseTime <= 0) {
    await store.setKv(cursorKey, String(latestCloseTime));
    return result("baseline", pair, { latestCloseTime, demoEntries });
  }
  if (latestCloseTime <= previousCloseTime) {
    return result("unchanged", pair, { latestCloseTime, demoEntries });
  }

  const bias = continuationShadowBias(daily, h4, now);
  const captures = buildContinuationShadowExperiments({ pair, h4, bias, cfg, now });
  if (captures.length) {
    let available = false;
    try {
      available = (await store.getShadowExperimentLedger(1)).available;
    } catch (err) {
      console.warn(JSON.stringify({
        level: "warn", msg: "continuation shadow ledger availability check failed",
        pair, error: String(err),
      }));
    }
    if (!available) {
      return result("ledger_unavailable", pair, { bias, latestCloseTime, captures, demoEntries });
    }

    let inserted = 0;
    const insertedCaptures: ShadowExperimentCapture[] = [];
    let failed = false;
    for (const capture of captures) {
      try {
        if (await store.insertShadowExperiment(capture)) {
          inserted++;
          insertedCaptures.push(capture);
        }
      } catch (err) {
        failed = true;
        console.warn(JSON.stringify({
          level: "warn", msg: "continuation shadow capture persistence failed",
          pair, experimentId: capture.experimentId, error: String(err),
        }));
      }
    }
    if (failed) return result("persistence_failed", pair, { bias, latestCloseTime, captures, inserted, insertedCaptures, demoEntries });

    // Pending M30 watches use the existing KV store; no D1 schema migration or
    // order path is needed. Persist these before advancing the H4 cursor. The
    // actionable queue exists only while its private manual-DM route is on.
    if (args.demoEntriesEnabled) {
      await store.setKv(
        continuationDemoPendingKey(pair),
        JSON.stringify(createPendingContinuationDemoGroup(pair, latestCloseTime, captures)),
      );
    }
    await store.setKv(cursorKey, String(latestCloseTime));
    if (args.demoEntriesEnabled) {
      // A delayed H4 scan may already contain a fresh post-close M30 trigger.
      // Evaluate the just-persisted group now; the index still enforces the
      // one-minute DM cutoff before any private message is sent.
      demoEntries = demoEntries.concat(await processPendingDemoEntries({
        store,
        pair,
        m30Candles: args.m30Candles ?? [],
        nextOpenCandles: args.nextOpenCandles ?? [],
        now,
      }));
    }
    return result("processed", pair, { bias, latestCloseTime, captures, inserted, insertedCaptures, demoEntries });
  }

  await store.setKv(cursorKey, String(latestCloseTime));
  return result("processed", pair, { bias, latestCloseTime, demoEntries });
}
