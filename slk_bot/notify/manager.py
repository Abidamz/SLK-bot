"""Fan-out notifications to every configured channel."""
from __future__ import annotations

import logging

from ..config import Config
from ..models import Direction, fmt_pips, fmt_price
from ..slk.types import Alert
from .discord import DiscordNotifier
from .telegram import TelegramNotifier

log = logging.getLogger(__name__)

GREEN = 0x2ECC71
RED = 0xE74C3C
GREY = 0x95A5A6
BLUE = 0x3498DB

_KIND_NAMES = {"A": "A-top", "V": "V-bottom", "OC": "Open-Close"}


def _paper_tag(a: Alert) -> str:
    return "🧪 PAPER — " if a.alert_status == "PAPER" else ""


def format_alert(a: Alert) -> str:
    emoji = "🟢" if a.direction is Direction.LONG else "🔴"
    pair = a.pair
    lo, hi = a.key_level_bounds
    kl = f"{_KIND_NAMES.get(a.key_level_type, a.key_level_type)} {fmt_price(pair, lo)}–{fmt_price(pair, hi)}"
    flags = []
    if a.key_level_tested:
        flags.append("tested")
    if a.key_level_flipped:
        flags.append("flipped")
    if a.imbalance_context:
        flags.append("+FVG")
    if flags:
        kl += " · " + ", ".join(flags)

    lines = [
        f"{_paper_tag(a)}{emoji} SLK {a.direction.value} — {pair} · {a.entry_tf}"
        f" (map {a.map_tf})",
        "",
        f"Story     : {a.environment} · {a.phase} · {a.htf_alignment}",
        f"Key level : {kl}",
        f"Entry     : {fmt_price(pair, a.entry)}  (retest close)",
        f"Stop Loss : {fmt_price(pair, a.stop_loss)} "
        f"({fmt_pips(pair, a.entry - a.stop_loss)} · beyond sweep extreme)",
        f"Target 1  : {fmt_price(pair, a.tp_internal)} internal liquidity "
        f"({fmt_pips(pair, a.tp_internal - a.entry)}"
        + (f" · {a.rr_internal:g}R" if a.rr_internal else "")
        + ")",
    ]
    if a.tp_external is not None:
        lines.append(
            f"Target 2  : {fmt_price(pair, a.tp_external)} external liquidity "
            "(targets beyond the nearest external level are anticipatory)"
        )
    if a.draw_on_liquidity is not None:
        lines.append(f"Draw      : {fmt_price(pair, a.draw_on_liquidity)}")
    lines.append(
        "Opp. liq. : "
        + ("standing ✅" if a.opposing_liquidity_standing else "NOT standing ⚠️")
    )
    lines.append(
        "Path      : sweep "
        + a.sweep_time.strftime("%H:%M")
        + " → BOS "
        + a.bos_time.strftime("%H:%M")
        + " → retest "
        + a.return_time.strftime("%H:%M")
        + " UTC"
    )
    if a.session:
        lines.append(f"Session   : {a.session}")
    lines.append(
        f"Setup     : {a.setup_id} · invalidation: close "
        + (">" if a.direction is Direction.SHORT else "<")
        + f" {fmt_price(pair, a.invalidation_level)}"
    )
    return "\n".join(lines)


def format_outcome(rec: dict, outcome) -> str:
    pair = rec["canonical_symbol"]
    paper = "🧪 PAPER — " if rec.get("alert_status") == "PAPER" else ""
    r = outcome.r_multiple
    if outcome.status.value == "TP_HIT":
        emoji, label = "✅", "TP HIT"
    elif outcome.status.value == "SL_HIT":
        emoji, label = "❌", "SL HIT"
    else:
        emoji, label = "⌛", "EXPIRED"
    return (
        f"{paper}{emoji} {label} — {pair} · {rec['entry_timeframe']} · "
        f"{rec['direction']} (setup {rec['setup_id']})\n"
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

    def notify_alert(self, a: Alert) -> None:
        color = GREEN if a.direction is Direction.LONG else RED
        self.broadcast(format_alert(a), color=color)

    def notify_outcome(self, rec: dict, outcome) -> None:
        color = (
            GREEN
            if outcome.status.value == "TP_HIT"
            else RED if outcome.status.value == "SL_HIT" else GREY
        )
        self.broadcast(format_outcome(rec, outcome), color=color)
