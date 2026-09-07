# SLK MT5 demo execution scaffold

This directory is intentionally **demo-only**. The Worker endpoint is
`GET /signals/confirmed`; it returns only open, confirmed paper alerts with a
server HMAC signature and `execution: "DISABLED"`. No live order path exists.

Before compiling or attaching the EA, configure `SIGNAL_API_KEY` and
`SIGNAL_SIGNING_SECRET` as Worker secrets and use the same values only in the
local MT5 terminal. Never commit either secret.

The EA implementation must remain disabled until broker/server/symbol mapping,
risk, spread/slippage, session, and demo-account decisions are recorded. The
current Worker signal uses the retest-close reference entry and `MARKET` as a
paper order type; it does not place an order.
