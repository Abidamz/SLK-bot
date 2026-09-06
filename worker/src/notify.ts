/** Notification delivery: Telegram Bot API + Discord incoming webhook,
 *  plus the alert/outcome message formatters. Outbound HTTPS only — no
 *  webhook server needed. Secrets stay on the Worker (never the dashboard).
 *
 *  NOTE: messages are sent as plain text (no parse_mode) — alert text
 *  contains characters like ">" that would need escaping under HTML/Markdown
 *  parse modes. */
import { fmtPips, fmtPrice } from "./config";
import type { Alert, EngineEvent } from "./types";
import type { AlertRowish, NotifyEnv, OutcomeLike } from "./notify_types";

const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const GREY = 0x95a5a6;
const AMBER = 0xe67e22;

export async function sendTelegram(env: NotifyEnv, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const doFetch = env.fetchFn ?? fetch;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!resp.ok) throw new Error(`Telegram failed: HTTP ${resp.status} ${await resp.text()}`);
}

export async function sendDiscord(env: NotifyEnv, text: string, color = RED): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const doFetch = env.fetchFn ?? fetch;
  const resp = await doFetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "SLK Paper Alerts",
      content: "```\n" + text + "\n```",
      allowed_mentions: { parse: [] }, // never ping anyone
    }),
  });
  if (!resp.ok && resp.status !== 204)
    throw new Error(`Discord failed: HTTP ${resp.status} ${await resp.text()}`);
}

const KIND_NAMES: Record<string, string> = { A: "A-top", V: "V-bottom", OC: "Open-Close" };
const tfmt = (ms: number) =>
  new Date(ms).toISOString().slice(11, 16); // HH:MM UTC

export function formatAlert(a: Alert): string {
  const emoji = a.direction === "LONG" ? "🟢" : "🔴";
  const paper = a.alertStatus === "PAPER" ? "🧪 PAPER ALERT" : "ALERT";
  const [lo, hi] = a.keyLevelBounds;
  const flags: string[] = [];
  if (a.keyLevelTested) flags.push("tested");
  if (a.keyLevelFlipped) flags.push("flipped");
  if ((a.imbalanceContext as unknown[]).length) flags.push("+FVG");
  const kl =
    `${KIND_NAMES[a.keyLevelType] ?? a.keyLevelType} `
    + `${fmtPrice(a.pair, lo)}–${fmtPrice(a.pair, hi)}`
    + (flags.length ? " · " + flags.join(", ") : "");

  const lines = [
    `${emoji} SLK ${paper} — ${a.pair}`,
    `Direction   : ${a.direction}`,
    `Timeframe   : ${a.entryTf} (map ${a.mapTf})`,
    `State       : RETEST → CONFIRMED`,
    `Story       : ${a.environment} · ${a.phase} · ${a.htfAlignment}`,
    `Key level   : ${kl}`,
    `Entry       : ${fmtPrice(a.pair, a.entry)} (retest close)`,
    `Stop        : ${fmtPrice(a.pair, a.stopLoss)} (${fmtPips(a.pair, a.entry - a.stopLoss)} · beyond sweep extreme)`,
    `Target 1    : ${fmtPrice(a.pair, a.tpInternal)} internal liquidity (${fmtPips(a.pair, a.tpInternal - a.entry)}${a.rrInternal ? ` · ${a.rrInternal}R` : ""})`,
  ];
  if (a.tpExternal !== null)
    lines.push(
      `Target 2    : ${fmtPrice(a.pair, a.tpExternal)} nearest external liquidity (targets beyond are anticipatory)`,
    );
  if (a.drawOnLiquidity !== null)
    lines.push(`Draw        : ${fmtPrice(a.pair, a.drawOnLiquidity)}`);
  lines.push(
    `Invalidation: CLOSE ${a.direction === "SHORT" ? ">" : "<"} ${fmtPrice(a.pair, a.invalidationLevel)}`,
  );
  lines.push(
    `Opp. liq.   : ${a.opposingLiquidityStanding ? "standing ✅" : "NOT standing ⚠️"}`,
  );
  lines.push(
    `Path        : sweep ${tfmt(a.sweepTime)} → BOS ${tfmt(a.bosTime)} → retest ${tfmt(a.returnTime)} UTC`,
  );
  if (a.session) lines.push(`Session     : ${a.session}`);
  lines.push(`Setup ID    : ${a.setupId}`);
  lines.push("");
  lines.push("Research signal only. No order was placed.");
  return lines.join("\n");
}

export function formatOutcome(rec: AlertRowish, oc: OutcomeLike): string {
  const pair = String(rec.canonical_symbol);
  const paper = rec.alert_status === "PAPER" ? "🧪 PAPER — " : "";
  const r = oc.rMultiple;
  const [emoji, label] =
    oc.status === "TP_HIT" ? ["✅", "TP HIT"] : oc.status === "SL_HIT" ? ["❌", "SL HIT"] : ["⌛", "EXPIRED"];
  return [
    `${paper}${emoji} ${label} — ${pair} · ${rec.entry_timeframe} · ${rec.direction} (setup ${rec.setup_id})`,
    `Entry ${fmtPrice(pair, Number(rec.entry))} → Exit ${fmtPrice(pair, oc.exitPrice)}  (${r >= 0 ? "+" : ""}${r.toFixed(2)}R)`,
  ].join("\n");
}

/** Fan out to every configured channel; a failing channel is logged and
 *  skipped and never blocks the others. Returns per-channel status. */
export async function broadcast(
  env: NotifyEnv,
  text: string,
  color: number,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      await sendTelegram(env, text);
      results.telegram = "ok";
    } catch (err) {
      results.telegram = `error: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(JSON.stringify({ level: "warn", msg: "telegram delivery failed", error: results.telegram }));
    }
  }
  if (env.DISCORD_WEBHOOK_URL) {
    try {
      await sendDiscord(env, text, color);
      results.discord = "ok";
    } catch (err) {
      results.discord = `error: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(JSON.stringify({ level: "warn", msg: "discord delivery failed", error: results.discord }));
    }
  }
  if (Object.keys(results).length === 0) {
    console.info(JSON.stringify({ level: "info", msg: "no channels configured — alert logged only", preview: text.slice(0, 120) }));
  }
  return results;
}

/** Confirmed entry alerts fan out to every configured channel. The alert
 * includes the candidate entry, stop-loss, internal/external targets, and
 * invalidation level; it is still research-only and places no order. */
export async function notifyAlert(env: NotifyEnv, a: Alert): Promise<Record<string, string>> {
  return broadcast(env, formatAlert(a), a.direction === "LONG" ? GREEN : RED);
}

/** "Setup forming" heads-up (WATCH_NOTIFY=true): a TOUCH/SWEEP/SHIFT
 *  transition on an entry timeframe, hours before the confirmed retracement
 *  close would alert. Never fires on the boot scan. */
export function formatWatch(ev: EngineEvent, entryTf: string): string {
  const parts = ev.setupId.split(":");
  const direction = parts[3] ?? "";
  const stateEmoji = ev.state === "SWEEP" ? "🌊" : ev.state === "SHIFT" ? "⚡" : "👆";
  const lines = [
    `👀 WATCH — ${ev.pair} · ${entryTf} · ${direction} ${direction === "LONG" ? "🔼" : "🔽"}`,
    `State     : ${stateEmoji} ${ev.state}`,
    `Detail    : ${ev.reason}`,
  ];
  if (ev.price != null) lines.push(`Price     : ~${fmtPrice(ev.pair, ev.price)}`);
  lines.push(
    `Candle    : ${new Date(ev.candleTime).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Setup ID  : ${ev.setupId}`,
    ``,
    `Watch only — the entry alert fires on the confirmed retest candle close.`,
    `Research signal only. No order was placed.`,
  );
  return lines.join("\n");
}

export async function notifyWatch(
  env: NotifyEnv, ev: EngineEvent, entryTf: string,
): Promise<Record<string, string>> {
  return broadcast(env, formatWatch(ev, entryTf), AMBER);
}

export async function notifyOutcome(
  env: NotifyEnv, rec: AlertRowish, oc: OutcomeLike,
): Promise<Record<string, string>> {
  const color = oc.status === "TP_HIT" ? GREEN : oc.status === "SL_HIT" ? RED : GREY;
  return broadcast(env, formatOutcome(rec, oc), color);
}
