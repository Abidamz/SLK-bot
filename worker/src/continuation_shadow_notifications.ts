/**
 * Private-only notification path for newly persisted continuation candidates.
 * This deliberately does not call the shared broadcast helper, so it cannot
 * reach Telegram groups/channels or Discord.
 */
import { parseChatIds, sendTelegram } from "./notify";
import type { NotifyEnv } from "./notify_types";
import type { ShadowExperimentCapture } from "./types";

export interface ContinuationShadowDmResult {
  sent: number;
  failed: number;
  skipped?: "missing_bot_token" | "missing_private_dm";
}

/** Positive numeric Telegram chat IDs are user DMs; negative IDs are groups/channels. */
export function continuationShadowPrivateDmIds(raw?: string): string[] {
  return [...new Set(parseChatIds(raw).filter((id) => /^[1-9]\d*$/.test(id)))];
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 8 }).format(value);
}

/** Clearly marks the candidate as hypothetical and separates setup/outcome TFs. */
export function formatContinuationShadowDm(capture: ShadowExperimentCapture): string {
  return [
    "🧪 DEO EDGE — PAPER SHADOW CANDIDATE",
    "Hypothetical research entry only — not a live alert or order.",
    "",
    `${capture.pair} · ${capture.direction} · H4 continuation setup`,
    `Hypothetical entry: ${formatPrice(capture.entry)}`,
    `Hypothetical stop: ${formatPrice(capture.stopLoss)}`,
    `Hypothetical target: ${formatPrice(capture.target)}`,
    `Planned reward/risk: ${capture.rr.toFixed(2)}R`,
    "Outcome check: up to 120 M30 candles; stop-first if both levels hit in one candle.",
    `H4 setup close: ${new Date(capture.candleCloseTime).toISOString()}`,
  ].join("\n");
}

/** Sends text only to positive numeric IDs from the private-DM setting. */
export async function sendContinuationShadowPrivateDmText(
  env: NotifyEnv,
  rawDmChatIds: string | undefined,
  text: string,
): Promise<ContinuationShadowDmResult> {
  if (!env.TELEGRAM_BOT_TOKEN) return { sent: 0, failed: 0, skipped: "missing_bot_token" };
  const chatIds = continuationShadowPrivateDmIds(rawDmChatIds);
  if (!chatIds.length) return { sent: 0, failed: 0, skipped: "missing_private_dm" };

  let sent = 0;
  let failed = 0;
  for (const chatId of chatIds) {
    try {
      // Explicit chatId bypasses TELEGRAM_CHAT_ID; no group/channel fallback.
      await sendTelegram(env, text, { chatId, silent: false, pin: false });
      sent++;
    } catch (err) {
      failed++;
      console.warn(JSON.stringify({
        level: "warn",
        msg: "continuation shadow private Telegram DM failed",
        error: String(err),
      }));
    }
  }
  return { sent, failed };
}

export async function sendContinuationShadowPrivateDm(
  env: NotifyEnv,
  rawDmChatIds: string | undefined,
  capture: ShadowExperimentCapture,
): Promise<ContinuationShadowDmResult> {
  return sendContinuationShadowPrivateDmText(env, rawDmChatIds, formatContinuationShadowDm(capture));
}

export function formatContinuationShadowDmTest(): string {
  return [
    "✅ DEO EDGE — PRIVATE TELEGRAM DELIVERY TEST",
    "This confirms the continuation paper-test route reaches this private DM.",
    "No market setup, alert row, or order was created.",
  ].join("\n");
}
