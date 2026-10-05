/** Layer 2 — XYZ execution engine (confirmation-entry mode). TS port of
 *  slk_bot/slk/engine.py. Replays the trailing `setupWindow` of entry-TF
 *  candles against point-in-time storyline snapshots:
 *
 *    MAP → TOUCH → SWEEP → SHIFT → RETEST → ALERT | INVALID | EXPIRED
 *
 *  Stateless across scans; idempotency comes from the DB (unique setup ids
 *  and unique event keys). Every transition is emitted as an EngineEvent. */
import * as F from "./features";
import { countTransition, emptyReplayDiagnostics, type ReplayDiagnostics } from "./diagnostics";
import { PARAM_VERSION, minStopDistance, pipSize, roundToTick } from "./config";
import { MAP_TF_SECONDS } from "./storyline";
import { evaluateDirectionalBias, type DirectionalBiasDiagnostics } from "./shadow";
import type {
  Alert, Candle, Direction, EngineEvent, Setup, Storyline, ShadowTradeCapture,
} from "./types";
import type { StrategyConfig } from "./config";

export interface ScanEntryArgs {
  pair: string;
  entryTf: string;
  tfSeconds: number;
  candles: Candle[];
  snaps: [number, Storyline][];
  cfg: StrategyConfig;
  mode: "paper" | "live";
  provider: string;
  d1Candles?: Candle[];
  h1Candles?: Candle[];
  h4Candles?: Candle[];
}

/** Deterministic setup identity (readable in logs/audit trail).
 *  Deliberately EXCLUDES the data provider: a provider failover must not
 *  mint a new identity for the same level (the provider stays a stored
 *  column on slk_alerts). The level price is rounded to the instrument's
 *  identity tick so sub-tick provider jitter cannot rotate the ID.
 *  Legacy provider-prefixed rows in D1 are handled by the store-level
 *  identity guard (pair, timeframe, direction, level kind, origin time). */
export function buildSetupId(
  pair: string,
  entryTf: string,
  d: Direction,
  level: { kind: string; originPrice: number; originTime: number },
): string {
  const price = roundToTick(pair, level.originPrice).toFixed(6);
  return `${pair}:${entryTf}:${d}:${level.kind}:${price}:${new Date(level.originTime).toISOString()}`;
}

/** The 100% setting deliberately preserves the legacy ATR-tolerant predicate
 *  byte-for-byte. Below 100, require that fraction of actual FVG penetration:
 *  SHORT pulls up from zoneLo; LONG pulls down from zoneHi. */
export function hasRequiredRetestDepth(
  candle: Candle,
  zoneLo: number,
  zoneHi: number,
  isShort: boolean,
  tolerance: number,
  depthPct = 100,
): boolean {
  if (!Number.isFinite(depthPct) || depthPct >= 100) {
    return isShort ? candle.h >= zoneLo - tolerance : candle.l <= zoneHi + tolerance;
  }
  const depth = Math.max(0, depthPct) / 100 * Math.max(0, zoneHi - zoneLo);
  return isShort ? candle.h >= zoneLo + depth : candle.l <= zoneHi - depth;
}

function bisectRight(keys: number[], x: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function scanEntry(args: ScanEntryArgs): {
  alerts: Alert[];
  events: EngineEvent[];
  diagnostics: ReplayDiagnostics;
  shadowDiagnostics: DirectionalBiasDiagnostics[];
  shadowTrades: ShadowTradeCapture[];
} {
  const { pair, entryTf, tfSeconds, candles, snaps, cfg, mode, provider, d1Candles, h1Candles, h4Candles } = args;
  const alerts: Alert[] = [];
  const events: EngineEvent[] = [];
  const diagnostics = emptyReplayDiagnostics();
  const shadowDiagnostics: DirectionalBiasDiagnostics[] = [];
  const shadowTrades: ShadowTradeCapture[] = [];
  if (candles.length < cfg.pivotLeft + cfg.pivotRight + 6) return { alerts, events, diagnostics, shadowDiagnostics, shadowTrades };

  // snapshot validity starts when that H4 candle has closed
  const validFrom = snaps.map(([t]) => t + MAP_TF_SECONDS * 1000).sort((a, b) => a - b);
  const storyByKey = new Map<number, Storyline>();
  for (const [t, s] of snaps) storyByKey.set(t + MAP_TF_SECONDS * 1000, s);
  const storyAt = (closeTime: number): Storyline | null => {
    const i = bisectRight(validFrom, closeTime) - 1;
    return i >= 0 ? storyByKey.get(validFrom[i]) ?? null : null;
  };

  const atrE = F.atr(candles, cfg.atrPeriod);
  const [highs, lows] = F.findSwings(candles, cfg.pivotLeft, cfg.pivotRight);
  const conf = cfg.pivotRight;
  const start = Math.max(0, candles.length - cfg.setupWindow);
  const active: { LONG: Setup | null; SHORT: Setup | null } = { LONG: null, SHORT: null };

  const emit = (s: Setup, state: string, c: Candle, reason: string, price: number | null = c.c) => {
    countTransition(diagnostics, state);
    events.push({ setupId: s.setupId, pair, state, candleTime: c.t, reason, price });
    console.info(JSON.stringify({ level: "info", msg: "slk.transition", pair, tf: entryTf, setupId: s.setupId, state, reason, price }));
  };
  const kill = (s: Setup, state: string, c: Candle, reason: string) => {
    emit(s, state, c, reason, c.c);
    active[s.direction] = null;
  };

  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const closeTime = c.t + tfSeconds * 1000;
    const story = storyAt(closeTime);

    for (const d of ["SHORT", "LONG"] as Direction[]) {
      const isShort = d === "SHORT";
      let s = active[d];

      // ---- MAP: arm an origin level -----------------------------------
      if (!s && story && story.valid && story.direction === d && story.origin) {
        const lv = story.origin;
        const onSide = isShort ? c.c < lv.zoneLo : c.c > lv.zoneHi;
        if (onSide) {
          s = {
            setupId: buildSetupId(pair, entryTf, d, lv),
            direction: d, level: lv, state: "MAP",
            mapIndex: i, mapTime: c.t,
            touchIndex: 0, touchTime: null,
            sweptPoolIndex: -1, sweptPoolPrice: 0,
            sweepIndex: 0, sweepTime: null,
            extreme: 0, refPrice: 0,
            bosIndex: 0, bosTime: null,
            invLevel: 0, leftZone: false,
            environment: story.environment, phase: story.phase,
            htfAlignment: story.htfAlignment,
            drawOnLiquidity: story.drawOnLiquidity,
            nearestExternalTarget: story.nearestExternalTarget,
            internalPools: [...story.internalPools],
            externalPools: [...story.externalPools],
            imbalances: [...story.imbalances],
          };
          active[d] = s;
          emit(s, "MAP", c, `${lv.kind}-level ${lv.originPrice} armed (${story.environment}/${story.phase})`, lv.originPrice);
        }
      }
      if (!s) continue;
      const z = s.level;
      const cur: Setup = s;

      // ---- HTF story flip ---------------------------------------------
      if (story && story.valid && story.direction !== null && story.direction !== d) {
        kill(cur, "INVALID", c, "HTF storyline invalidation");
        continue;
      }

      const brokeLevel = isShort
        ? c.c > z.zoneHi + cfg.flipMarginAtr * atrE
        : c.c < z.zoneLo - cfg.flipMarginAtr * atrE;

      // ---- MAP → TOUCH -------------------------------------------------
      if (cur.state === "MAP") {
        if (brokeLevel) { kill(cur, "INVALID", c, "close beyond key level (level may flip)"); continue; }
        // Expectation re-evaluation: while still pre-touch, follow the
        // storyline if it moves to a different (fresher/better) origin.
        // Without this, a stale MAP armed from an old snapshot wedges the
        // direction slot and starves newer valid setups. Dedupe-safe:
        // events are unique on (setup_id, state, candle_time).
        const origin = story && story.valid && story.direction === d ? story.origin : null;
        if (origin && (origin.kind !== cur.level.kind || origin.originTime !== cur.level.originTime)) {
          const onSideNew = isShort ? c.c < origin.zoneLo : c.c > origin.zoneHi;
          if (onSideNew) {
            cur.level = origin;
            cur.setupId = buildSetupId(pair, entryTf, d, origin);
            cur.mapIndex = i;
            cur.mapTime = c.t;
            emit(cur, "MAP", c, `${origin.kind}-level ${origin.originPrice} armed (${story!.environment}/${story!.phase})`, origin.originPrice);
          }
        }
        const touched = isShort ? c.h >= z.zoneLo : c.l <= z.zoneHi;
        if (touched) {
          cur.state = "TOUCH";
          cur.touchIndex = i;
          cur.touchTime = c.t;
          emit(cur, "TOUCH", c, "price entered the origin zone");
        } else if (i - cur.mapIndex > cfg.touchWindow) {
          kill(cur, "EXPIRED", c, "level not reached in time");
          continue;
        }
      }

      // ---- TOUCH → SWEEP -----------------------------------------------
      if (cur.state === "TOUCH") {
        if (brokeLevel) { kill(cur, "INVALID", c, "close beyond key level without a sweep"); continue; }
        const pools = isShort ? highs : lows;
        const swept = pools.filter((sw) =>
          sw.index <= cur.touchIndex && sw.index + conf <= i
          && (isShort ? c.h > sw.price && c.c < sw.price : c.l < sw.price && c.c > sw.price)
          && (isShort ? c.h >= z.zoneLo : c.l <= z.zoneHi));
        if (swept.length) {
          const pick = isShort
            ? swept.reduce((a, b) => (b.price > a.price ? b : a))
            : swept.reduce((a, b) => (b.price < a.price ? b : a));
          cur.sweptPoolIndex = pick.index;
          cur.sweptPoolPrice = pick.price;
          cur.sweepIndex = i;
          cur.sweepTime = c.t;
          cur.extreme = isShort ? c.h : c.l;
          const refSwings = (isShort ? lows : highs).filter(
            (rw) => pick.index < rw.index && rw.index <= i && rw.index + conf <= i);
          if (refSwings.length) {
            cur.refPrice = refSwings[refSwings.length - 1].price;
          } else {
            const seg = candles.slice(cur.touchIndex, i + 1);
            cur.refPrice = isShort
              ? Math.min(...seg.map((x) => x.l))
              : Math.max(...seg.map((x) => x.h));
          }
          cur.state = "SHIFT";
          emit(cur, "SWEEP", c, `swept ${isShort ? "buyside" : "sellside"} internal liquidity @ ${pick.price}`, pick.price);
        } else if (i - cur.touchIndex > cfg.sweepWindow) {
          kill(cur, "EXPIRED", c, "no liquidity sweep after the touch");
          continue;
        }
      }

      // ---- SWEEP → SHIFT (BOS) ------------------------------------------
      if (cur.state === "SHIFT") {
        if (i > cur.sweepIndex) {
          const prev = candles[i - 1];
          cur.extreme = isShort ? Math.max(cur.extreme, prev.h) : Math.min(cur.extreme, prev.l);
        }
        const violated = isShort ? c.c > cur.extreme : c.c < cur.extreme;
        if (violated) { kill(cur, "INVALID", c, "close beyond sweep extreme"); continue; }
        const bos = isShort ? c.c < cur.refPrice : c.c > cur.refPrice;
        if (bos) {
          cur.invLevel = isShort ? Math.max(cur.extreme, c.h) : Math.min(cur.extreme, c.l);
          cur.bosIndex = i;
          cur.bosTime = c.t;
          cur.state = "RETEST";
          emit(cur, "SHIFT", c, `BOS through pullback structure ${cur.refPrice}`);
        }
        if (cur.state === "SHIFT" && i - cur.sweepIndex > cfg.bosWindow) {
          kill(cur, "EXPIRED", c, "no BOS after the sweep");
          continue;
        }
      }

      // ---- SHIFT → RETEST → ALERT ---------------------------------------
      if (cur.state === "RETEST") {
        const violated = isShort ? c.c > cur.invLevel : c.c < cur.invLevel;
        if (violated) { kill(cur, "INVALID", c, "close beyond invalidation level"); continue; }
        if (i > cur.bosIndex) {
          const left = isShort ? c.c < z.zoneLo : c.c > z.zoneHi;
          if (left) cur.leftZone = true;
          const tol = cfg.retestToleranceAtr * atrE;
          const returns = hasRequiredRetestDepth(
            c, z.zoneLo, z.zoneHi, isShort, tol, cfg.retestDepthPct,
          );
          if (cur.leftZone && returns) {
            // opposing liquidity must remain standing for reversal setups
            let standing = false;
            if (cur.drawOnLiquidity !== null) {
              const seg = candles.slice(cur.mapIndex, i + 1);
              standing = isShort
                ? seg.every((x) => x.l > (cur.drawOnLiquidity as number))
                : seg.every((x) => x.h < (cur.drawOnLiquidity as number));
            }
            diagnostics.retestCandidates++;
            const alert = buildAlert({
              pair, entryTf, closeTime, c, s: cur, isShort,
              atrE, cfg, mode, standing, provider, diagnostics,
              candles, candleIndex: i, d1Candles, h1Candles, h4Candles,
              shadowTrades,
            });
            if (alert) {
              emit(cur, "RETEST", c, `return to origin zone → confirmation entry @ ${c.c}`);
              alerts.push(alert);
              if (alert.directionalBias) shadowDiagnostics.push(alert.directionalBias);
              diagnostics.confirmedAlerts++;
            }
            active[d] = null;
            continue;
          }
        }
        if (i - cur.bosIndex > cfg.retestWindow) {
          // Capture only the hypothetical BOS-close trade in the separate
          // research ledger. All failures are swallowed so observation cannot
          // affect this established expiry transition or its event payload.
          try {
            const shadow = buildNoRetestShadow({
              pair, entryTf, tfSeconds, s: cur, isShort, atrE, cfg, candles,
            });
            if (shadow) shadowTrades.push(shadow);
          } catch (err) {
            console.warn(JSON.stringify({ level: "warn", msg: "shadow NO_RETEST capture failed", setupId: cur.setupId, error: String(err) }));
          }
          kill(cur, "EXPIRED", c, "no retest of the origin zone");
          continue;
        }
      }
    }
  }

  return { alerts, events, diagnostics, shadowDiagnostics, shadowTrades };
}

interface BuildAlertArgs {
  pair: string; entryTf: string; closeTime: number; c: Candle; s: Setup;
  isShort: boolean; atrE: number; cfg: StrategyConfig;
  diagnostics: ReplayDiagnostics;
  mode: "paper" | "live"; standing: boolean; provider: string;
  candles: Candle[];
  candleIndex: number;
  d1Candles?: Candle[];
  h1Candles?: Candle[];
  h4Candles?: Candle[];
  shadowTrades: ShadowTradeCapture[];
}

/** Pick the internal-liquidity target (tp1) and external drawback (tp2) for
 *  a setup. Exported for tests. Direction-sanity: the external draw is picked
 *  at STORYLINE-map time and price can run past it before the retest entry
 *  fires — a target on the wrong side of the entry is meaningless, so it is
 *  dropped rather than stored (production: a SHORT XAUUSD alert shipped with
 *  tp above entry and later "resolved" as TP_HIT at -1.2R). */
export function selectTargets(args: {
  isShort: boolean; entry: number; risk: number; minTpR: number;
  maxPromotedTpR?: number;
  internalPools: { side: string; price: number }[];
  nearestExternalTarget: number | null;
}): { tp1: number; tp2: number | null } | null {
  const side = args.isShort ? "sellside" : "buyside";
  const inner = args.internalPools
    .filter((p) => p.side === side && (args.isShort ? p.price < args.entry : p.price > args.entry))
    .map((p) => p.price);
  let tp1: number | null = inner.length
    ? (args.isShort ? Math.max(...inner) : Math.min(...inner))
    : null;
  let tp2 = args.nearestExternalTarget;
  if (tp2 !== null && (args.isShort ? tp2 >= args.entry : tp2 <= args.entry)) tp2 = null;
  if (tp1 === tp2) tp2 = null;
  if (tp1 === null) { tp1 = tp2; tp2 = null; }
  if (tp1 === null) return null;
  let rr1 = Math.abs(tp1 - args.entry) / args.risk;
  if (rr1 < args.minTpR && tp2 !== null) {
    // Internal target is too close. Use a bounded execution target when the
    // external draw is unusually distant; retain the external draw as tp2.
    const promoted = tp2;
    const promotedR = Math.abs(promoted - args.entry) / args.risk;
    const capR = args.maxPromotedTpR ?? args.minTpR;
    if (promotedR > capR) {
      tp1 = args.isShort
        ? args.entry - capR * args.risk
        : args.entry + capR * args.risk;
      tp2 = promoted;
    } else {
      tp1 = promoted;
      tp2 = null;
    }
    rr1 = Math.abs(tp1 - args.entry) / args.risk;
  }
  if (rr1 < args.minTpR) return null;
  return { tp1, tp2 };
}

function buildTargetFloorShadow(args: {
  pair: string; entryTf: string; closeTime: number; entry: number; stopLoss: number;
  risk: number; isShort: boolean; s: Setup; cfg: StrategyConfig;
}): ShadowTradeCapture | null {
  if (args.cfg.minTpR !== 2.5 || args.risk <= 0) return null;
  const candidate = selectTargets({
    isShort: args.isShort,
    entry: args.entry,
    risk: args.risk,
    minTpR: 2.0,
    maxPromotedTpR: args.cfg.maxPromotedTpR,
    internalPools: args.s.internalPools,
    nearestExternalTarget: args.s.nearestExternalTarget,
  });
  if (!candidate) return null;
  const rr = Math.abs(candidate.tp1 - args.entry) / args.risk;
  if (!Number.isFinite(rr) || rr < 2.0 || rr >= 2.5) return null;
  return {
    setupId: args.s.setupId, pair: args.pair, entryTf: args.entryTf,
    direction: args.s.direction, entry: args.entry, stopLoss: args.stopLoss,
    tp1: candidate.tp1, rr, rejectReason: "TARGET_FLOOR",
    candleCloseTime: args.closeTime,
  };
}

function buildNoRetestShadow(args: {
  pair: string; entryTf: string; tfSeconds: number; s: Setup; isShort: boolean;
  atrE: number; cfg: StrategyConfig; candles: Candle[];
}): ShadowTradeCapture | null {
  const bosCandle = args.candles[args.s.bosIndex];
  const bosAtr = args.atrE;
  if (!bosCandle || !Number.isFinite(bosAtr) || bosAtr <= 0) return null;
  const entry = bosCandle.c;
  let stopLoss = args.isShort
    ? args.s.invLevel + args.cfg.slBufferAtr * bosAtr
    : args.s.invLevel - args.cfg.slBufferAtr * bosAtr;
  let risk = args.isShort ? stopLoss - entry : entry - stopLoss;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  if (args.cfg.minStopPips && args.cfg.minStopPips > 0) {
    const minDistance = minStopDistance(args.pair, args.cfg.minStopPips);
    if (risk < minDistance) {
      stopLoss = args.isShort ? entry + minDistance : entry - minDistance;
      risk = minDistance;
    }
  }
  // Use the nearest valid opposing liquidity target without imposing the
  // confirmation-entry RR floor: this row measures a BOS-close entry that the
  // retest rule rejected, not a second alert or a new strategy gate.
  const side = args.isShort ? "sellside" : "buyside";
  const validExternal = args.s.externalPools
    .filter((pool) => pool.side === side && (args.isShort ? pool.price < entry : pool.price > entry))
    .map((pool) => pool.price);
  const mappedTargetIsValid = args.s.nearestExternalTarget !== null
    && (args.isShort ? args.s.nearestExternalTarget < entry : args.s.nearestExternalTarget > entry);
  const externalFallback = validExternal.length
    ? (args.isShort ? Math.max(...validExternal) : Math.min(...validExternal))
    : null;
  const targets = selectTargets({
    isShort: args.isShort, entry, risk, minTpR: 0,
    maxPromotedTpR: args.cfg.maxPromotedTpR,
    internalPools: args.s.internalPools,
    nearestExternalTarget: mappedTargetIsValid ? args.s.nearestExternalTarget : externalFallback,
  });
  // A valid storyline normally supplies a draw target. If price has already
  // crossed every mapped pool by the BOS close, retain the required outcome
  // fields with a transparent 2.5R benchmark rather than silently dropping an
  // otherwise qualifying NO_RETEST expiry.
  const tp1 = targets?.tp1 ?? (args.isShort ? entry - 2.5 * risk : entry + 2.5 * risk);
  const rr = targets ? Math.abs(tp1 - entry) / risk : 2.5;
  if (!Number.isFinite(rr) || rr <= 0) return null;
  return {
    setupId: args.s.setupId, pair: args.pair, entryTf: args.entryTf,
    direction: args.s.direction, entry, stopLoss, tp1, rr,
    rejectReason: "NO_RETEST",
    candleCloseTime: bosCandle.t + args.tfSeconds * 1000,
  };
}

function buildAlert(a: BuildAlertArgs): Alert | null {
  const { pair, entryTf, closeTime, c, s, isShort, atrE, cfg, mode, standing, provider } = a;
  const entry = c.c;
  const buf = cfg.slBufferAtr * atrE;
  let sl = isShort ? s.invLevel + buf : s.invLevel - buf;
  let risk = isShort ? sl - entry : entry - sl;
  if (risk <= 0) {
    a.diagnostics.riskRejects++;
    a.diagnostics.riskRejectReasons.nonPositiveRisk++;
    return null;
  }
  // Enforce Option A: Minimum Stop Floor in Pips/Points (e.g. 10 pips forex, 25-30 pts indices)
  // so broker spread never prematurely tags out valid setups.
  if (cfg.minStopPips && cfg.minStopPips > 0) {
    const minDistance = minStopDistance(pair, cfg.minStopPips);
    if (risk < minDistance) {
      sl = isShort ? entry + minDistance : entry - minDistance;
      risk = minDistance;
    }
  }
  if (risk < cfg.minRiskAtr * atrE) {
    a.diagnostics.riskRejects++;
    a.diagnostics.riskRejectReasons.belowMinRiskAtr++;
    return null;
  }
  // stop-width ceiling: beyond 2× ATR the entry is structurally too far from
  // its invalidation — re-enter later rather than alert with a fat stop
  if (risk > cfg.maxStopAtr * atrE) {
    a.diagnostics.riskRejects++;
    a.diagnostics.riskRejectReasons.aboveMaxStopAtr++;
    return null;
  }

  // targets: internal liquidity first, then the nearest external target
  const targets = selectTargets({
    isShort, entry, risk, minTpR: cfg.minTpR, maxPromotedTpR: cfg.maxPromotedTpR,
    internalPools: s.internalPools, nearestExternalTarget: s.nearestExternalTarget,
  });
  if (!targets) {
    a.diagnostics.targetRejects++;
    // The live floor remains cfg.minTpR (2.5R in production). As a separate
    // counterfactual, ask the same selector for the best candidate at 2.0R;
    // only a resulting RR in [2.0, 2.5) is recorded. This branch never returns
    // an Alert and never emits an event or notification.
    try {
      const shadow = buildTargetFloorShadow({
        pair, entryTf, closeTime, entry, stopLoss: sl, risk, isShort, s, cfg,
      });
      if (shadow) a.shadowTrades.push(shadow);
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "shadow TARGET_FLOOR capture failed", setupId: s.setupId, error: String(err) }));
    }
    return null;
  }
  const { tp1, tp2 } = targets;

  let sess: string | null = null;
  if (cfg.sessionsAllowlist.length) sess = F.sessionFor(closeTime, cfg.sessionsAllowlist);
  let status: Alert["alertStatus"] = mode === "paper" ? "PAPER" : "SENT";
  let suppressReason: string | null = null;
  if (cfg.sessionsAllowlist.length && sess === null) {
    status = "SUPPRESSED";
    suppressReason = "outside session allowlist";
  }

  const lo = Math.min(entry, tp1);
  const hi = Math.max(entry, tp1);
  const intermediate = s.imbalances
    .filter((imb) => !(imb.hi < lo || imb.lo > hi))
    .map((imb) => ({ lo: imb.lo, hi: imb.hi, direction: imb.direction }));

  const shadowDiagnostics = evaluateDirectionalBias({
    pair, entryTf, direction: s.direction,
    entryCandles: a.candles,
    d1Candles: a.d1Candles,
    h4Candles: a.h4Candles,
    h1Candles: a.h1Candles,
    cfg,
    setup: {
      sweptPoolPrice: s.sweptPoolPrice,
      sweepTime: s.sweepTime,
      sweepIndex: s.sweepIndex,
      bosTime: s.bosTime,
      bosIndex: s.bosIndex,
      retestTime: c.t,
      retestIndex: a.candleIndex,
      origin: s.level,
    },
    sweepOccurred: true,
    bosOccurred: true,
    retestOccurred: true,
  });

  return {
    setupId: s.setupId, pair, entryTf, mapTf: cfg.mapTfLabel,
    direction: s.direction, entry, stopLoss: sl,
    tpInternal: tp1, tpExternal: tp2, candleCloseTime: closeTime,
    environment: s.environment, phase: s.phase, htfAlignment: s.htfAlignment,
    originKeyLevel: s.level.originPrice, originTime: s.level.originTime, keyLevelType: s.level.kind,
    keyLevelBounds: [s.level.zoneLo, s.level.zoneHi],
    keyLevelTested: s.level.touches > 0, keyLevelFlipped: s.level.flipped,
    imbalanceContext: s.imbalances.map((i2) => ({ lo: i2.lo, hi: i2.hi, direction: i2.direction })),
    internalLiquidity: s.internalPools.map((p) => ({ price: p.price, side: p.side, kind: p.kind, time: new Date(p.sourceTime).toISOString() })),
    externalLiquidity: s.externalPools.map((p) => ({ price: p.price, side: p.side, kind: p.kind, time: new Date(p.sourceTime).toISOString() })),
    drawOnLiquidity: s.drawOnLiquidity,
    nearestExternalTarget: s.nearestExternalTarget,
    intermediateZones: intermediate,
    opposingLiquidityStanding: standing,
    sweepTime: s.sweepTime ?? 0, bosTime: s.bosTime ?? 0, returnTime: c.t,
    invalidationLevel: s.invLevel, invalidationReason: null,
    parameterVersion: PARAM_VERSION,
    alertStatus: status, suppressReason, session: sess,
    atrEntry: atrE, rrInternal: Math.round((Math.abs(tp1 - entry) / risk) * 100) / 100,
    cycleStage: "entry_alert", entryMode: "confirmation",
    shadowClassification: shadowDiagnostics.classification,
    directionalBias: shadowDiagnostics,
  };
}
