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

test('prepareDatabase migrates a synthetic 2.1.1 database without inventing history', () => {
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
    assert.equal(readUserVersion(dbPath), 1);
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
      assert.equal(repo.getSettings().dayTime, '12:30');
      assert.equal(repo.getSettings().treatmentChangeDate, undefined);
      assert.equal(repo.getReminderStates('2026-07-31').day.snoozedUntil, '2026-07-31T07:00:00.000Z');
      assert.equal(repo.getReminderStates('2026-07-31').evening.dismissedAt, '2026-07-31T15:30:00.000Z');
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

test('prepareDatabase creates schema version 1 directly for a clean install', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-clean-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  try {
    const result = prepareDatabase({ dbPath, backupDir: join(root, 'backups') });
    assert.equal(result.migrated, false);
    assert.equal(result.backupPath, null);
    assert.equal(readUserVersion(dbPath), 1);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(checkins)').all().map((row) => row.name);
      assert.equal(columns.includes('kind'), true);
      assert.equal(columns.includes('slot'), false);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
