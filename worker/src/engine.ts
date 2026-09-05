/** Layer 2 — XYZ execution engine (confirmation-entry mode). TS port of
 *  slk_bot/slk/engine.py. Replays the trailing `setupWindow` of entry-TF
 *  candles against point-in-time storyline snapshots:
 *
 *    MAP → TOUCH → SWEEP → SHIFT → RETEST → ALERT | INVALID | EXPIRED
 *
 *  Stateless across scans; idempotency comes from the DB (unique setup ids
 *  and unique event keys). Every transition is emitted as an EngineEvent. */
import * as F from "./features";
import { PARAM_VERSION } from "./config";
import { MAP_TF_SECONDS } from "./storyline";
import type {
  Alert, Candle, Direction, EngineEvent, Setup, Storyline,
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
}

function setupId(provider: string, pair: string, entryTf: string, d: Direction, level: { kind: string; originPrice: number; originTime: number }): string {
  // deterministic composite id (readable in logs/audit trail)
  return `${provider}:${pair}:${entryTf}:${d}:${level.kind}:${level.originPrice.toFixed(6)}:${new Date(level.originTime).toISOString()}`;
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

export function scanEntry(args: ScanEntryArgs): { alerts: Alert[]; events: EngineEvent[] } {
  const { pair, entryTf, tfSeconds, candles, snaps, cfg, mode, provider } = args;
  const alerts: Alert[] = [];
  const events: EngineEvent[] = [];
  if (candles.length < cfg.pivotLeft + cfg.pivotRight + 6) return { alerts, events };

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
            setupId: setupId(provider, pair, entryTf, d, lv),
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
            cur.setupId = setupId(provider, pair, entryTf, d, origin);
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
          const returns = isShort ? c.h >= z.zoneLo - tol : c.l <= z.zoneHi + tol;
          if (cur.leftZone && returns) {
            // opposing liquidity must remain standing for reversal setups
            let standing = false;
            if (cur.drawOnLiquidity !== null) {
              const seg = candles.slice(cur.mapIndex, i + 1);
              standing = isShort
                ? seg.every((x) => x.l > (cur.drawOnLiquidity as number))
                : seg.every((x) => x.h < (cur.drawOnLiquidity as number));
            }
            const alert = buildAlert({
              pair, entryTf, closeTime, c, s: cur, isShort,
              atrE, cfg, mode, standing, provider,
            });
            if (alert) {
              emit(cur, "RETEST", c, `return to origin zone → confirmation entry @ ${c.c}`);
              alerts.push(alert);
            }
            active[d] = null;
            continue;
          }
        }
        if (i - cur.bosIndex > cfg.retestWindow) {
          kill(cur, "EXPIRED", c, "no retest of the origin zone");
          continue;
        }
      }
    }
  }

  return { alerts, events };
}

interface BuildAlertArgs {
  pair: string; entryTf: string; closeTime: number; c: Candle; s: Setup;
  isShort: boolean; atrE: number; cfg: StrategyConfig;
  mode: "paper" | "live"; standing: boolean; provider: string;
}

/** Pick the internal-liquidity target (tp1) and external drawback (tp2) for
 *  a setup. Exported for tests. Direction-sanity: the external draw is picked
 *  at STORYLINE-map time and price can run past it before the retest entry
 *  fires — a target on the wrong side of the entry is meaningless, so it is
 *  dropped rather than stored (production: a SHORT XAUUSD alert shipped with
 *  tp above entry and later "resolved" as TP_HIT at -1.2R). */
export function selectTargets(args: {
  isShort: boolean; entry: number; risk: number; minTpR: number;
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
    // internal target too close — target the external draw directly
    tp1 = tp2;
    tp2 = null;
    rr1 = Math.abs(tp1 - args.entry) / args.risk;
  }
  if (rr1 < args.minTpR) return null;
  return { tp1, tp2 };
}

function buildAlert(a: BuildAlertArgs): Alert | null {
  const { pair, entryTf, closeTime, c, s, isShort, atrE, cfg, mode, standing, provider } = a;
  const entry = c.c;
  const buf = cfg.slBufferAtr * atrE;
  const sl = isShort ? s.invLevel + buf : s.invLevel - buf;
  const risk = isShort ? sl - entry : entry - sl;
  if (risk <= 0 || risk < cfg.minRiskAtr * atrE) return null;

  // targets: internal liquidity first, then the nearest external target
  const targets = selectTargets({
    isShort, entry, risk, minTpR: cfg.minTpR,
    internalPools: s.internalPools, nearestExternalTarget: s.nearestExternalTarget,
  });
  if (!targets) return null;
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

  return {
    setupId: s.setupId, pair, entryTf, mapTf: cfg.mapTfLabel,
    direction: s.direction, entry, stopLoss: sl,
    tpInternal: tp1, tpExternal: tp2, candleCloseTime: closeTime,
    environment: s.environment, phase: s.phase, htfAlignment: s.htfAlignment,
    originKeyLevel: s.level.originPrice, keyLevelType: s.level.kind,
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
  };
}
