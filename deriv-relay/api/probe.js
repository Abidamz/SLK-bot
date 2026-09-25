let WebSocketClient;
try {
  WebSocketClient = require("ws");
} catch {
  WebSocketClient = globalThis.WebSocket;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const symbol = req.query.symbol || "R_75";

  const requestedTarget = req.query.target || req.query.cluster;

  const allCandidates = [
    { url: "wss://ws.binaryws.com/websockets/v3?app_id=1089", origin: "", label: "binaryws_1089_plain" },
    { url: "wss://frontend.binaryws.com/websockets/v3?app_id=1089", origin: "", label: "frontend_1089_plain" },
    { url: "wss://ws.derivws.com/websockets/v3?app_id=1089", origin: "", label: "derivws_1089_plain" },
    { url: "wss://green.derivws.com/websockets/v3?app_id=16929&brand=deriv&l=en", origin: "https://deriv.com", label: "green_16929_origin" },
  ];

  const candidates = requestedTarget
    ? allCandidates.filter((c) => c.label.includes(requestedTarget))
    : allCandidates.slice(0, 2);

  const results = [];

  for (const cand of candidates) {
    const start = Date.now();
    try {
      const opts = {};
      if (cand.origin) {
        opts.headers = { Origin: cand.origin };
      }

      const candleData = await new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocketClient(cand.url, opts);

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch {}
            reject(new Error("Timeout after 4000ms"));
          }
        }, 4000);

        ws.onopen = () => {
          try {
            ws.send(JSON.stringify({
              ticks_history: symbol,
              style: "candles",
              granularity: 1800,
              count: 3,
              end: "latest",
              req_id: 1,
            }));
          } catch (e) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              try { ws.close(); } catch {}
              reject(e);
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
              try { ws.close(); } catch {}
              resolve(data.candles);
            }
          } catch (e) {
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(e);
          }
        };

        ws.onerror = (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(new Error(err.message || "WS error"));
          }
        };
      });

      results.push({
        label: cand.label,
        url: cand.url,
        success: true,
        count: candleData.length,
        durationMs: Date.now() - start,
        sample: candleData[0],
      });
      // Break on first success
      break;
    } catch (err) {
      results.push({
        label: cand.label,
        url: cand.url,
        success: false,
        durationMs: Date.now() - start,
        error: err.message,
      });
    }
  }

  res.status(200).json({ ok: true, symbol, results });
};
