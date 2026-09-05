/** Layer 1 — ABC storyline (expectation). Port of slk_bot/slk/storyline.py.
 *  Snapshots are built point-in-time: each H4 close gets a storyline made
 *  only from data closed at that moment. */
import * as F from "./features";
import type { Candle, Direction, Storyline } from "./types";
import type { StrategyConfig } from "./config";

export const MAP_TF_SECONDS = 14400; // H4

export function buildStoryline(d1: Candle[], h4: Candle[], cfg: StrategyConfig): Storyline {
  const asof = h4.length ? h4[h4.length - 1].t : Date.now();
  const base: Storyline = {
    asof, valid: false, reason: "", direction: null,
    environment: "consolidation", phase: "range", htfAlignment: "",
    origin: null, drawOnLiquidity: null, nearestExternalTarget: null,
    internalPools: [], externalPools: [], imbalances: [], mapClose: 0,
  };
  if (h4.length < 20) return { ...base, reason: "insufficient H4 data" };
  if (d1.length < 10) return { ...base, reason: "insufficient daily data" };

  const env = F.environment(h4, cfg.pivotLeft, cfg.pivotRight, cfg.minSwingsEnv);
  const ph = F.phase(h4, env, cfg.phaseLookback, cfg.pivotLeft, cfg.pivotRight);
  const align = F.htfAlignment(d1, env, cfg.pivotLeft, cfg.pivotRight);
  const close = h4[h4.length - 1].c;

  let direction: Direction | null = null;
  if (env === "bullish") direction = "LONG";
  else if (env === "bearish") direction = "SHORT";
  const story: Storyline = { ...base, environment: env, phase: ph, htfAlignment: align, mapClose: close, direction };

  if (!direction) return { ...story, reason: "no directional H4 environment (consolidation)" };

  // HTF invalidation: close through opposing structure kills the story
  const inv = F.structureInvalidationLevel(h4, direction, cfg.pivotLeft, cfg.pivotRight);
  if (inv !== null) {
    if (direction === "SHORT" && close > inv)
      return { ...story, reason: `H4 close ${close} broke opposing structure ${inv}` };
    if (direction === "LONG" && close < inv)
      return { ...story, reason: `H4 close ${close} broke opposing structure ${inv}` };
  }

  const atrMap = F.atr(h4, cfg.atrPeriod);
  const ext = F.externalPools(d1, cfg.pivotLeft, cfg.pivotRight);
  const intp = F.internalPools(h4, atrMap, cfg.decisionAtrMult, cfg.pivotLeft, cfg.pivotRight);
  const imb = F.fvgZones(h4, cfg.fvgLookback);
  const levels = F.keyLevels(h4, cfg);
  F.markFvgOverlap(levels, imb);

  const origin = F.selectOrigin(levels, close, atrMap, direction, cfg);
  if (!origin) return { ...story, reason: "no origin key level within reach of price" };

  // draw on liquidity: nearest external pool in the storyline direction
  let draw: number | null = null;
  if (direction === "SHORT") {
    const below = ext.filter((p) => p.side === "sellside" && p.price < close);
    if (below.length) draw = Math.max(...below.map((p) => p.price));
  } else {
    const above = ext.filter((p) => p.side === "buyside" && p.price > close);
    if (above.length) draw = Math.min(...above.map((p) => p.price));
  }
  if (draw === null) return { ...story, reason: "no external draw on liquidity in storyline direction" };

  return {
    ...story,
    valid: true,
    reason: "ok",
    origin,
    drawOnLiquidity: draw,
    nearestExternalTarget: draw,
    internalPools: intp,
    externalPools: ext,
    imbalances: imb,
  };
}

/** Storyline snapshots at each recent closed H4 candle (point-in-time). */
export function storylineSeries(
  d1: Candle[], h4: Candle[], cfg: StrategyConfig, maxSnapshots = 90,
): [number, Storyline][] {
  const n = h4.length;
  const start = Math.max(20, n - maxSnapshots);
  const snaps: [number, Storyline][] = [];
  const day = 86400 * 1000;
  for (let j = start; j < n; j++) {
    const h4Close = h4[j].t + MAP_TF_SECONDS * 1000;
    const dSlice = d1.filter((d) => d.t + day <= h4Close);
    if (dSlice.length < 10) continue;
    snaps.push([h4[j].t, buildStoryline(dSlice, h4.slice(0, j + 1), cfg)]);
  }
  return snaps;
}
