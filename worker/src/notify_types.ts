/** Small structural types so notify.ts doesn't depend on the store impl. */

export interface NotifyEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
  /** Injectable transport (tests pass a fake; production uses global fetch). */
  fetchFn?: typeof fetch;
}

/** Row-shaped subset used when formatting outcomes (matches slk_alerts). */
export interface AlertRowish {
  canonical_symbol: unknown;
  entry_timeframe: unknown;
  direction: unknown;
  entry: unknown;
  setup_id: unknown;
  alert_status: unknown;
}

export interface OutcomeLike {
  status: string;
  exitPrice: number;
  exitTime: number;
  rMultiple: number;
}
