/** Plan-limit labels must describe the plan actually in use.
 *
 *  The system-health card used to hardcode Workers Free ceilings — "10ms
 *  limit", "100,000 writes/day", "500MB", "subrequest limit 50" — and label
 *  the service "Free Tier Optimized", while the account is on Workers Paid.
 *  Those strings were read as facts and produced a headroom estimate that was
 *  wrong by about three orders of magnitude. Free-tier ceilings must not come
 *  back, and no unmeasurable figure should be presented as measured.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const index = read("../src/index.ts");
const health = read("../src/dashboard_html.ts");

/** Free-tier numbers that must never be asserted as this deployment's limits. */
const FREE_TIER_CLAIMS = [
  "Free Tier",
  "10ms limit",
  "100,000 writes/day",
  "500MB free storage",
  "subrequest limit 50",
];

describe("plan limit labels", () => {
  it.each(FREE_TIER_CLAIMS)("does not claim the Free-tier limit %s", (claim) => {
    expect(index).not.toContain(claim);
  });

  it("names the Workers Paid ceilings on the health card", () => {
    // 30s CPU per invocation, 10,000 subrequests, and the D1 paid allowance.
    expect(index).toContain("30,000ms of CPU per invocation");
    expect(index).toContain("10,000 subrequests");
    expect(index).toContain("50,000,000 row-writes per month");
    expect(index).toContain("5GB of storage");
  });

  it("does not assert a measured per-tick CPU figure", () => {
    // Cloudflare does not expose a Worker's own CPU time to the running
    // Worker, so any specific ms-per-tick number would be invented.
    expect(index).not.toMatch(/executes ~[\d.]+ms per tick/);
  });

  it("keeps the service line free of the old tier branding", () => {
    expect(index).not.toContain("Free Tier CPU Optimized");
    expect(health).not.toContain("Free Tier");
  });
});
