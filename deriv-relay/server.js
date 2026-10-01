// Ultra-lightweight native WebSocket relay for Deriv synthetic candles
// Keeps Deriv WebSocket connection open for sub-50ms responses to Cloudflare Worker

const http = require("http");
const { URL } = require("url");

let WebSocketClient;
try {
  WebSocketClient = require("ws");
} catch {
  WebSocketClient = globalThis.WebSocket;
}

const PORT = process.env.PORT || 3000;
const DERIV_APP_ID = process.env.DERIV_APP_ID || "1089";
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(DERIV_APP_ID)}&brand=deriv&l=en`;

// In-memory cache for recent candles (15s TTL)
const cache = new Map();
const CACHE_TTL_MS = 15_000;

// Pending request tracking for concurrent queries
const pendingRequests = new Map();
let reqIdCounter = 1;

// Persistent WebSocket state
let activeWs = null;
let isConnecting = false;
let pingInterval = null;

function connectWs() {
  if (activeWs && (activeWs.readyState === 0 || activeWs.readyState === 1)) {
    return;
  }
  isConnecting = true;
  try {
    const ws = new WebSocketClient(DERIV_WS_URL, {
      headers: {
        Origin: "https://deriv.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    ws.onopen = () => {
      console.log(`[Deriv Relay] Connected to Deriv WebSocket (${DERIV_WS_URL})`);
      activeWs = ws;
      isConnecting = false;

      // Keepalive ping every 25 seconds
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws.readyState === 1) {
          try {
            ws.send(JSON.stringify({ ping: 1 }));
          } catch {}
        }
      }, 25_000);
    };

    ws.onmessage = (event) => {
      try {
        const raw = typeof event.data === "string" ? event.data : event.data.toString();
        const data = JSON.parse(raw);

        const reqId = data.req_id || data.echo_req?.req_id;
        if (reqId && pendingRequests.has(reqId)) {
          const { resolve, reject, timer } = pendingRequests.get(reqId);
          clearTimeout(timer);
          pendingRequests.delete(reqId);

          if (data.error) {
            reject(new Error(data.error.message || JSON.stringify(data.error)));
          } else if (data.candles && Array.isArray(data.candles)) {
            const mapped = data.candles.map((c) => ({
              t: Number(c.epoch) * 1000,
              o: Number(c.open),
              h: Number(c.high),
              l: Number(c.low),
              c: Number(c.close),
            })).sort((a, b) => a.t - b.t);
            resolve(mapped);
          } else {
            resolve([]);
          }
        }
      } catch (err) {
        console.error("[Deriv Relay] Message parsing error:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("[Deriv Relay] WS error:", err.message || err);
    };

    ws.onclose = () => {
      console.log("[Deriv Relay] WS closed, reconnecting in 2s...");
      activeWs = null;
      isConnecting = false;
      if (pingInterval) clearInterval(pingInterval);
      setTimeout(connectWs, 2000);
    };
  } catch (err) {
    console.error("[Deriv Relay] Connection exception:", err);
    isConnecting = false;
    setTimeout(connectWs, 3000);
  }
}

// Initial connection
connectWs();

/** Fetch candles for a symbol via persistent WebSocket or one-shot */
async function getCandles(symbol, granularity, limit) {
  const cacheKey = `${symbol}:${granularity}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { candles: cached.candles, cached: true };
  }

  // Ensure socket is ready
  if (!activeWs || activeWs.readyState !== 1) {
    connectWs();
    // Wait up to 3 seconds for connection
    const waitStart = Date.now();
    while ((!activeWs || activeWs.readyState !== 1) && Date.now() - waitStart < 3000) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  if (!activeWs || activeWs.readyState !== 1) {
    throw new Error("Deriv WebSocket connection unavailable");
  }

  const reqId = ++reqIdCounter;
  const payload = {
    ticks_history: symbol,
    style: "candles",
    granularity: Number(granularity) || 1800,
    count: Math.min(Number(limit) || 300, 1000),
    end: "latest",
    req_id: reqId,
  };

  const candles = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error(`Timeout waiting for Deriv response (${symbol} ${granularity}s)`));
    }, 8000);

    pendingRequests.set(reqId, { resolve, reject, timer });

    try {
      activeWs.send(JSON.stringify(payload));
    } catch (sendErr) {
      clearTimeout(timer);
      pendingRequests.delete(reqId);
      reject(sendErr);
    }
  });

  cache.set(cacheKey, { candles, timestamp: Date.now() });
  return { candles, cached: false };
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  if (pathname === "/" || pathname === "/health") {
    const mem = process.memoryUsage();
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      service: "slk-deriv-relay",
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(mem.rss / 1024 / 1024),
      wsConnected: activeWs ? activeWs.readyState === 1 : false,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (pathname === "/candles") {
    const symbol = parsedUrl.searchParams.get("symbol") || "R_75";
    const granularity = parsedUrl.searchParams.get("granularity") || "1800";
    const limit = parsedUrl.searchParams.get("limit") || "300";

    const start = Date.now();
    try {
      const { candles, cached } = await getCandles(symbol, granularity, limit);
      res.writeHead(200, {
        "X-Cache": cached ? "HIT" : "MISS",
        "X-Duration-Ms": String(Date.now() - start),
      });
      res.end(JSON.stringify({
        ok: true,
        symbol,
        granularity: Number(granularity),
        count: candles.length,
        cached,
        durationMs: Date.now() - start,
        candles,
      }));
    } catch (err) {
      res.writeHead(502);
      res.end(JSON.stringify({
        ok: false,
        symbol,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`[Deriv Relay] HTTP server listening on port ${PORT}`);
});
