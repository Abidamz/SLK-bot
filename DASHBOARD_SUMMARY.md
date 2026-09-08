# SLK Dashboard Summary

## Purpose

Create a lightweight, read-only dashboard for the SLK alert Worker. The dashboard should make the signal lifecycle, evidence, paper outcomes, and data health easy to inspect without implying that alerts are executed trades.

The dashboard improves observability and trust; it does **not** imply higher profitability or replace the replay and paper-validation process.

## Current system state

- Runtime: Cloudflare Worker
- Worker mode: `paper`
- Confirmed alerts: Telegram and Discord enabled
- WATCH notifications: disabled by default
- Minimum stop floor: `0.8 × entry-timeframe ATR`
- Minimum target: `3R`
- Promoted far targets: bounded at a 3R execution target; distant external liquidity remains context/Target 2
- Stale confirmation delivery: suppressed
- MT5 execution: disabled
- Current signal endpoint:

```text
GET /signals/confirmed
```

The endpoint returns only recent, open, confirmed signals and includes an HMAC signature. It returns:

```json
"execution": "DISABLED"
```

## Dashboard MVP

### 1. Overview

Show:

- Worker health
- Current execution mode
- Last successful scan
- Last scan duration
- Active pairs and timeframes
- Confirmed alerts this week
- TP, SL, and expired counts
- Paper net R
- Max drawdown
- Current execution status

The execution indicator must remain prominent:

```text
PAPER / EXECUTION DISABLED / NO ORDER PLACED
```

### 2. Alert lifecycle inbox

Represent each setup as a state timeline:

```text
MAP → TOUCH → SWEEP → SHIFT → RETEST → CONFIRMED → TP/SL/EXPIRED
```

Filters:

- Pair
- Timeframe
- Direction
- Lifecycle state
- Open or closed
- Confirmed only
- Date range

WATCH events should be visible separately from confirmed signals. They must never be presented as trade entries.

### 3. Evidence drawer

For each alert, display:

- Setup ID
- Provider
- Strategy version
- Pair and timeframe
- HTF bias
- Environment and phase
- HTF alignment
- Key-level type and bounds
- Origin level
- Liquidity sweep timestamp
- BOS/SHIFT timestamp
- Retest timestamp
- Entry reference price
- Stop-loss
- Target 1 execution target
- Target 2/far external draw
- Invalidation level
- Paper/demo status
- Outcome and R multiple

### 4. Performance view

Show separately:

- Raw mid-touch results
- Spread-adjusted estimated results
- Alerts
- TP and SL count
- Win rate
- Average R
- Profit factor
- Net R
- Max drawdown
- Longest losing streak
- Pair breakdown
- Timeframe breakdown
- Monthly breakdown
- Recent outcome sequence

All performance views must be labelled as paper/replay research, not audited live performance.

### 5. Data-health view

Show:

- Provider freshness
- Missing or stale candles
- Last successful scan per pair
- Scan errors
- Scan duration
- Market-idle status for index CFDs
- Notification delivery status
- Historical replay suppression events

### 6. Future execution view

Keep execution visibly disabled until the MT5 demo path has passed validation.

Required lifecycle:

```text
CONFIRMED → SUBMITTED → FILLED → CLOSED
```

Possible statuses:

```text
SIGNAL_CONFIRMED
ORDER_SUBMITTED
ORDER_FILLED
ORDER_REJECTED
ORDER_PARTIALLY_FILLED
POSITION_CLOSED
EXECUTION_ERROR
```

A successful Worker response must never be described as proof of an MT5 fill. MT5 retcode, ticket, and broker acknowledgement are authoritative.

## Security model

The browser must not contain Worker secrets.

Recommended approach:

1. Keep provider keys, Telegram credentials, Discord webhook, signing secret, and broker credentials server-side.
2. Add a narrow, read-only dashboard data endpoint.
3. Keep administrative and execution endpoints separate.
4. Do not expose `ADMIN_KEY`, `SIGNAL_API_KEY`, or `SIGNAL_SIGNING_SECRET` in the repository.
5. Use short-lived dashboard authentication or a protected Worker route for private data.

## Implementation shape

Use the lean MVP style already preferred by the project:

```text
dashboard/
  index.html
  app.js
  styles.css
```

Avoid a framework until the dashboard requirements justify one. Initially use read-only API data and fixture data for UI development.

## Recommended implementation order

1. Add a read-only dashboard data contract.
2. Build the overview and execution-disabled indicator.
3. Build the alert inbox.
4. Add the evidence drawer.
5. Add the paper outcome/performance view.
6. Add data-health reporting.
7. Add delivery attempts and dead-letter records.
8. Add MT5 execution lifecycle records after demo EA validation.
9. Add pair-request/community feedback later.

## Product principles

- Confirmed signals are distinct from WATCH heads-ups.
- Paper alerts are not broker orders.
- A far liquidity draw is not automatically a realistic execution target.
- Small samples must not be presented as reliable performance evidence.
- Every alert should be explainable from its stored evidence.
- Stale or replayed signals must be visible for audit but must not be delivered as fresh alerts.
- Live execution remains disabled until demo testing and explicit authorization are complete.

## Current next step

Build the dashboard data contract and a read-only MVP with:

- Overview
- Alert inbox
- Evidence drawer
- Paper outcome ledger
- Data-health panel
- Prominent `EXECUTION DISABLED` status
