import { describe, expect, it } from "vitest";
import { scanAll, type Env } from "../src/index";
import { MemStore } from "../src/store";
import type { ShadowExperimentCapture } from "../src/types";
import {
  continuationDemoPendingKey,
  createPendingContinuationDemoGroup,
} from "../src/continuation_demo_entries";
import { T0, makeFakeFetch, type RecordedCalls } from "./fixtures";

function makeEnv(overrides: Record<string, string> = {}): Env {
  return {
    TWELVEDATA_API_KEY: "TESTKEY",
    TELEGRAM_BOT_TOKEN: "TGT",
    TELEGRAM_CHAT_ID: "-100-shared-group",
    PAIRS: "EURUSD",
    ENTRY_TFS: "30m",
    MODE: "paper",
    PAPER_NOTIFY: "true",
    ...overrides,
  } as Env;
}

describe("continuation demo scan priority", () => {
  it("priority-scans an active watch inside one minute when the M30 boundary was already marked, without rerunning the live gate", async () => {
    const calls: RecordedCalls = { telegram: [], discord: [] };
    const store = new MemStore();
    const now = T0 + 8 * 60 * 60_000 + 30_000;
    const m30Boundary = T0 + 8 * 60 * 60_000;
    const setupClose = m30Boundary - 60 * 60_000;
    const capture: ShadowExperimentCapture = {
      experimentId: "CONTINUATION_SETUP_V1:EURUSD:4h:M30_OUTCOME:priority-test",
      sourceSetupId: "CONTINUATION_SETUP_V1:EURUSD:4h:M30_OUTCOME:priority-test",
      variant: "CONTINUATION_SETUP_V1",
      pair: "EURUSD",
      entryTf: "30m",
      direction: "LONG",
      entry: 1_000_000,
      stopLoss: 999_000,
      target: 1_003_000,
      rr: 3,
      candleCloseTime: setupClose,
    };
    const pendingKey = continuationDemoPendingKey("EURUSD");
    await store.setKv(pendingKey, JSON.stringify(createPendingContinuationDemoGroup("EURUSD", setupClose, [capture])));
    await store.setKv("last_boundary:30m", String(m30Boundary));
    await store.setKv("last_scan:EURUSD:30m", String(m30Boundary));

    const summary = await scanAll(makeEnv({
      CONTINUATION_SHADOW_ENABLED: "true",
      CONTINUATION_SHADOW_DM_NOTIFY: "true",
      TELEGRAM_DM_CHAT_ID: "123456",
    }), {
      now,
      fetchFn: makeFakeFetch(calls),
      storeOverride: store,
    });

    expect(summary.timeframes).toContain("30m");
    expect(summary.pairs).toContain("EURUSD");
    expect(summary.alerts).toBe(0);
    expect(summary.events).toBe(0);
    expect(await store.getKv(pendingKey)).not.toBe("");
    expect(calls.telegram).toHaveLength(0);
    expect(calls.discord).toHaveLength(0);
  });
});
