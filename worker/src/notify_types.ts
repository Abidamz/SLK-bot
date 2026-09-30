/** Small structural types so notify.ts doesn't depend on the store impl. */

export interface NotifyEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_DM_CHAT_ID?: string;
  TELEGRAM_FREE_CHAT_ID?: string;
  TELEGRAM_DERIV_CHAT_ID?: string;
  TELEGRAM_DERIV_FREE_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
  /** Injectable transport (tests pass a fake; production uses global fetch). */
  fetchFn?: typeof fetch;
  watchOnly?: boolean;
  WATCH_TELEGRAM?: string;
  WATCH_DISCORD?: string;
  VIP_WATCH_TELEGRAM?: string;
  VIP_WATCH_NOTIFY?: string;
  CHART_SNAPSHOTS?: string;
}

/** Row-shaped subset used when formatting outcomes and performance recaps (matches slk_alerts). */
export interface AlertRowish {
  canonical_symbol: unknown;
  entry_timeframe: unknown;
  direction: unknown;
  entry: unknown;
  stop_loss?: unknown;
  tp_internal?: unknown;
  tp_external?: unknown;
  setup_id: unknown;
  alert_status: unknown;
  status?: unknown;
  exit_time?: unknown;
  candle_close_time?: unknown;
  r_multiple?: unknown;
}

export interface PerformanceRecapStats {
  period: "daily" | "weekly";
  segment: "institutional" | "synthetics";
  dateLabel: string;
  periodSetups: number;
  periodTp: number;
  periodSl: number;
  periodBe: number;
  periodWinRate: number | null; // e.g. 75.0 (percentage), or null if 0 setups
  periodNetR: number; // sum of r_multiple in period
  allTimeSetups: number;
  allTimeTp: number;
  allTimeSl: number;
  allTimeWinRate: number | null;
  allTimeNetR: number; // sum of all completed r_multiple in segment
}

export interface OutcomeLike {
  status: string;
  exitPrice: number;
  exitTime: number;
  rMultiple: number;
}
