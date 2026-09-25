let WebSocketClient;
try {
  WebSocketClient = require("ws");
} catch {
  WebSocketClient = globalThis.WebSocket;
}

const DERIV_APP_ID = process.env.DERIV_APP_ID || "1089";
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(DERIV_APP_ID)}&brand=deriv&l=en`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const symbol = req.query.symbol || "R_75";
  const granularity = Number(req.query.granularity) || 1800;
  const limit = Math.min(Number(req.query.limit) || 300, 1000);

  const start = Date.now();

  try {
    const candles = await new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocketClient(DERIV_WS_URL, {
        headers: {
          Origin: "https://deriv.com",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error(`Timeout after 7000ms waiting for Deriv ${symbol}`));
        }
      }, 7000);

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({
            ticks_history: symbol,
            style: "candles",
            granularity,
            count: limit,
            end: "latest",
            req_id: 1,
          }));
        } catch (sendErr) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(sendErr);
          }
        }
      };

      ws.onmessage = (event) => {
        if (settled) return;
        try {
          const raw = typeof event.data === "string" ? event.data : event.data.toString();
          const data = JSON.parse(raw);
          if (data.error) {
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(new Error(data.error.message || JSON.stringify(data.error)));
            return;
          }
          if (data.candles && Array.isArray(data.candles)) {
            settled = true;
            clearTimeout(timer);
            const mapped = data.candles.map((c) => ({
              t: Number(c.epoch) * 1000,
              o: Number(c.open),
              h: Number(c.high),
              l: Number(c.low),
              c: Number(c.close),
            })).sort((a, b) => a.t - b.t);
            try { ws.close(); } catch {}
            resolve(mapped);
          }
        } catch (parseErr) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          reject(parseErr);
        }
      };

      ws.onerror = (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          reject(new Error(err.message || "WebSocket error"));
        }
      };
    });

    res.status(200).json({
      ok: true,
      symbol,
      granularity,
      count: candles.length,
      durationMs: Date.now() - start,
      candles,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      symbol,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
