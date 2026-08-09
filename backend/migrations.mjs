import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTimestampedBackup } from './backups.mjs';
import { createLatestSchema, createTrackedItemsSchema, LATEST_SCHEMA_VERSION } from './schema.mjs';

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function tableColumns(db, name) {
  return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name));
}

export function readUserVersion(dbPath) {
  if (!existsSync(dbPath)) return 0;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return Number(db.prepare('PRAGMA user_version').get().user_version); }
  finally { db.close(); }
}

export function prepareDatabase({ dbPath, backupDir, now = new Date(), log = () => {} }) {
  const initial = new DatabaseSync(dbPath);
  initial.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = Number(initial.prepare('PRAGMA user_version').get().user_version);
  if (version > LATEST_SCHEMA_VERSION) {
    initial.close();
    throw new Error(`Unsupported database schema version ${version}`);
  }
  if (version === LATEST_SCHEMA_VERSION) {
    initial.close();
    return { migrated: false, backupPath: null, version };
  }

  if (!tableExists(initial, 'checkins')) {
    createLatestSchema(initial);
    initial.close();
    return { migrated: false, backupPath: null, version: LATEST_SCHEMA_VERSION };
  }

  if (version === 1) {
    initial.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    initial.close();
    const backupPath = createTimestampedBackup({ dbPath, backupDir, prefix: 'pre-migration', now });
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    try {
      db.exec('BEGIN IMMEDIATE');
      createTrackedItemsSchema(db);
      db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`);
      db.exec('COMMIT');
      log('info', 'Database migrated to schema version 2', { backupPath });
      return { migrated: true, backupPath, version: LATEST_SCHEMA_VERSION };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      error.backupPath = backupPath;
      log('fatal', 'Database migration failed', { backupPath, error: error.message });
      throw error;
    } finally { db.close(); }
  }

  const columns = tableColumns(initial, 'checkins');
  if (!columns.has('slot')) {
    initial.close();
    throw new Error('Unrecognized legacy database schema');
  }

  initial.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  initial.close();
  const backupPath = createTimestampedBackup({ dbPath, backupDir, prefix: 'pre-migration', now });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('ALTER TABLE checkins RENAME TO checkins_legacy');
    if (tableExists(db, 'reminder_state')) db.exec('ALTER TABLE reminder_state RENAME TO reminder_state_legacy');
    createLatestSchema(db, { setUserVersion: false });
    db.exec(`
      INSERT INTO checkins (
        id, kind, local_date, period, scheduled_for, observed_at, recorded_at, updated_at,
        mood, anxiety, irritability, energy, focus, functioning, sleep_quality, appetite,
        night_sleep_hours, day_sleep_hours, sleep_start, wake_time, context_json,
        symptoms_json, activation_json, notes, red_flags
      )
      SELECT
        id, 'scheduled', local_date,
        CASE slot WHEN '13:00' THEN 'day' WHEN '22:00' THEN 'evening' END,
        NULL, NULL, recorded_at, updated_at,
        mood, anxiety, irritability, energy, focus, functioning, sleep_quality, appetite,
        night_sleep_hours, day_sleep_hours, sleep_start, wake_time, context_json,
        symptoms_json, activation_json, notes, red_flags
      FROM checkins_legacy;
    `);
    if (tableExists(db, 'reminder_state_legacy')) {
      db.exec(`
        INSERT INTO reminder_state(local_date, period, snoozed_until, dismissed_at, notified_at)
        SELECT local_date,
          CASE slot WHEN '13:00' THEN 'day' WHEN '22:00' THEN 'evening' END,
          snoozed_until, dismissed_at, notified_at
        FROM reminder_state_legacy;
      `);
      db.exec('DROP TABLE reminder_state_legacy');
    }
    db.prepare("DELETE FROM settings WHERE key IN ('treatmentChangeDate','medicationLabel')").run();
    db.exec('DROP TABLE checkins_legacy');
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`);
    db.exec('COMMIT');
    log('info', 'Database migrated to schema version 2', { backupPath });
    return { migrated: true, backupPath, version: LATEST_SCHEMA_VERSION };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    error.backupPath = backupPath;
    log('fatal', 'Database migration failed', { backupPath, error: error.message });
    throw error;
  } finally {
    db.close();
  }
}
