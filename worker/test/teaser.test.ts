/**
 * Free-channel TP1 win teaser (Task 4b): pair / timeframe / result only —
 * never entry, stop, or target levels. Levels stay VIP-only.
 */
import { describe, expect, it } from "vitest";
import { formatFreeTpTeaser, toBold } from "../src/notify";
import type { AlertRowish, OutcomeLike } from "../src/notify_types";

const rec: AlertRowish = {
  setup_id: "EURUSD:30m:SHORT:V:1.085250:2026-09-30T10:30:00.000Z",
  canonical_symbol: "EURUSD",
  entry_timeframe: "30m",
  direction: "SHORT",
  entry: 1.08525,
  stop_loss: 1.0861,
  tp_internal: 1.0831,
  alert_status: "SENT",
  status: "TP_HIT",
};

const oc: OutcomeLike = { status: "TP_HIT", exitPrice: 1.0831, exitTime: Date.parse("2026-09-30T14:00:00.000Z"), rMultiple: 2.57 };

describe("free-channel TP1 teaser", () => {
  it("uses the exact level-free layout (pair / timeframe / result only)", () => {
    const boldPair = toBold("EURUSD");
    const text = formatFreeTpTeaser(rec, oc);
    expect(text).toBe([
      `🎯 TP1 HIT — 🌟【 ${boldPair} 】🌟 SHORT (+2.57R)`,
      "",
      `📍 Pair      : 🌟【 ${boldPair} 】🌟`,
      "• Timeframe : 30m",
      "• Direction : SHORT 🔴",
      "• Result    : TP1 reached at +2.57R ✅",
      "",
      "VIP members received this live alert with exact entry, stop floor, and targets.",
      "",
      "👉 Join VIP ($100/mo · $49 w/ code FOUNDING20): https://whop.com/slk-radar/slk-radar-vip-signals",
      "👉 Live Verified Journal: https://slk-radar.pages.dev",
    ].join("\n"));
  });

  it("never leaks execution levels to free channels", () => {
    const text = formatFreeTpTeaser(rec, oc);
    // raw + bolded forms of the entry / stop / TP levels must be absent
    for (const v of ["1.08525", "1.0861", "1.0831"]) {
      expect(text).not.toContain(v);
      expect(text).not.toContain(toBold(v));
    }
    expect(text).not.toContain("Entry     :");
    expect(text).not.toContain("Target 1  :");
    expect(text).not.toContain("Target 2  :");
    // but the result R-value is fine
    expect(text).toContain("+2.57R");
  });
});
