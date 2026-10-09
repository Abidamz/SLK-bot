"""TAYO-bot — Forex notification bot for the TAYO model.

Watches FX pairs for TAYO-model setups (liquidity sweep -> market structure
shift -> entry) and pushes alerts to Telegram and Discord, then tracks each
signal to its TP/SL outcome for performance stats.
"""

__version__ = "0.1.0"
