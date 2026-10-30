import type { Candle, ShadowExperimentCapture } from "./types";

export const CONTINUATION_DEMO_ENTRY_TF_MS = 30 * 60 * 1000;
export const CONTINUATION_DEMO_SETUP_TTL_MS = 4 * 60 * 60 * 1000;
export const CONTINUATION_DEMO_MAX_ENTRY_DELAY_MS = 60 * 1000;
export const CONTINUATION_DEMO_PENDING_PREFIX = "continuation-shadow:v1:pending-demo:";

export interface ContinuationDemoEntry {
  capture: ShadowExperimentCapture;
  triggerCandleCloseTime: number;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  target: number;
  /** Actual reward/risk from the next M30 open to the unchanged H4 levels. */
  rr: number;
}

export interface PendingContinuationDemoCandidate {
  capture: ShadowExperimentCapture;
  /** Last stale/invalid trigger already observed, so later retests can still qualify. */
  ignoreTriggerCloseTime?: number;
}

export interface PendingContinuationDemoGroup {
  version: 1;
  pair: string;
  setupCloseTime: number;
  expiresAt: number;
  candidates: PendingContinuationDemoCandidate[];
}

export type ContinuationDemoEntryEvaluation =
  | { state: "no_trigger" }
  | { state: "expired" }
  | { state: "stale_trigger"; triggerCandleCloseTime: number; entryTime: number }
  | { state: "waiting_for_next_open"; triggerCandleCloseTime: number; entryTime: number }
  | { state: "invalid_levels"; triggerCandleCloseTime: number; entryTime: number }
  | { state: "ready"; entry: ContinuationDemoEntry };

export interface EvaluateContinuationDemoEntryArgs {
  capture: ShadowExperimentCapture;
  /** Only completed M30 candles should be passed here. */
  m30Candles: Candle[];
  /** Provider candles may include the newly opened, still-forming M30 interval. */
  nextOpenCandles: Candle[];
  now: number;
  expiresAt?: number;
  maxEntryDelayMs?: number;
  ignoreTriggerCloseTime?: number;
}

export function continuationDemoPendingKey(pair: string): string {
  return `${CONTINUATION_DEMO_PENDING_PREFIX}${pair}`;
}

export function createPendingContinuationDemoGroup(
  pair: string,
  setupCloseTime: number,
  captures: ShadowExperimentCapture[],
): PendingContinuationDemoGroup {
  return {
    version: 1,
    pair,
    setupCloseTime,
    expiresAt: setupCloseTime + CONTINUATION_DEMO_SETUP_TTL_MS,
    candidates: captures.map((capture) => ({ capture })),
  };
}

export function parsePendingContinuationDemoGroup(raw: string | null | undefined): PendingContinuationDemoGroup | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingContinuationDemoGroup>;
    if (value.version !== 1 || typeof value.pair !== "string"
        || !Number.isFinite(value.setupCloseTime) || !Number.isFinite(value.expiresAt)
        || !Array.isArray(value.candidates)) return null;
    const candidates = value.candidates.filter((candidate): candidate is PendingContinuationDemoCandidate => {
      if (!candidate || typeof candidate !== "object" || !candidate.capture || typeof candidate.capture !== "object") return false;
      return candidate.capture.pair === value.pair
        && Number.isFinite(candidate.capture.candleCloseTime)
        && Number.isFinite(candidate.capture.entry)
        && Number.isFinite(candidate.capture.stopLoss)
        && Number.isFinite(candidate.capture.target)
        && (candidate.ignoreTriggerCloseTime === undefined || Number.isFinite(candidate.ignoreTriggerCloseTime));
    });
    if (!candidates.length) return null;
    return {
      version: 1,
      pair: value.pair,
      setupCloseTime: Number(value.setupCloseTime),
      expiresAt: Number(value.expiresAt),
      candidates,
    };
  } catch {
    return null;
  }
}

/** Returns active setup-watch pairs from the namespaced KV prefix. */
export function continuationDemoPendingPairs(kv: Record<string, string>, now: number): string[] {
  const pairs: string[] = [];
  for (const [key, raw] of Object.entries(kv)) {
    if (!key.startsWith(CONTINUATION_DEMO_PENDING_PREFIX)) continue;
    const group = parsePendingContinuationDemoGroup(raw);
    if (group && group.expiresAt > now) pairs.push(group.pair);
  }
  return [...new Set(pairs)];
}

function touchedAndClosedBackInDirection(capture: ShadowExperimentCapture, candle: Candle): boolean {
  return capture.direction === "LONG"
    ? candle.l <= capture.entry && candle.c > capture.entry
    : candle.h >= capture.entry && candle.c < capture.entry;
}

/**
 * Resolve a prospective, post-H4 M30 retest into a demo-entry reference.
 *
 * The H4 capture's stop and target remain fixed. The entry is the open of the
 * next M30 interval; R:R is recomputed from that price. Old H4-bar touches are
 * excluded, triggers expire at the next H4 close, and late/missing opens fail
 * closed rather than becoming stale demo instructions.
 */
export function evaluateContinuationDemoEntry(
  args: EvaluateContinuationDemoEntryArgs,
): ContinuationDemoEntryEvaluation {
  const {
    capture,
    m30Candles,
    nextOpenCandles,
    now,
    expiresAt = capture.candleCloseTime + CONTINUATION_DEMO_SETUP_TTL_MS,
    maxEntryDelayMs = CONTINUATION_DEMO_MAX_ENTRY_DELAY_MS,
    ignoreTriggerCloseTime = 0,
  } = args;
  if (now >= expiresAt) return { state: "expired" };

  const triggers = m30Candles
    .filter((candle) => {
      const closeTime = candle.t + CONTINUATION_DEMO_ENTRY_TF_MS;
      return Number.isFinite(candle.t)
        && candle.t >= capture.candleCloseTime
        && closeTime > ignoreTriggerCloseTime
        && closeTime > capture.candleCloseTime
        && closeTime < expiresAt
        && closeTime <= now
        && touchedAndClosedBackInDirection(capture, candle);
    })
    .sort((a, b) => a.t - b.t);

  if (!triggers.length) return { state: "no_trigger" };

  // Skip stale M30 triggers, but continue watching for a later fresh retest
  // while the H4 setup remains valid.
  for (const triggerCandle of triggers) {
    const triggerCandleCloseTime = triggerCandle.t + CONTINUATION_DEMO_ENTRY_TF_MS;
    const entryTime = triggerCandleCloseTime;
    const delay = now - entryTime;
    if (delay < 0 || delay > maxEntryDelayMs) continue;

    const nextOpen = nextOpenCandles.find((candle) => candle.t === entryTime);
    if (!nextOpen) return { state: "waiting_for_next_open", triggerCandleCloseTime, entryTime };
    if (!Number.isFinite(nextOpen.o)) return { state: "invalid_levels", triggerCandleCloseTime, entryTime };

    const entryPrice = nextOpen.o;
    const risk = capture.direction === "LONG"
      ? entryPrice - capture.stopLoss
      : capture.stopLoss - entryPrice;
    const reward = capture.direction === "LONG"
      ? capture.target - entryPrice
      : entryPrice - capture.target;
    if (!(risk > 0) || !(reward > 0) || !Number.isFinite(risk) || !Number.isFinite(reward)) {
      return { state: "invalid_levels", triggerCandleCloseTime, entryTime };
    }

    return {
      state: "ready",
      entry: {
        capture,
        triggerCandleCloseTime,
        entryTime,
        entryPrice,
        stopLoss: capture.stopLoss,
        target: capture.target,
        rr: reward / risk,
      },
    };
  }

  const latestStaleTrigger = triggers[triggers.length - 1];
  const triggerCandleCloseTime = latestStaleTrigger.t + CONTINUATION_DEMO_ENTRY_TF_MS;
  return {
    state: "stale_trigger",
    triggerCandleCloseTime,
    entryTime: triggerCandleCloseTime,
  };
}

export function groupContinuationDemoEntries(
  entries: ContinuationDemoEntry[],
): ContinuationDemoEntry[][] {
  const groups = new Map<string, ContinuationDemoEntry[]>();
  for (const entry of entries) {
    const key = [
      entry.capture.pair,
      entry.capture.candleCloseTime,
      entry.triggerCandleCloseTime,
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) =>
    group.sort((a, b) => a.entryPrice - b.entryPrice || a.capture.experimentId.localeCompare(b.capture.experimentId)),
  );
}
