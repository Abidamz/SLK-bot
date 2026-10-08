import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import {
  createTelegramInviteLink,
  kickTelegramMember,
  verifyWhopWebhookSignature,
  getChartUrl,
} from "../src/notify";
import { MemStore } from "../src/store";

describe("Whop Webhook & Member Automation (Recommendation 4)", () => {
  const secret = "test_whop_secret_123";

  async function computeHmac(payload: string, sec: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(sec),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  describe("verifyWhopWebhookSignature", () => {
    it("validates raw hex HMAC-SHA256 signature", async () => {
      const payload = JSON.stringify({ action: "membership.went_valid", id: "mem_1" });
      const sig = await computeHmac(payload, secret);
      const ok = await verifyWhopWebhookSignature(payload, sig, secret);
      expect(ok).toBe(true);
    });

    it("validates t=timestamp,v1=signature format used by Whop", async () => {
      const payload = JSON.stringify({ action: "membership.went_valid", id: "mem_2" });
      const timestamp = "1700000000";
      const sig = await computeHmac(`${timestamp}.${payload}`, secret);
      const header = `t=${timestamp},v1=${sig}`;
      const ok = await verifyWhopWebhookSignature(payload, header, secret);
      expect(ok).toBe(true);
    });

    it("rejects invalid signature", async () => {
      const payload = JSON.stringify({ action: "membership.went_valid", id: "mem_3" });
      const ok = await verifyWhopWebhookSignature(payload, "bad_signature_hex", secret);
      expect(ok).toBe(false);
    });
  });

  describe("getChartUrl (Recommendation 3 Visual Links)", () => {
    it("maps institutional forex pairs to TradingView", () => {
      expect(getChartUrl("EURUSD")).toBe("https://www.tradingview.com/chart/?symbol=FX:EURUSD");
      expect(getChartUrl("XAUUSD")).toBe("https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD");
    });

    it("maps US30 and indices to Currencycom / TradingView", () => {
      expect(getChartUrl("US30")).toBe("https://www.tradingview.com/chart/?symbol=CURRENCYCOM:US30");
      expect(getChartUrl("NAS100")).toBe("https://www.tradingview.com/chart/?symbol=CURRENCYCOM:US100");
    });

    it("maps Deriv synthetics to Deriv DTrader chart app", () => {
      expect(getChartUrl("V75")).toBe("https://app.deriv.com/dtrader?symbol=V75");
      expect(getChartUrl("R_100")).toBe("https://app.deriv.com/dtrader?symbol=R_100");
    });

    it("generates QuickChart visual image URL with entry, SL, and TP datasets", async () => {
      const { generateQuickChartUrl } = await import("../src/notify");
      const fakeAlert: any = {
        pair: "EURUSD",
        entryTf: "30m",
        direction: "LONG",
        entry: 1.0850,
        stopLoss: 1.0820,
        tpInternal: 1.0940,
        tpExternal: 1.0980,
        originKeyLevel: 1.0835,
        rrInternal: 3.0,
      };
      const url = generateQuickChartUrl(fakeAlert);
      expect(url).toContain("https://quickchart.io/chart");
      expect(url).toContain("SLK%20MODEL");
      expect(url).toContain("EURUSD");
    });

    it("fetches TradingView screenshot with Long Position tool via chart-img.com", async () => {
      const { fetchTradingViewSnapshot, getVisualAlertImageUrl } = await import("../src/notify");
      const fakeAlert: any = {
        pair: "V75",
        entryTf: "30m",
        direction: "LONG",
        entry: 45038.51,
        stopLoss: 44249.13,
        tpInternal: 47413.22,
      };

      let sentBody: any = null;
      let sentHeaders: any = null;
      const fakeFetch = (async (_url: string | URL, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        sentHeaders = init?.headers;
        return new Response(JSON.stringify({ url: "https://storage.chart-img.com/tradingview-v75.png" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const result = await fetchTradingViewSnapshot("test_key_123", fakeAlert, fakeFetch);
      expect(result).toBe("https://storage.chart-img.com/tradingview-v75.png");
      expect(sentBody.symbol).toBe("DERIV:VOLATILITY_75_INDEX");
      expect(sentBody.interval).toBe("30m");
      expect(sentBody.drawings[0].name).toBe("Long Position");
      expect(sentBody.drawings[0].input.entryPrice).toBe(45038.51);
      expect(sentBody.drawings[0].input.startDatetime).toBeDefined();
      expect(sentBody.drawings[0].input.endDatetime).toBeDefined();
      expect(sentHeaders["x-api-key"]).toBe("test_key_123");

      // Verify getVisualAlertImageUrl uses it when key is present
      const imageUrl = await getVisualAlertImageUrl({ CHART_IMG_API_KEY: "test_key_123", fetchFn: fakeFetch }, fakeAlert);
      expect(imageUrl).toBe("https://storage.chart-img.com/tradingview-v75.png");

      // Verify getVisualAlertImageUrl falls back to QuickChart when no key is set
      const fallbackUrl = await getVisualAlertImageUrl({}, fakeAlert);
      expect(fallbackUrl).toContain("https://quickchart.io/chart");
    });

    it("sends via sendPhoto when CHART_SNAPSHOTS is true", async () => {
      const { sendTelegram } = await import("../src/notify");
      const calls: any[] = [];
      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 12345 } }), { status: 200 });
      }) as unknown as typeof fetch;

      await sendTelegram(
        {
          TELEGRAM_BOT_TOKEN: "fake_token",
          TELEGRAM_CHAT_ID: "-10012345",
          CHART_SNAPSHOTS: "true",
          fetchFn: fakeFetch,
        },
        "🚨 SLK CONFIRMED ENTRY — EURUSD 30m LONG",
        {
          photoUrl: "https://quickchart.io/chart?c=test",
        },
      );

      const photoCall = calls.find((c) => c.url.includes("/sendPhoto"));
      expect(photoCall).toBeDefined();
      expect(photoCall.body.photo).toBe("https://quickchart.io/chart?c=test");
      expect(photoCall.body.caption).toContain("SLK CONFIRMED ENTRY");
    });

    // Telegram caps photo captions at 1024 chars. Alerts routinely exceed that,
    // and the old behaviour silently dropped the tail — the risk protocol,
    // invalidation level, setup ID and chart link never reached the channel.
    it("sends the full text as a follow-up when it exceeds the 1024-char caption limit", async () => {
      const { sendTelegram } = await import("../src/notify");
      const calls: any[] = [];
      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }) as unknown as typeof fetch;

      const longText = "X".repeat(1500) + "|TAIL_MARKER|";
      await sendTelegram(
        { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "-100", CHART_SNAPSHOTS: "true", fetchFn: fakeFetch },
        longText,
        { photoUrl: "https://quickchart.io/chart?c=test", shortCaption: "EURUSD · SHORT · 1h · SELL LIMIT @ 1.1000" },
      );

      const photoCall = calls.find((c) => c.url.includes("/sendPhoto"));
      const msgCall = calls.find((c) => c.url.includes("/sendMessage"));
      // The chart carries the compact caption, not a mangled slice of the alert.
      expect(photoCall.body.caption).toBe("EURUSD · SHORT · 1h · SELL LIMIT @ 1.1000");
      // And the complete text still goes out — this is the actual regression fix.
      expect(msgCall).toBeDefined();
      expect(msgCall.body.text).toBe(longText);
      expect(msgCall.body.text).toContain("|TAIL_MARKER|");
    });

    it("does not duplicate the message when the text fits in a caption", async () => {
      const { sendTelegram } = await import("../src/notify");
      const calls: any[] = [];
      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }) as unknown as typeof fetch;

      const shortText = "SHORT ALERT";
      await sendTelegram(
        { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "-100", CHART_SNAPSHOTS: "true", fetchFn: fakeFetch },
        shortText,
        { photoUrl: "https://quickchart.io/chart?c=test" },
      );

      expect(calls.filter((c) => c.url.includes("/sendPhoto"))).toHaveLength(1);
      expect(calls.filter((c) => c.url.includes("/sendMessage"))).toHaveLength(0);
    });

    it("falls back to sendMessage when the photo fails, even for a long alert", async () => {
      const { sendTelegram } = await import("../src/notify");
      const calls: any[] = [];
      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        if (String(url).includes("/sendPhoto")) return new Response("bad", { status: 400 });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }) as unknown as typeof fetch;

      const longText = "Y".repeat(1500) + "|TAIL|";
      await sendTelegram(
        { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "-100", CHART_SNAPSHOTS: "true", fetchFn: fakeFetch },
        longText,
        { photoUrl: "https://quickchart.io/chart?c=test" },
      );

      const msgCall = calls.find((c) => c.url.includes("/sendMessage"));
      expect(msgCall.body.text).toBe(longText);
    });
  });

  describe("createTelegramInviteLink & kickTelegramMember", () => {
    it("calls Telegram Bot API to create single-use invite link", async () => {
      let requestedUrl = "";
      let requestedBody: any = null;

      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ ok: true, result: { invite_link: "https://t.me/+test_single_use" } }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const link = await createTelegramInviteLink(
        { TELEGRAM_BOT_TOKEN: "fake_bot_token", fetchFn: fakeFetch },
        "-1001234567890",
        "SLK VIP Test",
        1,
        48,
      );

      expect(requestedUrl).toContain("/createChatInviteLink");
      expect(requestedBody.chat_id).toBe("-1001234567890");
      expect(requestedBody.member_limit).toBe(1);
      expect(link).toBe("https://t.me/+test_single_use");
    });

    it("calls Telegram Bot API to kick (ban+unban) member", async () => {
      const calls: string[] = [];
      const fakeFetch = (async (url: string | URL) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch;

      const ok = await kickTelegramMember(
        { TELEGRAM_BOT_TOKEN: "fake_bot_token", fetchFn: fakeFetch },
        "-1001234567890",
        987654321,
      );

      expect(ok).toBe(true);
      expect(calls.some((c) => c.includes("/banChatMember"))).toBe(true);
      expect(calls.some((c) => c.includes("/unbanChatMember"))).toBe(true);
    });
  });

  describe("POST /api/whop-webhook endpoint", () => {
    it("rejects unauthorized webhook requests", async () => {
      const env: Env = {
        WHOP_WEBHOOK_SECRET: secret,
      };
      const req = new Request("http://localhost/api/whop-webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "membership.went_valid" }),
      });
      const res = await worker.fetch(req, env, { waitUntil: () => {} });
      expect(res.status).toBe(401);
    });

    it("handles membership.went_valid: creates invite links and records active member", async () => {
      const calls: any[] = [];
      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url: String(url), body });
        return new Response(
          JSON.stringify({ ok: true, result: { invite_link: `https://t.me/+invite_${body.chat_id}` } }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const env: Env = {
        WHOP_WEBHOOK_SECRET: secret,
        TELEGRAM_BOT_TOKEN: "bot_123",
        TELEGRAM_CHAT_ID: "-100_VIP_INSTITUTIONAL",
        TELEGRAM_DERIV_CHAT_ID: "-100_VIP_SYNTHETICS",
        fetchFn: fakeFetch,
      };

      const payload = {
        action: "membership.went_valid",
        data: {
          id: "mem_abc_999",
          user: {
            id: "user_456",
            email: "trader@example.com",
            telegram_account_id: 11223344,
          },
        },
      };

      const raw = JSON.stringify(payload);
      const sig = await computeHmac(raw, secret);

      const req = new Request("http://localhost/api/whop-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-signature": sig,
        },
        body: raw,
      });

      const res = await worker.fetch(req, env, { waitUntil: () => {} });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.ok).toBe(true);
      expect(json.action).toBe("membership.went_valid");
      expect(json.status).toBe("active");
      expect(json.inviteLinks.institutional).toContain("-100_VIP_INSTITUTIONAL");
      expect(json.inviteLinks.synthetics).toContain("-100_VIP_SYNTHETICS");
      expect(calls.length).toBe(2);
    });

    it("handles membership.went_invalid: revokes VIP access and updates member state", async () => {
      const calls: string[] = [];
      const fakeFetch = (async (url: string | URL) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch;

      const env: Env = {
        WHOP_WEBHOOK_SECRET: secret,
        TELEGRAM_BOT_TOKEN: "bot_123",
        TELEGRAM_CHAT_ID: "-100_VIP_INSTITUTIONAL",
        TELEGRAM_DERIV_CHAT_ID: "-100_VIP_SYNTHETICS",
        fetchFn: fakeFetch,
      };

      const payload = {
        action: "membership.went_invalid",
        data: {
          id: "mem_abc_999",
          user_id: "user_456",
          telegram_account_id: 11223344,
        },
      };

      const raw = JSON.stringify(payload);
      const sig = await computeHmac(raw, secret);

      const req = new Request("http://localhost/api/whop-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-signature": sig,
        },
        body: raw,
      });

      const res = await worker.fetch(req, env, { waitUntil: () => {} });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.ok).toBe(true);
      expect(json.action).toBe("membership.went_invalid");
      expect(json.status).toBe("revoked");
      expect(json.primaryRevoked).toBe(true);
      expect(json.derivRevoked).toBe(true);
      expect(calls.some((c) => c.includes("/banChatMember"))).toBe(true);
    });
  });
});
