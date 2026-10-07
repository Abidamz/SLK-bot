/** Diagnostics-only coverage for the H4 vantage confluence tags, the UTC+1
 *  session buckets, and the aligned BREAKOUT_CONTINUATION shadow experiment.
 *
 *  These annotations are observation metadata: nothing asserted here may ever
 *  create, suppress, delay, or gate a live/paper alert. */
import { describe, expect, it } from "vitest";
import {
  buildH4VantageConfluence, diagnosticTagsForRow, sessionBucketUtcPlus1,
  H4_BREAKOUT_RECENCY_BARS, SESSION_BUCKETS,
} from "../src/h4_context";
import { defaultStrategy } from "../src/config";
import { scanEntry, buildBreakoutContinuationExperiment } from "../src/engine";
import { mkCandles, SHORT_ROWS, SHORT_STORY, snapsFor } from "./fixtures";
import type { Candle } from "../src/types";

const H4 = 240; // minutes per H4 candle

/** Bullish fixture: a confirmed swing high at 102.6 (index 4), a pullback, then
 *  a breakout candle (index 12) that closes above it and leaves a 3-candle
 *  bullish FVG [101.8, 102.6] with an OC key level inside it. */
const BULL_H4_ROWS: [number, number, number, number][] = [
  [101.0, 101.2, 100.8, 101.1],
  [101.1, 101.3, 100.9, 101.0],
  [101.0, 101.1, 100.7, 100.8],
  [100.8, 101.0, 100.6, 100.9],
  [100.9, 102.6, 100.8, 102.4], // confirmed swing high 102.6
  [102.4, 102.5, 102.0, 102.1],
  [102.1, 102.2, 101.9, 102.0],
  [102.0, 102.1, 101.7, 101.8],
  [101.8, 102.0, 101.6, 101.9],
  [101.9, 102.0, 101.7, 101.8],
  [101.8, 102.0, 101.5, 101.6],
  [101.6, 101.8, 101.4, 101.5], // prev.h = 101.8 → FVG floor
  [101.5, 103.1, 101.9, 103.0], // H4 breakout candle (body close > 102.6)
  [102.5, 103.3, 102.6, 103.1], // next.l = 102.6 → FVG ceiling
  [103.1, 103.4, 103.0, 103.2],
];

/** Mirror OHLC around a pivot so a bullish fixture becomes an identical
 *  bearish one (highs and lows swap). */
function mirrorRows(
  rows: [number, number, number, number][], pivot: number,
): [number, number, number, number][] {
  return rows.map(([o, h, l, c]) => [2 * pivot - o, 2 * pivot - l, 2 * pivot - h, 2 * pivot - c]);
}

const H4_BREAKOUT_TIME = Date.parse("2024-03-06T00:00:00.000Z"); // H4 index 12

/** Entry-TF (30m) pullback: confirmed swing low at 102.45, a sweep of it at
 *  index 8, then a rebalance into the H4 FVG [101.8, 102.6] on the latest
 *  closed candle (index 10). */
const ENTRY_ROWS: [number, number, number, number][] = [
  [103.05, 103.10, 102.95, 103.00],
  [103.00, 103.05, 102.85, 102.90],
  [102.90, 102.95, 102.70, 102.75],
  [102.75, 102.80, 102.55, 102.60],
  [102.60, 102.65, 102.45, 102.50], // confirmed swing low 102.45
  [102.50, 102.60, 102.48, 102.55],
  [102.55, 102.65, 102.50, 102.60],
  [102.60, 102.70, 102.55, 102.65],
  [102.65, 102.70, 102.40, 102.50], // sweep of 102.45, closes back above
  [102.50, 102.60, 102.42, 102.55],
  [102.55, 102.62, 102.30, 102.58], // rebalance: low 102.30 ≤ FVG ceiling 102.6
];

/** Entry-TF candles must be aligned after the H4 breakout candle's open time. */
function candlesFromRows(rows: [number, number, number, number][]): Candle[] {
  return rows.map(([o, h, l, c], i) => ({
    t: H4_BREAKOUT_TIME + i * 30 * 60_000, o, h, l, c,
  }));
}

function entryCandles(): Candle[] {
  return candlesFromRows(ENTRY_ROWS);
}

/** Breakout candle that closes through the swing high without leaving a
 *  3-candle gap at (or either side of) the breakout candle. */
const BARE_H4_ROWS: [number, number, number, number][] = BULL_H4_ROWS.map((row, i) => {
  if (i === 11) return [101.6, 103.0, 101.4, 102.5]; // wide, but no gap after it
  if (i === 12) return [102.5, 103.2, 101.9, 103.0]; // breakout close, no gap before it
  if (i === 13) return [103.0, 103.3, 102.6, 103.1];
  if (i === 14) return [103.1, 103.5, 103.0, 103.3];
  return row;
});

describe("UTC+1 session buckets", () => {
  it("maps candle open times to the six 4-hour buckets", () => {
    const at = (iso: string) => sessionBucketUtcPlus1(Date.parse(iso));
    expect(at("2024-03-04T00:00:00Z")).toBe("S00_04"); // 01:00 UTC+1
    expect(at("2024-03-04T02:59:00Z")).toBe("S00_04");
    expect(at("2024-03-04T03:00:00Z")).toBe("S04_08"); // 04:00 UTC+1
    expect(at("2024-03-04T05:00:00Z")).toBe("S04_08"); // 06:00 UTC+1 (Asia H4)
    expect(at("2024-03-04T07:00:00Z")).toBe("S08_12");
    expect(at("2024-03-04T12:00:00Z")).toBe("S12_16");
    expect(at("2024-03-04T16:00:00Z")).toBe("S16_20");
    expect(at("2024-03-04T20:00:00Z")).toBe("S20_24");
    expect(at("2024-03-04T23:00:00Z")).toBe("S00_04"); // 00:00 UTC+1 next day
    expect(new Set(SESSION_BUCKETS).size).toBe(6);
  });

  it("appends the bucket tag after the scan-level confluence tags", () => {
    expect(diagnosticTagsForRow({ ...buildH4VantageConfluence([], defaultStrategy()), tags: ["X"] }, Date.parse("2024-03-04T03:00:00Z")))
      .toEqual(["X", "S04_08"]);
  });
});

describe("H4 vantage confluence (diagnostics only)", () => {
  const cfg = defaultStrategy();

  it("grades a key level inside the breakout FVG as plug-and-play", () => {
    const ctx = buildH4VantageConfluence(mkCandles(BULL_H4_ROWS, H4), cfg);
    expect(ctx.available).toBe(true);
    expect(ctx.breakoutDirection).toBe("bullish");
    expect(ctx.breakoutLevel).toBe(102.6);
    expect(ctx.breakoutTime).toBe(H4_BREAKOUT_TIME);
    expect(ctx.breakoutAgeBars).toBe(2);
    expect(ctx.fvg).toMatchObject({ lo: 101.8, hi: 102.6, direction: "bullish" });
    // key level of ANY kind (here the consecutive-body OC overlap) inside the FVG
    expect(ctx.keyLevelKind).toBe("OC");
    expect(ctx.keyLevelTag).toBe("H4_KL_OC");
    expect(ctx.keyLevelFvgOverlap).toBe(true);
    expect(ctx.grade).toBe("H4_PLUG_AND_PLAY");
    expect(ctx.tags).toContain("H4_PLUG_AND_PLAY");
    expect(ctx.tags).toContain("H4_KL_OC");
    expect(ctx.tags).toContain("H4_BREAKOUT_BULLISH");
  });

  it("records the breakout direction as an OBSERVATION_ONLY provisional bias when the daily read is unclear", () => {
    const ctx = buildH4VantageConfluence(mkCandles(BULL_H4_ROWS, H4), cfg);
    expect(ctx.observationOnly).toBe(true);
    expect(ctx.provisionalBias).toBe("LONG");
    expect(ctx.tags).toContain("OBSERVATION_ONLY");
    expect(ctx.tags).toContain("H4_PROVISIONAL_BIAS_LONG");

    // A clear (non-neutral, complete) daily bias removes the provisional marker.
    const daily: Candle[] = Array.from({ length: 24 }, (_, i) => ({
      t: Date.parse("2024-02-01T00:00:00Z") + i * 86_400_000,
      o: 110 - 0.5 * i, h: 110.4 - 0.5 * i, l: 109.6 - 0.5 * i, c: 109.9 - 0.5 * i,
    }));
    const withDaily = buildH4VantageConfluence(mkCandles(BULL_H4_ROWS, H4), cfg, daily);
    expect(withDaily.observationOnly).toBe(false);
    expect(withDaily.provisionalBias).toBeNull();
    expect(withDaily.tags).not.toContain("OBSERVATION_ONLY");
    expect(withDaily.grade).toBe("H4_PLUG_AND_PLAY");
  });

  it("grades a breakout without an FVG and a market without a breakout", () => {
    // Breakout candle closes through the swing high but no 3-candle gap forms.
    const bareCtx = buildH4VantageConfluence(mkCandles(BARE_H4_ROWS, H4), cfg);
    expect(bareCtx.breakoutDirection).toBe("bullish");
    expect(bareCtx.fvg).toBeNull();
    expect(bareCtx.grade).toBe("H4_BREAKOUT_BARE");
    expect(bareCtx.tags).toContain("H4_BREAKOUT_BARE");

    // A slow, structure-less drift has no breakout to grade.
    const drift: [number, number, number, number][] = Array.from({ length: 14 }, (_, i) => {
      const p = 100 + 0.01 * i;
      return [p, p + 0.05, p - 0.05, p] as [number, number, number, number];
    });
    const driftCtx = buildH4VantageConfluence(mkCandles(drift, H4), cfg);
    expect(driftCtx.grade).toBeNull();
    expect(driftCtx.breakoutDirection).toBeNull();
    expect(driftCtx.tags).toEqual(["H4_NO_BREAKOUT"]);

    // Too little H4 data: "unavailable", not "no breakout".
    const shortCtx = buildH4VantageConfluence(mkCandles(BULL_H4_ROWS.slice(0, 4), H4), cfg);
    expect(shortCtx.available).toBe(false);
    expect(shortCtx.tags).toEqual([]);
  });
});

describe("BREAKOUT_CONTINUATION shadow experiment (aligned sequence)", () => {
  const cfg = { ...defaultStrategy(), minStopPips: 0 };
  const h4Context = buildH4VantageConfluence(mkCandles(BULL_H4_ROWS, H4), cfg);

  function run(candles: Candle[], context = h4Context) {
    return scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles, snaps: [], cfg, mode: "paper", provider: "test", h4Context: context,
    });
  }

  it("records the zone-touch continuation entry with confluence tags and bucket", () => {
    const candles = entryCandles();
    const result = run(candles);
    expect(result.alerts).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.shadowExperiments).toHaveLength(1);

    const experiment = result.shadowExperiments[0];
    expect(experiment).toMatchObject({
      variant: "BREAKOUT_CONTINUATION",
      pair: "EURUSD",
      entryTf: "30m",
      direction: "LONG",
      entry: 102.58,
      h4ConfluenceGrade: "H4_PLUG_AND_PLAY",
      sessionBucket: "S04_08", // 05:00 UTC → 06:00 UTC+1
    });
    // Entry sits at the rebalance candle's close, the stop below the pullback
    // leg's extreme, and the target is the mapped 2.5R continuation draw.
    expect(experiment.stopLoss).toBeCloseTo(102.3 - cfg.slBufferAtr * 0.212, 6);
    expect(experiment.rr).toBeCloseTo(2.5, 6);
    expect(experiment.h4ConfluenceTags).toEqual([
      "H4_PLUG_AND_PLAY", "H4_KL_OC", "H4_BREAKOUT_BULLISH",
      "OBSERVATION_ONLY", "H4_PROVISIONAL_BIAS_LONG", "S04_08",
    ]);
    // Deterministic identity: replaying the same scan cannot mint a second row.
    expect(run(candles).shadowExperiments[0].experimentId).toBe(experiment.experimentId);
  });

  it("mirrors the whole sequence for a bearish H4 breakout", () => {
    const bearishH4 = mkCandles(mirrorRows(BULL_H4_ROWS, 101), H4);
    const bearishCtx = buildH4VantageConfluence(bearishH4, cfg);
    expect(bearishCtx.breakoutDirection).toBe("bearish");
    expect(bearishCtx.grade).toBe("H4_PLUG_AND_PLAY");
    expect(bearishCtx.tags).toContain("H4_BREAKOUT_BEARISH");

    const result = run(candlesFromRows(mirrorRows(ENTRY_ROWS, 101)), bearishCtx);
    expect(result.alerts).toEqual([]);
    expect(result.shadowExperiments).toHaveLength(1);
    const experiment = result.shadowExperiments[0];
    expect(experiment.direction).toBe("SHORT");
    expect(experiment.entry).toBeCloseTo(99.42, 6);
    expect(experiment.stopLoss).toBeGreaterThan(experiment.entry);
    expect(experiment.target).toBeLessThan(experiment.entry);
    expect(experiment.sessionBucket).toBe("S04_08");
  });

  it("requires the rebalance into the breakout's H4 FVG", () => {
    const rows = ENTRY_ROWS.map((r) => [...r] as [number, number, number, number]);
    rows[10] = [102.90, 102.95, 102.70, 102.92]; // never trades back into [101.8, 102.6]
    const result = run(candlesFromRows(rows));
    expect(result.shadowExperiments).toEqual([]);
  });

  it("requires a liquidity sweep between the breakout and the rebalance", () => {
    const rows = ENTRY_ROWS.map((r) => [...r] as [number, number, number, number]);
    // Rebalances into the FVG, but nothing ever trades below the only
    // confirmed swing low (102.45) → no sellside sweep to build on.
    rows[8] = [102.65, 102.70, 102.52, 102.62];
    rows[9] = [102.62, 102.65, 102.52, 102.55];
    rows[10] = [102.55, 102.62, 102.50, 102.58];
    const result = run(candlesFromRows(rows));
    expect(result.shadowExperiments).toEqual([]);
  });

  it("ignores a stale H4 breakout and a breakout with no FVG", () => {
    const stale = { ...h4Context, breakoutAgeBars: H4_BREAKOUT_RECENCY_BARS + 1 };
    expect(run(entryCandles(), stale).shadowExperiments).toEqual([]);

    const bare = buildH4VantageConfluence(mkCandles(BARE_H4_ROWS, H4), cfg);
    expect(bare.fvg).toBeNull();
    expect(run(entryCandles(), bare).shadowExperiments).toEqual([]);
  });

  it("is exported for direct replay verification without an EngineEvent or Alert", () => {
    const experiment = buildBreakoutContinuationExperiment({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: entryCandles(), cfg, atrE: 0.212, h4Context, story: null,
    });
    expect(experiment).toMatchObject({ variant: "BREAKOUT_CONTINUATION", direction: "LONG" });
    expect(buildBreakoutContinuationExperiment({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: entryCandles(), cfg, atrE: 0.212,
      h4Context: { ...h4Context, breakoutDirection: null, fvg: null },
    })).toBeNull();
  });
});

describe("setup rows carry the diagnostics tags", () => {
  it("annotates a confirmed alert with H4 confluence tags and its session bucket", () => {
    const cfg = { ...defaultStrategy(), minRiskAtr: 0.1 }; // parity fixtures carry a tiny stop
    const h4Context = buildH4VantageConfluence(mkCandles(mirrorRows(BULL_H4_ROWS, 104), H4), cfg);
    const result = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: mkCandles(SHORT_ROWS, 30), snaps: snapsFor(SHORT_STORY),
      cfg, mode: "paper", provider: "test", h4Context,
    });
    expect(result.alerts).toHaveLength(1);
    const alert = result.alerts[0];
    // The confirmation candle opens at 07:00 UTC → 08:00 UTC+1.
    expect(alert.sessionBucket).toBe("S08_12");
    expect(alert.h4ConfluenceTags).toEqual([
      "H4_PLUG_AND_PLAY", "H4_KL_OC", "H4_BREAKOUT_BEARISH",
      "OBSERVATION_ONLY", "H4_PROVISIONAL_BIAS_SHORT", "S08_12",
    ]);
    expect(alert.h4ConfluenceGrade).toBe("H4_PLUG_AND_PLAY");
    // The annotation is metadata only: the alert itself is unchanged.
    expect(alert.alertStatus).toBe("PAPER");
    expect(alert.direction).toBe("SHORT");
    expect(alert.entry).toBe(104.9);
  });
});
