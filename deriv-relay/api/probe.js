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
  const requestedTarget = req.query.target || req.query.cluster || "public";
  const timeoutMs = Math.min(Number(req.query.timeout) || 8000, 9500);

  const allCandidates = [
    { url: "wss://api.derivws.com/trading/v1/options/ws/public", origin: "https://api.deriv.com", label: "deriv_public_options" },
    { url: "wss://api.derivws.com/trading/v1/options/ws/public", origin: "", label: "deriv_public_options_plain" },
    { url: "wss://ws.binaryws.com/websockets/v3?app_id=1089", origin: "", label: "binaryws_1089_plain" },
    { url: "wss://ws.derivws.com/websockets/v3?app_id=1089", origin: "", label: "derivws_1089_plain" },
  ];

  const matched = allCandidates.filter((c) => c.label.includes(requestedTarget));
  const cand = matched.length > 0 ? matched[0] : allCandidates[0];

  const start = Date.now();
  let opened = false;
  let openedAt = 0;
  let firstMsg = null;
  let firstMsgAt = 0;
  let closeInfo = null;
  let errorInfo = null;

  try {
    const candleData = await new Promise((resolve, reject) => {
      let settled = false;
      const opts = {};
      if (cand.origin) {
        opts.headers = { Origin: cand.origin };
      }
      const ws = new WebSocketClient(cand.url, opts);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error(`Timeout after ${timeoutMs}ms (opened=${opened}, openedAt=${openedAt}ms, firstMsg=${JSON.stringify(firstMsg)}, close=${JSON.stringify(closeInfo)}, err=${errorInfo})`));
        }
      }, timeoutMs);

      ws.onopen = () => {
        opened = true;
        openedAt = Date.now() - start;
        try {
          ws.send(JSON.stringify({
            ticks_history: symbol,
            style: "candles",
            granularity: 1800,
            count: 5,
            end: "latest",
            req_id: 1,
          }));
        } catch (e) {
          errorInfo = `sendErr: ${e.message}`;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(e);
          }
        }
      };

      ws.onclose = (ev) => {
        closeInfo = { code: ev.code, reason: ev.reason, wasClean: ev.wasClean, at: Date.now() - start };
      };

      ws.onerror = (err) => {
        errorInfo = `wsErr: ${err.message || "unknown"}`;
      };

      ws.onmessage = (event) => {
        const at = Date.now() - start;
        try {
          const raw = typeof event.data === "string" ? event.data : event.data.toString();
          const data = JSON.parse(raw);
          if (!firstMsg) {
            firstMsg = data.msg_type || Object.keys(data);
            firstMsgAt = at;
          }
          if (data.error) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              try { ws.close(); } catch {}
              reject(new Error(data.error.message || JSON.stringify(data.error)));
            }
            return;
          }
          if (data.candles && Array.isArray(data.candles)) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              try { ws.close(); } catch {}
              resolve(data.candles);
            }
          }
        } catch (e) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(e);
          }
        }
      };
    });

    return res.status(200).json({
      ok: true,
      symbol,
      candidate: cand.label,
      url: cand.url,
      durationMs: Date.now() - start,
      openedAt,
      firstMsgAt,
      count: candleData.length,
      sample: candleData[0],
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      symbol,
      candidate: cand.label,
      url: cand.url,
      durationMs: Date.now() - start,
      opened,
      openedAt,
      firstMsg,
      firstMsgAt,
      closeInfo,
      errorInfo,
      error: err.message,
    });
  }
};
