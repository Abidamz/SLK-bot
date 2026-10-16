import WebSocket from "ws";
import { DERIV_SYMBOLS } from "../src/provider";
import type { Candle } from "../src/types";

const MAX_PAGE_SIZE = 1000;
const DEFAULT_APP_ID = "1089";
const DEFAULT_PAGE_DELAY_MS = 250;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

interface DerivCandle {
  epoch: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
}

interface DerivResponse {
  req_id?: number | string;
  echo_req?: { req_id?: number | string };
  error?: { code?: string; message?: string };
  candles?: DerivCandle[];
}

export interface DerivSocketLike {
  readyState: number;
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface DerivHistoryOptions {
  appId?: string;
  pageSize?: number;
  pageDelayMs?: number;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  createSocket?: (url: string, headers: Record<string, string>) => DerivSocketLike;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: { pair: string; symbol: string; pages: number; bars: number }) => void;
}

export interface DerivHistoryResult {
  pair: string;
  symbol: string;
  granularitySeconds: number;
  requestedFromMs: number;
  requestedToMs: number;
  pages: number;
  candles: Candle[];
}

interface PendingRequest {
  resolve: (response: DerivResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function parseResponse(raw: unknown): DerivResponse {
  const text = typeof raw === "string"
    ? raw
    : raw && typeof (raw as { toString?: unknown }).toString === "function"
      ? (raw as { toString: () => string }).toString()
      : String(raw);
  let data: DerivResponse;
  try {
    data = JSON.parse(text) as DerivResponse;
  } catch (error) {
    throw new Error(`Deriv history returned invalid JSON: ${errorMessage(error)}`);
  }
  return data;
}

function decodeCandles(rows: DerivCandle[], granularitySeconds: number): Candle[] {
  const out: Candle[] = [];
  for (const row of rows) {
    const candle: Candle = {
      t: Number(row.epoch) * 1000,
      o: Number(row.open),
      h: Number(row.high),
      l: Number(row.low),
      c: Number(row.close),
    };
    const valid = Number.isFinite(candle.t)
      && Number.isFinite(candle.o) && Number.isFinite(candle.h)
      && Number.isFinite(candle.l) && Number.isFinite(candle.c)
      && candle.h >= Math.max(candle.o, candle.c)
      && candle.l <= Math.min(candle.o, candle.c)
      && candle.h >= candle.l
      && candle.t % (granularitySeconds * 1000) === 0;
    if (!valid) throw new Error(`Deriv history contains a malformed candle at ${row.epoch}`);
    out.push(candle);
  }
  return out.sort((a, b) => a.t - b.t);
}

class DerivHistoryClient {
  private socket: DerivSocketLike | null = null;
  private connecting: Promise<void> | null = null;
  private nextReqId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly url: string,
    private readonly createSocket: (url: string, headers: Record<string, string>) => DerivSocketLike,
    private readonly connectTimeoutMs: number,
    private readonly requestTimeoutMs: number,
  ) {}

  private connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      let opened = false;
      const socket = this.createSocket(this.url, {
        Origin: "https://deriv.com",
        "User-Agent": "Mozilla/5.0 (compatible; DEO-Edge-backtest/1.0)",
      });
      this.socket = socket;
      const timer = setTimeout(() => {
        if (!opened) {
          try { socket.close(); } catch {}
          reject(new Error(`Timed out connecting to Deriv history (${this.url})`));
        }
      }, this.connectTimeoutMs);

      socket.on("open", () => {
        opened = true;
        clearTimeout(timer);
        resolve();
      });
      socket.on("message", (raw: unknown) => this.onMessage(raw));
      socket.on("error", (err: unknown) => {
        const error = new Error(`Deriv history socket error: ${errorMessage(err)}`);
        if (!opened) {
          clearTimeout(timer);
          reject(error);
        }
        this.rejectPending(error);
      });
      socket.on("close", (code: number, reason: unknown) => {
        clearTimeout(timer);
        this.socket = null;
        const reasonText = reason == null ? "" : String(reason);
        const error = new Error(`Deriv history socket closed (${code}${reasonText ? `: ${reasonText}` : ""})`);
        if (!opened) reject(error);
        this.rejectPending(error);
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private onMessage(raw: unknown): void {
    let response: DerivResponse;
    try {
      response = parseResponse(raw);
    } catch (error) {
      this.rejectPending(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const reqId = Number(response.req_id ?? response.echo_req?.req_id);
    const pending = this.pending.get(reqId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(reqId);
    if (response.error) {
      pending.reject(new Error(`Deriv API ${response.error.code ?? "error"}: ${response.error.message ?? "request failed"}`));
    } else {
      pending.resolve(response);
    }
  }

  private rejectPending(error: Error): void {
    for (const [reqId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(reqId);
      pending.reject(error);
    }
  }

  async historyPage(args: {
    symbol: string;
    granularitySeconds: number;
    count: number;
    endEpoch: number;
  }): Promise<DerivCandle[]> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Deriv history socket is not open");
    }
    const reqId = this.nextReqId++;
    const response = await new Promise<DerivResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Timed out waiting for Deriv candles (${args.symbol}, request ${reqId})`));
      }, this.requestTimeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({
          ticks_history: args.symbol,
          style: "candles",
          granularity: args.granularitySeconds,
          count: args.count,
          end: args.endEpoch,
          req_id: reqId,
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    if (!Array.isArray(response.candles)) {
      throw new Error(`Deriv returned no candle array for ${args.symbol}`);
    }
    return response.candles;
  }

  close(): void {
    this.rejectPending(new Error("Deriv history request cancelled"));
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
  }
}

/**
 * Download a historical candle range from Deriv by paging backwards from the
 * requested end time. This is a script-only helper for offline research; live
 * Worker fetching still uses its small latest-candle request.
 */
export async function fetchDerivHistoryRange(
  pair: string,
  granularitySeconds: number,
  fromMs: number,
  toMs: number,
  options: DerivHistoryOptions = {},
): Promise<DerivHistoryResult> {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error("Deriv history range must have finite from/to times with to > from");
  }
  if (!Number.isInteger(granularitySeconds) || granularitySeconds <= 0) {
    throw new Error("Deriv candle granularity must be a positive integer number of seconds");
  }
  const pairKey = pair.toUpperCase();
  const symbol = DERIV_SYMBOLS[pairKey] ?? pairKey;
  const appId = options.appId ?? process.env.DERIV_APP_ID ?? DEFAULT_APP_ID;
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(options.pageSize ?? MAX_PAGE_SIZE)));
  const pageDelayMs = Math.max(0, options.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const createSocket = options.createSocket
    ?? ((url, headers) => new WebSocket(url, { headers }) as unknown as DerivSocketLike);
  const url = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}&brand=deriv&l=en`;
  const client = new DerivHistoryClient(
    url, createSocket, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );

  const fromEpoch = Math.floor(fromMs / 1000);
  const endExclusiveMs = toMs;
  let endEpoch = Math.floor((toMs - 1) / 1000);
  const maxPages = Math.ceil((endEpoch - fromEpoch + 1) / (granularitySeconds * pageSize)) + 3;
  const candles: Candle[] = [];
  let pages = 0;
  try {
    while (endEpoch >= fromEpoch) {
      if (pages >= maxPages) {
        throw new Error(`Deriv pagination exceeded ${maxPages} pages for ${pairKey}; refusing a partial backtest window`);
      }
      let raw: DerivCandle[] = [];
      for (let attempt = 0; ; attempt++) {
        try {
          raw = await client.historyPage({ symbol, granularitySeconds, count: pageSize, endEpoch });
          break;
        } catch (error) {
          if (attempt >= 2) {
            throw new Error(`Deriv history failed after 3 attempts for ${pairKey} at ${endEpoch}: ${errorMessage(error)}`);
          }
          await sleep(500 * (attempt + 1));
        }
      }
      pages++;
      if (raw.length === 0) break;
      const page = decodeCandles(raw, granularitySeconds);
      if (page.length === 0) break;
      candles.push(...page.filter((c) => c.t >= fromMs && c.t < endExclusiveMs));
      options.onProgress?.({ pair: pairKey, symbol, pages, bars: candles.length });

      const oldestEpoch = Math.floor(page[0].t / 1000);
      if (oldestEpoch <= fromEpoch) break;
      if (oldestEpoch >= endEpoch) {
        throw new Error(`Deriv pagination made no progress for ${pairKey} at ${new Date(oldestEpoch * 1000).toISOString()}`);
      }
      endEpoch = oldestEpoch - 1;
      if (pageDelayMs > 0) await sleep(pageDelayMs);
    }
  } finally {
    client.close();
  }

  candles.sort((a, b) => a.t - b.t);
  const unique: Candle[] = [];
  for (const candle of candles) {
    const previous = unique[unique.length - 1];
    if (previous?.t === candle.t) {
      if (previous.o !== candle.o || previous.h !== candle.h || previous.l !== candle.l || previous.c !== candle.c) {
        throw new Error(`Deriv returned conflicting duplicate candles for ${pairKey} at ${new Date(candle.t).toISOString()}`);
      }
      continue;
    }
    if (previous && candle.t < previous.t) {
      throw new Error(`Deriv candles are out of order for ${pairKey}`);
    }
    unique.push(candle);
  }

  return {
    pair: pairKey,
    symbol,
    granularitySeconds,
    requestedFromMs: fromMs,
    requestedToMs: toMs,
    pages,
    candles: unique,
  };
}

export function summarizeDerivHistory(
  candles: Candle[], fromMs: number, toMs: number, granularitySeconds: number,
): { expectedBars: number; receivedBars: number; missingBars: number; gapCount: number; maxGapSeconds: number } {
  const intervalMs = granularitySeconds * 1000;
  const expectedBars = Math.max(0, Math.floor((toMs - fromMs) / intervalMs));
  let gapCount = 0;
  let maxGapMs = 0;
  for (let i = 1; i < candles.length; i++) {
    const gap = candles[i].t - candles[i - 1].t;
    if (gap > intervalMs) {
      gapCount++;
      maxGapMs = Math.max(maxGapMs, gap);
    }
  }
  return {
    expectedBars,
    receivedBars: candles.length,
    missingBars: Math.max(0, expectedBars - candles.length),
    gapCount,
    maxGapSeconds: maxGapMs / 1000,
  };
}
