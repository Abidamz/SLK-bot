import { describe, expect, it } from "vitest";
import {
  continuationShadowPrivateDmIds,
  formatContinuationDemoEntryDm,
  formatContinuationShadowDm,
  formatContinuationShadowDmGroup,
  groupContinuationShadowCaptures,
  sendContinuationShadowPrivateDm,
} from "../src/continuation_shadow_notifications";
import type { ContinuationDemoEntry } from "../src/continuation_demo_entries";
import type { ShadowExperimentCapture } from "../src/types";
import worker, { type Env } from "../src/index";

const capture: ShadowExperimentCapture = {
  experimentId: "CONTINUATION_SETUP_V1:EURUSD:4h:M30_OUTCOME:test",
  sourceSetupId: "CONTINUATION_SETUP_V1:EURUSD:4h:M30_OUTCOME:test",
  variant: "CONTINUATION_SETUP_V1",
  pair: "EURUSD",
  entryTf: "30m",
  direction: "LONG",
  entry: 1.12345,
  stopLoss: 1.12045,
  target: 1.13245,
  rr: 3,
  candleCloseTime: Date.UTC(2026, 0, 2, 4),
};

describe("continuation private shadow notifications", () => {
  it("formats a private, non-blocking H4 setup watch without claiming execution", () => {
    const text = formatContinuationShadowDm(capture);
    expect(text).toContain("PRIVATE CONTINUATION SETUP WATCH");
    expect(text).toContain("latest completed H4 candle");
    expect(text).toContain("primary gate is unchanged");
    expect(text).toContain("not an entry fill or order");
    expect(text).toContain("EURUSD · H4 continuation setups");
    expect(text).toContain("Candidate 1 · LONG:");
    expect(text).toContain("Reference entry: 1.12345");
    expect(text).toContain("Reference stop: 1.12045");
    expect(text).toContain("Reference target: 1.13245");
    expect(text).toContain("Reference reward/risk: 3.00R");
    expect(text).toContain("120 M30 candles");
    expect(text).not.toContain("Hypothetical");
  });

  it("groups same H4-close candidates into a manual-choice setup watch", () => {
    const second = { ...capture, experimentId: `${capture.experimentId}:second`, entry: 1.123, stopLoss: 1.120, target: 1.132 };
    const otherClose = { ...capture, experimentId: `${capture.experimentId}:other`, candleCloseTime: capture.candleCloseTime + 4 * 60 * 60 * 1000 };
    const groups = groupContinuationShadowCaptures([capture, second, otherClose]);
    expect(groups.map((group) => group.length).sort()).toEqual([1, 2]);
    const text = formatContinuationShadowDmGroup(groups.find((group) => group.length === 2)!);
    expect(text).toContain("Candidate 1 · LONG:");
    expect(text).toContain("Candidate 2 · LONG:");
    expect(text.match(/Reference entry:/g)).toHaveLength(2);
    expect(text).toContain("fresh post-close M30 touch");
  });

  it("formats the next-open manual demo signal with fixed H4 levels and actual R:R", () => {
    const entry: ContinuationDemoEntry = {
      capture,
      triggerCandleCloseTime: capture.candleCloseTime + 30 * 60 * 1000,
      entryTime: capture.candleCloseTime + 30 * 60 * 1000,
      entryPrice: 1.124,
      stopLoss: capture.stopLoss,
      target: capture.target,
      rr: 0.00845 / 0.00355,
    };
    const text = formatContinuationDemoEntryDm([entry]);
    expect(text).toContain("PRIVATE MANUAL DEMO ENTRY");
    expect(text).toContain("next M30 open");
    expect(text).toContain("Demo entry reference: 1.124");
    expect(text).toContain("Fixed H4 stop: 1.12045");
    expect(text).toContain("Fixed H4 target: 1.13245");
    expect(text).toContain("Actual R:R from next-open entry:");
    expect(text).toContain("No automatic selection or order is placed");
  });

  it("accepts only positive numeric private chat IDs", () => {
    expect(continuationShadowPrivateDmIds("123456,-100123,@public,123456,0")).toEqual(["123456"]);
    expect(continuationShadowPrivateDmIds("-100123,@public,0")).toEqual([]);
  });

  it("sends only to configured private DMs, never group/channel targets", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const env = {
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "-100-group-channel",
      fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };

    const result = await sendContinuationShadowPrivateDm(env, "123456,-100-group,@channel", capture);
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/sendMessage");
    expect(requests[0].body.chat_id).toBe("123456");
    expect(String(requests[0].body.text)).toContain("PRIVATE CONTINUATION SETUP WATCH");
  });

  it("does not send without a bot token or a private DM recipient", async () => {
    const noToken = await sendContinuationShadowPrivateDm({}, "123456", capture);
    expect(noToken).toMatchObject({ sent: 0, failed: 0, skipped: "missing_bot_token" });

    const noDm = await sendContinuationShadowPrivateDm({ TELEGRAM_BOT_TOKEN: "test-token" }, "-100-group", capture);
    expect(noDm).toMatchObject({ sent: 0, failed: 0, skipped: "missing_private_dm" });
  });

  it("fails closed rather than fanning out to multiple positive Telegram IDs", async () => {
    let requests = 0;
    const result = await sendContinuationShadowPrivateDm({
      TELEGRAM_BOT_TOKEN: "test-token",
      fetchFn: async () => {
        requests++;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    }, "123456,654321", capture);

    expect(result).toEqual({ sent: 0, failed: 0, skipped: "multiple_private_dms" });
    expect(requests).toBe(0);
  });

  it("supports an owner-authenticated DM-only test without touching shared channels", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const env: Env = {
      ADMIN_KEY: "owner-test",
      MODE: "paper",
      CONTINUATION_SHADOW_ENABLED: "true",
      CONTINUATION_SHADOW_DM_NOTIFY: "true",
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "-100-shared-group",
      TELEGRAM_DM_CHAT_ID: "123456,-100-not-a-dm",
      DISCORD_WEBHOOK_URL: "https://discord.invalid/webhook",
      fetchFn: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const response = await worker.fetch(new Request("https://worker.test/test-notify", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: "telegram_dm" }),
    }), env, { waitUntil: () => undefined } as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, isolated: true, results: { telegram_dm: "ok" } });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/sendMessage");
    expect(requests[0].body.chat_id).toBe("123456");
    expect(String(requests[0].body.text)).toContain("PRIVATE TELEGRAM DELIVERY TEST");
  });
});
