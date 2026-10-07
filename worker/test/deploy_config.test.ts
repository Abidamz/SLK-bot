/** Deploy-config guard (scheduling + standing gates).
 *
 *  `worker/wrangler.jsonc` is what actually ships to production, so the values
 *  that define the live cadence and the gates that must not move are pinned
 *  here. A silent edit to the deployed file (or a revert of the cadence
 *  decision) fails this suite instead of quietly changing production.
 *
 *  Why 2 markets per tick: after the 2026-10-07 scheduler/store work a full
 *  tick measured 5-15 s against the 60 s cron budget (11-15 s for
 *  three-timeframe pairs, 6.6-8.3 s for single-timeframe ones), so a second
 *  pair costs ~15-30 s in total and roughly halves the per-pair revisit time
 *  (~23 min -> ~12 min). Scheduling only — no alert gate, threshold, pair
 *  list, timeframe, or delivery change.
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

  it("keeps paper mode and the standing gates byte-identical", () => {
    for (const entry of [
      '"MODE":"paper"',
      '"MIN_TP_R":"2.5"',
      '"MIN_RISK_ATR":"0.8"',
      '"RETEST_DEPTH_PCT":"60"',
      '"PAPER_NOTIFY":"true"',
    ]) {
      expect(compact).toContain(entry);
    }
  });

  it("keeps the every-minute cron schedule", () => {
    expect(compact).toContain('"crons":["*/1****"]');
  });
});
