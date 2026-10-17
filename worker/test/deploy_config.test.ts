/** Deploy-config guard (scheduling + standing gates).
 *
 *  `worker/wrangler.jsonc` is what actually ships to production, so the values
 *  that define the live cadence and the gates that must not move are pinned
 *  here. A silent edit to the deployed file (or a revert of the cadence
 *  decision) fails this suite instead of quietly changing production. The
 *  separately authorized Deriv rollout is pinned as alert-only: the ten
 *  supported volatility indices are included while the Worker stays in paper
 *  mode with notifications on.
 *
 *  Why 2 markets per tick: after the 2026-10-07 scheduler/store work a full
 *  tick measured 5-15 s against the 60 s cron budget (11-15 s for
 *  three-timeframe pairs, 6.6-8.3 s for single-timeframe ones), so a second
 *  pair costs ~15-30 s in total and roughly halves the per-pair revisit time
 *  (~23 min -> ~12 min). The cadence tweak is scheduling-only; the approved
 *  Deriv pair-list change is pinned separately below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw: string = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
/** Full-line `//` comments removed, then all whitespace squeezed out, so the
 *  assertions match the values themselves rather than the file's formatting
 *  (the URLs inside PROVIDER_MAP/DERIV_PROXY_URL are never touched). */
const compact = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n")
  .replace(/\s+/g, "");

describe("deployed wrangler.jsonc", () => {
  it("scans two markets per cron tick", () => {
    expect(compact).toContain('"PAIR_BATCH_SIZE":"2"');
  });

  it("routes the ten supported Deriv indices for signal alerts only", () => {
    expect(compact).toContain(
      '"PAIRS":"JAPAN225,NAS100,EURUSD,XAUUSD,V75,V100,V50,V25,V10,V75_1S,V100_1S,V50_1S,V25_1S,V10_1S"',
    );
    expect(compact).toContain('"MODE":"paper"');
    expect(compact).toContain('"PAPER_NOTIFY":"true"');
  });

  it("keeps paper mode and the standing gates byte-identical", () => {
    for (const entry of [
      '"MODE":"paper"',
      // Market entry. The pending limit at the retest close measured worse on
      // both the 180d and 360d replays (31.06R vs 36.33R over 360d), and 3
      // alerts never filled it at all. Changing this changes what subscribers
      // are told to do, so it is pinned rather than left to a default.
      '"EXECUTION_MODE":"market"',
      '"MIN_TP_R":"2.5"',
      '"MIN_RISK_ATR":"0.8"',
      // 100 = the legacy "return to the origin zone" retest check. Any value
      // 1-99 switches to FVG-penetration semantics, where a retest becomes
      // impossible (not merely unlikely) unless a direction-matched imbalance
      // overlaps the origin zone. That switch took retest candidates from
      // ~220/day to zero on 2026-10-06; see CONTINUATION_HANDOFF.md.
      '"RETEST_DEPTH_PCT":"100"',
      '"PAPER_NOTIFY":"true"',
    ]) {
      expect(compact).toContain(entry);
    }
  });

  it("keeps the every-minute cron schedule", () => {
    expect(compact).toContain('"crons":["*/1****"]');
  });
});
