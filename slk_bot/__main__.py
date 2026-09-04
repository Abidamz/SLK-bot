"""CLI entry point.

    python -m slk_bot run                 # daemon: watch and alert forever
    python -m slk_bot scan-once           # one scan of every pair/timeframe
    python -m slk_bot stats [--send]      # performance summary (optionally pushed)
    python -m slk_bot test-notify         # send a test message to all channels
"""
from __future__ import annotations

import argparse
import logging
import sys

from .bot import SLKBot
from .config import load_config
from .notify.manager import format_signal
from .tracking import format_stats


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="slk_bot", description="SLK model forex notification bot"
    )
    p.add_argument("--config", default=None, help="path to config.yaml")
    p.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("run", help="run the bot continuously")

    so = sub.add_parser("scan-once", help="run a single scan pass, then exit")
    so.add_argument("--pair", help="only this pair, e.g. EURUSD")
    so.add_argument("--timeframe", help="only this timeframe, e.g. 15m")
    so.add_argument(
        "--ignore-session",
        action="store_true",
        help="disable the killzone filter (testing / off-hours)",
    )
    so.add_argument(
        "--fresh-window",
        type=int,
        default=0,
        help="also inspect the N candles before the last closed one",
    )
    so.add_argument("--no-alert", action="store_true", help="record but don't notify")

    st = sub.add_parser("stats", help="show signal performance stats")
    st.add_argument("--send", action="store_true", help="also push stats to channels")

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
        sigs = bot.scan_once(
            pairs=[args.pair.upper()] if args.pair else None,
            timeframes={args.timeframe} if args.timeframe else None,
            fresh_window=args.fresh_window,
            enforce_killzone=not args.ignore_session,
            alert=not args.no_alert,
        )
        if not sigs:
            print("No new SLK setups.")
        else:
            print(f"\n{len(sigs)} new signal(s):\n")
            for s in sigs:
                print(format_signal(s))
                print("-" * 40)
        return 0

    if args.cmd == "stats":
        text = format_stats(bot.tracker.stats())
        print(text)
        if args.send:
            bot.notifier.broadcast(text)
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
