import { describe, it, expect } from "vitest";
import { defaultStrategy } from "../src/config";
import * as F from "../src/features";
import type { Candle, KeyLevel } from "../src/types";

describe("origin level recency and proximity prioritization", () => {
  it("favors fresh, closer structure over stale 4-day-old levels with historic FVG", () => {
    const cfg = defaultStrategy();
    const atr = 20.0;

    // Stale level from 4 days ago (e.g. XAUUSD 4394.03 from Sept 18)
    const staleLevel: KeyLevel = {
      kind: "OC",
      originPrice: 4394.03,
      zoneLo: 4390.0,
      zoneHi: 4398.0,
      originTime: Date.parse("2026-09-18T04:00:00.000Z"),
      originIndex: 10,
      touches: 3,
      flipped: false,
      fvgOverlap: true, // Historic FVG from last week
    };

    // Fresh breakdown level from yesterday (e.g. XAUUSD 4355.0 from Sept 21)
    const freshBreaker: KeyLevel = {
      kind: "V",
      originPrice: 4355.0,
      zoneLo: 4352.0,
      zoneHi: 4358.0,
      originTime: Date.parse("2026-09-21T16:00:00.000Z"),
      originIndex: 95,
      touches: 1,
      flipped: true, // Flipped support into resistance
      fvgOverlap: false,
    };

    // Price is currently breaking down at 4325.0
    const currentPrice = 4325.0;
    const selected = F.selectOrigin([staleLevel, freshBreaker], currentPrice, atr, "SHORT", cfg);

    expect(selected).not.toBeNull();
    expect(selected?.originPrice).toBe(4355.0);
    expect(selected?.flipped).toBe(true);
  });

  it("disqualifies levels exceeding zoneMaxDistanceAtr", () => {
    const cfg = defaultStrategy();
    const atr = 10.0; // 3.5 ATR = 35 points max

    const farLevel: KeyLevel = {
      kind: "OC",
      originPrice: 4394.03,
      zoneLo: 4390.0,
      zoneHi: 4398.0,
      originTime: Date.parse("2026-09-18T04:00:00.000Z"),
      originIndex: 10,
      touches: 3,
      flipped: false,
      fvgOverlap: true,
    };

    // Price is at 4325.0 -> distance is 4390 - 4325 = 65 points (6.5 ATR > 3.5 ATR)
    const currentPrice = 4325.0;
    const selected = F.selectOrigin([farLevel], currentPrice, atr, "SHORT", cfg);

    expect(selected).toBeNull();
  });

  it("findRetracementOrigin finds local 1H/30m breaker before distant H4 origin", () => {
    const cfg = defaultStrategy();
    const baseTime = Date.parse("2026-09-22T00:00:00.000Z");

    // 1H feed with recent breakdown around 4355
    const h1Candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const t = baseTime - (30 - i) * 3600_000;
      const isConsolidation = i >= 20 && i <= 25;
      h1Candles.push({
        t,
        o: isConsolidation ? 4355 : 4340 + (30 - i),
        h: isConsolidation ? 4360 : 4345 + (30 - i),
        l: isConsolidation ? 4350 : 4335 + (30 - i),
        c: isConsolidation ? 4355 : 4338 + (30 - i),
      });
    }

    const feeds = { "1h": h1Candles };
    const origin = F.findRetracementOrigin(feeds, "SHORT", 4325.0, cfg);

    expect(origin).not.toBeNull();
    // Origin should be near the consolidation zone (4350-4360), not hundreds of points away
    expect(origin!.originPrice).toBeGreaterThanOrEqual(4330);
    expect(origin!.originPrice).toBeLessThanOrEqual(4380);
  });
});
