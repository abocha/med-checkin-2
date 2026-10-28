import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRepository } from '../backend/repository.mjs';
import { normalizeCheckin } from '../backend/domain.mjs';
import { prepareDatabase, readUserVersion } from '../backend/migrations.mjs';
import { buildPortableExport, validatePortableImport, replacePortableData, validateBackupFile, createManualBackup, restoreDatabase } from '../backend/data-maintenance.mjs';
import { rowsToCsv, createHttpServer } from '../backend/http-server.mjs';
import { buildAnalytics } from '../backend/analytics.mjs';

function extra(emotionalImpact, overrides = {}) {
  return { kind: 'extra', period: null, localDate: '2026-10-28', observedAt: '2026-10-28T10:00:00.000Z', scales: {}, emotionalImpact, ...overrides };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'med-emotion-'));
  const dbPath = join(dir, 'test.sqlite'), backupDir = join(dir, 'backups');
  const repo = createRepository(dbPath);
  return { dir, dbPath, backupDir, repo, close() { try { repo.close(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}

test('emotional impact distinguishes unanswered, no emotions and rated zero; rejects contradictory values', () => {
  for (const emotionalImpact of [undefined, null, { status: 'none' }, { status: 'rated', value: 0 }, { status: 'rated', value: 10 }]) {
    assert.deepEqual(normalizeCheckin(extra(emotionalImpact, { notes: 'observation' })).emotionalImpact, emotionalImpact ?? null);
  }
  for (const emotionalImpact of [0, false, 'none', [], {}, { status: 'none', value: 0 }, { status: 'rated' }, { status: 'rated', value: null }, { status: 'rated', value: '0' }, { status: 'rated', value: -1 }, { status: 'rated', value: 11 }, { status: 'rated', value: NaN }, { status: 'rated', value: 0, unknown: true }]) {
    assert.throws(() => normalizeCheckin(extra(emotionalImpact)), /emotionalImpact/);
  }
  assert.throws(() => normalizeCheckin(extra(null)), /meaningful/);
});

test('repository, JSON Replace and appended CSV columns preserve all three states and edits', () => {
  const f = fixture();
  try {
    const impacts = [null, { status: 'none' }, { status: 'rated', value: 0 }, { status: 'rated', value: 8 }];
    const saved = impacts.map(impact => f.repo.createCheckin(extra(impact, { notes: 'entry', scales: { mood: 5 } })));
    saved.forEach((row, index) => assert.deepEqual(f.repo.getCheckinById(row.id).emotionalImpact, impacts[index]));
    assert.deepEqual(f.repo.updateCheckin(saved[2].id, { notes: 'edit only' }).emotionalImpact, impacts[2]);
    assert.equal(f.repo.updateCheckin(saved[3].id, { emotionalImpact: null }).emotionalImpact, null);
    const exported = buildPortableExport(f.repo);
    assert.equal(exported.formatVersion, 4);
    assert.deepEqual(validatePortableImport(JSON.parse(JSON.stringify(exported))).observations, exported.observations.map(({ slot, ...row }) => row));
    replacePortableData({ ...f, payload: exported });
    saved.forEach(row => assert.deepEqual(f.repo.getCheckinById(row.id).emotionalImpact, exported.observations.find(item => item.id === row.id).emotionalImpact));
    const csv = rowsToCsv(f.repo.exportRows(), f.repo.listScaleDefinitions()).split('\r\n');
    assert.match(csv[0], /redFlags,Настроение,emotionalImpactStatus,emotionalImpactValue$/);
    assert.match(csv[1], /,5,,$/);
    assert.match(csv[2], /,5,none,$/);
    assert.match(csv[3], /,5,rated,0$/);
    const before = f.repo.listAllCheckins();
    assert.throws(() => replacePortableData({ ...f, payload: { ...exported, observations: [{ ...exported.observations[0], emotionalImpact: { status: 'rated', value: null } }] } }), /emotionalImpact/);
    assert.deepEqual(f.repo.listAllCheckins(), before);
    for (const version of [1, 2, 3]) {
      const payload = { ...exported, formatVersion: version, observations: [{ ...exported.observations[0], mood: 5, emotionalImpact: { status: 'rated', value: 8 } }] };
      assert.equal(validatePortableImport(payload).observations[0].emotionalImpact, null);
    }
  } finally { f.close(); }
});

test('SQLite rejects impossible status/value combinations including NULL status with numeric value', () => {
  const f = fixture();
  try {
    const saved = f.repo.createCheckin(extra({ status: 'rated', value: 0 }));
    const db = new DatabaseSync(f.dbPath);
    try {
      for (const [status, value] of [[null, 5], ['none', 0], ['rated', null], ['rated', 11], ['unknown', null]]) {
        assert.throws(() => db.prepare('UPDATE checkins SET emotional_impact_status=?,emotional_impact_value=? WHERE id=?').run(status, value, saved.id), /CHECK/);
      }
    } finally { db.close(); }
  } finally { f.close(); }
});

function makeV3(f) {
  f.repo.createCheckin(extra(null, { notes: 'historical', scales: { mood: 7 } }));
  f.repo.checkpoint(); f.repo.close();
  const db = new DatabaseSync(f.dbPath);
  db.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE old_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, local_date TEXT NOT NULL, period TEXT,
      scheduled_for TEXT, observed_at TEXT, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      night_sleep_hours REAL, day_sleep_hours REAL, sleep_start TEXT, wake_time TEXT,
      context_json TEXT NOT NULL, symptoms_json TEXT NOT NULL, activation_json TEXT NOT NULL,
      notes TEXT NOT NULL, red_flags TEXT NOT NULL
    ) STRICT;
    INSERT INTO old_checkins SELECT id,kind,local_date,period,scheduled_for,observed_at,recorded_at,updated_at,
      night_sleep_hours,day_sleep_hours,sleep_start,wake_time,context_json,symptoms_json,activation_json,notes,red_flags FROM checkins;
    DROP TABLE checkins;
    ALTER TABLE old_checkins RENAME TO checkins;
    CREATE UNIQUE INDEX checkins_scheduled_identity ON checkins(local_date,period) WHERE kind='scheduled';
    PRAGMA user_version=3;
  `);
  db.close();
}

test('v3 additive migration preserves old rows and scales, creates backup, and enforces new constraints', () => {
  const f = fixture();
  try {
    makeV3(f);
    const before = readFileSync(f.dbPath);
    const result = prepareDatabase(f);
    assert.equal(readUserVersion(f.dbPath), 4);
    assert.equal(existsSync(result.backupPath), true);
    assert.deepEqual(readFileSync(result.backupPath), before);
    assert.deepEqual(validateBackupFile(result.backupPath), { userVersion: 3 });
    const repo = createRepository(f.dbPath);
    try {
      assert.equal(repo.getCheckinById(1).emotionalImpact, null);
      assert.equal(repo.getCheckinById(1).scales.mood, 7);
      assert.equal(repo.getCheckinById(1).notes, 'historical');
      assert.deepEqual(repo.updateCheckin(1, { emotionalImpact: { status: 'rated', value: 0 } }).emotionalImpact, { status: 'rated', value: 0 });
      const db = new DatabaseSync(f.dbPath);
      try { assert.throws(() => db.exec('UPDATE checkins SET emotional_impact_status=NULL,emotional_impact_value=5'), /CHECK/); } finally { db.close(); }
    } finally { repo.close(); }
    assert.equal(prepareDatabase(f).migrated, false);
  } finally { f.close(); }
});

test('failed additive migration rolls back schema and preserves pre-migration backup', () => {
  const f = fixture();
  try {
    makeV3(f);
    const db = new DatabaseSync(f.dbPath);
    db.exec('ALTER TABLE checkins ADD COLUMN emotional_impact_value REAL'); db.close();
    let failure;
    try { prepareDatabase(f); } catch (error) { failure = error; }
    assert.match(failure?.message || '', /duplicate column/);
    assert.equal(existsSync(failure.backupPath), true);
    assert.equal(readUserVersion(f.dbPath), 3);
    const check = new DatabaseSync(f.dbPath);
    try { assert.equal(check.prepare('PRAGMA table_info(checkins)').all().some(row => row.name === 'emotional_impact_status'), false); } finally { check.close(); }
  } finally { f.close(); }
});

test('restore rejects forged v4 emotional responses before replacing current data', () => {
  const f = fixture(), forged = fixture();
  try {
    const current = f.repo.createCheckin(extra({ status: 'rated', value: 0 }));
    const candidate = createManualBackup(f);
    makeV3(forged);
    const db = new DatabaseSync(forged.dbPath);
    try {
      db.exec("ALTER TABLE checkins ADD COLUMN emotional_impact_status TEXT; ALTER TABLE checkins ADD COLUMN emotional_impact_value REAL; PRAGMA user_version=4;");
      for (const [status, value] of [['rated', null], ['none', 0], [null, 4], ['rated', 11], ['unknown', null]]) {
        db.prepare('UPDATE checkins SET emotional_impact_status=?,emotional_impact_value=?').run(status, value);
        assert.equal(Object.values(db.prepare('PRAGMA quick_check').get())[0], 'ok');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        copyFileSync(forged.dbPath, candidate);
        assert.throws(() => restoreDatabase({ ...f, backupName: candidate.split(/[\\/]/).at(-1) }), /emotional impact/);
        assert.deepEqual(f.repo.getCheckinById(current.id).emotionalImpact, { status: 'rated', value: 0 });
      }
      db.exec('PRAGMA user_version=5; PRAGMA wal_checkpoint(TRUNCATE)'); copyFileSync(forged.dbPath, candidate);
      assert.throws(() => validateBackupFile(candidate), /newer schema/);
    } finally { db.close(); }
  } finally { f.close(); forged.close(); }
});

test('backup restore retains rated zero and no-emotion responses', () => {
  const f = fixture();
  try {
    const zero = f.repo.createCheckin(extra({ status: 'rated', value: 0 }));
    const none = f.repo.createCheckin(extra({ status: 'none' }));
    const backup = createManualBackup(f);
    f.repo.updateCheckin(zero.id, { emotionalImpact: { status: 'rated', value: 9 } });
    restoreDatabase({ ...f, backupName: backup.split(/[\\/]/).at(-1), now: new Date(Date.now() + 1000) });
    const restored = createRepository(f.dbPath);
    try {
      assert.deepEqual(restored.getCheckinById(zero.id).emotionalImpact, { status: 'rated', value: 0 });
      assert.deepEqual(restored.getCheckinById(none.id).emotionalImpact, { status: 'none' });
    } finally { restored.close(); }
  } finally { f.close(); }
});

test('evening analytics use actual scores, exclude none from mean, and retain calendar gaps', () => {
  const row = (date, period, emotionalImpact, kind = 'scheduled') => ({ localDate: date, period, emotionalImpact, kind, scales: {} });
  const result = buildAnalytics([
    row('2026-10-20', 'day', { status: 'rated', value: 10 }),
    row('2026-10-21', 'evening', { status: 'rated', value: 0 }),
    row('2026-10-22', 'evening', { status: 'none' }),
    row('2026-10-24', 'evening', { status: 'rated', value: 8 }),
    row('2026-10-25', 'day', { status: 'rated', value: 1 }),
    row('2026-10-26', null, { status: 'rated', value: 10 }, 'extra')
  ]).emotionalImpact;
  assert.equal(result.mean, 4); assert.equal(result.ratedCount, 2); assert.equal(result.noneCount, 1);
  assert.deepEqual(result.daily.map(day => [day.date, day.status, day.value]), [
    ['2026-10-20', null, null], ['2026-10-21', 'rated', 0], ['2026-10-22', 'none', null],
    ['2026-10-23', null, null], ['2026-10-24', 'rated', 8], ['2026-10-25', null, null]
  ]);
  assert.equal(buildAnalytics([row('2026-10-20', 'day', { status: 'rated', value: 10 })]).emotionalImpact.mean, null);
});

test('HTTP roundtrip validates emotional-only Extra and exports v4', async () => {
  const f = fixture();
  const app = createHttpServer({ repo: f.repo, token: 'synthetic-test-token', dataDir: f.dir });
  try {
    await app.listen(0);
    const request = (path, body) => fetch(`http://127.0.0.1:${app.port}/api/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer synthetic-test-token', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await request('checkins', extra({ status: 'rated', value: 0 }));
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).emotionalImpact, { status: 'rated', value: 0 });
    assert.equal((await request('checkins', extra({ status: 'rated', value: null }))).status, 400);
    assert.equal(f.repo.listAllCheckins().length, 1);
  } finally { await app.close(); f.close(); }
});
