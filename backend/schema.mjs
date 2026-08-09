import { BUILTIN_TRACKED_ITEMS } from './tracked-items.mjs';
import { BUILTIN_SCALE_DEFINITIONS } from './scales.mjs';

export const LATEST_SCHEMA_VERSION = 3;

export function createTrackedItemsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('context','symptoms','activation')),
      label TEXT NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0,1)),
      sort_order INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS tracked_items_category_order
      ON tracked_items(category, sort_order, id);
  `);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tracked_items(id, category, label, active, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const item of BUILTIN_TRACKED_ITEMS) {
    insert.run(item.id, item.category, item.label, Number(item.active), item.sortOrder);
  }
}

export function createScaleSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scale_definitions (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0,1)),
      sort_order INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS checkin_scale_values (
      checkin_id INTEGER NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
      scale_id TEXT NOT NULL REFERENCES scale_definitions(id),
      value REAL NOT NULL CHECK(value >= 0 AND value <= 10),
      PRIMARY KEY(checkin_id, scale_id)
    ) STRICT;
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO scale_definitions(id, label, active, sort_order) VALUES (?, ?, ?, ?)');
  for (const definition of BUILTIN_SCALE_DEFINITIONS) {
    insert.run(definition.id, definition.label, Number(definition.active), definition.sortOrder);
  }
}

export function createLatestSchema(db, { setUserVersion = true } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('scheduled','extra')),
      local_date TEXT NOT NULL,
      period TEXT CHECK(period IN ('day','evening') OR period IS NULL),
      scheduled_for TEXT,
      observed_at TEXT,
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      night_sleep_hours REAL, day_sleep_hours REAL, sleep_start TEXT, wake_time TEXT,
      context_json TEXT NOT NULL DEFAULT '[]', symptoms_json TEXT NOT NULL DEFAULT '[]',
      activation_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
      red_flags TEXT NOT NULL DEFAULT '',
      CHECK((kind='scheduled' AND period IS NOT NULL) OR (kind='extra' AND period IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS checkins_scheduled_identity
      ON checkins(local_date, period) WHERE kind='scheduled';
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reminder_state (
      local_date TEXT NOT NULL,
      period TEXT NOT NULL CHECK(period IN ('day','evening')),
      snoozed_until TEXT,
      dismissed_at TEXT,
      notified_at TEXT,
      PRIMARY KEY(local_date, period)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS treatment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_date TEXT,
      regimen_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS treatment_events_effective_date
      ON treatment_events(effective_date) WHERE effective_date IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS treatment_events_single_baseline
      ON treatment_events((1)) WHERE effective_date IS NULL;
  `);
  createTrackedItemsSchema(db);
  createScaleSchema(db);
  if (setUserVersion) db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`);
}
