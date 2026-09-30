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
import type { AlertRowish, NotifyEnv, OutcomeLike, PerformanceRecapStats } from "./notify_types";

const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const GREY = 0x95a5a6;
const AMBER = 0xe67e22;

export interface TelegramSendOptions {
  silent?: boolean;
  pin?: boolean;
  chatId?: string;
  photoUrl?: string;
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
    let sentMsgId: number | undefined;
    let photoSent = false;

    // Serverless visual chart snapshot via Telegram sendPhoto (Recommendation 3)
    if (options.photoUrl && env.CHART_SNAPSHOTS === "true") {
      const photoUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
      const caption = text.length <= 1024 ? text : text.slice(0, 1020) + "...";
      const photoBody: Record<string, unknown> = {
        chat_id: chatId,
        photo: options.photoUrl,
        caption,
      };
      if (options.silent) photoBody.disable_notification = true;
      try {
        const pResp = await doFetch(photoUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(photoBody),
        });
        if (pResp.ok) {
          photoSent = true;
          const pData = (await pResp.json()) as { ok?: boolean; result?: { message_id?: number } };
          sentMsgId = pData?.result?.message_id;
        }
      } catch (pErr) {
        console.warn(JSON.stringify({ level: "warn", msg: "sendPhoto failed, falling back to sendMessage", error: String(pErr) }));
      }
    }

    if (!photoSent) {
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
      const data = (await resp.json()) as { ok?: boolean; result?: { message_id?: number } };
      sentMsgId = data?.result?.message_id;
    }

    if (options.pin && sentMsgId) {
      try {
        const pinUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/pinChatMessage`;
        await doFetch(pinUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: sentMsgId,
            disable_notification: true, // Silent pin so it doesn't suppress or overwrite the loud message alert
          }),
        });
      } catch (pinErr) {
        console.warn(JSON.stringify({ level: "warn", msg: "telegram pin failed", chatId, error: String(pinErr) }));
      }
    }
  }
}

/**
 * Creates a single-use expiring invite link to a VIP channel via Telegram Bot API.
 */
export async function createTelegramInviteLink(
  env: NotifyEnv,
  chatId: string,
  name?: string,
  memberLimit = 1,
  expireHours = 48,
): Promise<string | null> {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return null;
  const doFetch = env.fetchFn ?? fetch;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/createChatInviteLink`;
  const expireDate = Math.floor(Date.now() / 1000) + expireHours * 3600;
  try {
    const resp = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        name: name ?? "SLK VIP Access",
        member_limit: memberLimit,
        expire_date: expireDate,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(JSON.stringify({ level: "warn", msg: "createChatInviteLink failed", chatId, error: errText }));
      return null;
    }
    const data = (await resp.json()) as { ok?: boolean; result?: { invite_link?: string } };
    return data?.result?.invite_link ?? null;
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "createChatInviteLink network error", error: String(err) }));
    return null;
  }
}

/**
 * Revokes a member's access from a Telegram channel via ban+unban.
 */
export async function kickTelegramMember(
  env: NotifyEnv,
  chatId: string,
  userId: number | string,
): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId || !userId) return false;
  const doFetch = env.fetchFn ?? fetch;
  const banUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/banChatMember`;
  const unbanUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/unbanChatMember`;
  try {
    const bResp = await doFetch(banUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    if (!bResp.ok) return false;
    await doFetch(unbanUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: userId, only_if_banned: true }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates HMAC-SHA256 signature from Whop webhooks.
 */
export async function verifyWhopWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret) return true;
  if (!signatureHeader) return false;

  let receivedHex = signatureHeader;
  let signedPayload = rawBody;

  if (signatureHeader.includes("v1=")) {
    const parts = signatureHeader.split(",");
    const tPart = parts.find((p) => p.startsWith("t="));
    const v1Part = parts.find((p) => p.startsWith("v1="));
    if (tPart && v1Part) {
      const timestamp = tPart.slice(2);
      receivedHex = v1Part.slice(3);
      signedPayload = `${timestamp}.${rawBody}`;
    }
  }

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
    const computedHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return computedHex.toLowerCase() === receivedHex.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Maps an instrument to its institutional TradingView or Deriv chart link.
 */
export function getChartUrl(pair: string): string {
  const p = pair.toUpperCase().replace("/", "").replace("=X", "").replace("-", "");
  if (isDerivPair(p)) {
    return `https://app.deriv.com/dtrader?symbol=${p}`;
  }
  const tvMap: Record<string, string> = {
    US30: "CURRENCYCOM:US30",
    NAS100: "CURRENCYCOM:US100",
    GER40: "CURRENCYCOM:DE40",
    JAPAN225: "CURRENCYCOM:JP225",
    XAUUSD: "OANDA:XAUUSD",
    EURUSD: "FX:EURUSD",
    GBPUSD: "FX:GBPUSD",
    USDJPY: "FX:USDJPY",
    AUDJPY: "FX:AUDJPY",
    GBPJPY: "FX:GBPJPY",
  };
  return `https://www.tradingview.com/chart/?symbol=${tvMap[p] ?? `FX:${p}`}`;
}

/**
 * Generates an institutional visual candlestick/level snapshot image URL via QuickChart (Recommendation 3).
 */
export function generateQuickChartUrl(a: Alert): string {
  const entry = Number(a.entry);
  const sl = Number(a.stopLoss);
  const tp1 = Number(a.tpInternal);
  const tp2 = a.tpExternal ? Number(a.tpExternal) : null;
  const origin = Number(a.originKeyLevel);

  const prices = [entry, sl, tp1];
  if (tp2) prices.push(tp2);
  if (origin) prices.push(origin);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pad = (maxP - minP) * 0.15 || (entry * 0.005);

  const chartConfig = {
    type: "line",
    data: {
      labels: ["Origin Zone", "Liquidity Sweep", "Structure Shift", "Retest Trigger", "Target 1"],
      datasets: [
        {
          label: "Entry",
          data: [null, null, null, entry, entry],
          borderColor: "#3b82f6",
          borderWidth: 3,
          pointBackgroundColor: "#3b82f6",
          pointRadius: 5,
          fill: false,
        },
        {
          label: "Stop Loss",
          data: [sl, sl, sl, sl, sl],
          borderColor: "#ef4444",
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
        {
          label: "Target 1 (Internal)",
          data: [tp1, tp1, tp1, tp1, tp1],
          borderColor: "#10b981",
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: `SLK MODEL · ${a.pair} ${a.entryTf} ${a.direction} (${a.rrInternal ? `1:${a.rrInternal}R` : "1:2.5R"})`,
        fontColor: "#f8fafc",
        fontSize: 16,
      },
      legend: {
        labels: { fontColor: "#94a3b8" },
      },
      scales: {
        xAxes: [{ ticks: { fontColor: "#94a3b8" }, gridLines: { color: "#334155" } }],
        yAxes: [{
          ticks: {
            fontColor: "#94a3b8",
            min: Math.floor((minP - pad) * 100000) / 100000,
            max: Math.ceil((maxP + pad) * 100000) / 100000,
          },
          gridLines: { color: "#334155" },
        }],
      },
    },
  };

  const jsonStr = JSON.stringify(chartConfig);
  return `https://quickchart.io/chart?w=600&h=350&bkg=%230b0f17&c=${encodeURIComponent(jsonStr)}`;
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
  lines.push(`Chart View  : ${getChartUrl(a.pair)}`);
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
    oc.status === "TP_HIT"
      ? ["✅", "TP HIT"]
      : oc.status === "SL_HIT"
      ? ["❌", "SL HIT"]
      : oc.status === "BE_HIT"
      ? ["🛡️", "BREAKEVEN HIT — [ACTION: EXIT AT ENTRY]"]
      : ["⌛", "EXPIRED"];
  const lines = [
    `${paper}${emoji} ${label} — 🌟【 ${boldPair} 】🌟 · ${rec.entry_timeframe} · ${rec.direction} (setup ${rec.setup_id})`,
    `📍 Pair     : 🌟【 ${boldPair} 】🌟`,
    `Entry ${fmtPrice(pair, Number(rec.entry))} → Exit ${fmtPrice(pair, oc.exitPrice)}  (${r >= 0 ? "+" : ""}${r.toFixed(2)}R)`,
  ];
  if (oc.status === "BE_HIT") {
    lines.push(
      "🛡️ INSTRUCTION: Trade was secured at Breakeven after reaching +1.50R favorable excursion.",
      "👉 ACTION: Exit / close position flat at Entry price (0.00R). Zero loss incurred — account 100% protected. Await the next SLK confirmed setup.",
    );
  }
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
  photoUrl?: string;
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
  const vipWatchEnabled = (env.VIP_WATCH_TELEGRAM ?? env.VIP_WATCH_NOTIFY ?? "false").toLowerCase() === "true";
  const telegramAllowed = !env.watchOnly || (env.WATCH_TELEGRAM !== "false" && vipWatchEnabled);
  const discordAllowed = !env.watchOnly || env.WATCH_DISCORD !== "false";
  const pair = options.pair ?? "";
  const isDeriv = isDerivPair(pair);
  const targetChannelIds = options.chatId
    ? [options.chatId]
    : isDeriv
    ? parseChatIds(env.TELEGRAM_DERIV_CHAT_ID)
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
  const photoUrl = generateQuickChartUrl(a);
  return broadcast(env, formatAlert(a), a.direction === "LONG" ? GREEN : RED, {
    silent: false,
    pin: true,
    sendToDm: true,
    pair: a.pair,
    photoUrl,
  });
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

export function getFreeChatIds(env: NotifyEnv, pair?: string): string[] {
  const isDeriv = pair ? isDerivPair(pair) : false;
  if (isDeriv) {
    // Synthetic watch radar, bias confirmation cards, and win teasers route strictly
    // to the dedicated Synthetics Free channel (TELEGRAM_DERIV_FREE_CHAT_ID) and never leak into the Forex Free channel
    return parseChatIds(env.TELEGRAM_DERIV_FREE_CHAT_ID);
  }
  // Institutional (forex/indices) teasers route strictly to the Forex Free channel
  return parseChatIds(env.TELEGRAM_FREE_CHAT_ID);
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
  const results = await broadcast({ ...env, watchOnly: true }, card, color, { silent: true, pin: false, sendToDm: false, pair });

  // Broadcast bias card to Free Telegram Channel as educational market context
  const freeChatIds = getFreeChatIds(env, pair);
  if (env.TELEGRAM_BOT_TOKEN && freeChatIds.length > 0) {
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
  const results = await broadcast({ ...env, watchOnly: true }, text, AMBER, { silent: true, pin: false, sendToDm: false, pair: ev.pair });

  // Broadcast watch heads-up to Free Telegram Channel
  const freeChatIds = getFreeChatIds(env, ev.pair);
  if (env.TELEGRAM_BOT_TOKEN && freeChatIds.length > 0) {
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
  const color = oc.status === "TP_HIT" ? GREEN : oc.status === "SL_HIT" ? RED : oc.status === "BE_HIT" ? AMBER : GREY;
  const pair = String(rec.canonical_symbol ?? "");
  const results = await broadcast(env, formatOutcome(rec, oc), color, { silent: false, pin: false, sendToDm: true, pair });

  // When a VIP trade hits Take Profit (TP_HIT), automatically send the high-converting Win Teaser to the Free Channel!
  const freeChatIds = getFreeChatIds(env, pair);
  if (oc.status === "TP_HIT" && env.TELEGRAM_BOT_TOKEN && freeChatIds.length > 0) {
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

// ------------------------------------------------ Performance Journal Recaps

/**
 * Aggregates verified performance stats for institutional or synthetic segments
 * over a given rolling period (daily 24h or weekly 7d).
 */
export function computeRecapStats(
  rows: AlertRowish[],
  segment: "institutional" | "synthetics",
  period: "daily" | "weekly",
  nowMs: number = Date.now(),
): PerformanceRecapStats {
  const isTargetSegment = (symbol: string) => {
    const isSynth = isDerivPair(symbol);
    return segment === "synthetics" ? isSynth : !isSynth;
  };

  const segmentRows = rows.filter((r) => isTargetSegment(String(r.canonical_symbol ?? "")));

  // Window for period: daily = past 24 hours; weekly = past 7 days
  const windowMs = period === "daily" ? 24 * 3600 * 1000 : 7 * 86400 * 1000;
  const cutoffMs = nowMs - windowMs;

  // Closed trades in period
  const periodClosed = segmentRows.filter((r) => {
    const exitTimeStr = r.exit_time ?? r.candle_close_time;
    const t = exitTimeStr ? Date.parse(String(exitTimeStr)) : NaN;
    if (!Number.isFinite(t) || t < cutoffMs || t > nowMs) return false;
    const s = String(r.status ?? "").toUpperCase();
    return s === "TP_HIT" || s === "SL_HIT" || s === "BE_HIT";
  });

  const periodTp = periodClosed.filter((r) => String(r.status ?? "").toUpperCase() === "TP_HIT").length;
  const periodSl = periodClosed.filter((r) => String(r.status ?? "").toUpperCase() === "SL_HIT").length;
  const periodBe = periodClosed.filter((r) => String(r.status ?? "").toUpperCase() === "BE_HIT").length;
  const periodDecided = periodTp + periodSl;
  const periodWinRate = periodDecided > 0 ? (periodTp / periodDecided) * 100 : null;
  const periodNetR = periodClosed.reduce((sum, r) => sum + (Number(r.r_multiple) || 0), 0);

  // All-time closed trades in segment
  const allTimeClosed = segmentRows.filter((r) => {
    const s = String(r.status ?? "").toUpperCase();
    return s === "TP_HIT" || s === "SL_HIT" || s === "BE_HIT";
  });
  const allTimeTp = allTimeClosed.filter((r) => String(r.status ?? "").toUpperCase() === "TP_HIT").length;
  const allTimeSl = allTimeClosed.filter((r) => String(r.status ?? "").toUpperCase() === "SL_HIT").length;
  const allTimeDecided = allTimeTp + allTimeSl;
  const allTimeWinRate = allTimeDecided > 0 ? (allTimeTp / allTimeDecided) * 100 : null;
  const allTimeNetR = allTimeClosed.reduce((sum, r) => sum + (Number(r.r_multiple) || 0), 0);

  // Date label formatting
  const d = new Date(nowMs);
  const dateStr = d.toISOString().slice(0, 10);
  const dateLabel = period === "daily" ? `New York Close · ${dateStr}` : `Week Ending Friday · ${dateStr}`;

  return {
    period,
    segment,
    dateLabel,
    periodSetups: periodClosed.length,
    periodTp,
    periodSl,
    periodBe,
    periodWinRate: periodWinRate !== null ? Math.round(periodWinRate * 10) / 10 : null,
    periodNetR: Math.round(periodNetR * 100) / 100,
    allTimeSetups: allTimeClosed.length,
    allTimeTp,
    allTimeSl,
    allTimeWinRate: allTimeWinRate !== null ? Math.round(allTimeWinRate * 10) / 10 : null,
    allTimeNetR: Math.round(allTimeNetR * 100) / 100,
  };
}

/**
 * Formats a high-converting institutional performance recap card for free channels.
 */
export function formatPerformanceRecap(stats: PerformanceRecapStats): string {
  const isDaily = stats.period === "daily";
  const isInst = stats.segment === "institutional";
  const title = isDaily
    ? isInst
      ? "📊 [SLK RADAR] — DAILY PERFORMANCE RECAP"
      : "📊 [SLK RADAR] — 24/7 SYNTHETICS DAILY RECAP"
    : isInst
      ? "📊 [SLK RADAR] — WEEKLY PERFORMANCE JOURNAL"
      : "📊 [SLK RADAR] — 24/7 SYNTHETICS WEEKLY JOURNAL";

  const marketLine = isInst
    ? "Market: Institutional (Forex · Indices · Metals)"
    : "Market: Continuous Synthetics (V75 · V100 · V50 · V25 · V10)";

  const periodHeader = isDaily ? "📈 TODAY'S RESULTS" : "📈 THIS WEEK'S RESULTS";

  const netRFormatted = stats.periodNetR >= 0 ? `+${stats.periodNetR.toFixed(2)}R` : `${stats.periodNetR.toFixed(2)}R`;
  const allTimeNetRFormatted = stats.allTimeNetR >= 0 ? `+${stats.allTimeNetR.toFixed(2)}R` : `${stats.allTimeNetR.toFixed(2)}R`;

  let resultsBlock = "";
  if (stats.periodSetups > 0) {
    const winRateStr = stats.periodWinRate !== null ? `${stats.periodWinRate.toFixed(1)}%` : "N/A";
    resultsBlock = [
      periodHeader,
      `• Setups Closed: ${stats.periodSetups}`,
      `• Outcomes: ${stats.periodTp} TP Hit | ${stats.periodSl} SL Hit${stats.periodBe > 0 ? ` | ${stats.periodBe} BE` : ""}`,
      `• Win Rate: ${winRateStr}`,
      `• Net Return: ${netRFormatted}`,
    ].join("\n");
  } else {
    resultsBlock = [
      periodHeader,
      "• Setups Triggered: 0 (Strict Discipline)",
      "• Note: Capital preserved. Zero low-probability setups forced during non-expansion conditions.",
    ].join("\n");
  }

  const allTimeWinRateStr = stats.allTimeWinRate !== null ? `${stats.allTimeWinRate.toFixed(1)}%` : "N/A";
  const ledgerUrl = isInst ? "https://slk-radar.pages.dev" : "https://slk-radar.pages.dev?segment=synthetics";

  return [
    title,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━",
    marketLine,
    `Session: ${stats.dateLabel}`,
    "",
    resultsBlock,
    "",
    "🏆 VERIFIED ALL-TIME TRACK RECORD",
    `• Net Return: ${allTimeNetRFormatted}`,
    `• Decided Win Rate: ${allTimeWinRateStr}`,
    `• Cumulative Record: ${stats.allTimeTp} TP Hit | ${stats.allTimeSl} SL Hit`,
    "• Target Floor: 2.50R - 4.50R Asymmetric Expansion",
    "",
    "🔒 100% PUBLIC TRANSPARENCY",
    "Every execution is mathematically recorded intrabar on our public ledger:",
    `🔗 Track Record: ${ledgerUrl}`,
    "",
    "💎 READY FOR REAL-TIME CONFIRMED ENTRIES?",
    "Stop trading counter-trend noise. Get loud, real-time SLK confirmation alerts with exact Entry, Invalidation, and Target levels:",
    "👉 Join VIP ($100/mo · $49 with code FOUNDING20): https://whop.com/slk-radar/slk-radar-vip-signals",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "SLK Model · Structure · Liquidity · Key Levels",
  ].join("\n");
}

/**
 * Dispatches an automated performance recap card to the designated Free Channel.
 */
export async function sendPerformanceRecap(
  env: NotifyEnv,
  rows: AlertRowish[],
  period: "daily" | "weekly",
  segment: "institutional" | "synthetics",
  nowMs: number = Date.now(),
  targetChatIdOverride?: string,
): Promise<{ sent: boolean; targetChatIds: string[]; text: string }> {
  const stats = computeRecapStats(rows, segment, period, nowMs);
  const text = formatPerformanceRecap(stats);

  const targetChatIds = targetChatIdOverride
    ? [targetChatIdOverride]
    : (segment === "synthetics"
        ? parseChatIds(env.TELEGRAM_DERIV_FREE_CHAT_ID || env.TELEGRAM_DERIV_CHAT_ID || env.TELEGRAM_FREE_CHAT_ID || env.TELEGRAM_CHAT_ID)
        : parseChatIds(env.TELEGRAM_FREE_CHAT_ID || env.TELEGRAM_CHAT_ID));

  if (targetChatIds.length === 0 || !env.TELEGRAM_BOT_TOKEN) {
    return { sent: false, targetChatIds, text };
  }

  for (const chatId of targetChatIds) {
    try {
      await sendTelegram(env, text, { silent: false, pin: false, chatId });
    } catch (err) {
      console.warn(JSON.stringify({
        level: "warn",
        msg: "performance recap delivery failed",
        chatId,
        segment,
        period,
        error: String(err),
      }));
    }
  }

  return { sent: true, targetChatIds, text };
}
