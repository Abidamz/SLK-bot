import { describe, expect, it } from "vitest";
import { inducementPresent, rejectionClose } from "../src/engine";
import type { Candle } from "../src/types";

const c = (t: number, o: number, cl: number, hp = 1, lp = 1): Candle =>
  ({ t, o, h: Math.max(o, cl) + hp, l: Math.min(o, cl) - lp, c: cl });

describe("rejectionClose", () => {
  it("long: wick into the zone but close back above the zone top", () => {
    const wick = c(1, 105, 106.5, 1, 4); // low 101, inside zone [100,104]
    expect(rejectionClose(wick, 100, 104, false)).toBe(true);
  });
  it("long: a candle that closes inside the zone is a visit, not a rejection", () => {
    const inside = c(1, 105, 102, 1, 4);
    expect(rejectionClose(inside, 100, 104, false)).toBe(false);
  });
  it("short: mirror image", () => {
    const wick = c(1, 95, 93.5, 4, 1); // high 99, inside zone [96,100]
    expect(rejectionClose(wick, 96, 100, true)).toBe(true);
    const inside = c(1, 95, 98, 4, 1);
    expect(rejectionClose(inside, 96, 100, true)).toBe(false);
  });
});

describe("inducementPresent", () => {
  // Pullback leg for a long: decline with a bounce that leaves an internal
  // swing low at 105.8, above the zone top 104 — the magnet price sweeps
  // before the zone itself is tagged.
  const legLong: Candle[] = [
    c(1, 110, 109),          // l 108
    c(2, 109, 107),          // l 106
    c(3, 107, 106, 1, 0.2),  // l 105.8  <- swing low
    c(4, 106, 108, 1, 0.05), // l 105.95 (higher than 105.8, confirms swing)
    c(5, 108, 104.5),        // l 103.5, tags the zone
  ];
  it("long: an internal low between zone and leg extreme counts", () => {
    expect(inducementPresent(legLong, 0, legLong.length, 100, 104, false)).toBe(true);
  });
  it("long: a monotonic leg has no internal magnet", () => {
    const leg: Candle[] = [c(1, 110, 109), c(2, 109, 108), c(3, 108, 107), c(4, 107, 106), c(5, 106, 104.5)];
    expect(inducementPresent(leg, 0, leg.length, 100, 104, false)).toBe(false);
  });
  it("short: mirror image with an internal high below the zone", () => {
    const leg: Candle[] = [
      c(1, 90, 91),           // h 92
      c(2, 91, 93),           // h 94
      c(3, 93, 94, 0.2, 1),   // h 94.2 <- swing high
      c(4, 93.8, 92, 0.05, 1),// h 93.85 (lower than 94.2, confirms swing)
      c(5, 92, 95.5),         // h 96.5, tags the zone
    ];
    expect(inducementPresent(leg, 0, leg.length, 96, 100, true)).toBe(true);
    const flat: Candle[] = [c(1, 90, 91), c(2, 91, 92), c(3, 92, 93), c(4, 93, 94), c(5, 94, 95.5)];
    expect(inducementPresent(flat, 0, flat.length, 96, 100, true)).toBe(false);
  });
  it("a swing on the far side of the zone is not inducement", () => {
    // zone top raised above the swing low: the magnet sits inside the zone
    expect(inducementPresent(legLong, 0, legLong.length, 100, 106.5, false)).toBe(false);
  });
});
