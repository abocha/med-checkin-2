import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS } from './domain.mjs';

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function rowToCheckin(row) {
  if (!row) return null;
  return {
    id: row.id,
    localDate: row.local_date,
    slot: row.slot,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
    mood: row.mood,
    anxiety: row.anxiety,
    irritability: row.irritability,
    energy: row.energy,
    focus: row.focus,
    functioning: row.functioning,
    sleepQuality: row.sleep_quality,
    appetite: row.appetite,
    nightSleepHours: row.night_sleep_hours,
    daySleepHours: row.day_sleep_hours,
    sleepStart: row.sleep_start,
    wakeTime: row.wake_time,
    context: parseJson(row.context_json, []),
    symptoms: parseJson(row.symptoms_json, []),
    activation: parseJson(row.activation_json, []),
    notes: row.notes ?? '',
    redFlags: row.red_flags ?? ''
  };
}

export function createRepository(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reminder_state (
      local_date TEXT NOT NULL,
      slot TEXT NOT NULL CHECK(slot IN ('13:00','22:00')),
      snoozed_until TEXT,
      dismissed_at TEXT,
      notified_at TEXT,
      PRIMARY KEY(local_date, slot)
    ) STRICT;
  `);

  const upsert = db.prepare(`
    INSERT INTO checkins (
      local_date, slot, recorded_at, updated_at, mood, anxiety, irritability,
      energy, focus, functioning, sleep_quality, appetite, night_sleep_hours,
      day_sleep_hours, sleep_start, wake_time, context_json, symptoms_json,
      activation_json, notes, red_flags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_date, slot) DO UPDATE SET
      updated_at=excluded.updated_at, mood=excluded.mood, anxiety=excluded.anxiety,
      irritability=excluded.irritability, energy=excluded.energy, focus=excluded.focus,
      functioning=excluded.functioning, sleep_quality=excluded.sleep_quality,
      appetite=excluded.appetite, night_sleep_hours=excluded.night_sleep_hours,
      day_sleep_hours=excluded.day_sleep_hours, sleep_start=excluded.sleep_start,
      wake_time=excluded.wake_time, context_json=excluded.context_json,
      symptoms_json=excluded.symptoms_json, activation_json=excluded.activation_json,
      notes=excluded.notes, red_flags=excluded.red_flags
    RETURNING *
  `);

  const getByDateSlot = db.prepare('SELECT * FROM checkins WHERE local_date=? AND slot=?');
  const getById = db.prepare('SELECT * FROM checkins WHERE id=?');
  const deleteById = db.prepare('DELETE FROM checkins WHERE id=?');
  const settingUpsert = db.prepare(`INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`);
  const reminderUpsert = db.prepare(`
    INSERT INTO reminder_state(local_date,slot,snoozed_until,dismissed_at,notified_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(local_date,slot) DO UPDATE SET
      snoozed_until=excluded.snoozed_until,
      dismissed_at=excluded.dismissed_at,
      notified_at=excluded.notified_at
  `);

  return {
    upsertCheckin(checkin) {
      const row = upsert.get(
        checkin.localDate, checkin.slot, checkin.recordedAt, checkin.updatedAt,
        checkin.mood, checkin.anxiety, checkin.irritability, checkin.energy,
        checkin.focus, checkin.functioning, checkin.sleepQuality, checkin.appetite,
        checkin.nightSleepHours, checkin.daySleepHours, checkin.sleepStart,
        checkin.wakeTime, JSON.stringify(checkin.context), JSON.stringify(checkin.symptoms),
        JSON.stringify(checkin.activation), checkin.notes, checkin.redFlags
      );
      return rowToCheckin(row);
    },
    getCheckin(localDate, slot) { return rowToCheckin(getByDateSlot.get(localDate, slot)); },
    getCheckinById(id) { return rowToCheckin(getById.get(Number(id))); },
    listCheckins({ limit = 100, offset = 0, from = null, to = null } = {}) {
      const conditions = [];
      const params = [];
      if (from) { conditions.push('local_date >= ?'); params.push(from); }
      if (to) { conditions.push('local_date <= ?'); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM checkins ${where} ORDER BY local_date DESC, slot DESC LIMIT ? OFFSET ?`).all(...params, Math.min(1000, Number(limit) || 100), Math.max(0, Number(offset) || 0));
      return rows.map(rowToCheckin);
    },
    deleteCheckin(id) { return deleteById.run(Number(id)).changes > 0; },
    getSettings() {
      const entries = db.prepare('SELECT key,value_json FROM settings').all();
      const saved = Object.fromEntries(entries.map((row) => [row.key, parseJson(row.value_json, null)]));
      return { ...DEFAULT_SETTINGS, ...saved };
    },
    saveSettings(settings) {
      const merged = { ...this.getSettings(), ...settings };
      db.exec('BEGIN');
      try {
        for (const [key, value] of Object.entries(merged)) settingUpsert.run(key, JSON.stringify(value));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return merged;
    },
    getReminderStates(localDate) {
      const rows = db.prepare('SELECT * FROM reminder_state WHERE local_date=?').all(localDate);
      return Object.fromEntries(rows.map((row) => [row.slot, {
        snoozedUntil: row.snoozed_until,
        dismissedAt: row.dismissed_at,
        notifiedAt: row.notified_at
      }]));
    },
    saveReminderState(localDate, slot, patch) {
      const current = this.getReminderStates(localDate)[slot] ?? {};
      const next = { ...current, ...patch };
      reminderUpsert.run(localDate, slot, next.snoozedUntil ?? null, next.dismissedAt ?? null, next.notifiedAt ?? null);
      return next;
    },
    clearReminderState(localDate, slot) {
      db.prepare('DELETE FROM reminder_state WHERE local_date=? AND slot=?').run(localDate, slot);
    },
    exportRows() { return db.prepare('SELECT * FROM checkins ORDER BY local_date, slot').all().map(rowToCheckin); },
    checkpoint() { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); },
    close() { db.close(); }
  };
}
