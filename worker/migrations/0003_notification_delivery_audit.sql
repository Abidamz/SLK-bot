CREATE TABLE IF NOT EXISTS notification_delivery_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_utc TEXT NOT NULL
);
