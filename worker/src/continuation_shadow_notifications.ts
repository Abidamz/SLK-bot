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
  skipped?: "missing_bot_token" | "missing_private_dm" | "multiple_private_dms";
}

/** Positive numeric Telegram chat IDs are user DMs; negative IDs are groups/channels. */
export function continuationShadowPrivateDmIds(raw?: string): string[] {
  return [...new Set(parseChatIds(raw).filter((id) => /^[1-9]\d*$/.test(id)))];
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 8 }).format(value);
}

/** Formats a private live-scan setup watch; levels are references, not fills. */
export function formatContinuationShadowDm(capture: ShadowExperimentCapture): string {
  return [
    "🟡 DEO EDGE — PRIVATE CONTINUATION SETUP WATCH",
    "Observed on the latest completed H4 candle during the scheduled market scan.",
    "Non-blocking support watch; the primary gate is unchanged. Reference levels only—not an entry fill or order.",
    "",
    `${capture.pair} · ${capture.direction} · H4 continuation setup`,
    `Reference entry: ${formatPrice(capture.entry)}`,
    `Reference stop: ${formatPrice(capture.stopLoss)}`,
    `Reference target: ${formatPrice(capture.target)}`,
    `Reference reward/risk: ${capture.rr.toFixed(2)}R`,
    "Research tracking: up to 120 M30 candles; stop-first if both reference levels are touched in one candle.",
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
  // Fail closed when the setting contains more than one personal ID. A private
  // support notice must never fan out to an unverified Telegram recipient list.
  if (chatIds.length !== 1) return { sent: 0, failed: 0, skipped: "multiple_private_dms" };

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
