import { describe, expect, it } from "vitest";
import { navigatorState } from "../src/navigator";
import type { Candle } from "../src/types";

const DAY = 86_400_000;
const MON = Date.UTC(2026, 2, 2); // a Monday: the current week's open
const c = (t: number, o: number, cl: number, hp = 1, lp = 1): Candle =>
  ({ t, o, h: Math.max(o, cl) + hp, l: Math.min(o, cl) - lp, c: cl });

// Seven complete months: swing high at index 2 (h 112, above both neighbours
// on each side), body-close above it at index 5 → monthly BOS LONG.
const moLong = [
  c(Date.UTC(2025, 8, 1), 98, 100),
  c(Date.UTC(2025, 9, 1), 100, 104),
  c(Date.UTC(2025, 10, 1), 104, 110, 2),
  c(Date.UTC(2025, 11, 1), 110, 106),
  c(Date.UTC(2026, 0, 1), 106, 108),
  c(Date.UTC(2026, 1, 1), 108, 115),
  c(Date.UTC(2026, 2, 1), 115, 114),
];
// Seven complete weeks (the last ending before the current week): swing high
// at index 2 (h 120), body-close above it at index 5 → weekly BOS LONG.
const w1Long = [
  c(MON - 49 * DAY, 108, 112),
  c(MON - 42 * DAY, 112, 114),
  c(MON - 35 * DAY, 114, 118, 2),
  c(MON - 28 * DAY, 118, 114),
  c(MON - 21 * DAY, 114, 116),
  c(MON - 14 * DAY, 116, 121),
  c(MON - 7 * DAY, 121, 120),
];
// Same shape inverted: swing low at index 2 (l 100), body-close below it at
// index 5 → weekly BOS SHORT, misaligned against a LONG month.
const w1Short = [
  c(MON - 49 * DAY, 112, 108),
  c(MON - 42 * DAY, 108, 106),
  c(MON - 35 * DAY, 106, 102, 1, 2),
  c(MON - 28 * DAY, 102, 106),
  c(MON - 21 * DAY, 106, 104),
  c(MON - 14 * DAY, 104, 99),
  c(MON - 7 * DAY, 99, 100),
];
// Ten quiet rising dailies, then this week: a small bearish Monday and a
// bullish Tuesday whose body completely covers Monday's → engulfing
// confirmation inside the current week.
const d1Engulf = [
  ...Array.from({ length: 10 }, (_, i) => c(MON - (10 - i) * DAY, 110 + i * 0.8, 110 + (i + 1) * 0.8)),
  c(MON, 119, 118),
  c(MON + DAY, 117.5, 119.5),
];
// Same history but this week holds two tiny same-direction candles: no
// engulfing, no sweep (lows rise monotonically), no levels → no confirmation.
const d1Quiet = [
  ...Array.from({ length: 10 }, (_, i) => c(MON - (10 - i) * DAY, 110 + i * 0.8, 110 + (i + 1) * 0.8)),
  c(MON, 119, 118.6),
  c(MON + DAY, 118.6, 118.3),
];

describe("navigatorState", () => {
  it("permits the aligned direction once the current week confirms it", () => {
    const st = navigatorState(moLong, w1Long, d1Engulf);
    expect(st.reason).toBe("ALIGNED_CONFIRMED");
    expect(st.permitted).toBe("LONG");
    expect(st.confirmation).toBe("engulfing");
    expect(st.monthDir).toBe("LONG");
    expect(st.weekDir).toBe("LONG");
    expect(st.weekStart).toBe(MON);
  });

  it("refuses everything when the weekly contradicts the monthly", () => {
    const st = navigatorState(moLong, w1Short, d1Engulf);
    expect(st.reason).toBe("WEEKLY_MISALIGNED");
    expect(st.permitted).toBeNull();
  });

  it("refuses an aligned week that has not confirmed yet", () => {
    const st = navigatorState(moLong, w1Long, d1Quiet);
    expect(st.reason).toBe("NO_DAILY_CONFIRM");
    expect(st.permitted).toBeNull();
  });

  it("will not license this week's trades on an older confirmation", () => {
    // Move the engulfing pair into last week: the current week then opens
    // with two quiet candles and the old confirmation is out of window.
    const stale = [
      ...Array.from({ length: 8 }, (_, i) => c(MON - (10 - i) * DAY, 110 + i * 0.8, 110 + (i + 1) * 0.8)),
      c(MON - 2 * DAY, 119, 118),
      c(MON - DAY, 117.5, 119.5),
      c(MON, 119.6, 119.4),
      c(MON + DAY, 119.4, 119.2),
    ];
    const st = navigatorState(moLong, w1Long, stale);
    expect(st.reason).toBe("NO_DAILY_CONFIRM");
    expect(st.permitted).toBeNull();
  });

  it("reports missing history instead of guessing", () => {
    expect(navigatorState(moLong.slice(0, 3), w1Long, d1Engulf).reason).toBe("NO_MONTHLY_BOS");
    expect(navigatorState([], [], []).reason).toBe("INSUFFICIENT_HISTORY");
  });
});
