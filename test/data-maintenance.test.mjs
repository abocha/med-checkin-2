import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRepository } from '../backend/repository.mjs';
import { prepareDatabase } from '../backend/migrations.mjs';
import { BUILTIN_TRACKED_ITEMS } from '../backend/tracked-items.mjs';
import {
  buildPortableExport,
  createManualBackup,
  listBackups,
  previewPortableImport,
  replacePortableData,
  restoreDatabase,
  validateBackupFile
} from '../backend/data-maintenance.mjs';

const scales = {
  mood: 7, anxiety: 2, irritability: 1, energy: 6,
  focus: 8, functioning: 8, sleepQuality: 6, appetite: 5
};

function scheduled(overrides = {}) {
  return {
    id: 10, kind: 'scheduled', period: 'day', localDate: '2026-08-01',
    scheduledFor: '2026-08-01T06:00:00.000Z', observedAt: '2026-08-01T06:05:00.000Z',
    recordedAt: '2026-08-01T06:10:00.000Z', updatedAt: '2026-08-01T06:10:00.000Z',
    ...scales, nightSleepHours: 7.5, daySleepHours: null, sleepStart: '04:00', wakeTime: '11:30',
    context: ['caffeine'], symptoms: [], activation: [], notes: 'portable', redFlags: '', ...overrides
  };
}

function portable(overrides = {}) {
  return {
    format: 'med-checkin-2',
    formatVersion: 1,
    exportedAt: '2026-08-07T01:02:03.000Z',
    observations: [
      scheduled(),
      scheduled({
        id: 11, kind: 'extra', period: null, scheduledFor: null,
        observedAt: '2026-08-01T08:00:00.000Z', recordedAt: '2026-08-01T08:01:00.000Z',
        updatedAt: '2026-08-01T08:01:00.000Z', mood: 4,
        anxiety: null, irritability: null, energy: null, focus: null,
        functioning: null, sleepQuality: null, appetite: null
      })
    ],
    treatmentEvents: [
      { id: 20, effectiveDate: null, regimen: [], note: 'baseline', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: 21, effectiveDate: '2026-08-02', regimen: [{ name: 'Example', amount: 2, unit: 'mg', timing: null }], note: '', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' }
    ],
    settings: { dayTime: '12:30', eveningTime: '21:45', catchupHours: 3, repeatMinutes: 20 },
    ...overrides
  };
}

function portableV2(overrides = {}) {
  return portable({
    formatVersion: 2,
    trackedItems: BUILTIN_TRACKED_ITEMS.map((item) => ({ ...item })),
    ...overrides
  });
}

test('backup listing recognizes only app-created names and rejects corrupt or newer schemas', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-maintenance-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  const repo = createRepository(dbPath);
  try {
    const manual = createManualBackup({ repo, dbPath, backupDir, now: new Date('2026-08-07T01:02:03.000Z') });
    copyFileSync(dbPath, join(backupDir, 'pre-restore-20260807T010204Z.sqlite'));
    writeFileSync(join(backupDir, 'notes.txt'), 'not a backup');
    writeFileSync(join(backupDir, 'manual-20260807T010205Z.sqlite'), 'not sqlite');
    assert.deepEqual(listBackups(backupDir).map((item) => item.name), [
      'manual-20260807T010205Z.sqlite',
      'pre-restore-20260807T010204Z.sqlite',
      'manual-20260807T010203Z.sqlite'
    ]);
    assert.equal(validateBackupFile(manual).userVersion, 2);
    assert.throws(() => validateBackupFile(join(backupDir, 'manual-20260807T010205Z.sqlite')), /sqlite|database/i);

    const newer = join(backupDir, 'manual-20260807T010206Z.sqlite');
    const db = new DatabaseSync(newer);
    try { db.exec('PRAGMA user_version = 3; CREATE TABLE checkins(id INTEGER);'); } finally { db.close(); }
    assert.throws(() => validateBackupFile(newer), /newer|version/i);

    const incomplete = join(backupDir, 'manual-20260807T010207Z.sqlite');
    const incompleteDb = new DatabaseSync(incomplete);
    try {
      incompleteDb.exec(`
        PRAGMA user_version = 1;
        CREATE TABLE checkins(id INTEGER PRIMARY KEY, kind TEXT, period TEXT);
      `);
    } finally { incompleteDb.close(); }
    assert.throws(() => validateBackupFile(incomplete), /schema|settings|columns/i);

    const incompleteV2 = join(backupDir, 'manual-20260807T010208Z.sqlite');
    const incompleteV2Db = new DatabaseSync(incompleteV2);
    try {
      incompleteV2Db.exec(`
        PRAGMA user_version = 2;
        CREATE TABLE checkins(id INTEGER PRIMARY KEY, kind TEXT, period TEXT);
      `);
    } finally { incompleteV2Db.close(); }
    assert.throws(() => validateBackupFile(incompleteV2), /schema|settings|columns/i);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

test('restore validates first and creates a recoverable pre-restore backup before replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-restore-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  const repo = createRepository(dbPath);
  repo.createCheckin(scheduled({ id: undefined, mood: 6 }), new Date('2026-08-01T06:10:00.000Z'));
  const source = createManualBackup({ repo, dbPath, backupDir, now: new Date('2026-08-07T01:00:00.000Z') });
  const row = repo.listAllCheckins()[0];
  repo.updateCheckin(row.id, { ...row, mood: 9 }, new Date('2026-08-07T01:01:00.000Z'));
  const result = restoreDatabase({
    repo, dbPath, backupDir, backupName: source.split(/[\\/]/).at(-1),
    now: new Date('2026-08-07T01:02:03.000Z'), prepareDatabase
  });
  try {
    assert.equal(existsSync(result.preRestoreBackupPath), true);
    assert.equal(result.restoredUserVersion, 2);
    const restored = createRepository(dbPath);
    try { assert.equal(restored.listAllCheckins()[0].mood, 6); }
    finally { restored.close(); }
    const safety = createRepository(result.preRestoreBackupPath);
    try { assert.equal(safety.listAllCheckins()[0].mood, 9); }
    finally { safety.close(); }
    const invalidRepo = createRepository(dbPath);
    try {
      assert.throws(() => restoreDatabase({
        repo: invalidRepo, dbPath, backupDir, backupName: '..\\outside.sqlite', prepareDatabase
      }), /recognized|backup/i);
    } finally { invalidRepo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('portable preview validates the exact format and reports bounded counts and dates', () => {
  assert.deepEqual(previewPortableImport(portable()), {
    format: 'med-checkin-2', formatVersion: 1,
    trackedItemCount: 20, observationCount: 2, extraCount: 1, treatmentEventCount: 2,
    dateFrom: '2026-08-01', dateTo: '2026-08-01'
  });
  assert.throws(() => previewPortableImport(portableV2({ trackedItems: BUILTIN_TRACKED_ITEMS.slice(1) })), /built-in|missing/i);
  assert.throws(() => previewPortableImport(portableV2({ trackedItems: [
    ...BUILTIN_TRACKED_ITEMS,
    { id: 'caffeine', category: 'context', label: 'Duplicate', active: true, sortOrder: 6 }
  ] })), /duplicate/i);
  assert.throws(() => previewPortableImport(portableV2({ observations: [scheduled({ symptoms: ['caffeine'] })] })), /symptoms/i);
  assert.throws(() => previewPortableImport(portable({ observations: [scheduled(), scheduled({ id: 12 })] })), /duplicate scheduled/i);
  assert.throws(() => previewPortableImport(portable({ observations: [scheduled({ mood: 11 })] })), /mood/i);
  assert.throws(() => previewPortableImport(portable({ observations: [scheduled({ observedAt: 'not-a-time' })] })), /observedAt/i);
});

test('failed restore preparation rolls the live database back to its pre-restore copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-restore-rollback-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  const repo = createRepository(dbPath);
  repo.createCheckin(scheduled({ id: undefined, mood: 5 }), new Date('2026-08-01T06:10:00.000Z'));
  const source = createManualBackup({ repo, dbPath, backupDir, now: new Date('2026-08-07T01:00:00.000Z') });
  const row = repo.listAllCheckins()[0];
  repo.updateCheckin(row.id, { ...row, mood: 9 }, new Date('2026-08-07T01:01:00.000Z'));
  let failure;
  try {
    restoreDatabase({
      repo, dbPath, backupDir, backupName: source.split(/[\\/]/).at(-1),
      now: new Date('2026-08-07T01:02:03.000Z'), prepareDatabase: () => { throw new Error('synthetic migration failure'); }
    });
  } catch (error) { failure = error; }
  try {
    assert.match(failure?.message ?? '', /synthetic migration failure/);
    assert.equal(failure.repositoryClosed, true);
    assert.equal(existsSync(failure.preRestoreBackupPath), true);
    const recovered = createRepository(dbPath);
    try { assert.equal(recovered.listAllCheckins()[0].mood, 9); }
    finally { recovered.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('portable export is v2 and Replace preserves source identity while leaving reminder state local', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-import-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  const repo = createRepository(dbPath);
  try {
    repo.createCheckin(scheduled({ id: undefined, localDate: '2026-07-31', notes: 'old' }), new Date('2026-07-31T06:10:00.000Z'));
    repo.saveSettings({ dayTime: '11:00', remindersPausedUntil: '2026-08-10T00:00:00.000Z' });
    repo.saveReminderState('2026-08-01', 'day', { dismissedAt: '2026-08-01T06:00:00.000Z' });

    const exported = buildPortableExport(repo, new Date('2026-08-07T01:02:03.000Z'));
    assert.equal(exported.format, 'med-checkin-2');
    assert.equal(exported.formatVersion, 2);
    assert.equal(exported.exportedAt, '2026-08-07T01:02:03.000Z');
    assert.equal(exported.trackedItems.length, 20);
    assert.deepEqual(Object.keys(exported.settings).sort(), ['catchupHours', 'dayTime', 'eveningTime', 'repeatMinutes']);

    const result = replacePortableData({ repo, dbPath, backupDir, payload: portableV2(), now: new Date('2026-08-07T02:03:04.000Z') });
    assert.equal(existsSync(result.preImportBackupPath), true);
    assert.deepEqual(repo.listAllCheckins().map((item) => item.id).sort((a, b) => a - b), [10, 11]);
    assert.equal(repo.getCheckinById(10).recordedAt, '2026-08-01T06:10:00.000Z');
    assert.deepEqual(repo.listTreatmentEvents().map((item) => item.id), [20, 21]);
    assert.equal(repo.getSettings().dayTime, '12:30');
    assert.equal(repo.getSettings().remindersPausedUntil, '2026-08-10T00:00:00.000Z');
    assert.equal(repo.getReminderStates('2026-08-01').day.dismissedAt, '2026-08-01T06:00:00.000Z');
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

test('portable v2 round-trips custom definitions and rejects Replace before changing live data', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-portable-v2-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  const repo = createRepository(dbPath);
  try {
    const custom = repo.createTrackedItem({ category: 'symptoms', label: 'Original custom' });
    repo.updateTrackedItem(custom.id, { label: 'Renamed custom', active: false });
    const symptomIds = repo.listTrackedItems().filter((item) => item.category === 'symptoms').map((item) => item.id);
    repo.reorderTrackedItems('symptoms', [...symptomIds].reverse());
    const observation = repo.createCheckin(scheduled({ id: undefined, symptoms: [custom.id] }), new Date('2026-08-01T06:10:00.000Z'));
    const payload = buildPortableExport(repo, new Date('2026-08-07T01:02:03.000Z'));
    assert.equal(payload.formatVersion, 2);
    assert.deepEqual(payload.trackedItems.find((item) => item.id === custom.id), {
      id: custom.id, category: 'symptoms', label: 'Renamed custom', active: false, sortOrder: 0
    });
    repo.createCheckin(scheduled({ id: undefined, localDate: '2026-08-02', symptoms: [] }), new Date('2026-08-02T06:10:00.000Z'));
    replacePortableData({ repo, dbPath, backupDir, payload, now: new Date('2026-08-07T02:03:04.000Z') });
    assert.deepEqual(repo.getCheckinById(observation.id).symptoms, [custom.id]);
    assert.deepEqual(repo.listTrackedItems().find((item) => item.id === custom.id), {
      id: custom.id, category: 'symptoms', label: 'Renamed custom', active: false, sortOrder: 0
    });
    const before = repo.listAllCheckins().map((item) => item.id);
    assert.throws(() => replacePortableData({
      repo, dbPath, backupDir, payload: portableV2({ trackedItems: BUILTIN_TRACKED_ITEMS.slice(1) })
    }), /built-in|missing/i);
    assert.deepEqual(repo.listAllCheckins().map((item) => item.id), before);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});
