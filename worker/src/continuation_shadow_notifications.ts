/**
 * Private-only notification path for continuation setup watches and manual
 * demo-entry references. This deliberately does not call the shared broadcast
 * helper, so it cannot reach Telegram groups/channels or Discord.
 */
import { parseChatIds, sendTelegram } from "./notify";
import type { NotifyEnv } from "./notify_types";
import type { ContinuationDemoEntry } from "./continuation_demo_entries";
import { CONTINUATION_DEMO_SETUP_TTL_MS } from "./continuation_demo_entries";
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
  return formatContinuationShadowDmGroup([capture]);
}

/** Groups same-pair/direction/H4-close candidates for one private manual-choice DM. */
export function groupContinuationShadowCaptures(
  captures: ShadowExperimentCapture[],
): ShadowExperimentCapture[][] {
  const groups = new Map<string, ShadowExperimentCapture[]>();
  for (const capture of captures) {
    const key = [capture.pair, capture.candleCloseTime].join("|");
    const group = groups.get(key) ?? [];
    group.push(capture);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => group.sort((a, b) =>
    a.entry - b.entry || a.experimentId.localeCompare(b.experimentId),
  ));
}

/** One post-H4 setup watch for all levels from the same pair/direction/close. */
export function formatContinuationShadowDmGroup(captures: ShadowExperimentCapture[]): string {
  if (!captures.length) return "";
  const first = captures[0];
  const lines = [
    "🟡 DEO EDGE — PRIVATE CONTINUATION SETUP WATCH",
    "Observed on the latest completed H4 candle during the scheduled market scan.",
    "Waiting for a fresh post-close M30 touch and close back in the setup direction.",
    "Reference levels only—not an entry fill or order. The primary gate is unchanged.",
    "",
    `${first.pair} · H4 continuation setups`,
    ...captures.map((capture, index) => [
      `Candidate ${index + 1} · ${capture.direction}:`,
      `  Reference entry: ${formatPrice(capture.entry)}`,
      `  Reference stop: ${formatPrice(capture.stopLoss)}`,
      `  Reference target: ${formatPrice(capture.target)}`,
      `  Reference reward/risk: ${capture.rr.toFixed(2)}R`,
    ].join("\n")),
    "Research tracking: up to 120 M30 candles; stop-first if both reference levels are touched in one candle.",
    `H4 setup close: ${new Date(first.candleCloseTime).toISOString()}`,
    `Pending watch expires: ${new Date(first.candleCloseTime + CONTINUATION_DEMO_SETUP_TTL_MS).toISOString()}`,
    "Manual selection only; no automatic entry or order placement.",
  ];
  return lines.join("\n");
}

/** Formats a fresh, private manual demo-entry reference after the M30 trigger. */
export function formatContinuationDemoEntryDm(entries: ContinuationDemoEntry[]): string {
  if (!entries.length) return "";
  const first = entries[0];
  const lines = [
    "🟢 DEO EDGE — PRIVATE MANUAL DEMO ENTRY",
    "Fresh post-H4 M30 touch-and-close confirmation detected.",
    "Entry is referenced at the next M30 open; H4 stop and target stay fixed.",
    "",
    `${first.capture.pair} · H4 continuation setups`,
    `M30 trigger close: ${new Date(first.triggerCandleCloseTime).toISOString()}`,
    `Next M30 open: ${new Date(first.entryTime).toISOString()}`,
    ...entries.map((entry, index) => [
      `Candidate ${index + 1} · ${entry.capture.direction}:`,
      `  Original H4 reference level: ${formatPrice(entry.capture.entry)}`,
      `  Demo entry reference: ${formatPrice(entry.entryPrice)}`,
      `  Fixed H4 stop: ${formatPrice(entry.stopLoss)}`,
      `  Fixed H4 target: ${formatPrice(entry.target)}`,
      `  Actual R:R from next-open entry: ${entry.rr.toFixed(2)}R`,
    ].join("\n")),
    `Setup expires: ${new Date(first.capture.candleCloseTime + CONTINUATION_DEMO_SETUP_TTL_MS).toISOString()}`,
    "One-minute alert cutoff from the next M30 open; skip if this DM arrives later.",
    "Choose manually from the listed levels. No automatic selection or order is placed.",
    "Demo only. Verify your current demo quote; skip if it has moved from the reference. The primary live gate is unchanged.",
  ];
  return lines.join("\n");
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
