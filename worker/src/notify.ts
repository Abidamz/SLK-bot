/** Notification delivery: Telegram Bot API + Discord incoming webhook,
 *  plus the alert/outcome message formatters. Outbound HTTPS only — no
 *  webhook server needed. Secrets stay on the Worker (never the dashboard).
 *
 *  NOTE: messages are sent as plain text (no parse_mode) — alert text
 *  contains characters like ">" that would need escaping under HTML/Markdown
 *  parse modes. */
import { fmtPips, fmtPrice, isDerivPair } from "./config";
import type { Alert, Direction, EngineEvent, KeyLevel } from "./types";
import type { DirectionalBiasDiagnostics } from "./shadow";
import type { AlertRowish, NotifyEnv, OutcomeLike } from "./notify_types";

const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const GREY = 0x95a5a6;
const AMBER = 0xe67e22;

export interface TelegramSendOptions {
  silent?: boolean;
  pin?: boolean;
  chatId?: string;
}

export function parseChatIds(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Converts ASCII letters and digits to Unicode Mathematical Bold characters
 *  (e.g., "XAUUSD" -> "𝐗𝐀𝐔𝐔𝐒𝐃", "NAS100" -> "𝐍𝐀𝐒𝟏𝟎𝟎") for high-visibility
 *  native bold rendering in Telegram plain text notifications. */
export function toBold(str: string): string {
  return str.split("").map((c) => {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D400 + code - 65); // A-Z bold
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7CE + code - 48); // 0-9 bold
    return c;
  }).join("");
}

export async function sendTelegram(
  env: NotifyEnv,
  text: string,
  options: TelegramSendOptions = {},
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const targetChatIds = options.chatId ? [options.chatId] : parseChatIds(env.TELEGRAM_CHAT_ID);
  if (targetChatIds.length === 0) return;

  const doFetch = env.fetchFn ?? fetch;
  for (const chatId of targetChatIds) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    // Only pass disable_notification when explicitly silent
    if (options.silent) {
      body.disable_notification = true;
    }
    const resp = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Telegram failed: HTTP ${resp.status} ${await resp.text()}`);

    if (options.pin) {
      try {
        const data = (await resp.json()) as { ok?: boolean; result?: { message_id?: number } };
        const msgId = data?.result?.message_id;
        if (msgId) {
          const pinUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/pinChatMessage`;
          await doFetch(pinUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: msgId,
              disable_notification: true, // Silent pin so it doesn't suppress or overwrite the loud message alert
            }),
          });
        }
      } catch (pinErr) {
        console.warn(JSON.stringify({ level: "warn", msg: "telegram pin failed", chatId, error: String(pinErr) }));
      }
    }
  }
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
  const boldPair = toBold(a.pair);
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
    `🚨🚨🚨 [ACTION REQUIRED] — SLK CONFIRMED ENTRY 🚨🚨🚨`,
    `${emoji} SLK ${paper} — ${a.pair} · 🌟【 ${boldPair} 】🌟`,
    `📍 Pair       : 🌟【 ${boldPair} 】🌟`,
    `Direction   : ${a.direction} ${emoji}`,
    `Timeframe   : ${a.entryTf} (map ${a.mapTf})`,
    `State       : RETEST → CONFIRMED`,
  ];
  if (a.shadowClassification) {
    const gradeEmoji: Record<string, string> = {
      A_GRADE: "🌟",
      B_GRADE: "⭐",
      HTF_CONFLICT: "⚠️",
      OBSERVATION_ONLY: "👀",
    };
    const badge = `${gradeEmoji[a.shadowClassification] ?? "📊"} ${a.shadowClassification}`;
    lines.push(`Bias Grade  : ${badge}`);
  }
  if (a.directionalBias) {
    const db = a.directionalBias;
    const sweepSide = db.weekly.weeklyHighSwept
      ? "Prior High Swept"
      : db.weekly.weeklyLowSwept
      ? "Prior Low Swept"
      : "No sweep";
    const oppSide = a.direction === "LONG" ? "Opposing High" : "Opposing Low";
    const standingStr = db.weekly.primaryOpposingTarget
      ? `Standing (${fmtPrice(a.pair, db.weekly.primaryOpposingTarget)})`
      : db.weekly.opposingLiquidityStanding
      ? "Standing ✅"
      : "Taken";
    lines.push(`Weekly Cont.: ${sweepSide} · ${oppSide} ${standingStr}`);
    const dBreakout = db.daily.bodyToBodyBreakout === "bullish"
      ? "Bullish Breakout"
      : db.daily.bodyToBodyBreakout === "bearish"
      ? "Bearish Breakout"
      : "Neutral";
    lines.push(`Daily Cont. : ${dBreakout}`);
    lines.push(`4H Vantage  : ${db.h4.direction} (${db.h4.breakoutStatus})`);
    lines.push(`1H Alignment: ${db.h1.direction} (${db.h1.agreesWith4H ? "Agrees with 4H ✅" : "HTF Conflict ⚠️"})`);
    const eq = db.entryQuality;
    const eqParts: string[] = [
      `Sweep ${eq.lowerTimeframeSweep ? "✅" : "❌"}`,
      `BOS ${eq.bosStructureShift ? "✅" : "❌"}`,
      `FVG Rebalance ${eq.fvgRebalanceDetected ? "✅" : eq.fvgDetected ? "⚠️" : "❌"}`,
      `Retest ${eq.retestDetected ? "✅" : "❌"}`,
    ];
    lines.push(`Entry Qual. : ${eqParts.join(" · ")}`);
  }
  lines.push(
    `Story       : ${a.environment} · ${a.phase} · ${a.htfAlignment}`,
    `Key level   : ${kl}`,
    `Entry       : ${fmtPrice(a.pair, a.entry)} (retest close)`,
    `Stop        : ${fmtPrice(a.pair, a.stopLoss)} (${fmtPips(a.pair, a.entry - a.stopLoss)} · beyond sweep extreme)`,
    `Target 1    : ${fmtPrice(a.pair, a.tpInternal)} internal liquidity (${fmtPips(a.pair, a.tpInternal - a.entry)}${a.rrInternal ? ` · ${a.rrInternal}R` : ""})`,
  );
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

export function formatFreeTpTeaser(rec: AlertRowish, oc: OutcomeLike): string {
  const pair = String(rec.canonical_symbol);
  const boldPair = toBold(pair);
  const dir = String(rec.direction);
  const dirEmoji = dir === "LONG" ? "🟢" : "🔴";
  const r = oc.rMultiple;
  const tp1 = rec.tp_internal != null ? fmtPrice(pair, Number(rec.tp_internal)) : fmtPrice(pair, oc.exitPrice);

  return [
    `🎯 TP1 HIT — 🌟【 ${boldPair} 】🌟 ${dir} (+${r.toFixed(2)}R)`,
    ``,
    `📍 Pair      : 🌟【 ${boldPair} 】🌟`,
    `• Timeframe : ${rec.entry_timeframe}`,
    `• Direction : ${dir} ${dirEmoji}`,
    `• Entry     : ${fmtPrice(pair, Number(rec.entry))}`,
    `• Target 1  : ${tp1} (+${r.toFixed(2)}R) ✅`,
    `• Target 2  : Running risk-free toward external liquidity`,
    ``,
    `VIP members received this alert with exact entry, stop floor, and lot size calculations.`,
    ``,
    `Stop missing the moves.`,
    `👉 Join VIP ($100/mo · $49 with code FOUNDING20): https://whop.com/slk-radar/slk-radar-vip-signals`,
    `👉 Live Verified Journal: https://slk-radar.pages.dev`,
  ].join("\n");
}

export function formatOutcome(rec: AlertRowish, oc: OutcomeLike): string {
  const pair = String(rec.canonical_symbol);
  const boldPair = toBold(pair);
  const paper = rec.alert_status === "PAPER" ? "🧪 PAPER — " : "";
  const r = oc.rMultiple;
  const [emoji, label] =
    oc.status === "TP_HIT" ? ["✅", "TP HIT"] : oc.status === "SL_HIT" ? ["❌", "SL HIT"] : ["⌛", "EXPIRED"];
  const lines = [
    `${paper}${emoji} ${label} — 🌟【 ${boldPair} 】🌟 · ${rec.entry_timeframe} · ${rec.direction} (setup ${rec.setup_id})`,
    `📍 Pair     : 🌟【 ${boldPair} 】🌟`,
    `Entry ${fmtPrice(pair, Number(rec.entry))} → Exit ${fmtPrice(pair, oc.exitPrice)}  (${r >= 0 ? "+" : ""}${r.toFixed(2)}R)`,
  ];
  if (rec.stop_loss != null) lines.push(`Stop ${fmtPrice(pair, Number(rec.stop_loss))}`);
  if (rec.tp_internal != null) lines.push(`Target 1 ${fmtPrice(pair, Number(rec.tp_internal))}`);
  if (rec.tp_external != null) lines.push(`Target 2 ${fmtPrice(pair, Number(rec.tp_external))}`);
  return lines.join("\n");
}

export interface BroadcastOptions {
  silent?: boolean;
  pin?: boolean;
  sendToDm?: boolean;
  pair?: string;
  chatId?: string;
}

/** Fan out to every configured channel; a failing channel is logged and
 *  skipped and never blocks the others. Returns per-channel status. */
export async function broadcast(
  env: NotifyEnv,
  text: string,
  color: number,
  options: BroadcastOptions = {},
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const telegramAllowed = !env.watchOnly || env.WATCH_TELEGRAM !== "false";
  const discordAllowed = !env.watchOnly || env.WATCH_DISCORD !== "false";
  const pair = options.pair ?? "";
  const isDeriv = isDerivPair(pair);
  const targetChannelIds = options.chatId
    ? [options.chatId]
    : isDeriv
    ? parseChatIds(env.TELEGRAM_DERIV_CHAT_ID || env.TELEGRAM_CHAT_ID)
    : parseChatIds(env.TELEGRAM_CHAT_ID);

  if (telegramAllowed && env.TELEGRAM_BOT_TOKEN && targetChannelIds.length > 0) {
    for (const chatId of targetChannelIds) {
      try {
        await sendTelegram(env, text, { ...options, chatId });
        results.telegram = "ok";
      } catch (err) {
        results.telegram = `error: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(JSON.stringify({ level: "warn", msg: "telegram delivery failed", error: results.telegram }));
      }
    }
  }

  // Simultaneously deliver loud signals to private DM if configured and requested
  const shouldSendDm = options.sendToDm ?? (!options.silent);
  if (telegramAllowed && shouldSendDm && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_DM_CHAT_ID) {
    const channelIds = targetChannelIds;
    const dmIds = parseChatIds(env.TELEGRAM_DM_CHAT_ID);
    for (const dmId of dmIds) {
      if (channelIds.includes(dmId)) continue; // Don't duplicate if DM ID is already in target channel
      try {
        await sendTelegram(env, text, { silent: false, pin: false, chatId: dmId });
        results.telegram_dm = "ok";
      } catch (err) {
        results.telegram_dm = `error: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(JSON.stringify({ level: "warn", msg: "telegram DM delivery failed", dmId, error: results.telegram_dm }));
      }
    }
  }

  if (discordAllowed && env.DISCORD_WEBHOOK_URL) {
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
 * invalidation level; it is still research-only and places no order.
 * Entry alerts are sent LOUD and auto-pinned to prevent missing execution,
 * and simultaneously sent to personal private DM so it cannot be missed. */
export async function notifyAlert(env: NotifyEnv, a: Alert): Promise<Record<string, string>> {
  return broadcast(env, formatAlert(a), a.direction === "LONG" ? GREEN : RED, { silent: false, pin: true, sendToDm: true, pair: a.pair });
}

/** "Setup forming" heads-up (WATCH_NOTIFY=true): a SWEEP or SHIFT
 *  transition on an entry timeframe. Delivered SILENTLY so phones do not vibrate. */
export function formatWatch(ev: EngineEvent, entryTf: string, options?: { isFreeChannel?: boolean }): string {
  const parts = ev.setupId.split(":");
  const direction = parts[3] ?? "";
  const boldPair = toBold(ev.pair);
  const originKind = parts[4] ?? "";
  const originPrice = parts[5] ? Number(parts[5]) : null;
  const stateEmoji = ev.state === "SWEEP" ? "🌊" : ev.state === "SHIFT" ? "⚡" : "👆";
  const lines = [
    `👀 WATCH (Silent Radar) — 🌟【 ${boldPair} 】🌟 · ${entryTf} · ${direction} ${direction === "LONG" ? "🔼" : "🔽"}`,
    `📍 Pair     : 🌟【 ${boldPair} 】🌟`,
    `State      : ${stateEmoji} ${ev.state}`,
    `Detail     : ${ev.reason}`,
  ];
  if (originPrice != null && Number.isFinite(originPrice)) {
    lines.push(`Origin Zone: ~${fmtPrice(ev.pair, originPrice)} (${originKind}-Level Zone)`);
  }
  if (ev.biasGrade) lines.push(`Bias Grade : ${ev.biasGrade}`);
  if (ev.price != null) lines.push(`Price      : ~${fmtPrice(ev.pair, ev.price)}`);
  lines.push(
    `Candle     : ${new Date(ev.candleTime).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Setup ID   : ${ev.setupId}`,
    ``,
    `Quiet radar heads-up — real entry signal fires on confirmed retest candle close.`,
    `Research signal only. No order was placed.`,
  );
  if (options?.isFreeChannel) {
    lines.push(
      ``,
      `────────────────────────`,
      `👑 VIP receives the live entry alert the second confirmation triggers.`,
      `👉 Join VIP ($100/mo · $49 with code FOUNDING20): https://whop.com/slk-radar/slk-radar-vip-signals`,
    );
  }
  return lines.join("\n");
}

export function formatBiasCard(
  pair: string,
  direction: Direction,
  diag: DirectionalBiasDiagnostics,
  origin?: KeyLevel | null,
  currentPrice?: number,
  options?: { isFreeChannel?: boolean },
): string {
  const boldPair = toBold(pair);
  const emoji = direction === "LONG" ? "🟢" : "🔴";
  const gradeLabel = diag.classification === "A_GRADE"
    ? "⭐ A_GRADE (HTF Aligned)"
    : "✨ B_GRADE (Strong Bias)";
  const weeklyTarget = diag.weekly.primaryOpposingTarget !== null
    ? `${fmtPrice(pair, diag.weekly.primaryOpposingTarget)} (${diag.weekly.opposingLiquidityStanding ? "standing ✅" : "taken"})`
    : "open";

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const h4Status = diag.h4.breakoutStatus.replace(/_/g, " ").split(" ").map(capitalize).join(" ");

  const lines = [
    `🧭 SLK BIAS CONFIRMATION (Silent Context) — 🌟【 ${boldPair} 】🌟`,
    `📍 Pair       : 🌟【 ${boldPair} 】🌟`,
    `Direction    : ${direction} ${emoji} · ${gradeLabel}`,
    `4H Vantage   : ${diag.h4.direction.toUpperCase()} (${h4Status})`,
    `1H Alignment : ${diag.h1.direction.toUpperCase()} (${diag.h1.agreesWith4H ? "agrees with 4H ✅" : "neutral"})`,
    `Daily Context: ${diag.daily.bias.toUpperCase()} (${capitalize(diag.daily.bodyToBodyBreakout)} Breakout)`,
    `Weekly Target: ${weeklyTarget}`,
  ];

  if (origin) {
    const structType = origin.flipped
      ? "Flipped Breaker (Disrespected Support/Resistance)"
      : `${origin.kind}-Level Origin Zone`;
    const fvgText = origin.fvgOverlap
      ? "Overlaps 30m/1H FVG Imbalance ✅"
      : "High-Volume Mitigation Zone";
    lines.push(
      ``,
      `🎯 Armed Retracement Zone: ${fmtPrice(pair, origin.zoneLo)} – ${fmtPrice(pair, origin.zoneHi)}`,
      `   • Structure : ${structType}`,
      `   • Confluence: ${fvgText}`,
      `   • History   : ${origin.touches} prior reaction test${origin.touches === 1 ? "" : "s"}`,
    );
    if (currentPrice != null && Number.isFinite(currentPrice)) {
      const dist = Math.abs(currentPrice - origin.originPrice);
      lines.push(`   • Distance  : ~${fmtPips(pair, dist)} from current price`);
    }
  }

  lines.push(
    ``,
    `Higher timeframe structure is confirmed. Monitoring for pullback retest into zone.`,
    `Research analysis only. No order was placed.`,
  );

  if (options?.isFreeChannel) {
    lines.push(
      ``,
      `────────────────────────`,
      `👑 VIP members receive exact entry alerts, stop loss, and 1:2.5R–4.0R target execution.`,
      `👉 Join VIP ($100/mo · $49 with code FOUNDING20): https://whop.com/slk-radar/slk-radar-vip-signals`,
    );
  }

  return lines.join("\n");
}

export async function notifyBias(
  env: NotifyEnv,
  pair: string,
  direction: Direction,
  diag: DirectionalBiasDiagnostics,
  origin?: KeyLevel | null,
  currentPrice?: number,
): Promise<Record<string, string>> {
  const color = direction === "LONG" ? GREEN : RED;
  const card = formatBiasCard(pair, direction, diag, origin, currentPrice);
  const results = await broadcast(env, card, color, { silent: true, pin: false, sendToDm: false, pair });

  // Broadcast bias card to Free Telegram Channel as educational market context
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_FREE_CHAT_ID) {
    const freeChatIds = parseChatIds(env.TELEGRAM_FREE_CHAT_ID);
    const freeCard = formatBiasCard(pair, direction, diag, origin, currentPrice, { isFreeChannel: true });
    for (const freeId of freeChatIds) {
      try {
        await sendTelegram(env, freeCard, { silent: true, pin: false, chatId: freeId });
        results.telegram_free_bias = "ok";
      } catch (err) {
        console.warn(JSON.stringify({ level: "warn", msg: "telegram free bias delivery failed", freeId, error: String(err) }));
      }
    }
  }

  return results;
}

export async function notifyWatch(
  env: NotifyEnv, ev: EngineEvent, entryTf: string,
): Promise<Record<string, string>> {
  const text = formatWatch(ev, entryTf);
  const results = await broadcast(env, text, AMBER, { silent: true, pin: false, sendToDm: false, pair: ev.pair });

  // Broadcast watch heads-up to Free Telegram Channel
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_FREE_CHAT_ID) {
    const freeChatIds = parseChatIds(env.TELEGRAM_FREE_CHAT_ID);
    const freeText = formatWatch(ev, entryTf, { isFreeChannel: true });
    for (const freeId of freeChatIds) {
      try {
        await sendTelegram(env, freeText, { silent: true, pin: false, chatId: freeId });
        results.telegram_free_watch = "ok";
      } catch (err) {
        console.warn(JSON.stringify({ level: "warn", msg: "telegram free watch delivery failed", freeId, error: String(err) }));
      }
    }
  }

  return results;
}

export async function notifyOutcome(
  env: NotifyEnv, rec: AlertRowish, oc: OutcomeLike,
): Promise<Record<string, string>> {
  const color = oc.status === "TP_HIT" ? GREEN : oc.status === "SL_HIT" ? RED : GREY;
  const pair = String(rec.canonical_symbol ?? "");
  const results = await broadcast(env, formatOutcome(rec, oc), color, { silent: false, pin: false, sendToDm: true, pair });

  // When a VIP trade hits Take Profit (TP_HIT), automatically send the high-converting Win Teaser to the Free Channel!
  if (oc.status === "TP_HIT" && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_FREE_CHAT_ID) {
    const freeChatIds = parseChatIds(env.TELEGRAM_FREE_CHAT_ID);
    const teaser = formatFreeTpTeaser(rec, oc);
    for (const freeId of freeChatIds) {
      try {
        await sendTelegram(env, teaser, { silent: false, pin: false, chatId: freeId });
        results.telegram_free_teaser = "ok";
      } catch (err) {
        results.telegram_free_teaser = `error: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(JSON.stringify({ level: "warn", msg: "telegram free TP teaser failed", freeId, error: results.telegram_free_teaser }));
      }
    }
  }

  return results;
}
