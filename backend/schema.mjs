export const LATEST_SCHEMA_VERSION = 1;

export const KNOWN_TREATMENT_EVENTS = Object.freeze([
  {
    effectiveDate: null,
    regimen: [
      { name: 'Escitalopram', amount: 20, unit: 'mg', timing: null },
      { name: 'Atomoxetine', amount: 80, unit: 'mg', timing: null }
    ],
    note: 'Known baseline before 2026-07-07'
  },
  {
    effectiveDate: '2026-07-07',
    regimen: [
      { name: 'Escitalopram', amount: 10, unit: 'mg', timing: null },
      { name: 'Atomoxetine', amount: 80, unit: 'mg', timing: null }
    ],
    note: ''
  }
]);

export function createLatestSchema(db, { setUserVersion = true, seedAt = new Date().toISOString() } = {}) {
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
      mood REAL, anxiety REAL, irritability REAL,
      energy REAL, focus REAL, functioning REAL,
      sleep_quality REAL, appetite REAL,
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

  const count = db.prepare('SELECT COUNT(*) AS count FROM treatment_events').get().count;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO treatment_events(effective_date, regimen_json, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const event of KNOWN_TREATMENT_EVENTS) {
      insert.run(event.effectiveDate, JSON.stringify(event.regimen), event.note, seedAt, seedAt);
    }
  }
  if (setUserVersion) db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`);
}
