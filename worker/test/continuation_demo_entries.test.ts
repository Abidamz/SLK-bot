import { describe, expect, it } from "vitest";
import type { Candle, ShadowExperimentCapture } from "../src/types";
import {
  CONTINUATION_DEMO_ENTRY_TF_MS,
  CONTINUATION_DEMO_MAX_ENTRY_DELAY_MS,
  CONTINUATION_DEMO_SETUP_TTL_MS,
  continuationDemoPendingKey,
  continuationDemoPendingPairs,
  createPendingContinuationDemoGroup,
  evaluateContinuationDemoEntry,
  groupContinuationDemoEntries,
  parsePendingContinuationDemoGroup,
} from "../src/continuation_demo_entries";

const setupClose = Date.UTC(2026, 9, 30, 8);
const capture: ShadowExperimentCapture = {
  experimentId: "CONTINUATION_SETUP_V1:NETHERLANDS25:4h:M30_OUTCOME:test",
  sourceSetupId: "CONTINUATION_SETUP_V1:NETHERLANDS25:4h:M30_OUTCOME:test",
  variant: "CONTINUATION_SETUP_V1",
  pair: "NETHERLANDS25",
  entryTf: "30m",
  direction: "LONG",
  entry: 1140,
  stopLoss: 1120,
  target: 1200,
  rr: 3,
  candleCloseTime: setupClose,
};

function m30(
  t: number,
  values: Partial<Pick<Candle, "o" | "h" | "l" | "c">> = {},
): Candle {
  return { t, o: 1145, h: 1150, l: 1135, c: 1145, ...values };
}

describe("continuation demo-entry trigger", () => {
  it("requires a fresh post-H4 M30 touch and close back in direction, then uses next M30 open", () => {
    const entryTime = setupClose + CONTINUATION_DEMO_ENTRY_TF_MS;
    const result = evaluateContinuationDemoEntry({
      capture,
      m30Candles: [
        // The touch before the H4 setup close is never actionable.
        m30(setupClose - CONTINUATION_DEMO_ENTRY_TF_MS, { l: 1138, c: 1142 }),
        m30(setupClose, { l: 1139, c: 1142 }),
      ],
      nextOpenCandles: [m30(entryTime, { o: 1142 })],
      now: entryTime + 30_000,
    });

    expect(result).toMatchObject({
      state: "ready",
      entry: {
        triggerCandleCloseTime: entryTime,
        entryTime,
        entryPrice: 1142,
        stopLoss: 1120,
        target: 1200,
      },
    });
    if (result.state === "ready") expect(result.entry.rr).toBeCloseTo(58 / 22, 8);
  });

  it("requires the M30 close to reclaim the level in the setup direction", () => {
    const shortCapture: ShadowExperimentCapture = {
      ...capture,
      direction: "SHORT",
      entry: 1140,
      stopLoss: 1160,
      target: 1080,
    };
    const entryTime = setupClose + CONTINUATION_DEMO_ENTRY_TF_MS;
    const result = evaluateContinuationDemoEntry({
      capture: shortCapture,
      m30Candles: [m30(setupClose, { h: 1145, c: 1138 })],
      nextOpenCandles: [m30(entryTime, { o: 1137 })],
      now: entryTime,
    });

    expect(result).toMatchObject({
      state: "ready",
      entry: { entryPrice: 1137, stopLoss: 1160, target: 1080 },
    });
    if (result.state === "ready") expect(result.entry.rr).toBeCloseTo(57 / 23, 8);

    const noCloseConfirmation = evaluateContinuationDemoEntry({
      capture: shortCapture,
      m30Candles: [m30(setupClose, { h: 1145, c: 1142 })],
      nextOpenCandles: [m30(entryTime, { o: 1140 })],
      now: entryTime,
    });
    expect(noCloseConfirmation.state).toBe("no_trigger");
  });

  it("waits for the next open while within the one-minute window, then marks a late trigger stale", () => {
    const entryTime = setupClose + CONTINUATION_DEMO_ENTRY_TF_MS;
    const trigger = m30(setupClose, { l: 1139, c: 1142 });
    const waiting = evaluateContinuationDemoEntry({
      capture,
      m30Candles: [trigger],
      nextOpenCandles: [],
      now: entryTime + 30_000,
    });
    expect(waiting).toMatchObject({ state: "waiting_for_next_open", entryTime });

    const stale = evaluateContinuationDemoEntry({
      capture,
      m30Candles: [trigger],
      nextOpenCandles: [m30(entryTime, { o: 1142 })],
      now: entryTime + CONTINUATION_DEMO_MAX_ENTRY_DELAY_MS + 1,
    });
    expect(stale).toMatchObject({ state: "stale_trigger", entryTime });
  });

  it("does not issue an entry after the next H4 close or when next-open price invalidates fixed levels", () => {
    const nextH4Close = setupClose + 4 * 60 * 60 * 1000;
    const expired = evaluateContinuationDemoEntry({
      capture,
      m30Candles: [m30(setupClose, { l: 1139, c: 1142 })],
      nextOpenCandles: [m30(setupClose + CONTINUATION_DEMO_ENTRY_TF_MS, { o: 1142 })],
      now: nextH4Close,
    });
    expect(expired).toEqual({ state: "expired" });

    const invalid = evaluateContinuationDemoEntry({
      capture,
      m30Candles: [m30(setupClose, { l: 1139, c: 1142 })],
      nextOpenCandles: [m30(setupClose + CONTINUATION_DEMO_ENTRY_TF_MS, { o: 1201 })],
      now: setupClose + CONTINUATION_DEMO_ENTRY_TF_MS,
    });
    expect(invalid.state).toBe("invalid_levels");
  });

  it("groups triggered levels from the same pair, direction, H4 setup, and M30 close", () => {
    const triggerTime = setupClose + CONTINUATION_DEMO_ENTRY_TF_MS;
    const entry = {
      capture,
      triggerCandleCloseTime: triggerTime,
      entryTime: triggerTime,
      entryPrice: 1142,
      stopLoss: 1120,
      target: 1200,
      rr: 58 / 22,
    };
    const second = {
      ...entry,
      capture: { ...capture, experimentId: `${capture.experimentId}:second`, entry: 1139 },
    };
    const oppositeDirection = {
      ...entry,
      capture: { ...capture, experimentId: `${capture.experimentId}:short`, direction: "SHORT" as const },
    };
    const differentH4 = {
      ...entry,
      capture: { ...capture, candleCloseTime: setupClose - 4 * 60 * 60 * 1000 },
    };

    const groups = groupContinuationDemoEntries([entry, second, oppositeDirection, differentH4]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.length).sort()).toEqual([1, 3]);
  });

  it("persists and expires same-H4 pending groups through the existing KV key namespace", () => {
    const group = createPendingContinuationDemoGroup("NETHERLANDS25", setupClose, [capture]);
    expect(group.expiresAt).toBe(setupClose + CONTINUATION_DEMO_SETUP_TTL_MS);
    const raw = JSON.stringify(group);
    expect(parsePendingContinuationDemoGroup(raw)).toEqual(group);
    expect(continuationDemoPendingPairs({ [continuationDemoPendingKey("NETHERLANDS25")]: raw }, setupClose + 1))
      .toEqual(["NETHERLANDS25"]);
    expect(continuationDemoPendingPairs({ [continuationDemoPendingKey("NETHERLANDS25")]: raw }, group.expiresAt))
      .toEqual([]);
    expect(parsePendingContinuationDemoGroup("not-json")).toBeNull();
  });
});
