/** MT5 execution bridge client (Roadmap Recommendation 6).
 *
 *  Connects the Cloudflare Worker to the institutional FastAPI bridge in
 *  `scripts/mt5_bridge.py` (HMAC-SHA256 signed `POST /webhook/trade` and
 *  `POST /webhook/breakeven`).
 *
 *  HARD SAFETY GATE — every dispatch is a no-op unless ALL of:
 *    1. `MODE=live` (production runs `MODE=paper`),
 *    2. `MT5_ENABLED=true` is explicitly set,
 *    3. `MT5_WEBHOOK_URL` and `MT5_HMAC_SECRET` are configured.
 *  Paper mode never touches the bridge; secrets live only in Worker
 *  secrets/KV and are never committed to the repository. */
import type { Alert } from "./types";

export interface Mt5Env {
  MT5_ENABLED?: string;
  MT5_WEBHOOK_URL?: string;
  MT5_HMAC_SECRET?: string;
  MT5_RISK_USD?: string;
}

export type Mt5Result =
  | { status: "skipped"; reason: string }
  | { status: "sent"; httpStatus: number; body: unknown }
  | { status: "error"; error: string };

/** True only when live mode AND the bridge is explicitly enabled+configured. */
export function mt5Active(env: Mt5Env, mode: string): boolean {
  return (
    mode === "live" &&
    (env.MT5_ENABLED ?? "").toLowerCase() === "true" &&
    Boolean(env.MT5_WEBHOOK_URL?.trim()) &&
    Boolean(env.MT5_HMAC_SECRET?.trim())
  );
}

function skipReason(env: Mt5Env, mode: string): string {
  if (mode !== "live") return "paper mode — MT5/live execution disabled";
  if ((env.MT5_ENABLED ?? "").toLowerCase() !== "true") return "MT5_ENABLED is not true";
  if (!env.MT5_WEBHOOK_URL?.trim()) return "MT5_WEBHOOK_URL not configured";
  return "MT5_HMAC_SECRET not configured";
}

/** Payload shape mirrors `TradePayload` in scripts/mt5_bridge.py. */
export function buildTradePayload(a: Alert, riskUsd?: number) {
  return {
    setup_id: a.setupId,
    pair: a.pair,
    direction: a.direction,
    entry: Number(a.entry),
    stop_loss: Number(a.stopLoss),
    tp_internal: Number(a.tpInternal),
    tp_external: a.tpExternal != null ? Number(a.tpExternal) : null,
    entry_timeframe: a.entryTf,
    risk_usd: riskUsd ?? null,
  };
}

/** Payload shape mirrors `BreakevenPayload` in scripts/mt5_bridge.py. */
export function buildBreakevenPayload(setupId: string, pair: string, entryPrice: number) {
  return { setup_id: setupId, pair, entry_price: entryPrice };
}

/** HMAC-SHA256 hex digest of the raw JSON body (bridge verifies `x-slk-signature`). */
export async function signBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postMt5(
  env: Mt5Env, path: string, payload: unknown, fetchFn: typeof fetch = fetch,
): Promise<Mt5Result> {
  const body = JSON.stringify(payload);
  const sig = await signBody(env.MT5_HMAC_SECRET as string, body);
  const base = (env.MT5_WEBHOOK_URL as string).trim().replace(/\/+$/, "");
  try {
    const resp = await fetchFn(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-slk-signature": sig },
      body,
    });
    const text = await resp.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep raw text */ }
    return { status: "sent", httpStatus: resp.status, body: parsed };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sends a confirmed entry to the MT5 bridge (live mode only). */
export async function dispatchMt5Trade(
  env: Mt5Env, mode: string, a: Alert, fetchFn: typeof fetch = fetch,
): Promise<Mt5Result> {
  if (!mt5Active(env, mode)) {
    const reason = skipReason(env, mode);
    // Only log when the owner actually configured the bridge but the safety
    // gate holds it back — avoids noise on the default paper deployment.
    if (env.MT5_WEBHOOK_URL?.trim() || (env.MT5_ENABLED ?? "").toLowerCase() === "true") {
      console.info(JSON.stringify({ level: "info", msg: "slk.mt5.skip", setupId: a.setupId, reason }));
    }
    return { status: "skipped", reason };
  }
  const riskUsd = Number(env.MT5_RISK_USD ?? "");
  const result = await postMt5(env, "/webhook/trade", buildTradePayload(a, Number.isFinite(riskUsd) && riskUsd > 0 ? riskUsd : undefined), fetchFn);
  console.info(JSON.stringify({ level: "info", msg: "slk.mt5.trade", setupId: a.setupId, pair: a.pair, direction: a.direction, result }));
  return result;
}

/** Trails the broker stop to breakeven once +R excursion arms BE (live only). */
export async function dispatchMt5Breakeven(
  env: Mt5Env, mode: string, setupId: string, pair: string, entryPrice: number,
  fetchFn: typeof fetch = fetch,
): Promise<Mt5Result> {
  if (!mt5Active(env, mode)) return { status: "skipped", reason: skipReason(env, mode) };
  const result = await postMt5(env, "/webhook/breakeven", buildBreakevenPayload(setupId, pair, entryPrice), fetchFn);
  console.info(JSON.stringify({ level: "info", msg: "slk.mt5.breakeven", setupId, pair, entryPrice, result }));
  return result;
}
