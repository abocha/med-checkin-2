import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRepository } from '../backend/repository.mjs';
import { BUILTIN_TRACKED_ITEMS } from '../backend/tracked-items.mjs';
import { BUILTIN_SCALE_DEFINITIONS } from '../backend/scales.mjs';
import { buildPortableExport, createManualBackup, previewPortableImport, replacePortableData, restoreDatabase, validateBackupFile, validatePortableImport } from '../backend/data-maintenance.mjs';
import { prepareDatabase } from '../backend/migrations.mjs';

const legacyScales = { mood: 7, anxiety: 2, irritability: 1, energy: 6, focus: 8, functioning: 8, sleepQuality: 6, appetite: 5 };
const settings = { dayTime: '12:30', eveningTime: '21:45', catchupHours: 3, repeatMinutes: 20 };
const legacyObservation = (overrides = {}) => ({ id: 10, kind: 'scheduled', period: 'day', localDate: '2026-08-01', scheduledFor: '2026-08-01T06:00:00.000Z', observedAt: '2026-08-01T06:05:00.000Z', recordedAt: '2026-08-01T06:10:00.000Z', updatedAt: '2026-08-01T06:10:00.000Z', ...legacyScales, nightSleepHours: 7.5, daySleepHours: null, sleepStart: '04:00', wakeTime: '11:30', context: ['caffeine'], symptoms: [], activation: [], notes: 'portable', redFlags: '', ...overrides });
const portableV1 = (overrides = {}) => ({ format: 'med-checkin-2', formatVersion: 1, exportedAt: '2026-08-07T01:02:03.000Z', observations: [legacyObservation()], treatmentEvents: [], settings, ...overrides });
const portableV2 = (overrides = {}) => portableV1({ formatVersion: 2, trackedItems: BUILTIN_TRACKED_ITEMS.map((item) => ({ ...item })), ...overrides });

test('backup validation accepts v3 and rejects incomplete/newer schemas', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-maintenance-')); const dbPath = join(root, 'med-checkin.sqlite'); const backupDir = join(root, 'backups'); const repo = createRepository(dbPath);
  try {
    const backup = createManualBackup({ repo, dbPath, backupDir, now: new Date('2026-08-07T01:02:03.000Z') }); assert.deepEqual(validateBackupFile(backup), { userVersion: 3 });
    const incomplete = join(backupDir, 'manual-20260807T010204Z.sqlite'); const db = new DatabaseSync(incomplete); try { db.exec('PRAGMA user_version=3; CREATE TABLE checkins(id INTEGER);'); } finally { db.close(); }
    assert.throws(() => validateBackupFile(incomplete), /schema|incomplete/i);
    const newer = join(backupDir, 'manual-20260807T010205Z.sqlite'); writeFileSync(newer, 'not sqlite'); assert.throws(() => validateBackupFile(newer), /sqlite|database/i);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

test('v1 and v2 portable payloads normalize legacy scale fields at the boundary', () => {
  for (const payload of [portableV1(), portableV2()]) {
    const normalized = validatePortableImport(payload);
    assert.equal(normalized.scaleDefinitions.length, 8); assert.deepEqual(normalized.observations[0].scales, legacyScales);
    assert.equal(Object.hasOwn(normalized.observations[0], 'mood'), false);
  }
  assert.equal(previewPortableImport(portableV1()).scaleDefinitionCount, 8);
  assert.throws(() => previewPortableImport(portableV1({ observations: [legacyObservation({ mood: true })] })), /mood|scale/i);
});

test('v1 and v2 Replace returns its preview after the normalized data commits', () => {
  for (const payload of [portableV1(), portableV2()]) {
    const root = mkdtempSync(join(tmpdir(), 'med-checkin-legacy-replace-')); const dbPath = join(root, 'med-checkin.sqlite'); const backupDir = join(root, 'backups'); const repo = createRepository(dbPath);
    try {
      const result = replacePortableData({ repo, dbPath, backupDir, payload, now: new Date('2026-08-07T02:03:04.000Z') });
      assert.equal(result.observationCount, 1); assert.equal(result.scaleDefinitionCount, 8); assert.equal(repo.getCheckinById(10).scales.mood, 7);
    } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test('portable v3 validates definition and dynamic-scale integrity', () => {
  const payload = { ...portableV2(), formatVersion: 3, scaleDefinitions: BUILTIN_SCALE_DEFINITIONS.map((item) => ({ ...item })), observations: [{ ...legacyObservation(), scales: legacyScales }] };
  for (const field of Object.keys(legacyScales)) delete payload.observations[0][field];
  assert.equal(validatePortableImport(payload).observations[0].scales.mood, 7);
  assert.throws(() => validatePortableImport({ ...payload, scaleDefinitions: payload.scaleDefinitions.slice(1) }), /built-in|missing/i);
  assert.throws(() => validatePortableImport({ ...payload, scaleDefinitions: payload.scaleDefinitions.map((item) => ({ ...item, active: false })) }), /active/i);
  assert.throws(() => validatePortableImport({ ...payload, observations: [{ ...payload.observations[0], scales: { unknown: 2 } }] }), /unknown/i);
  assert.throws(() => validatePortableImport({ ...payload, observations: [{ ...payload.observations[0], scales: {} }] }), /scales|required/i);
});

test('portable v3 round-trips custom archived definitions and Replace preserves reminders atomically', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-import-')); const dbPath = join(root, 'med-checkin.sqlite'); const backupDir = join(root, 'backups'); const repo = createRepository(dbPath);
  try {
    const custom = repo.createScaleDefinition({ label: 'Fog' });
    const values = Object.fromEntries(repo.listScaleDefinitions().filter((item) => item.active).map((item) => [item.id, item.id === custom.id ? 3 : 5]));
    const saved = repo.createCheckin({ kind: 'scheduled', period: 'day', localDate: '2026-08-01', observedAt: '2026-08-01T06:05:00.000Z', scales: values });
    repo.updateScaleDefinition(custom.id, { active: false }); repo.saveReminderState('2026-08-01', 'day', { dismissedAt: '2026-08-01T06:00:00.000Z' });
    const exported = buildPortableExport(repo, new Date('2026-08-07T01:02:03.000Z'));
    assert.equal(exported.formatVersion, 3); assert.deepEqual(exported.scaleDefinitions, repo.listScaleDefinitions()); assert.deepEqual(exported.observations[0].scales, repo.getCheckinById(saved.id).scales);
    repo.createCheckin({ kind: 'extra', period: null, localDate: '2026-08-02', observedAt: '2026-08-02T08:00:00.000Z', scales: { mood: 2 } });
    const result = replacePortableData({ repo, dbPath, backupDir, payload: exported, now: new Date('2026-08-07T02:03:04.000Z') });
    assert.equal(existsSync(result.preImportBackupPath), true); assert.deepEqual(repo.listAllCheckins().map((item) => item.id), [saved.id]); assert.equal(repo.listScaleDefinitions().find((item) => item.id === custom.id).active, false); assert.equal(repo.getReminderStates('2026-08-01').day.dismissedAt, '2026-08-01T06:00:00.000Z');
    const before = repo.listAllCheckins().map((item) => item.id); assert.throws(() => replacePortableData({ repo, dbPath, backupDir, payload: { ...exported, observations: [{ ...exported.observations[0], scales: { mood: 11 } }] } }), /mood/i); assert.deepEqual(repo.listAllCheckins().map((item) => item.id), before);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

test('restore validates before replacement and creates a recoverable v3 backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-restore-')); const dbPath = join(root, 'med-checkin.sqlite'); const backupDir = join(root, 'backups'); const repo = createRepository(dbPath);
  try {
    repo.createCheckin({ kind: 'scheduled', period: 'day', localDate: '2026-08-01', observedAt: '2026-08-01T06:05:00.000Z', scales: Object.fromEntries(repo.listScaleDefinitions().map((item) => [item.id, 5])) });
    const source = createManualBackup({ repo, dbPath, backupDir, now: new Date('2026-08-07T01:00:00.000Z') }); const row = repo.listAllCheckins()[0]; repo.updateCheckin(row.id, { ...row, scales: { ...row.scales, mood: 9 } });
    const result = restoreDatabase({ repo, dbPath, backupDir, backupName: source.split(/[\\/]/).at(-1), now: new Date('2026-08-07T01:02:03.000Z'), prepareDatabase });
    assert.equal(existsSync(result.preRestoreBackupPath), true); const restored = createRepository(dbPath); try { assert.equal(restored.getCheckinById(row.id).scales.mood, 5); } finally { restored.close(); }
  } finally { try { repo.close(); } catch {} rmSync(root, { recursive: true, force: true }); }
});
