# SLK Radar dashboard

A lean, read-only dashboard for paper operations. It loads `/health`, `/stats`, and `/alerts` from the Worker and keeps the admin key only in browser `sessionStorage` for the current session.

## Local preview

From the repository root:

```bash
python3 -m http.server 4173 --directory dashboard
```

Open `http://localhost:4173` in a browser. Enter the Worker URL and admin key locally; do not commit or share the key.

## Scope

This MVP is observability-only. It does not submit orders and does not expose provider, notification, signing, or broker secrets. The prominent execution state remains `DISABLED`.
