"""Fan-out notifications to every configured channel."""
from __future__ import annotations

import logging

from ..config import Config
from ..models import Direction, Signal, fmt_pips, fmt_price
from .discord import DiscordNotifier
from .telegram import TelegramNotifier

log = logging.getLogger(__name__)

GREEN = 0x2ECC71
RED = 0xE74C3C
GREY = 0x95A5A6
BLUE = 0x3498DB


def format_signal(sig: Signal) -> str:
    emoji = "🟢" if sig.direction is Direction.LONG else "🔴"
    lines = [
        f"{emoji} SLK SIGNAL — {sig.pair} · {sig.timeframe}",
        "",
        f"Direction : {sig.direction.value}",
        f"Entry     : {fmt_price(sig.pair, sig.entry)}",
        f"Stop Loss : {fmt_price(sig.pair, sig.stop_loss)} "
        f"({fmt_pips(sig.pair, sig.entry - sig.stop_loss)})",
        f"Take Prof : {fmt_price(sig.pair, sig.take_profit)} "
        f"({fmt_pips(sig.pair, sig.take_profit - sig.entry)}"
        + (f" · {sig.rr:g}R" if sig.rr else "")
        + ")",
    ]
    if sig.sweep_level is not None:
        when = sig.sweep_time.strftime("%H:%M") if sig.sweep_time else "?"
        lines.append(f"Swept     : {fmt_price(sig.pair, sig.sweep_level)} @ {when} UTC")
    if sig.session:
        lines.append(f"Session   : {sig.session} killzone")
    lines.append("Time      : " + sig.signal_time.strftime("%Y-%m-%d %H:%M UTC"))
    return "\n".join(lines)


def format_outcome(rec: dict, outcome) -> str:
    pair = rec["pair"]
    r = outcome.r_multiple
    if outcome.status.value == "TP_HIT":
        emoji, label = "✅", "TP HIT"
    elif outcome.status.value == "SL_HIT":
        emoji, label = "❌", "SL HIT"
    else:
        emoji, label = "⌛", "EXPIRED"
    return (
        f"{emoji} {label} — {pair} · {rec['timeframe']} · {rec['direction']}\n"
        f"Entry {fmt_price(pair, rec['entry'])} → Exit "
        f"{fmt_price(pair, outcome.exit_price)}  ({r:+.2f}R)"
    )


class NotifierManager:
    """Holds every configured channel and broadcasts to all of them.
    A failing channel is logged and skipped, never blocks the others."""

    def __init__(self, channels: list | None = None):
        self.channels = channels or []

    @classmethod
    def from_config(cls, cfg: Config) -> "NotifierManager":
        channels = []
        if cfg.telegram_token and cfg.telegram_chat_id:
            channels.append(TelegramNotifier(cfg.telegram_token, cfg.telegram_chat_id))
        if cfg.discord_webhook_url:
            channels.append(DiscordNotifier(cfg.discord_webhook_url))
        if not channels:
            log.warning(
                "no notification channels configured — alerts will only be logged"
            )
        return cls(channels)

    def broadcast(self, text: str, color: int = BLUE) -> None:
        if not self.channels:
            log.info("[notify] %s", text.replace("\n", " | "))
            return
        for ch in self.channels:
            try:
                ch.send_message(text, color=color)
            except Exception:
                log.exception("%s: failed to send message", ch.name)

    def notify_signal(self, sig: Signal) -> None:
        color = GREEN if sig.direction is Direction.LONG else RED
        self.broadcast(format_signal(sig), color=color)

    def notify_outcome(self, rec: dict, outcome) -> None:
        color = (
            GREEN
            if outcome.status.value == "TP_HIT"
            else RED if outcome.status.value == "SL_HIT" else GREY
        )
        self.broadcast(format_outcome(rec, outcome), color=color)
