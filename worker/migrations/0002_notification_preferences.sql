CREATE TABLE IF NOT EXISTS notification_preferences (
  preference_id INTEGER PRIMARY KEY CHECK (preference_id = 1),
  telegram_watch INTEGER NOT NULL DEFAULT 0,
  discord_watch INTEGER NOT NULL DEFAULT 0,
  operational_enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  updated_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_preference_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  previous_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_utc TEXT NOT NULL
);
