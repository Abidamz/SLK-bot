import { describe, expect, it } from "vitest";
import {
  biasGate,
  confirmationEvent,
  engulfingDirection,
  engulfingEvent,
  isEngulfing,
  rejectionClosure,
  sweepEvent,
  type BiasTier,
} from "../src/bias_gate";
import { storylineTiers } from "../src/bias_gate";
import { defaultStrategy } from "../src/config";
import type { Candle, KeyLevel } from "../src/types";

const H = 3_600_000;

function candle(i: number, o: number, h: number, l: number, c: number): Candle {
  return { t: i * H, o, h, l, c };
}

function level(o: Partial<KeyLevel> & { originIndex: number; price: number; tol?: number }): KeyLevel {
  const tol = o.tol ?? 0.001;
  const { price, tol: _tol, ...rest } = o;
  return {
    flipDir: null,
    kind: "V",
    originPrice: price,
    zoneLo: price - tol,
    zoneHi: price + tol,
    originTime: o.originIndex * H,
    touches: 0,
    flipped: false,
    fvgOverlap: false,
    ...rest,
  };
}

describe("engulfing — the body covers the previous body, wicks irrelevant", () => {
  // prev is bullish with a body of [1.1000, 1.1020] inside a range of
  // [1.0950, 1.1050].
  const prev = candle(0, 1.1000, 1.1050, 1.0950, 1.1020);

  it("covers the previous body and ignores the wicks entirely", () => {
    // Body [1.0990, 1.1030] covers [1.1000, 1.1020], and the whole candle sits
    // inside the previous range — the wicks are not engulfed, and that does
    // not matter.
    expect(isEngulfing(candle(1, 1.1030, 1.1040, 1.0980, 1.0990), prev)).toBe(true);
    // Wicks well beyond the previous range still qualify, of course.
    expect(isEngulfing(candle(1, 1.1030, 1.1090, 1.0900, 1.0990), prev)).toBe(true);
  });

  it("is a reversal pattern, so the two candles must be opposite colours", () => {
    // A bigger green candle on top of a green candle is momentum, not an
    // engulfing, even though its body covers the previous one outright.
    expect(isEngulfing(candle(1, 1.0980, 1.1100, 1.0970, 1.1090), prev)).toBe(false);
  });

  it("needs the coverage to be genuine rather than a shared boundary", () => {
    // Bearish body [1.1000, 1.1020] exactly matches the previous body.
    expect(isEngulfing(candle(1, 1.1020, 1.1030, 1.0990, 1.1000), prev)).toBe(false);
    // Covers the top of the previous body but leaves the bottom exposed.
    expect(isEngulfing(candle(1, 1.1030, 1.1040, 1.1000, 1.1005), prev)).toBe(false);
    // Covers the bottom but leaves the top exposed.
    expect(isEngulfing(candle(1, 1.0995, 1.1015, 1.0980, 1.0998), prev)).toBe(false);
  });

  it("has nothing to say when either candle is a doji", () => {
    const doji = candle(0, 1.1000, 1.1050, 1.0950, 1.1000);
    // No body to engulf.
    expect(isEngulfing(candle(1, 1.1030, 1.1040, 1.0980, 1.0990), doji)).toBe(false);
    // No body to engulf with.
    expect(isEngulfing(candle(1, 1.1030, 1.1040, 1.0980, 1.1030), prev)).toBe(false);
  });

  it("takes direction from the engulfing candle's own close", () => {
    expect(engulfingDirection(candle(0, 1.00, 1.02, 0.99, 1.015))).toBe("LONG");
    expect(engulfingDirection(candle(0, 1.02, 1.03, 0.98, 0.99))).toBe("SHORT");
    expect(engulfingDirection(candle(0, 1.00, 1.03, 0.98, 1.00))).toBeNull();
  });

  it("finds the most recent engulfing in the requested direction only", () => {
    const cs = [
      candle(0, 1.1000, 1.1050, 1.0950, 1.1020), // bullish body [1.1000, 1.1020]
      candle(1, 1.1030, 1.1040, 1.0980, 1.0990), // bearish engulfing
      candle(2, 1.0990, 1.1080, 1.0985, 1.1070), // bullish engulfing of candle 1
      candle(3, 1.1070, 1.1090, 1.1040, 1.1080), // same colour as 2: momentum
    ];
    expect(engulfingEvent(cs, "LONG", 4)?.index).toBe(2);
    expect(engulfingEvent(cs, "SHORT", 4)?.index).toBe(1);
    // Outside the lookback window it is not reported.
    expect(engulfingEvent(cs, "LONG", 1)).toBeNull();
  });
});

describe("sweep — a wick beyond the extreme with the close back inside", () => {
  // findSwings scans i in [left, n-right-1], so the pivot sits at index 2 with
  // two bars of room either side and the raid lands after it.
  const cs = [
    candle(0, 1.1000, 1.1010, 1.0950, 1.0980),
    candle(1, 1.0980, 1.0990, 1.0900, 1.0930),
    candle(2, 1.0930, 1.0940, 1.0800, 1.0860), // pivot low 1.0800
    candle(3, 1.0860, 1.0920, 1.0840, 1.0900),
    candle(4, 1.0900, 1.0930, 1.0860, 1.0910),
    candle(5, 1.0910, 1.0920, 1.0820, 1.0880),
    candle(6, 1.0880, 1.0930, 1.0790, 1.0910), // wick below 1.0800, closes above
  ];

  it("counts a raid on the low that closes back above as a bullish sweep", () => {
    expect(sweepEvent(cs, "LONG", 2, 2, 6)?.index).toBe(6);
  });

  it("does not report a sweep in the opposite direction", () => {
    expect(sweepEvent(cs, "SHORT", 2, 2, 6)).toBeNull();
  });

  it("is not a sweep when the candle closes beyond the extreme", () => {
    const broke = [...cs.slice(0, 6), candle(6, 1.0880, 1.0930, 1.0790, 1.0795)];
    expect(sweepEvent(broke, "LONG", 2, 2, 6)).toBeNull();
  });
});

describe("rejection with candle closure at a key level", () => {
  const support = level({ originIndex: 0, price: 1.0900 });
  // tol 0.001 puts the zone at [1.0890, 1.0910]. Candle 1 stays clear of it so
  // the only rejection in the series is the one under test at index 2.
  const cs = [
    candle(0, 1.0900, 1.0950, 1.0880, 1.0930),
    candle(1, 1.0930, 1.0940, 1.0915, 1.0920),
    candle(2, 1.0920, 1.0930, 1.0895, 1.0925), // dips into the zone, closes above
  ];

  it("reads a dip into the zone that closes above it as a bullish rejection", () => {
    const r = rejectionClosure(cs, [support], 3);
    expect(r?.dir).toBe("LONG");
    expect(r?.index).toBe(2);
  });

  it("needs the closure — a wick into the zone that closes inside is not a rejection", () => {
    // Closes inside the zone [1.0899, 1.0901] — a touch, not a rejection.
    const touched = [...cs.slice(0, 2), candle(2, 1.0920, 1.0930, 1.0895, 1.0900)];
    expect(rejectionClosure(touched, [support], 3)).toBeNull();
  });

  it("reads the mirror at resistance as a bearish rejection", () => {
    const resistance = level({ originIndex: 0, price: 1.1000, kind: "A" });
    const bearish = [
      candle(0, 1.0980, 1.1000, 1.0960, 1.0975),
      candle(1, 1.0975, 1.1005, 1.0965, 1.0970), // pokes above the zone, closes below
    ];
    expect(rejectionClosure(bearish, [resistance], 2)?.dir).toBe("SHORT");
  });

  it("ignores a level that has not formed yet at the rejection candle", () => {
    const future = level({ originIndex: 5, price: 1.0900 });
    expect(rejectionClosure(cs, [future], 3)).toBeNull();
  });
});

describe("confirmation one timeframe lower — three interchangeable forms", () => {
  const bearish = "SHORT" as const;

  it("accepts an engulfing on its own", () => {
    const cs = [
      candle(0, 1.1000, 1.1050, 1.0950, 1.1020),
      candle(1, 1.1030, 1.1060, 1.0940, 1.0950), // bearish engulfing
    ];
    expect(confirmationEvent(cs, [], bearish, { lookback: 2 })?.kind).toBe("engulfing");
  });

  it("accepts a disrespected level that price returns to and closes through", () => {
    const flipped = level({ originIndex: 0, price: 1.1000, flipped: true, kind: "V" });
    const cs = [
      candle(0, 1.1000, 1.1010, 1.0980, 1.0990),
      candle(1, 1.0990, 1.1005, 1.0970, 1.0975), // taps up into the zone, closes below
    ];
    expect(confirmationEvent(cs, [flipped], bearish, { lookback: 2 })?.kind).toBe("flipped_level");
  });

  it("does not treat an unflipped level as form three", () => {
    const plain = level({ originIndex: 0, price: 1.1000, kind: "V" });
    const cs = [
      candle(0, 1.1000, 1.1010, 1.0980, 1.0990),
      candle(1, 1.0990, 1.1005, 1.0970, 1.0975),
    ];
    expect(confirmationEvent(cs, [plain], bearish, { lookback: 2 })).toBeNull();
  });

  it("prefers sweep-and-break over engulfing when both are present", () => {
    //  o       h       l       c
    const cs = [
      candle(0, 1.1000, 1.1000, 1.0980, 1.0990),
      candle(1, 1.0990, 1.1050, 1.0990, 1.1040),
      candle(2, 1.1040, 1.1120, 1.1000, 1.1100), // pivot high 1.1120
      candle(3, 1.1100, 1.1080, 1.0950, 1.0960),
      candle(4, 1.0960, 1.1060, 1.0900, 1.0950), // pivot low 1.0900
      candle(5, 1.0950, 1.1130, 1.0940, 1.1050), // wick above 1.1120, closes below: sweep
      candle(6, 1.1100, 1.1150, 1.0920, 1.0945), // body [1.0945, 1.1100] covers candle 5
      candle(7, 1.0960, 1.0980, 1.0880, 1.0880), // closes below 1.0900: break down
    ];
    expect(confirmationEvent(cs, [], bearish, { lookback: 6, sweptLookback: 8 })?.kind)
      .toBe("sweep_bos");
    // Sanity: the engulfing is genuinely there, so the preference is real
    // rather than form two simply failing to match.
    expect(engulfingEvent(cs, "SHORT", 6)?.index).toBe(6);
  });

  it("returns null when the confirmation runs against the bias", () => {
    const cs = [
      candle(0, 1.1000, 1.1050, 1.0950, 1.0960),
      candle(1, 1.0950, 1.1070, 1.0940, 1.1060), // bullish engulfing
    ];
    expect(confirmationEvent(cs, [], bearish, { lookback: 2 })).toBeNull();
  });
});

describe("biasGate — origin timeframe plus one lower", () => {
  const support = level({ originIndex: 0, price: 1.0900 });
  const weekly = [
    candle(0, 1.0900, 1.0950, 1.0880, 1.0930),
    candle(1, 1.0930, 1.0940, 1.0895, 1.0925), // rejection + close above
  ];
  const dailyConfirm = [
    candle(0, 1.1050, 1.1060, 1.0940, 1.0950), // bearish body [1.0950, 1.1050]
    candle(1, 1.0940, 1.1080, 1.0930, 1.1070), // bullish engulfing of that body
  ];

  const tier = (tf: string, candles: Candle[], levels: KeyLevel[] = []): BiasTier =>
    ({ tf, candles, levels });

  it("binds the rejection to the origin timeframe and the confirmation to the next one down", () => {
    const ev = biasGate([tier("w1", weekly, [support]), tier("d1", dailyConfirm)]);
    expect(ev?.dir).toBe("LONG");
    expect(ev?.originTf).toBe("w1");
    expect(ev?.confirmTf).toBe("d1");
    expect(ev?.confirmation).toBe("engulfing");
  });

  it("returns no bias when the origin rejects but nothing confirms below", () => {
    const flat = [candle(0, 1.1000, 1.1010, 1.0990, 1.1005), candle(1, 1.1005, 1.1015, 1.0995, 1.1010)];
    expect(biasGate([tier("w1", weekly, [support]), tier("d1", flat)])).toBeNull();
  });

  it("returns no bias when the lower timeframe confirms but the origin never rejected", () => {
    const flat = [candle(0, 1.1000, 1.1010, 1.0990, 1.1005), candle(1, 1.1005, 1.1015, 1.0995, 1.1010)];
    expect(biasGate([tier("w1", flat), tier("d1", dailyConfirm)])).toBeNull();
  });

  it("takes the highest origin that works, so monthly outranks weekly", () => {
    const monthly = [
      candle(0, 1.0900, 1.0950, 1.0880, 1.0930),
      candle(1, 1.0930, 1.0945, 1.0895, 1.0940),
    ];
    const ev = biasGate([
      tier("m1", monthly, [support]),
      tier("w1", dailyConfirm), // also confirms, but a lower origin
      tier("d1", dailyConfirm),
    ]);
    expect(ev?.originTf).toBe("m1");
    expect(ev?.confirmTf).toBe("w1");
  });

  it("falls through to a lower origin when the monthly is unclear", () => {
    const unclear = [candle(0, 1.1000, 1.1010, 1.0990, 1.1005), candle(1, 1.1005, 1.1015, 1.0995, 1.1010)];
    const ev = biasGate([
      tier("m1", unclear),
      tier("w1", weekly, [support]),
      tier("d1", dailyConfirm),
    ]);
    expect(ev?.originTf).toBe("w1");
    expect(ev?.confirmTf).toBe("d1");
  });

  it("does not require a monthly tier to exist at all", () => {
    const ev = biasGate([tier("d1", weekly, [support]), tier("h4", dailyConfirm)]);
    expect(ev?.originTf).toBe("d1");
  });

  it("gives no bias on an empty tier list", () => {
    expect(biasGate([])).toBeNull();
  });
});

describe("storylineTiers — key levels attached per timeframe", () => {
  // A zigzag: down to 1.0900, back up to 1.1300, down to 1.0900, back up. That
  // gives keyLevels two V troughs, two A peaks, and open-close overlaps at the
  // turns — enough of each kind to filter meaningfully.
  const CLOSES = [
    1.1200, 1.1150, 1.1100, 1.1050, 1.1000, 1.0950, 1.0900,
    1.0950, 1.1000, 1.1050, 1.1100, 1.1150, 1.1200, 1.1250, 1.1300,
    1.1250, 1.1200, 1.1150, 1.1100, 1.1050, 1.1000, 1.0950, 1.0900,
    1.0950, 1.1000, 1.1050, 1.1100, 1.1150, 1.1200, 1.1250,
  ];
  const d1: Candle[] = CLOSES.map((c, i) => {
    const o = i === 0 ? c + 0.005 : CLOSES[i - 1];
    return { t: i * 86400_000, o, h: Math.max(o, c) + 0.005, l: Math.min(o, c) - 0.005, c };
  });
  // One wide-range bar, so keyLevels emits a DECISION zone as well.
  d1[10] = { ...d1[10], h: d1[10].c + 0.03, l: d1[10].c - 0.03 };
  const cfg = defaultStrategy();

  it("keeps the order it was given, which is the rule itself", () => {
    const tiers = storylineTiers([{ tf: "d1", candles: d1 }, { tf: "h4", candles: d1.slice(0, 20) }], cfg);
    expect(tiers.map((t) => t.tf)).toEqual(["d1", "h4"]);
    expect(tiers[0].levels.length).toBeGreaterThan(0);
  });

  it("finds A, V and OC levels in a zigzag", () => {
    const kinds = new Set(storylineTiers([{ tf: "d1", candles: d1 }], cfg)[0].levels.map((l) => l.kind));
    expect(kinds.has("A")).toBe(true);
    expect(kinds.has("V")).toBe(true);
    expect(kinds.has("OC")).toBe(true);
  });

  it("excludes DECISION zones by default and takes them when asked", () => {
    const byDefault = storylineTiers([{ tf: "d1", candles: d1 }], cfg)[0].levels;
    expect(byDefault.some((l) => l.kind === "DECISION")).toBe(false);
    const asked = storylineTiers([{ tf: "d1", candles: d1 }], cfg, { kinds: ["DECISION"] })[0].levels;
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((l) => l.kind === "DECISION")).toBe(true);
  });

  it("honours minTouches", () => {
    const all = storylineTiers([{ tf: "d1", candles: d1 }], cfg)[0].levels;
    expect(all.length).toBeGreaterThan(0);
    expect(storylineTiers([{ tf: "d1", candles: d1 }], cfg, { minTouches: 999 })[0].levels).toEqual([]);
  });

  it("gives a two-candle stub no levels at all", () => {
    const tiers = storylineTiers([{ tf: "mo", candles: d1.slice(0, 2) }], cfg);
    expect(tiers[0].candles.length).toBe(2);
    expect(tiers[0].levels).toEqual([]);
  });
});
