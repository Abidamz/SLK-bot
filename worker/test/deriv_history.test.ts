import { describe, expect, it } from "vitest";
import { DERIV_SYMBOLS } from "../src/provider";
import {
  fetchDerivHistoryRange,
  summarizeDerivHistory,
  type DerivSocketLike,
} from "../scripts/deriv_history";

const history = [
  { epoch: 120, open: 10, high: 11, low: 9, close: 10.5 },
  { epoch: 180, open: 10.5, high: 12, low: 10, close: 11.5 },
  { epoch: 240, open: 11.5, high: 13, low: 11, close: 12.5 },
  { epoch: 300, open: 12.5, high: 14, low: 12, close: 13.5 },
];

interface FakeUnexpectedResponse {
  statusCode: number;
  statusMessage?: string;
  headers?: Record<string, unknown>;
  resume?: () => void;
}

class FakeSocket implements DerivSocketLike {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  private readonly listeners = new Map<string, ((...args: any[]) => void)[]>();

  constructor(
    private readonly response: (request: Record<string, any>) => unknown,
    private readonly connectError?: Error,
    private readonly unexpectedResponse?: FakeUnexpectedResponse,
  ) {
    queueMicrotask(() => {
      if (this.unexpectedResponse) {
        this.emit("unexpected-response", {}, this.unexpectedResponse);
        return;
      }
      if (this.connectError) {
        this.emit("error", this.connectError);
        return;
      }
      this.readyState = 1;
      this.emit("open");
    });
  }

  on(event: string, listener: (...args: any[]) => void): unknown {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  send(raw: string): void {
    const request = JSON.parse(raw) as Record<string, any>;
    this.sent.push(request);
    const response = this.response(request);
    queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify(response))));
  }

  close(code = 1000, reason = "test complete"): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", code, Buffer.from(reason)));
  }

  private emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

describe("Deriv historical candle paging", () => {
  it("walks backwards in bounded pages and returns ordered canonical candles", async () => {
    const sockets: FakeSocket[] = [];
    let url = "";
    let headers: Record<string, string> = {};
    const result = await fetchDerivHistoryRange("V75", 60, 120_000, 360_000, {
      pageSize: 2,
      pageDelayMs: 0,
      createSocket: (socketUrl, socketHeaders) => {
        url = socketUrl;
        headers = socketHeaders;
        const socket = new FakeSocket((request) => ({
          req_id: request.req_id,
          candles: history.filter((c) => c.epoch <= request.end).slice(-request.count),
        }));
        sockets.push(socket);
        return socket;
      },
    });

    expect(url).toBe("wss://api.derivws.com/trading/v1/options/ws/public");
    expect(headers).toEqual({});
    expect(result.symbol).toBe("R_75");
    expect(result.pages).toBe(2);
    expect(result.candles.map((c) => c.t)).toEqual([120_000, 180_000, 240_000, 300_000]);
    expect(sockets[0].sent.map((request) => request.end)).toEqual([359, 239]);
    expect(sockets[0].sent.every((request) => request.count === 2)).toBe(true);
  });

  it("skips an isolated off-grid candle without shifting it and reports the omission", async () => {
    const shiftedCandle = { epoch: 135, open: 10.5, high: 12, low: 10, close: 11.5 };
    const rows = [history[0], shiftedCandle, ...history.slice(1)];
    const result = await fetchDerivHistoryRange("V75", 60, 120_000, 360_000, {
      pageSize: 10,
      pageDelayMs: 0,
      createSocket: () => new FakeSocket((request) => ({
        req_id: request.req_id,
        candles: rows.filter((c) => c.epoch <= request.end).slice(-request.count),
      })),
    });

    expect(result.candles.map((c) => c.t)).toEqual([120_000, 180_000, 240_000, 300_000]);
    expect(result.skippedMisalignedCandles).toBe(1);
    expect(result.skippedMisalignedSamples).toEqual([135]);
  });

  it("fails early when a page is systematically off the requested candle grid", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      epoch: 135 + index * 60,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
    }));
    await expect(fetchDerivHistoryRange("V75", 60, 60_000, 600_000, {
      pageSize: rows.length,
      pageDelayMs: 0,
      createSocket: () => new FakeSocket((request) => ({
        req_id: request.req_id,
        candles: rows.filter((c) => c.epoch <= request.end),
      })),
    })).rejects.toThrow(/off the 60s grid.*refusing a likely shifted page/);
  });

  it("reports OHLC fields when a candle range is malformed", async () => {
    const badCandle = { epoch: 120, open: 10, high: 9, low: 8, close: 10 };
    await expect(fetchDerivHistoryRange("V75", 60, 120_000, 240_000, {
      pageSize: 2,
      pageDelayMs: 0,
      createSocket: () => new FakeSocket((request) => ({
        req_id: request.req_id,
        candles: [badCandle],
      })),
    })).rejects.toThrow(/invalid OHLC range.*epoch=120, granularity=60s, open=10, high=9, low=8, close=10/);
  });

  it("falls back to another Deriv history endpoint after a 520 handshake failure", async () => {
    const attemptedHosts: string[] = [];
    const result = await fetchDerivHistoryRange("V75", 60, 120_000, 240_000, {
      pageSize: 2,
      pageDelayMs: 0,
      createSocket: (url) => {
        const host = new URL(url).hostname;
        attemptedHosts.push(host);
        if (host === "api.derivws.com") {
          return new FakeSocket(() => ({}), new Error("Unexpected server response: 520"));
        }
        return new FakeSocket((request) => ({
          req_id: request.req_id,
          candles: history.filter((c) => c.epoch <= request.end).slice(-request.count),
        }));
      },
    });

    expect(attemptedHosts.slice(0, 3)).toEqual(["api.derivws.com", "api.derivws.com", "ws.derivws.com"]);
    expect(result.candles.map((c) => c.t)).toEqual([120_000, 180_000]);
  });

  it("backs off and fails clearly when every Deriv history endpoint returns 520", async () => {
    let socketsCreated = 0;
    const retryDelays: number[] = [];
    await expect(fetchDerivHistoryRange("V75", 60, 120_000, 240_000, {
      pageSize: 2,
      pageDelayMs: 0,
      sleep: async (ms) => { retryDelays.push(ms); },
      createSocket: () => {
        socketsCreated++;
        return new FakeSocket(() => ({}), new Error("Unexpected server response: 520"));
      },
    })).rejects.toThrow(/failed after 5 attempts.*520/);

    expect(socketsCreated).toBe(25);
    expect(retryDelays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it("includes Cloudflare request IDs in final handshake errors", async () => {
    const rayId = "a4ba0471eaa9643d-LHR";
    const response: FakeUnexpectedResponse = {
      statusCode: 520,
      headers: { server: "cloudflare", "cf-ray": rayId },
      resume: () => {},
    };
    await expect(fetchDerivHistoryRange("V75", 60, 120_000, 240_000, {
      pageSize: 2,
      pageDelayMs: 0,
      sleep: async () => {},
      createSocket: () => new FakeSocket(() => ({}), undefined, response),
    })).rejects.toThrow(`cf-ray=${rayId}`);
  });

  it("keeps all ten watchlist labels mapped to Deriv candle symbols", () => {
    const pairs = ["V75", "V100", "V50", "V25", "V10", "V75_1S", "V100_1S", "V50_1S", "V25_1S", "V10_1S"];
    expect(pairs.map((pair) => DERIV_SYMBOLS[pair])).toEqual([
      "R_75", "R_100", "R_50", "R_25", "R_10",
      "1HZ75V", "1HZ100V", "1HZ50V", "1HZ25V", "1HZ10V",
    ]);
  });

  it("fails closed if a response repeats a page without moving backward", async () => {
    await expect(fetchDerivHistoryRange("V75", 60, 120_000, 360_000, {
      pageSize: 2,
      pageDelayMs: 0,
      createSocket: () => new FakeSocket((request) => ({
        req_id: request.req_id,
        candles: [history[3]],
      })),
    })).rejects.toThrow("pagination made no progress");
  });

  it("rejects invalid time ranges rather than returning an empty-looking report", async () => {
    await expect(fetchDerivHistoryRange("V75", 60, 2000, 1000)).rejects.toThrow("to > from");
  });

  it("reports gaps in continuous synthetic history", () => {
    const candles = [
      { t: 0, o: 10, h: 11, l: 9, c: 10 },
      { t: 60_000, o: 10, h: 11, l: 9, c: 10 },
      { t: 180_000, o: 10, h: 11, l: 9, c: 10 },
    ];
    expect(summarizeDerivHistory(candles, 0, 240_000, 60)).toEqual({
      expectedBars: 4,
      receivedBars: 3,
      missingBars: 1,
      gapCount: 1,
      maxGapSeconds: 120,
    });
  });
});
