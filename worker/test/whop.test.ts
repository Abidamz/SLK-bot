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
