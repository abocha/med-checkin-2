import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'med-checkin-2.1.1.sqlite');
mkdirSync(dirname(fixturePath), { recursive: true });
rmSync(fixturePath, { force: true });

const db = new DatabaseSync(fixturePath);
try {
  db.exec(`
    PRAGMA user_version = 0;
    CREATE TABLE checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_date TEXT NOT NULL,
      slot TEXT NOT NULL CHECK(slot IN ('13:00','22:00')),
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      mood REAL NOT NULL, anxiety REAL NOT NULL, irritability REAL NOT NULL,
      energy REAL NOT NULL, focus REAL NOT NULL, functioning REAL NOT NULL,
      sleep_quality REAL NOT NULL, appetite REAL NOT NULL,
      night_sleep_hours REAL, day_sleep_hours REAL, sleep_start TEXT, wake_time TEXT,
      context_json TEXT NOT NULL DEFAULT '[]', symptoms_json TEXT NOT NULL DEFAULT '[]',
      activation_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
      red_flags TEXT NOT NULL DEFAULT '',
      UNIQUE(local_date, slot)
    ) STRICT;
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL) STRICT;
    CREATE TABLE reminder_state (
      local_date TEXT NOT NULL,
      slot TEXT NOT NULL CHECK(slot IN ('13:00','22:00')),
      snoozed_until TEXT,
      dismissed_at TEXT,
      notified_at TEXT,
      PRIMARY KEY(local_date, slot)
    ) STRICT;
  `);

  const insert = db.prepare(`
    INSERT INTO checkins (
      id, local_date, slot, recorded_at, updated_at, mood, anxiety, irritability,
      energy, focus, functioning, sleep_quality, appetite, night_sleep_hours,
      day_sleep_hours, sleep_start, wake_time, context_json, symptoms_json,
      activation_json, notes, red_flags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    41, '2026-07-31', '13:00', '2026-07-31T06:05:00.000Z', '2026-07-31T06:05:00.000Z',
    7, 2, 1, 6, 8, 8, 6, 5, 7.5, null, '04:00', '11:30',
    '["caffeine"]', '["headache"]', '[]', 'fixture day', ''
  );
  insert.run(
    42, '2026-07-31', '22:00', '2026-07-31T15:17:00.000Z', '2026-07-31T15:24:00.000Z',
    6, 3, 2, 4, 6, 7, 5, 6, null, 1, null, null,
    '["stress"]', '[]', '["racingThoughts"]', 'fixture evening', 'fixture red flag'
  );
  db.prepare('INSERT INTO reminder_state VALUES (?, ?, ?, ?, ?)')
    .run('2026-07-31', '13:00', '2026-07-31T07:00:00.000Z', null, '2026-07-31T06:10:00.000Z');
  db.prepare('INSERT INTO reminder_state VALUES (?, ?, ?, ?, ?)')
    .run('2026-07-31', '22:00', null, '2026-07-31T15:30:00.000Z', '2026-07-31T15:20:00.000Z');
  for (const [key, value] of Object.entries({
    dayTime: '12:30', eveningTime: '21:45', catchupHours: 3, repeatMinutes: 20,
    treatmentChangeDate: '2026-07-07', medicationLabel: 'legacy label', remindersPausedUntil: null
  })) {
    db.prepare('INSERT INTO settings(key, value_json) VALUES (?, ?)').run(key, JSON.stringify(value));
  }
} finally {
  db.close();
}

console.log(fixturePath);
