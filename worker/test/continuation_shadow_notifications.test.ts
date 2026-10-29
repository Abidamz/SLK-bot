import { describe, expect, it } from "vitest";
import {
  continuationShadowPrivateDmIds,
  formatContinuationShadowDm,
  sendContinuationShadowPrivateDm,
} from "../src/continuation_shadow_notifications";
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
  it("formats a clearly hypothetical H4 setup with M30 outcome details", () => {
    const text = formatContinuationShadowDm(capture);
    expect(text).toContain("PAPER SHADOW CANDIDATE");
    expect(text).toContain("not a live alert or order");
    expect(text).toContain("EURUSD · LONG · H4 continuation setup");
    expect(text).toContain("Hypothetical entry: 1.12345");
    expect(text).toContain("Hypothetical stop: 1.12045");
    expect(text).toContain("Hypothetical target: 1.13245");
    expect(text).toContain("120 M30 candles");
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
    expect(String(requests[0].body.text)).toContain("PAPER SHADOW CANDIDATE");
  });

  it("does not send without a bot token or a private DM recipient", async () => {
    const noToken = await sendContinuationShadowPrivateDm({}, "123456", capture);
    expect(noToken).toMatchObject({ sent: 0, failed: 0, skipped: "missing_bot_token" });

    const noDm = await sendContinuationShadowPrivateDm({ TELEGRAM_BOT_TOKEN: "test-token" }, "-100-group", capture);
    expect(noDm).toMatchObject({ sent: 0, failed: 0, skipped: "missing_private_dm" });
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
