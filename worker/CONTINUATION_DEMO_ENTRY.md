# Private continuation demo-entry watch

This is a separate, opt-in manual demo alert. It does not change the existing live gate, create a public notification, or place a broker order.

## When it runs

The Worker must be in `MODE=paper` with both `CONTINUATION_SHADOW_ENABLED=true` and `CONTINUATION_SHADOW_DM_NOTIFY=true`. Delivery is direct to Telegram only when the configured private-DM list contains exactly one positive numeric chat ID. Missing, group-only, or multiple-personal-ID configurations fail closed; there is no group/channel or Discord fallback.

## Signal lifecycle

1. A completed H4 continuation setup creates a private reference-level watch. Same-pair, same-H4-close levels are grouped for the user's manual selection.
2. After that H4 close, a **fresh M30 candle** must touch the reference level and close back in the setup direction. Earlier H4-bar touches do not qualify.
3. The reference entry is the following M30 open. The original H4 stop and target remain fixed, and R:R is recalculated from that next-open price.
4. The pending setup expires at the next H4 close. A next-open price must be detected and the private alert sent within 60 seconds; otherwise no actionable DM is sent and the miss is logged.

Active watches receive a priority scan during the one-minute window. If the configured base feed is coarser than M30, the Worker requests a true M30 feed rather than manufacturing sub-bars. The retry-only path does not rerun the established live gate. A missing/stale price, a next open beyond the fixed stop/target, or a late delivery fails closed.

Missed and delivered manual-entry DMs are recorded in the existing `notification_delivery_audit` table under the separate `continuation_demo_entry` kind. No D1 migration is required. This audit records signal/notification status, not a broker fill. A manual demo fill must be tracked separately; the pre-existing 120-M30 shadow outcome remains hypothetical research data.
