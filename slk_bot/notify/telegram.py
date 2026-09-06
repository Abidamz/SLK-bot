"""Telegram notifications via the Bot API."""
from __future__ import annotations

import logging

import requests

log = logging.getLogger(__name__)


class TelegramNotifier:
    name = "telegram"

    def __init__(self, token: str, chat_id: str, timeout: int = 15):
        self.token = token
        self.chat_id = chat_id
        self.timeout = timeout

    @property
    def url(self) -> str:
        return f"https://api.telegram.org/bot{self.token}/sendMessage"

    def send_message(self, text: str, color: int | None = None) -> None:
        resp = requests.post(
            self.url,
            json={
                "chat_id": self.chat_id,
                "text": text,
                "disable_web_page_preview": True,
            },
            timeout=self.timeout,
        )
        data = resp.json() if resp.content else {}
        if not data.get("ok"):
            raise RuntimeError(f"Telegram API error: {data}")
        log.debug("telegram: message delivered")
