"""Discord notifications via a channel webhook."""
from __future__ import annotations

import logging

import requests

log = logging.getLogger(__name__)


class DiscordNotifier:
    name = "discord"

    def __init__(self, webhook_url: str, timeout: int = 15):
        self.webhook_url = webhook_url
        self.timeout = timeout

    def send_message(self, text: str, color: int | None = None) -> None:
        payload = {
            "username": "SLK Bot",
            "embeds": [
                {
                    "description": text,
                    "color": color if color is not None else 0x3498DB,
                }
            ],
        }
        resp = requests.post(self.webhook_url, json=payload, timeout=self.timeout)
        if resp.status_code not in (200, 204):
            raise RuntimeError(
                f"Discord webhook error: HTTP {resp.status_code} {resp.text[:200]}"
            )
        log.debug("discord: message delivered")
