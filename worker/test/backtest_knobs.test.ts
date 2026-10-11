/**
 * The replay is configured entirely through BACKTEST_* environment variables,
 * and an unrecognised one is invisible — it is simply never read. That silence
 * is what makes a stale checkout dangerous: running BACKTEST_ENTRY_TFS=30m,1h,2h
 * against a checkout from before the knob existed printed a complete,
 * plausible-looking 33-alert report containing no 2H trades at all, with
 * nothing in the output to say the request had been dropped.
 *
 * The script now refuses unknown variables. This test keeps its allowlist from
 * drifting away from the variables the source actually reads, in either
 * direction: a read that is not listed would be rejected as unknown, and a
 * listed name that is never read would suggest a knob exists when it does not.
 *
 * Parsed from source rather than imported. scripts/ is outside the base
 * tsconfig's reach, and importing the script would execute main().
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../scripts/backtest.ts", import.meta.url), "utf8");

/** Every `process.env.BACKTEST_*` the script actually reads. */
function reads(): string[] {
  return [...new Set([...src.matchAll(/process\.env\.(BACKTEST_[A-Z_]+)/g)].map((m) => m[1]))].sort();
}

/** The names inside the KNOWN_BACKTEST_VARS literal. */
function listed(): string[] {
  const body = src.slice(
    src.indexOf("const KNOWN_BACKTEST_VARS = ["),
    src.indexOf("] as const;", src.indexOf("const KNOWN_BACKTEST_VARS = [")),
  );
  expect(body.length).toBeGreaterThan(0);
  return [...body.matchAll(/"(BACKTEST_[A-Z_]+)"/g)].map((m) => m[1]);
}

describe("backtest knobs — the allowlist must match the reads", () => {
  it("lists every variable the script reads, so none is rejected as unknown", () => {
    expect(listed().sort()).toEqual(reads());
  });

  it("has no duplicates, which would hide a stale entry", () => {
    const l = listed();
    expect(new Set(l).size).toBe(l.length);
  });

  it("reads enough knobs for the list to be worth pinning", () => {
    // Guards against the regex above silently matching nothing and both sides
    // agreeing on an empty set.
    expect(reads().length).toBeGreaterThan(20);
    expect(reads()).toContain("BACKTEST_ENTRY_TFS");
  });

  it("refuses an unknown variable rather than ignoring it", () => {
    expect(src).toContain("Unknown BACKTEST_* variable(s)");
    // The message has to say what to do about it, not just that something is
    // wrong — the usual cause is a checkout that predates the knob.
    expect(src).toContain("git pull");
  });

  it("records the entry timeframes in the run header, so a dropped request is visible in the log", () => {
    expect(src).toContain("entry tfs : ${ENTRY_TFS.join");
  });
});
