let WebSocketClient;
try {
  WebSocketClient = require("ws");
} catch {
  WebSocketClient = globalThis.WebSocket;
}

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
  const appId = process.env.DERIV_APP_ID || "1089";

  const start = Date.now();

  const candidates = [
    { url: "wss://api.derivws.com/trading/v1/options/ws/public", origin: "https://api.deriv.com", label: "deriv_public_options" },
    { url: "wss://api.derivws.com/trading/v1/options/ws/public", origin: "", label: "deriv_public_options_plain" },
    { url: `wss://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`, origin: "", label: "binaryws_1089_plain" },
    { url: `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`, origin: "", label: "derivws_1089_plain" },
  ];

  let lastError = "";

  for (const cand of candidates) {
    try {
      const opts = {};
      if (cand.origin) {
        opts.headers = { Origin: cand.origin };
      }

      const candles = await new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocketClient(cand.url, opts);

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch {}
            reject(new Error(`Timeout after 5000ms on ${cand.label}`));
          }
        }, 5000);

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
            reject(new Error(`${cand.label} error: ${err.message || "WS error"}`));
          }
        };
      });

      return res.status(200).json({
        ok: true,
        symbol,
        granularity,
        count: candles.length,
        source: cand.label,
        durationMs: Date.now() - start,
        candles,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  res.status(502).json({
    ok: false,
    symbol,
    durationMs: Date.now() - start,
    error: `All candidate endpoints failed: ${lastError}`,
  });
};
