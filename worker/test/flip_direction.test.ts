/** A flipped level changed ROLE, and the role has a direction: broke up means
 *  support now sits below (RBS), broke down means resistance now sits above
 *  (SBR). selectOrigin used to credit ANY flip at 1.0, so a level that broke
 *  downward - a bearish fact - lifted the score of a LONG's origin exactly as
 *  much as one that broke upward.
 *
 *  The fixtures are built so the flip is decisive: the agreeing flip is what
 *  makes the farther level win. If it stopped being decisive these tests would
 *  pass with the logic removed, so the margins are asserted too.
 */
import { describe, expect, it } from "vitest";
import { defaultStrategy } from "../src/config";
import { selectOrigin } from "../src/features";
import type { KeyLevel } from "../src/types";

const ATR = 10;
const PRICE = 1000;

function level(o: Partial<KeyLevel> & { zoneLo: number; zoneHi: number }): KeyLevel {
  return {
    kind: "V",
    originPrice: (o.zoneLo + o.zoneHi) / 2,
    originTime: 0,
    // Same index on both candidates, so recency cancels and only proximity and
    // the flip decide. Otherwise the test could pass on recency alone.
    originIndex: 50,
    touches: 0,
    flipped: false,
    flipDir: null,
    fvgOverlap: false,
    ...o,
  };
}

/** Below price (a long buys into it): near at 1.0 ATR, far at 2.0 ATR. */
const longCandidates = () => [
  level({ zoneLo: 985, zoneHi: 990 }),
  level({ zoneLo: 975, zoneHi: 980, flipped: true, flipDir: "down" }),
];

/** Above price (a short sells into it): same distances, mirrored. */
const shortCandidates = () => [
  level({ zoneLo: 1010, zoneHi: 1015 }),
  level({ zoneLo: 1020, zoneHi: 1025, flipped: true, flipDir: "down" }),
];

const cfgWith = (aware: boolean) => ({ ...defaultStrategy(), flipDirectionAware: aware });

describe("selectOrigin flip credit", () => {
  it("is decisive: the far level only wins because of its flip", () => {
    // Guard on the fixture. Same candidates, same direction, only the knob
    // differs: if the flip were not decisive both calls would pick the near
    // level, and every test below would pass with the logic deleted.
    const ignoring = selectOrigin(longCandidates(), PRICE, ATR, "LONG", cfgWith(true));
    const crediting = selectOrigin(longCandidates(), PRICE, ATR, "LONG", cfgWith(false));
    expect(ignoring?.zoneHi).toBe(990);   // near wins when the flip is not credited
    expect(crediting?.zoneHi).toBe(980);  // far wins ONLY because of its flip
  });

  it("credits a downward flip to a SHORT, which it agrees with", () => {
    // Broke down = resistance above = SBR. That is evidence for a short.
    const picked = selectOrigin(shortCandidates(), PRICE, ATR, "SHORT", cfgWith(true));
    expect(picked?.zoneLo).toBe(1020);
  });

  it("does not credit a downward flip to a LONG, which it contradicts", () => {
    // The defect. Same level, same flip, opposite trade: the bearish fact must
    // not make this level a better place to buy.
    const picked = selectOrigin(longCandidates(), PRICE, ATR, "LONG", cfgWith(true));
    expect(picked?.zoneHi).toBe(990);
  });

  it("leaves the shipped behaviour untouched when the knob is off", () => {
    // Off is the default, so live signals do not move until this is measured.
    expect(defaultStrategy().flipDirectionAware).toBe(false);
    expect(selectOrigin(longCandidates(), PRICE, ATR, "LONG", cfgWith(false))?.zoneHi)
      .toBe(980);
    expect(selectOrigin(shortCandidates(), PRICE, ATR, "SHORT", cfgWith(false))?.zoneLo)
      .toBe(1020);
  });

  it("credits an upward flip to a LONG, which it agrees with", () => {
    const levels = [
      level({ zoneLo: 985, zoneHi: 990 }),
      level({ zoneLo: 975, zoneHi: 980, flipped: true, flipDir: "up" }),
    ];
    expect(selectOrigin(levels, PRICE, ATR, "LONG", cfgWith(true))?.zoneHi).toBe(980);
  });

  it("does not credit an upward flip to a SHORT", () => {
    const levels = [
      level({ zoneLo: 1010, zoneHi: 1015 }),
      level({ zoneLo: 1020, zoneHi: 1025, flipped: true, flipDir: "up" }),
    ];
    expect(selectOrigin(levels, PRICE, ATR, "SHORT", cfgWith(true))?.zoneLo).toBe(1010);
  });

  it("treats an unbroken level as having no role, so the knob cannot help it", () => {
    // flipDir null with flipped true should not happen, but if it does the knob
    // must score it as no evidence rather than silently crediting it.
    const levels = [
      level({ zoneLo: 985, zoneHi: 990 }),
      level({ zoneLo: 975, zoneHi: 980, flipped: true, flipDir: null }),
    ];
    expect(selectOrigin(levels, PRICE, ATR, "LONG", cfgWith(true))?.zoneHi).toBe(990);
    expect(selectOrigin(levels, PRICE, ATR, "LONG", cfgWith(false))?.zoneHi).toBe(980);
  });
});
