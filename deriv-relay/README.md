# SLK Deriv Relay (Ultra-Lightweight Synthetic Candle Proxy)

This micro-service runs outside Cloudflare (on Render, Railway, or Fly.io) to provide continuous, unblocked Deriv synthetic market data (`R_75`, `R_100`, etc.) to the SLK-bot Cloudflare Worker via standard HTTP `GET /candles`.

## 🚀 2-Minute Free Deployment on Render.com

1. Go to [https://dashboard.render.com](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Select your GitHub repository: `Abidamz/SLK-bot`
4. Configure the settings:
   - **Name**: `slk-deriv-relay`
   - **Root Directory**: `deriv-relay`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free ($0/month)**
5. Click **Deploy Web Service**
6. Copy your public service URL (e.g., `https://slk-deriv-relay.onrender.com`).

---

## 🔗 Connect to Cloudflare Worker

Once your Render relay is live:
1. Open your Cloudflare Worker Dashboard → **slk-alert-worker** → **Settings** → **Variables and Secrets**.
2. Add an environment variable:
   - **Variable name**: `DERIV_PROXY_URL`
   - **Value**: `https://slk-deriv-relay.onrender.com` (your Render URL)
3. Save and Deploy!

Alternatively, you can save it via your interactive Admin Dashboard:
- Visit `https://slk-alert-worker.abidogundamilola.workers.dev/admin/settings?deriv_proxy_url=https://slk-deriv-relay.onrender.com`

---

## ⚡ Endpoints

- `GET /health` — Service health, memory usage, and Deriv WebSocket connection status.
- `GET /candles?symbol=R_75&granularity=1800&limit=300` — Returns normalized OHLC candles in JSON:
  ```json
  {
    "ok": true,
    "symbol": "R_75",
    "granularity": 1800,
    "count": 300,
    "cached": false,
    "durationMs": 42,
    "candles": [
      { "t": 1727247600000, "o": 1234.5, "h": 1240.2, "l": 1230.1, "c": 1238.0 }
    ]
  }
  ```
