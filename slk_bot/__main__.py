"""CLI entry point.

    python -m slk_bot run                 # daemon: watch and alert forever
    python -m slk_bot scan-once           # one full scan pass, then exit
    python -m slk_bot stats [--send]      # performance summary (optionally pushed)
    python -m slk_bot events [--limit N]  # recent state-machine transitions
    python -m slk_bot test-notify         # send a test message to all channels
"""
from __future__ import annotations

import argparse
import logging
import sys

from .bot import SLKBot
from .config import load_config
from .notify.manager import format_alert
from .tracking import format_stats


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="slk_bot",
        description="SLK (Structure · Liquidity · Key levels) forex alert bot",
    )
    p.add_argument("--config", default=None, help="path to config.yaml")
    p.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("run", help="run the bot continuously")

    so = sub.add_parser("scan-once", help="run a single scan pass, then exit")
    so.add_argument("--pair", help="only this pair, e.g. EURUSD")
    so.add_argument("--timeframe", help="only this entry timeframe, e.g. 1h")
    so.add_argument(
        "--ignore-session",
        action="store_true",
        help="bypass the session allowlist for this scan",
    )
    so.add_argument("--no-alert", action="store_true",
                    help="record but don't notify")

    st = sub.add_parser("stats", help="show alert performance stats")
    st.add_argument("--send", action="store_true",
                    help="also push stats to Telegram/Discord")

    ev = sub.add_parser("events", help="show recent state-machine transitions")
    ev.add_argument("--limit", type=int, default=20)

    sub.add_parser("test-notify", help="send a test message to every channel")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )
    cfg = load_config(args.config)
    bot = SLKBot(cfg)

    if args.cmd == "run":
        try:
            bot.run()
        except KeyboardInterrupt:
            print("\nstopped.")
        return 0

    if args.cmd == "scan-once":
        alerts = bot.scan_once(
            pairs=[args.pair.upper()] if args.pair else None,
            timeframes={args.timeframe} if args.timeframe else None,
            ignore_session=args.ignore_session,
            alert=not args.no_alert,
        )
        if not alerts:
            print("No new SLK setups completed (check `events` / logs).")
        else:
            print(f"\n{len(alerts)} new alert(s) recorded:\n")
            for a in alerts:
                print(format_alert(a))
                print("-" * 44)
        return 0

    if args.cmd == "stats":
        text = format_stats(bot.tracker.stats())
        print(text)
        if args.send:
            bot.notifier.broadcast(text)
        return 0

    if args.cmd == "events":
        rows = bot.tracker.recent_events(args.limit)
        if not rows:
            print("No transitions logged yet.")
        for r in reversed(rows):
            print(
                f"{str(r['candle_time'])[:16]}  {r['state']:<7} "
                f"{r['pair']:<7} setup {r['setup_id']}  — {r['reason']}"
            )
        return 0

    if args.cmd == "test-notify":
        bot.notifier.broadcast(
            "✅ SLK bot test — notification channels are wired up correctly."
        )
        print("test message sent (check Telegram / Discord).")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
