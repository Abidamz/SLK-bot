import WebSocket from "ws";

interface HistoryCandle {
  epoch?: number | string;
}

interface HistoryResponse {
  req_id?: number | string;
  echo_req?: { req_id?: number | string; [key: string]: unknown };
  error?: { code?: string; message?: string };
  candles?: HistoryCandle[];
  [key: string]: unknown;
}

interface DiagnosticCase {
  label: string;
  request: Record<string, unknown>;
}

interface DiagnosticEndpoint {
  label: string;
  url: string;
  headers?: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 10_000;
const APP_ID = process.env.DERIV_APP_ID ?? "1089";
const SYMBOL = "R_75";

function epochForDaysAgo(days: number): number {
  const now = Math.floor(Date.now() / 60_000) * 60;
  return now - days * 86_400;
}

function diagnosticCases(): DiagnosticCase[] {
  const cases: DiagnosticCase[] = [{
    label: "latest control",
    request: {
      ticks_history: SYMBOL,
      style: "candles",
      granularity: 60,
      count: 3,
      end: "latest",
    },
  }];

  for (const daysAgo of [7, 350, 370]) {
    const start = epochForDaysAgo(daysAgo);
    const end = start + 2 * 60;
    const dateLabel = `${daysAgo}d ago`;
    const base = {
      ticks_history: SYMBOL,
      style: "candles",
      granularity: 60,
      start,
      end,
    };
    cases.push(
      {
        label: `${dateLabel}, start+end+count`,
        request: { ...base, count: 3 },
      },
      {
        label: `${dateLabel}, start+end, no count`,
        request: base,
      },
      {
        label: `${dateLabel}, end+count, no start`,
        request: {
          ticks_history: SYMBOL,
          style: "candles",
          granularity: 60,
          end,
          count: 3,
        },
      },
    );
  }

  for (const daysAgo of [360, 364, 365, 366]) {
    const start = epochForDaysAgo(daysAgo);
    cases.push({
      label: `1m ${daysAgo}d ago, start+end+count`,
      request: {
        ticks_history: SYMBOL,
        style: "candles",
        granularity: 60,
        start,
        end: start + 2 * 60,
        count: 3,
      },
    });
  }
  const start370 = epochForDaysAgo(370);
  cases.push({
    label: "1m 370d ago, with adjust_start_time=1",
    request: {
      ticks_history: SYMBOL,
      style: "candles",
      granularity: 60,
      start: start370,
      end: start370 + 2 * 60,
      count: 3,
      adjust_start_time: 1,
    },
  });

  const utcToday = Math.floor(Date.now() / 86_400_000) * 86_400;
  for (const daysAgo of [350, 365, 385, 730]) {
    const start = utcToday - daysAgo * 86_400;
    cases.push({
      label: `1d ${daysAgo}d ago, start+end+count`,
      request: {
        ticks_history: SYMBOL,
        style: "candles",
        granularity: 86_400,
        start,
        end: start + 2 * 86_400,
        count: 3,
      },
    });
  }
  return cases;
}

function endpoints(): DiagnosticEndpoint[] {
  const appId = encodeURIComponent(APP_ID);
  return [
    {
      label: "new public endpoint (no Origin)",
      url: "wss://api.derivws.com/trading/v1/options/ws/public",
    },
    {
      label: "new public endpoint (api.deriv.com Origin)",
      url: "wss://api.derivws.com/trading/v1/options/ws/public",
      headers: { Origin: "https://api.deriv.com" },
    },
    {
      label: "legacy ws.derivws.com",
      url: `wss://ws.derivws.com/websockets/v3?app_id=${appId}&brand=deriv&l=en`,
    },
    {
      label: "legacy ws.binaryws.com",
      url: `wss://ws.binaryws.com/websockets/v3?app_id=${appId}`,
    },
    {
      label: "legacy frontend.binaryws.com",
      url: `wss://frontend.binaryws.com/websockets/v3?app_id=${appId}&brand=deriv&l=en`,
    },
  ];
}

function parseResponse(raw: unknown): HistoryResponse | null {
  try {
    const text = typeof raw === "string"
      ? raw
      : raw && typeof (raw as { toString?: unknown }).toString === "function"
        ? (raw as { toString: () => string }).toString()
        : String(raw);
    return JSON.parse(text) as HistoryResponse;
  } catch {
    return null;
  }
}

function describeResponse(response: HistoryResponse): string {
  const echoed = response.echo_req && typeof response.echo_req === "object"
    ? JSON.stringify(response.echo_req)
    : "not included";
  if (response.error) {
    return `API error ${response.error.code ?? "unknown"}: ${response.error.message ?? "no message"}; echo_req: ${echoed}`;
  }
  const candles = Array.isArray(response.candles) ? response.candles : [];
  const epochs = candles
    .map((candle) => Number(candle.epoch))
    .filter(Number.isSafeInteger)
    .sort((a, b) => a - b);
  const dates = epochs.length
    ? `${new Date(epochs[0] * 1000).toISOString()} to ${new Date(epochs[epochs.length - 1] * 1000).toISOString()}`
    : "no candle timestamps";
  return `${candles.length} candle(s), ${dates}; echo_req: ${echoed}`;
}

async function connect(endpoint: DiagnosticEndpoint): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.url, { headers: endpoint.headers });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function runEndpoint(endpoint: DiagnosticEndpoint, cases: DiagnosticCase[]): Promise<void> {
  console.log(`\n--- ${endpoint.label} ---`);
  let socket: WebSocket;
  try {
    socket = await connect(endpoint);
  } catch (error) {
    console.log(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let nextReqId = 1;
  const pending = new Map<number, {
    resolve: (response: HistoryResponse | Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  socket.on("message", (raw) => {
    const response = parseResponse(raw);
    if (!response) return;
    const responseId = Number(response.req_id ?? response.echo_req?.req_id);
    const entry = pending.get(responseId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(responseId);
    entry.resolve(response);
  });
  socket.on("error", (error) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(error instanceof Error ? error : new Error(String(error)));
    }
  });

  const results = await Promise.all(cases.map((diagnosticCase) => new Promise<HistoryResponse | Error>((resolve) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      pending.delete(reqId);
      resolve(new Error(`no response after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(reqId, { resolve, timer });
    try {
      socket.send(JSON.stringify({ ...diagnosticCase.request, req_id: reqId }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(reqId);
      resolve(error instanceof Error ? error : new Error(String(error)));
    }
  })));

  results.forEach((response, index) => {
    const summary = response instanceof Error
      ? `ERROR: ${response.message}`
      : describeResponse(response);
    console.log(`${cases[index].label}: ${summary}`);
  });
  socket.close();
}

async function main(): Promise<void> {
  console.log("Deriv history bounds diagnostic (read-only; no trades are placed)");
  console.log(`Symbol: ${SYMBOL}; app id: ${APP_ID}`);
  console.log("Checks M1 availability near 360–370 days and D1 availability back to 730 days.");
  console.log("Compares both new-endpoint Origin modes and all legacy fallback WebSocket endpoints.");
  const cases = diagnosticCases();
  for (const endpoint of endpoints()) await runEndpoint(endpoint, cases);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
