/**
 * Isolated OFF-04 forward capture. This module is intentionally not wired to
 * scanEntry, the production alert gate, the broadcast notification path, or
 * any MT5/order adapter. It reads OANDA midpoint candles, writes only to the
 * OFF-04 research ledger, and sends only to OFF04_FORWARD_TEST_CHAT_ID.
 *
 * First-enable behavior is forward-only: the initial scan seeds candle history
 * and confirmed swing pivots but does not backfill old H4/M15 signals. H4/M15
 * setups are tracked from their formation after that baseline.
 */
import { fetchOanda } from "./provider";
import { makeStore, type D1Like, type Off04ForwardOutcome, type Off04ForwardTradeCapture, type Off04ForwardTradeRow, type Store } from "./store";
import type { Candle, Direction } from "./types";

export const OFF04_FORWARD_PAIRS = [
  "JAPAN225", "NAS100", "EURUSD", "XAUUSD", "NETHERLANDS25", "AUDJPY", "AUDUSD",
] as const;
export const OFF04_FORWARD_VARIANT = "baseline_all_signals" as const;
export const OFF04_FORWARD_TRIGGER = "post_formation_m15_zone_retest" as const;
export const OFF04_FORWARD_TARGET_R = 3 as const;
export const OFF04_FORWARD_STATE_PREFIX = "off04-forward:v1:state:";

const M15_MS = 15 * 60_000;
const H1_MS = 60 * 60_000;
const H4_MS = 4 * H1_MS;
const RETEST_HORIZON_MS = 4 * H1_MS;
const MAX_FRESH_SIGNAL_AGE_MS = 2 * 60_000;
const CANDLE_CLOSE_GRACE_MS = 10_000;
const INITIAL_HISTORY_LIMIT = 5000;
const CONTINUATION_HISTORY_LIMIT = 200;
const MAX_RECOVERY_GAP_MS = 7 * 24 * H1_MS;

export interface Off04Gap {
  direction: Direction;
  lower: number;
  upper: number;
  availableAt: number;
}

export interface Off04H4Zone extends Off04Gap {
  firstTouchAvailableAt: number | null;
}

export interface Off04M15RetestWatch extends Off04Gap {
  h4FvgAvailableAt: number;
  h4FirstTouchAvailableAt: number;
  expiresAt: number;
}

export interface Off04ConfirmedPivot {
  kind: "high" | "low";
  price: number;
  confirmedAt: number;
}

export interface Off04ForwardSignal {
  setupId: string;
  pair: string;
  direction: Direction;
  h4FvgAvailableAt: number;
  h4FirstTouchAvailableAt: number;
  m15FvgAvailableAt: number;
  m15ZoneLower: number;
  m15ZoneUpper: number;
  triggerAvailableAt: number;
}

export interface Off04ForwardState {
  version: 1;
  startedAt: number;
  lastH1Open: number;
  lastM15Open: number;
  /** Three H1 bars are enough to complete the next UTC-aligned H4 bucket. */
  recentH1: Candle[];
  /** Two prior complete H4 bars are enough to detect the next H4 FVG. */
  recentH4: Candle[];
  /** Four prior M15 bars support new FVG detection and 2-left/2-right pivots. */
  recentM15: Candle[];
  /** Historical pivots are seeded once, then advanced causally bar by bar. */
  pivots: Off04ConfirmedPivot[];
  h4Zones: Off04H4Zone[];
  m15RetestWatches: Off04M15RetestWatch[];
}

export interface Off04ForwardEnv {
  DB?: D1Like;
  OANDA_API_KEY?: string;
  OANDA_API_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_FREE_CHAT_ID?: string;
  TELEGRAM_DERIV_CHAT_ID?: string;
  TELEGRAM_DERIV_FREE_CHAT_ID?: string;
  TELEGRAM_DM_CHAT_ID?: string;
  /** Must be a dedicated OFF-04 test-channel ID; never falls back to subscriber IDs. */
  OFF04_FORWARD_TEST_CHAT_ID?: string;
  /** Explicit opt-in. Missing or any value other than "true" means disabled. */
  OFF04_FORWARD_ENABLED?: string;
}

export interface Off04ForwardRunSummary {
  state: "disabled" | "not_boundary" | "missing_configuration" | "processed";
  seeded: number;
  pairsScanned: number;
  signalsInserted: number;
  telegramSent: number;
  telegramFailed: number;
  outcomesResolved: number;
  outcomesCensored: number;
  errors: string[];
}

function emptySummary(state: Off04ForwardRunSummary["state"]): Off04ForwardRunSummary {
  return {
    state, seeded: 0, pairsScanned: 0, signalsInserted: 0,
    telegramSent: 0, telegramFailed: 0, outcomesResolved: 0, outcomesCensored: 0, errors: [],
  };
}

function finiteCandle(candle: Candle): boolean {
  return Number.isFinite(candle.t)
    && Number.isFinite(candle.o) && Number.isFinite(candle.h)
    && Number.isFinite(candle.l) && Number.isFinite(candle.c)
    && candle.h >= Math.max(candle.o, candle.c, candle.l)
    && candle.l <= Math.min(candle.o, candle.c, candle.h);
}

function sortedUniqueBars(input: Candle[], durationMs: number, now: number, completeOnly: boolean): Candle[] {
  const sorted = input
    .filter((candle) => finiteCandle(candle) && candle.t % durationMs === 0
      && (!completeOnly || (candle.complete !== false
        && candle.t + durationMs + CANDLE_CLOSE_GRACE_MS <= now)))
    .slice()
    .sort((a, b) => a.t - b.t);
  const out: Candle[] = [];
  for (const candle of sorted) {
    if (!out.length || out[out.length - 1].t !== candle.t) out.push(candle);
  }
  return out;
}

function overlaps(bar: Candle, lower: number, upper: number): boolean {
  return bar.l <= upper && bar.h >= lower;
}

function detectGap(first: Candle, third: Candle, durationMs: number): Off04Gap | null {
  if (first.h < third.l) {
    return {
      direction: "LONG", lower: first.h, upper: third.l,
      availableAt: third.t + durationMs,
    };
  }
  if (first.l > third.h) {
    return {
      direction: "SHORT", lower: third.h, upper: first.l,
      availableAt: third.t + durationMs,
    };
  }
  return null;
}

/** Strict UTC-aligned H1 -> H4 aggregation; incomplete buckets are omitted. */
export function resampleOff04H1ToH4(h1: Candle[]): Candle[] {
  const grouped = new Map<number, Map<number, Candle>>();
  for (const candle of h1) {
    const bucketStart = Math.floor(candle.t / H4_MS) * H4_MS;
    const bucket = grouped.get(bucketStart) ?? new Map<number, Candle>();
    bucket.set(candle.t, candle);
    grouped.set(bucketStart, bucket);
  }
  const out: Candle[] = [];
  for (const [bucketStart, bucket] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    const expected = [0, 1, 2, 3].map((offset) => bucketStart + offset * H1_MS);
    const bars = expected.map((timestamp) => bucket.get(timestamp));
    if (bars.some((bar) => !bar)) continue;
    const complete = bars as Candle[];
    out.push({
      t: bucketStart,
      o: complete[0].o,
      h: Math.max(...complete.map((bar) => bar.h)),
      l: Math.min(...complete.map((bar) => bar.l)),
      c: complete[3].c,
    });
  }
  return out;
}

function confirmedPivots(m15: Candle[]): Off04ConfirmedPivot[] {
  const pivots: Off04ConfirmedPivot[] = [];
  for (let index = 2; index < m15.length - 2; index++) {
    const window = m15.slice(index - 2, index + 3);
    const center = window[2];
    const minLow = Math.min(...window.map((bar) => bar.l));
    const maxHigh = Math.max(...window.map((bar) => bar.h));
    if (center.l === minLow && window.filter((bar) => bar.l === center.l).length === 1) {
      pivots.push({ kind: "low", price: center.l, confirmedAt: window[4].t + M15_MS });
    }
    if (center.h === maxHigh && window.filter((bar) => bar.h === center.h).length === 1) {
      pivots.push({ kind: "high", price: center.h, confirmedAt: window[4].t + M15_MS });
    }
  }
  return pivots.sort((a, b) => a.confirmedAt - b.confirmedAt || a.kind.localeCompare(b.kind));
}

/** Seed the forward test without backfilling pre-enable H4 zones or M15 signals. */
export function createOff04ForwardBaseline(args: {
  h1: Candle[];
  m15: Candle[];
  now: number;
}): Off04ForwardState {
  const { h1, m15, now } = args;
  const h4Bars = resampleOff04H1ToH4(h1);
  return {
    version: 1,
    startedAt: now,
    lastH1Open: h1.length ? h1[h1.length - 1].t : -1,
    lastM15Open: m15.length ? m15[m15.length - 1].t : -1,
    recentH1: h1.slice(-3),
    recentH4: h4Bars.slice(-2),
    recentM15: m15.slice(-4),
    pivots: confirmedPivots(m15),
    h4Zones: [],
    m15RetestWatches: [],
  };
}

function addPivotFromLatestWindow(state: Off04ForwardState, window: Candle[]): void {
  if (window.length !== 5) return;
  const center = window[2];
  const confirmedAt = window[4].t + M15_MS;
  const minLow = Math.min(...window.map((bar) => bar.l));
  const maxHigh = Math.max(...window.map((bar) => bar.h));
  if (center.l === minLow && window.filter((bar) => bar.l === center.l).length === 1) {
    state.pivots.push({ kind: "low", price: center.l, confirmedAt });
  }
  if (center.h === maxHigh && window.filter((bar) => bar.h === center.h).length === 1) {
    state.pivots.push({ kind: "high", price: center.h, confirmedAt });
  }
  state.pivots.sort((a, b) => a.confirmedAt - b.confirmedAt || a.kind.localeCompare(b.kind));
}

function h4BarFromFour(h1: Candle[]): Candle | null {
  if (h1.length !== 4) return null;
  const start = h1[0].t;
  if (start % H4_MS !== 0 || h1.some((bar, index) => bar.t !== start + index * H1_MS)) return null;
  return {
    t: start,
    o: h1[0].o,
    h: Math.max(...h1.map((bar) => bar.h)),
    l: Math.min(...h1.map((bar) => bar.l)),
    c: h1[3].c,
  };
}

function h4ZoneId(gap: Off04Gap): string {
  return `${gap.availableAt}:${gap.direction}:${gap.lower}:${gap.upper}`;
}

function m15WatchId(gap: Off04Gap): string {
  return `${gap.availableAt}:${gap.direction}:${gap.lower}:${gap.upper}`;
}

/**
 * Advance the isolated causal state by newly completed H1 and M15 bars.
 * Candidate semantics mirror OFF-04: first H4-zone touch; same-direction,
 * narrower M15 FVG forming within four hours; then its first post-formation
 * M15 zone touch within four hours. There is deliberately no session filter.
 */
export function advanceOff04ForwardState(args: {
  state: Off04ForwardState;
  pair: string;
  newH1: Candle[];
  newM15: Candle[];
}): { state: Off04ForwardState; signals: Off04ForwardSignal[] } {
  const state: Off04ForwardState = {
    ...args.state,
    recentH1: [...args.state.recentH1],
    recentH4: [...args.state.recentH4],
    recentM15: [...args.state.recentM15],
    pivots: [...args.state.pivots],
    h4Zones: args.state.h4Zones.map((zone) => ({ ...zone })),
    m15RetestWatches: args.state.m15RetestWatches.map((watch) => ({ ...watch })),
  };
  const signals: Off04ForwardSignal[] = [];

  const h1 = args.newH1
    .filter((bar) => finiteCandle(bar) && bar.t > state.lastH1Open)
    .slice()
    .sort((a, b) => a.t - b.t);
  for (const bar of h1) {
    const h1Window = [...state.recentH1, bar];
    const newH4 = h4BarFromFour(h1Window.slice(-4));
    state.recentH1 = h1Window.slice(-3);
    state.lastH1Open = bar.t;
    if (!newH4) continue;

    if (state.recentH4.length >= 2) {
      const gap = detectGap(state.recentH4[0], newH4, H4_MS);
      if (gap && !state.h4Zones.some((zone) => h4ZoneId(zone) === h4ZoneId(gap))) {
        state.h4Zones.push({ ...gap, firstTouchAvailableAt: null });
      }
    }
    state.recentH4 = [...state.recentH4, newH4].slice(-2);
  }

  const m15 = args.newM15
    .filter((bar) => finiteCandle(bar) && bar.t > state.lastM15Open)
    .slice()
    .sort((a, b) => a.t - b.t);
  for (const bar of m15) {
    const previousM15 = [...state.recentM15];
    const completedAt = bar.t + M15_MS;

    // Update confirmed swings before creating a signal on this close: the
    // latest 2-right pivot becomes available exactly at the next-M15 entry.
    addPivotFromLatestWindow(state, [...previousM15, bar].slice(-5));

    const stillWatching: Off04M15RetestWatch[] = [];
    for (const watch of state.m15RetestWatches) {
      if (bar.t >= watch.availableAt && completedAt <= watch.expiresAt
          && overlaps(bar, watch.lower, watch.upper)) {
        const setupId = [
          "OFF04", OFF04_FORWARD_VARIANT, OFF04_FORWARD_TRIGGER, args.pair,
          watch.direction, watch.availableAt, completedAt,
        ].join(":");
        signals.push({
          setupId,
          pair: args.pair,
          direction: watch.direction,
          h4FvgAvailableAt: watch.h4FvgAvailableAt,
          h4FirstTouchAvailableAt: watch.h4FirstTouchAvailableAt,
          m15FvgAvailableAt: watch.availableAt,
          m15ZoneLower: watch.lower,
          m15ZoneUpper: watch.upper,
          triggerAvailableAt: completedAt,
        });
      } else if (completedAt <= watch.expiresAt) {
        stillWatching.push(watch);
      }
    }
    state.m15RetestWatches = stillWatching;

    // First post-formation M15 overlap is the trigger; H4 first touch is also
    // assigned only once and only after the FVG became available.
    for (const zone of state.h4Zones) {
      if (zone.firstTouchAvailableAt === null && bar.t >= zone.availableAt
          && overlaps(bar, zone.lower, zone.upper)) {
        zone.firstTouchAvailableAt = completedAt;
      }
    }

    const newM15Gap = previousM15.length >= 2
      ? detectGap(previousM15[previousM15.length - 2], bar, M15_MS)
      : null;
    if (newM15Gap) {
      const eligibleZones = state.h4Zones
        .filter((zone) => zone.firstTouchAvailableAt !== null
          && zone.direction === newM15Gap.direction
          && newM15Gap.upper - newM15Gap.lower < zone.upper - zone.lower
          && newM15Gap.availableAt > zone.firstTouchAvailableAt
          && newM15Gap.availableAt <= zone.firstTouchAvailableAt + RETEST_HORIZON_MS)
        .sort((a, b) => a.availableAt - b.availableAt);
      const firstZone = eligibleZones[0];
      if (firstZone && firstZone.firstTouchAvailableAt !== null
          && !state.m15RetestWatches.some((watch) => m15WatchId(watch) === m15WatchId(newM15Gap))) {
        state.m15RetestWatches.push({
          ...newM15Gap,
          h4FvgAvailableAt: firstZone.availableAt,
          h4FirstTouchAvailableAt: firstZone.firstTouchAvailableAt,
          expiresAt: newM15Gap.availableAt + RETEST_HORIZON_MS,
        });
      }
    }

    state.h4Zones = state.h4Zones.filter((zone) => zone.firstTouchAvailableAt === null
      || completedAt <= zone.firstTouchAvailableAt + RETEST_HORIZON_MS);
    state.m15RetestWatches = state.m15RetestWatches.filter((watch) => completedAt <= watch.expiresAt);
    state.recentM15 = [...previousM15, bar].slice(-4);
    state.lastM15Open = bar.t;
  }
  return { state, signals };
}

export function latestOff04SwingStop(
  pivots: Off04ConfirmedPivot[],
  direction: Direction,
  entryPrice: number,
  entryTime: number,
): number | null {
  const kind = direction === "LONG" ? "low" : "high";
  for (let index = pivots.length - 1; index >= 0; index--) {
    const pivot = pivots[index];
    if (pivot.confirmedAt > entryTime || pivot.kind !== kind) continue;
    if (direction === "LONG" ? pivot.price < entryPrice : pivot.price > entryPrice) {
      return pivot.price;
    }
  }
  return null;
}

export function buildOff04ForwardCapture(args: {
  signal: Off04ForwardSignal;
  entryBar: Candle | null;
  pivots: Off04ConfirmedPivot[];
  now: number;
}): Off04ForwardTradeCapture | null {
  const { signal, entryBar, pivots, now } = args;
  if (!entryBar || entryBar.t !== signal.triggerAvailableAt || now < signal.triggerAvailableAt
      || now - signal.triggerAvailableAt > MAX_FRESH_SIGNAL_AGE_MS) return null;
  const entry = entryBar.o;
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const stopLoss = latestOff04SwingStop(pivots, signal.direction, entry, signal.triggerAvailableAt);
  if (stopLoss === null) return null;
  const risk = signal.direction === "LONG" ? entry - stopLoss : stopLoss - entry;
  if (!(risk > 0) || !Number.isFinite(risk)) return null;
  const target = signal.direction === "LONG"
    ? entry + OFF04_FORWARD_TARGET_R * risk
    : entry - OFF04_FORWARD_TARGET_R * risk;
  if (!Number.isFinite(target)) return null;
  return {
    setupId: signal.setupId,
    pair: signal.pair,
    direction: signal.direction,
    entry,
    stopLoss,
    target,
    risk,
    h4FvgAvailableAt: signal.h4FvgAvailableAt,
    h4FirstTouchAvailableAt: signal.h4FirstTouchAvailableAt,
    m15FvgAvailableAt: signal.m15FvgAvailableAt,
    triggerAvailableAt: signal.triggerAvailableAt,
    entryTime: entryBar.t,
  };
}

/** R03-style OHLC resolver: next-M15-open reference entry, fixed stop, 3R TP,
 *  adverse gap fill, and stop-first treatment when both levels print in a bar. */
export function resolveOff04ForwardTrade(
  row: Off04ForwardTradeRow,
  completeM15: Candle[],
): Off04ForwardOutcome | null {
  const entry = Number(row.hypothetical_entry);
  const stop = Number(row.hypothetical_stop_loss);
  const target = Number(row.hypothetical_target);
  const risk = Number(row.initial_risk);
  if (![entry, stop, target, risk].every(Number.isFinite) || !(risk > 0)) return null;
  const direction = row.direction;
  const bars = completeM15
    .filter((bar) => bar.t >= Number(row.entry_time_ms) && finiteCandle(bar))
    .slice()
    .sort((a, b) => a.t - b.t);

  for (const bar of bars) {
    const stopAtOpen = direction === "LONG" ? bar.o <= stop : bar.o >= stop;
    const targetAtOpen = direction === "LONG" ? bar.o >= target : bar.o <= target;
    const hitStop = direction === "LONG" ? bar.l <= stop : bar.h >= stop;
    const hitTarget = direction === "LONG" ? bar.h >= target : bar.l <= target;
    let exitPrice: number | null = null;
    let status: Off04ForwardOutcome["status"] | null = null;

    if (stopAtOpen) {
      exitPrice = bar.o;
      status = "SL_HIT";
    } else if (targetAtOpen) {
      exitPrice = target;
      status = "TP_HIT";
    } else if (hitStop) {
      exitPrice = stop;
      status = "SL_HIT";
    } else if (hitTarget) {
      exitPrice = target;
      status = "TP_HIT";
    }
    if (status && exitPrice !== null) {
      const rMultiple = direction === "LONG" ? (exitPrice - entry) / risk : (entry - exitPrice) / risk;
      return { status, exitPrice, exitTime: bar.t + M15_MS, rMultiple };
    }
  }
  return null;
}

export function formatOff04ForwardTelegram(capture: Off04ForwardTradeCapture): string {
  const price = (value: number) => new Intl.NumberFormat("en-US", {
    useGrouping: false, maximumFractionDigits: 8,
  }).format(value);
  return [
    "🟡 OFF-04 FORWARD TEST · PAPER / NO ORDER",
    "Baseline: all sessions · post-formation M15-zone retest · fixed 3R target.",
    "This is a research reference only. No order was placed; no live fill is claimed.",
    "",
    `${capture.pair} · M15 · ${capture.direction}`,
    `Next-M15-open reference entry: ${price(capture.entry)}`,
    `Confirmed 2-left / 2-right M15 swing stop: ${price(capture.stopLoss)}`,
    `Fixed 3R target: ${price(capture.target)}`,
    `Price risk: ${price(capture.risk)}`,
    `H4 FVG available: ${new Date(capture.h4FvgAvailableAt).toISOString()}`,
    `First observed H4-zone touch available: ${new Date(capture.h4FirstTouchAvailableAt).toISOString()}`,
    `M15 FVG available: ${new Date(capture.m15FvgAvailableAt).toISOString()}`,
    `M15 retest signal available: ${new Date(capture.triggerAvailableAt).toISOString()}`,
    `Reference entry time: ${new Date(capture.entryTime).toISOString()}`,
    `Research ID: ${capture.setupId}`,
  ].join("\n");
}

function validDedicatedChatId(value: string): boolean {
  return /^-100\d+$/.test(value);
}

function isExistingTelegramDestination(
  env: Off04ForwardEnv,
  target: string,
  kvDestinations: Array<string | null> = [],
): boolean {
  const normalizedTarget = target.toLowerCase();
  const configured = [
    env.TELEGRAM_CHAT_ID,
    env.TELEGRAM_FREE_CHAT_ID,
    env.TELEGRAM_DERIV_CHAT_ID,
    env.TELEGRAM_DERIV_FREE_CHAT_ID,
    env.TELEGRAM_DM_CHAT_ID,
    ...kvDestinations,
  ];
  const configuredIds = configured
    .flatMap((raw) => raw?.split(",") ?? [])
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  // Non-numeric usernames/aliases cannot be compared safely with a numeric
  // channel ID; fail closed rather than risk aliasing a subscriber channel.
  return configuredIds.some((id) => !/^-?\d+$/.test(id) || id === normalizedTarget);
}

async function sendOnlyToDedicatedTestChannel(args: {
  botToken: string;
  chatId: string;
  text: string;
  fetchFn: typeof fetch;
}): Promise<void> {
  const response = await args.fetchFn(`https://api.telegram.org/bot${args.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: args.chatId,
      text: args.text,
      disable_web_page_preview: true,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
  if (!response.ok || payload.ok !== true) {
    throw new Error(`OFF-04 test-channel Telegram delivery failed: HTTP ${response.status} ${payload.description ?? ""}`.trim());
  }
}

function stateKey(pair: string): string {
  return `${OFF04_FORWARD_STATE_PREFIX}${pair}`;
}

function parseState(raw: string | null): Off04ForwardState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Off04ForwardState;
    const validGap = (gap: Off04Gap) => gap
      && (gap.direction === "LONG" || gap.direction === "SHORT")
      && Number.isFinite(gap.lower) && Number.isFinite(gap.upper) && gap.upper > gap.lower
      && Number.isFinite(gap.availableAt);
    const validPivot = (pivot: Off04ConfirmedPivot) => pivot
      && (pivot.kind === "high" || pivot.kind === "low")
      && Number.isFinite(pivot.price) && Number.isFinite(pivot.confirmedAt);
    if (value?.version !== 1 || !Number.isFinite(value.startedAt)
        || !Number.isFinite(value.lastH1Open) || value.lastH1Open < 0
        || !Number.isFinite(value.lastM15Open) || value.lastM15Open < 0
        || !Array.isArray(value.recentH1) || value.recentH1.length > 3 || !value.recentH1.every(finiteCandle)
        || !Array.isArray(value.recentH4) || value.recentH4.length > 2 || !value.recentH4.every(finiteCandle)
        || !Array.isArray(value.recentM15) || value.recentM15.length > 4 || !value.recentM15.every(finiteCandle)
        || !Array.isArray(value.pivots) || !value.pivots.every(validPivot)
        || !Array.isArray(value.h4Zones) || !value.h4Zones.every((zone) => validGap(zone)
          && (zone.firstTouchAvailableAt === null || Number.isFinite(zone.firstTouchAvailableAt)))
        || !Array.isArray(value.m15RetestWatches) || !value.m15RetestWatches.every((watch) => validGap(watch)
          && Number.isFinite(watch.h4FvgAvailableAt) && Number.isFinite(watch.h4FirstTouchAvailableAt)
          && Number.isFinite(watch.expiresAt))) return null;
    return value;
  } catch {
    return null;
  }
}

function resolveOandaEnvironment(value: string | null): "practice" | "live" | "auto" {
  return value === "practice" || value === "live" || value === "auto" ? value : "auto";
}

async function resolveOpenOutcomes(args: {
  store: Store;
  pair: string;
  completeM15: Candle[];
}): Promise<number> {
  const open = await args.store.openOff04ForwardTrades(args.pair);
  let resolved = 0;
  for (const row of open) {
    const outcome = resolveOff04ForwardTrade(row, args.completeM15);
    if (!outcome) continue;
    await args.store.recordOff04ForwardOutcome(row.setup_id, outcome);
    resolved++;
  }
  return resolved;
}

async function resolveAndCensorUnobservedOutcomes(args: {
  store: Store;
  pair: string;
  completeM15: Candle[];
}): Promise<{ resolved: number; censored: number }> {
  const resolved = await resolveOpenOutcomes(args);
  const earliestObservedOpen = args.completeM15[0]?.t;
  if (earliestObservedOpen === undefined) return { resolved, censored: 0 };
  let censored = 0;
  for (const row of await args.store.openOff04ForwardTrades(args.pair)) {
    if (Number(row.entry_time_ms) >= earliestObservedOpen) continue;
    await args.store.recordOff04ForwardCensored(row.setup_id);
    censored++;
  }
  return { resolved, censored };
}

/**
 * Scheduled entrypoint. Default-off and additionally requires a durable D1,
 * OANDA token, Telegram bot token, and one explicitly configured test-channel
 * ID. The destination is never inferred from any existing subscriber setting.
 */
export async function runOff04ForwardTest(args: {
  env: Off04ForwardEnv;
  now?: number;
  fetchFn?: typeof fetch;
  storeOverride?: Store;
}): Promise<Off04ForwardRunSummary> {
  const { env } = args;
  if ((env.OFF04_FORWARD_ENABLED ?? "").trim().toLowerCase() !== "true") return emptySummary("disabled");
  const now = args.now ?? Date.now();
  if (now % M15_MS > MAX_FRESH_SIGNAL_AGE_MS) return emptySummary("not_boundary");
  const chatId = env.OFF04_FORWARD_TEST_CHAT_ID?.trim() ?? "";
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !chatId || !validDedicatedChatId(chatId)) {
    return emptySummary("missing_configuration");
  }
  const store = args.storeOverride ?? makeStore(env.DB);
  const fetchFn = args.fetchFn ?? fetch;
  let kvDestinations: Array<string | null>;
  try {
    kvDestinations = await Promise.all([
      "telegram_chat_id", "telegram_free_chat_id", "telegram_deriv_chat_id",
      "telegram_deriv_free_chat_id", "telegram_dm_chat_id",
    ].map((key) => store.getKv(key)));
  } catch {
    return emptySummary("missing_configuration");
  }
  if (isExistingTelegramDestination(env, chatId, kvDestinations)) {
    return emptySummary("missing_configuration");
  }
  const token = env.OANDA_API_KEY || env.OANDA_API_TOKEN || await store.getKv("oanda_api_token");
  if (!token) return emptySummary("missing_configuration");
  const oandaEnvironment = resolveOandaEnvironment(await store.getKv("oanda_environment"));
  const summary = emptySummary("processed");
  try {
    await store.getOff04ForwardLedger(1);
  } catch (error) {
    summary.errors.push(`OFF-04 forward ledger/migration unavailable: ${String(error)}`);
    return summary;
  }

  for (const pair of OFF04_FORWARD_PAIRS) {
    const key = stateKey(pair);
    try {
      const oldState = parseState(await store.getKv(key));
      // A long Worker/API interruption cannot be causally repaired from the
      // bounded follow-up request. Rebaseline with the full OANDA window and
      // deliberately discard any unobserved in-gap setup watches.
      const firstRequest = !oldState;
      const [h1Raw, m15Raw] = await Promise.all([
        fetchOanda(token, pair, "1h", firstRequest ? INITIAL_HISTORY_LIMIT : CONTINUATION_HISTORY_LIMIT, {}, fetchFn, oandaEnvironment),
        fetchOanda(token, pair, "15m", firstRequest ? INITIAL_HISTORY_LIMIT : CONTINUATION_HISTORY_LIMIT, {}, fetchFn, oandaEnvironment),
      ]);
      const h1Closed = sortedUniqueBars(h1Raw, H1_MS, now, true);
      const m15Closed = sortedUniqueBars(m15Raw, M15_MS, now, true);
      const m15ForEntry = sortedUniqueBars(m15Raw, M15_MS, now, false);
      if (h1Closed.length < 4 || m15Closed.length < 5 || !m15ForEntry.length) {
        summary.errors.push(`${pair}: insufficient valid completed OANDA bars`);
        continue;
      }

      let state = oldState;
      if (!state) {
        const outcomes = await resolveAndCensorUnobservedOutcomes({ store, pair, completeM15: m15Closed });
        summary.outcomesResolved += outcomes.resolved;
        summary.outcomesCensored += outcomes.censored;
        state = createOff04ForwardBaseline({ h1: h1Closed, m15: m15Closed, now });
        await store.setKv(key, JSON.stringify(state));
        summary.seeded++;
        summary.pairsScanned++;
        continue;
      }

      const oldestM15 = m15Closed[0].t;
      const oldestH1 = h1Closed[0].t;
      // If a cursor predates the bounded provider window, intermediate M15/H1
      // bars are no longer observable. Rebaseline instead of claiming a missed
      // touch was the first one or replaying a stale candidate.
      const stateTooOld = (state.lastM15Open >= 0 && state.lastM15Open < oldestM15)
        || (state.lastH1Open >= 0 && state.lastH1Open < oldestH1)
        || (now - state.lastM15Open > MAX_RECOVERY_GAP_MS && state.lastM15Open >= 0);
      if (stateTooOld) {
        // Full refetch to seed pivots and H4 formation context, but no historic
        // signal replay. The research test resumes from this fresh cursor.
        const [h1FullRaw, m15FullRaw] = await Promise.all([
          fetchOanda(token, pair, "1h", INITIAL_HISTORY_LIMIT, {}, fetchFn, oandaEnvironment),
          fetchOanda(token, pair, "15m", INITIAL_HISTORY_LIMIT, {}, fetchFn, oandaEnvironment),
        ]);
        const h1Full = sortedUniqueBars(h1FullRaw, H1_MS, now, true);
        const m15Full = sortedUniqueBars(m15FullRaw, M15_MS, now, true);
        if (h1Full.length < 4 || m15Full.length < 5) {
          summary.errors.push(`${pair}: unable to rebaseline after data gap`);
          continue;
        }
        const outcomes = await resolveAndCensorUnobservedOutcomes({ store, pair, completeM15: m15Full });
        summary.outcomesResolved += outcomes.resolved;
        summary.outcomesCensored += outcomes.censored;
        state = createOff04ForwardBaseline({ h1: h1Full, m15: m15Full, now });
        await store.setKv(key, JSON.stringify(state));
        summary.seeded++;
        summary.pairsScanned++;
        continue;
      }

      const boundary = Math.floor(now / M15_MS) * M15_MS;
      const expectedClosedOpen = boundary - M15_MS;
      // If this pair's current M15 boundary was already processed, avoid a
      // second full OANDA fetch when cron invokes again during the 2-minute
      // freshness window. If the feed was not ready, its cursor remains behind
      // and the next minute can retry.
      if (state.lastM15Open >= expectedClosedOpen) continue;

      const newH1 = h1Closed.filter((bar) => bar.t > state!.lastH1Open);
      const newM15 = m15Closed.filter((bar) => bar.t > state!.lastM15Open);
      if (!newM15.length) {
        summary.pairsScanned++;
        continue;
      }

      const advanced = advanceOff04ForwardState({ state, pair, newH1, newM15 });
      const outcomesResolved = await resolveOpenOutcomes({ store, pair, completeM15: m15Closed });
      summary.outcomesResolved += outcomesResolved;

      for (const signal of advanced.signals) {
        if (now - signal.triggerAvailableAt < 0 || now - signal.triggerAvailableAt > MAX_FRESH_SIGNAL_AGE_MS) {
          console.info(JSON.stringify({
            level: "info", msg: "off04.forward_signal_skipped_stale", pair,
            setupId: signal.setupId,
            triggerAvailableAt: new Date(signal.triggerAvailableAt).toISOString(),
          }));
          continue;
        }
        const entryBar = m15ForEntry.find((bar) => bar.t === signal.triggerAvailableAt) ?? null;
        if (!entryBar) {
          // Keep the old cursor for one more scheduled retry while the exact
          // next-M15-open reference candle may still be arriving from OANDA.
          throw new Error(`fresh OFF-04 signal has no next-open candle yet (${signal.setupId})`);
        }
        const capture = buildOff04ForwardCapture({ signal, entryBar, pivots: advanced.state.pivots, now });
        if (!capture) {
          console.info(JSON.stringify({
            level: "info", msg: "off04.forward_signal_skipped_no_valid_next_open_or_swing_stop",
            pair, setupId: signal.setupId,
          }));
          continue;
        }

        const inserted = await store.insertOff04ForwardTrade(capture);
        if (!inserted) continue;
        summary.signalsInserted++;
        try {
          await sendOnlyToDedicatedTestChannel({
            botToken: env.TELEGRAM_BOT_TOKEN,
            chatId,
            text: formatOff04ForwardTelegram(capture),
            fetchFn,
          });
          await store.recordOff04ForwardDelivery(capture.setupId, "SENT");
          summary.telegramSent++;
        } catch (error) {
          const detail = String(error).slice(0, 500);
          await store.recordOff04ForwardDelivery(capture.setupId, "FAILED", detail);
          summary.telegramFailed++;
          console.warn(JSON.stringify({
            level: "warn", msg: "off04.forward_telegram_failed", pair,
            setupId: capture.setupId, error: detail,
          }));
        }
      }

      // Persist cursors after the isolated ledger insert attempts. If the D1
      // write fails, the pair catch below leaves the old cursor for safe retry;
      // setup_id uniqueness prevents a duplicate Telegram send after a retry.
      await store.setKv(key, JSON.stringify(advanced.state));
      summary.pairsScanned++;
    } catch (error) {
      const detail = `${pair}: ${String(error)}`;
      summary.errors.push(detail);
      console.warn(JSON.stringify({ level: "warn", msg: "off04.forward_pair_failed", pair, error: String(error) }));
    }
  }
  return summary;
}
