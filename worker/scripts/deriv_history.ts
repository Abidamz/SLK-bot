import WebSocket from "ws";
import { DERIV_SYMBOLS } from "../src/provider";
import type { Candle } from "../src/types";

const MAX_PAGE_SIZE = 1000;
const DEFAULT_APP_ID = "1089";
const DEFAULT_PAGE_DELAY_MS = 250;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_HISTORY_REQUEST_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15_000;
const MAX_OFF_GRID_FRACTION = 0.01;
const MAX_OFF_GRID_SAMPLES = 5;

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
  skippedMisalignedCandles: number;
  skippedMisalignedSamples: number[];
}

interface PendingRequest {
  resolve: (response: DerivResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface DerivHistoryEndpoint {
  url: string;
  label: string;
  headers: Record<string, string>;
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

interface DecodedCandlePage {
  candles: Candle[];
  oldestEpoch: number | null;
  skippedMisalignedCandles: number;
  misalignedSamples: number[];
}

function decodeCandles(rows: DerivCandle[], granularitySeconds: number): DecodedCandlePage {
  const out: Candle[] = [];
  const misalignedSamples: number[] = [];
  let oldestEpoch: number | null = null;
  let skippedMisalignedCandles = 0;
  for (const row of rows) {
    const epochSeconds = Number(row.epoch);
    const candle: Candle = {
      t: epochSeconds * 1000,
      o: Number(row.open),
      h: Number(row.high),
      l: Number(row.low),
      c: Number(row.close),
    };
    const values = `epoch=${String(row.epoch)}, granularity=${granularitySeconds}s, open=${String(row.open)}, high=${String(row.high)}, low=${String(row.low)}, close=${String(row.close)}`;
    if (!Number.isSafeInteger(epochSeconds)) {
      throw new Error(`Deriv history returned a non-integer candle epoch (${values})`);
    }
    if (![candle.o, candle.h, candle.l, candle.c].every(Number.isFinite)) {
      throw new Error(`Deriv history returned non-finite OHLC values (${values})`);
    }
    if (
      candle.h < Math.max(candle.o, candle.c)
      || candle.l > Math.min(candle.o, candle.c)
      || candle.h < candle.l
    ) {
      throw new Error(`Deriv history returned an invalid OHLC range (${values})`);
    }
    oldestEpoch = oldestEpoch === null ? epochSeconds : Math.min(oldestEpoch, epochSeconds);
    if (epochSeconds % granularitySeconds !== 0) {
      skippedMisalignedCandles++;
      if (misalignedSamples.length < MAX_OFF_GRID_SAMPLES) misalignedSamples.push(epochSeconds);
      continue;
    }
    out.push(candle);
  }
  return {
    candles: out.sort((a, b) => a.t - b.t),
    oldestEpoch,
    skippedMisalignedCandles,
    misalignedSamples,
  };
}

class DerivHistoryClient {
  private socket: DerivSocketLike | null = null;
  private connecting: Promise<void> | null = null;
  private nextReqId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  private nextEndpointIndex = 0;

  constructor(
    private readonly endpoints: DerivHistoryEndpoint[],
    private readonly createSocket: (url: string, headers: Record<string, string>) => DerivSocketLike,
    private readonly connectTimeoutMs: number,
    private readonly requestTimeoutMs: number,
  ) {}

  private connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = this.connectWithFallback().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectWithFallback(): Promise<void> {
    const errors: string[] = [];
    const startIndex = this.nextEndpointIndex;
    for (let offset = 0; offset < this.endpoints.length; offset++) {
      const endpointIndex = (startIndex + offset) % this.endpoints.length;
      const endpoint = this.endpoints[endpointIndex];
      try {
        await this.connectToEndpoint(endpoint, endpointIndex);
        this.nextEndpointIndex = endpointIndex;
        return;
      } catch (error) {
        errors.push(`${endpoint.label}: ${errorMessage(error)}`);
        this.nextEndpointIndex = (endpointIndex + 1) % this.endpoints.length;
      }
    }
    throw new Error(`all Deriv history endpoints failed (${errors.join("; ")})`);
  }

  private connectToEndpoint(endpoint: DerivHistoryEndpoint, endpointIndex: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const socket = this.createSocket(endpoint.url, endpoint.headers);
      this.socket = socket;

      const failBeforeOpen = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.socket === socket) this.socket = null;
        this.nextEndpointIndex = (endpointIndex + 1) % this.endpoints.length;
        try { socket.close(); } catch {}
        reject(error);
      };

      timer = setTimeout(() => {
        if (!opened) {
          failBeforeOpen(new Error(`Timed out connecting to Deriv history (${endpoint.label})`));
        }
      }, this.connectTimeoutMs);

      socket.on("open", () => {
        if (settled) {
          try { socket.close(); } catch {}
          return;
        }
        opened = true;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      socket.on("message", (raw: unknown) => this.onMessage(raw));
      socket.on("unexpected-response", (_request: unknown, response: unknown) => {
        const res = response as {
          statusCode?: number;
          statusMessage?: string;
          headers?: Record<string, unknown>;
          resume?: () => void;
        };
        const header = (name: string): string => {
          const value = res.headers?.[name];
          return value == null ? "" : Array.isArray(value) ? value.join(",") : String(value);
        };
        const detail = [
          `HTTP ${res.statusCode ?? "unknown"}${res.statusMessage ? ` ${res.statusMessage}` : ""}`,
          header("server") ? `server=${header("server")}` : "",
          header("cf-ray") ? `cf-ray=${header("cf-ray")}` : "",
        ].filter(Boolean).join(", ");
        try { res.resume?.(); } catch {}
        failBeforeOpen(new Error(`Deriv WebSocket handshake rejected (${detail})`));
      });
      socket.on("error", (err: unknown) => {
        const error = new Error(`Deriv history socket error: ${errorMessage(err)}`);
        if (!opened) {
          failBeforeOpen(error);
          return;
        }
        if (this.socket === socket) {
          this.socket = null;
          this.nextEndpointIndex = (endpointIndex + 1) % this.endpoints.length;
          this.rejectPending(error);
          try { socket.close(); } catch {}
        }
      });
      socket.on("close", (code: number, reason: unknown) => {
        clearTimeout(timer);
        const wasCurrentSocket = this.socket === socket;
        if (wasCurrentSocket) {
          this.socket = null;
          this.nextEndpointIndex = (endpointIndex + 1) % this.endpoints.length;
        }
        const reasonText = reason == null ? "" : String(reason);
        const error = new Error(`Deriv history socket closed (${code}${reasonText ? `: ${reasonText}` : ""})`);
        if (!opened) failBeforeOpen(error);
        else if (wasCurrentSocket) this.rejectPending(error);
      });
    });
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
  const encodedAppId = encodeURIComponent(appId);
  const endpoints: DerivHistoryEndpoint[] = [
    {
      url: "wss://api.derivws.com/trading/v1/options/ws/public",
      label: "api.derivws.com public market-data socket (no Origin)",
      headers: {},
    },
    {
      url: "wss://api.derivws.com/trading/v1/options/ws/public",
      label: "api.derivws.com public market-data socket (api.deriv.com Origin)",
      headers: { Origin: "https://api.deriv.com" },
    },
    {
      url: `wss://ws.derivws.com/websockets/v3?app_id=${encodedAppId}&brand=deriv&l=en`,
      label: "ws.derivws.com",
      headers: {},
    },
    {
      url: `wss://ws.binaryws.com/websockets/v3?app_id=${encodedAppId}`,
      label: "ws.binaryws.com",
      headers: {},
    },
    {
      url: `wss://frontend.binaryws.com/websockets/v3?app_id=${encodedAppId}&brand=deriv&l=en`,
      label: "frontend.binaryws.com",
      headers: {},
    },
  ];
  const client = new DerivHistoryClient(
    endpoints, createSocket, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );

  const fromEpoch = Math.floor(fromMs / 1000);
  const endExclusiveMs = toMs;
  let endEpoch = Math.floor((toMs - 1) / 1000);
  const maxPages = Math.ceil((endEpoch - fromEpoch + 1) / (granularitySeconds * pageSize)) + 3;
  const candles: Candle[] = [];
  let pages = 0;
  let downloadedCandles = 0;
  let skippedMisalignedCandles = 0;
  const skippedMisalignedSamples: number[] = [];
  try {
    while (endEpoch >= fromEpoch) {
      if (pages >= maxPages) {
        throw new Error(`Deriv pagination exceeded ${maxPages} pages for ${pairKey}; refusing a partial backtest window`);
      }
      let raw: DerivCandle[] = [];
      for (let attempt = 0; attempt < MAX_HISTORY_REQUEST_ATTEMPTS; attempt++) {
        try {
          raw = await client.historyPage({ symbol, granularitySeconds, count: pageSize, endEpoch });
          break;
        } catch (error) {
          if (attempt >= MAX_HISTORY_REQUEST_ATTEMPTS - 1) {
            throw new Error(
              `Deriv history failed after ${MAX_HISTORY_REQUEST_ATTEMPTS} attempts for ${pairKey} at ${endEpoch}: ${errorMessage(error)}`,
            );
          }
          const delayMs = Math.min(MAX_RETRY_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
          await sleep(delayMs);
        }
      }
      pages++;
      if (raw.length === 0) break;
      const decoded = decodeCandles(raw, granularitySeconds);
      const nextDownloadedCandles = downloadedCandles + raw.length;
      const nextSkippedMisalignedCandles = skippedMisalignedCandles + decoded.skippedMisalignedCandles;
      const offGridLimit = Math.max(1, Math.floor(raw.length * MAX_OFF_GRID_FRACTION));
      const overallOffGridLimit = Math.max(1, Math.floor(nextDownloadedCandles * MAX_OFF_GRID_FRACTION));
      if (
        decoded.skippedMisalignedCandles > offGridLimit
        || nextSkippedMisalignedCandles > overallOffGridLimit
      ) {
        const samples = decoded.misalignedSamples
          .map((epoch) => new Date(epoch * 1000).toISOString()).join(", ");
        throw new Error(
          `Deriv returned ${decoded.skippedMisalignedCandles}/${raw.length} candle timestamps off the ${granularitySeconds}s grid on the current page and ${nextSkippedMisalignedCandles}/${nextDownloadedCandles} overall for ${pairKey}; refusing a likely shifted dataset. Sample UTC timestamps: ${samples}`,
        );
      }
      downloadedCandles = nextDownloadedCandles;
      skippedMisalignedCandles = nextSkippedMisalignedCandles;
      for (const epoch of decoded.misalignedSamples) {
        if (skippedMisalignedSamples.length >= MAX_OFF_GRID_SAMPLES) break;
        skippedMisalignedSamples.push(epoch);
      }
      candles.push(...decoded.candles.filter((c) => c.t >= fromMs && c.t < endExclusiveMs));
      options.onProgress?.({ pair: pairKey, symbol, pages, bars: candles.length });

      const oldestEpoch = decoded.oldestEpoch;
      if (oldestEpoch === null) break;
      if (oldestEpoch > endEpoch) {
        throw new Error(
          `Deriv pagination made no progress for ${pairKey}: requested end ${new Date(endEpoch * 1000).toISOString()}, but the page's oldest candle is ${new Date(oldestEpoch * 1000).toISOString()} (${raw.length} candles on page ${pages})`,
        );
      }
      if (oldestEpoch <= fromEpoch) break;
      endEpoch = oldestEpoch - 1;
      if (pageDelayMs > 0) await sleep(pageDelayMs);
    }
  } finally {
    client.close();
  }

  if (skippedMisalignedCandles > 0) {
    const samples = skippedMisalignedSamples
      .map((epoch) => new Date(epoch * 1000).toISOString()).join(", ");
    console.warn(
      `Deriv history skipped ${skippedMisalignedCandles} off-grid ${granularitySeconds}s candle(s) for ${pairKey}; they were not re-timestamped. Sample UTC timestamps: ${samples}. Check the coverage/gap counts in the report.`,
    );
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
    skippedMisalignedCandles,
    skippedMisalignedSamples,
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
