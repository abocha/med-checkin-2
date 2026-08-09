import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, readUserVersion } from '../backend/migrations.mjs';
import { createRepository } from '../backend/repository.mjs';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'med-checkin-2.1.1.sqlite');

test('prepareDatabase migrates a legacy schema-0 database without inventing treatment history', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-migrate-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  copyFileSync(fixturePath, dbPath);
  try {
    const result = prepareDatabase({
      dbPath,
      backupDir,
      now: new Date('2026-08-07T01:02:03.000Z'),
      log() {}
    });
    assert.equal(readUserVersion(dbPath), 2);
    assert.equal(existsSync(result.backupPath), true);
    assert.deepEqual(readdirSync(backupDir), ['pre-migration-20260807T010203Z.sqlite']);

    const repo = createRepository(dbPath);
    try {
      const day = repo.getScheduledCheckin('2026-07-31', 'day');
      const evening = repo.getScheduledCheckin('2026-07-31', 'evening');
      assert.equal(day.id, 41);
      assert.equal(day.kind, 'scheduled');
      assert.equal(day.period, 'day');
      assert.equal(day.observedAt, null);
      assert.equal(day.scheduledFor, null);
      assert.equal(day.recordedAt, '2026-07-31T06:05:00.000Z');
      assert.equal(day.notes, 'fixture day');
      assert.deepEqual(day.context, ['caffeine']);
      assert.equal(evening.id, 42);
      assert.equal(evening.period, 'evening');
      assert.equal(evening.updatedAt, '2026-07-31T15:24:00.000Z');
      assert.equal(evening.redFlags, 'fixture red flag');
      const editedDay = repo.updateCheckin(day.id, { ...day, mood: 8 }, new Date('2026-08-07T02:00:00.000Z'));
      assert.equal(editedDay.observedAt, null);
      assert.equal(editedDay.recordedAt, '2026-07-31T06:05:00.000Z');
      assert.equal(editedDay.updatedAt, '2026-08-07T02:00:00.000Z');
      assert.equal(repo.getSettings().dayTime, '12:30');
      assert.equal(repo.getSettings().treatmentChangeDate, undefined);
      assert.equal(repo.getReminderStates('2026-07-31').day.snoozedUntil, '2026-07-31T07:00:00.000Z');
      assert.equal(repo.getReminderStates('2026-07-31').evening.dismissedAt, '2026-07-31T15:30:00.000Z');
      assert.deepEqual(repo.listTreatmentEvents(), []);
    } finally {
      repo.close();
    }

    const backup = new DatabaseSync(result.backupPath, { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 0);
      assert.equal(backup.prepare('SELECT slot FROM checkins WHERE id = 41').get().slot, '13:00');
    } finally {
      backup.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareDatabase creates schema version 2 directly for a clean install', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-clean-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  try {
    const result = prepareDatabase({ dbPath, backupDir: join(root, 'backups') });
    assert.equal(result.migrated, false);
    assert.equal(result.backupPath, null);
    assert.equal(readUserVersion(dbPath), 2);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(checkins)').all().map((row) => row.name);
      assert.equal(columns.includes('kind'), true);
      assert.equal(columns.includes('slot'), false);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tracked_items').get().count, 20);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM treatment_events').get().count, 0);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepareDatabase upgrades schema 1 in place without rewriting existing rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-v1-migrate-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  const repo = createRepository(dbPath);
  try {
    const observation = repo.createCheckin({
      kind: 'scheduled', period: 'day', localDate: '2026-08-01',
      scheduledFor: null, observedAt: '2026-08-01T06:05:00.000Z',
      mood: 7, anxiety: 2, irritability: 1, energy: 6, focus: 8, functioning: 8, sleepQuality: 6, appetite: 5,
      nightSleepHours: 7.5, daySleepHours: null, sleepStart: '04:00', wakeTime: '11:30',
      context: ['caffeine'], symptoms: ['headache'], activation: [], notes: 'v1 fixture', redFlags: ''
    }, new Date('2026-08-01T06:10:00.000Z'));
    const treatment = repo.createTreatmentEvent({ effectiveDate: '2026-08-02', regimen: [], note: 'v1 treatment' }, new Date('2026-08-02T00:00:00.000Z'));
    repo.saveSettings({ dayTime: '12:30' });
    repo.saveReminderState('2026-08-01', 'day', { dismissedAt: '2026-08-01T07:00:00.000Z' });
    const before = {
      observation: repo.getCheckinById(observation.id),
      treatment: repo.listTreatmentEvents().find((item) => item.id === treatment.id),
      settings: repo.getSettings(),
      reminder: repo.getReminderStates('2026-08-01')
    };
    repo.close();
    const db = new DatabaseSync(dbPath);
    try { db.exec('DROP INDEX tracked_items_category_order; DROP TABLE tracked_items; PRAGMA user_version = 1;'); }
    finally { db.close(); }
    const result = prepareDatabase({ dbPath, backupDir, now: new Date('2026-08-07T01:02:03.000Z'), log() {} });
    assert.equal(result.migrated, true);
    assert.equal(readUserVersion(dbPath), 2);
    assert.equal(existsSync(result.backupPath), true);
    assert.deepEqual(readdirSync(backupDir), ['pre-migration-20260807T010203Z.sqlite']);
    const migrated = createRepository(dbPath);
    try {
      assert.deepEqual(migrated.getCheckinById(observation.id), before.observation);
      assert.deepEqual(migrated.listTreatmentEvents().find((item) => item.id === treatment.id), before.treatment);
      assert.equal(migrated.getSettings().dayTime, before.settings.dayTime);
      assert.deepEqual(migrated.getReminderStates('2026-08-01'), before.reminder);
      assert.equal(migrated.listTrackedItems().length, 20);
    } finally { migrated.close(); }
  } finally { try { repo.close(); } catch {} rmSync(root, { recursive: true, force: true }); }
});
