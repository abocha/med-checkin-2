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
const legacyScales = { mood: 7, anxiety: 2, irritability: 1, energy: 6, focus: 8, functioning: 8, sleep_quality: 6, appetite: 5 };

function assertV3(dbPath, id = null) {
  assert.equal(readUserVersion(dbPath), 3);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const columns = db.prepare('PRAGMA table_info(checkins)').all().map((row) => row.name);
    assert.equal(columns.includes('mood'), false); assert.equal(columns.includes('sleep_quality'), false);
    assert.deepEqual(db.prepare('SELECT id FROM scale_definitions ORDER BY sort_order').all().map((row) => row.id), ['mood', 'anxiety', 'irritability', 'energy', 'focus', 'functioning', 'sleepQuality', 'appetite']);
    const index = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type='index' AND name='checkins_scheduled_identity'").get();
    assert.equal(index.tbl_name, 'checkins'); assert.match(index.sql, /ON checkins\(local_date, period\)/);
    if (id !== null) assert.deepEqual(db.prepare('SELECT scale_id,value FROM checkin_scale_values WHERE checkin_id=? ORDER BY scale_id').all(id).map((row) => ({ ...row })), [
      { scale_id: 'anxiety', value: 2 }, { scale_id: 'appetite', value: 5 }, { scale_id: 'energy', value: 6 }, { scale_id: 'focus', value: 8 },
      { scale_id: 'functioning', value: 8 }, { scale_id: 'irritability', value: 1 }, { scale_id: 'mood', value: 7 }, { scale_id: 'sleepQuality', value: 6 }
    ]);
  } finally { db.close(); }
}

function buildV1OrV2(dbPath, version) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, local_date TEXT NOT NULL, period TEXT, scheduled_for TEXT, observed_at TEXT, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL, mood REAL, anxiety REAL, irritability REAL, energy REAL, focus REAL, functioning REAL, sleep_quality REAL, appetite REAL, night_sleep_hours REAL, day_sleep_hours REAL, sleep_start TEXT, wake_time TEXT, context_json TEXT NOT NULL DEFAULT '[]', symptoms_json TEXT NOT NULL DEFAULT '[]', activation_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', red_flags TEXT NOT NULL DEFAULT '') STRICT;
      CREATE UNIQUE INDEX checkins_scheduled_identity ON checkins(local_date, period) WHERE kind='scheduled';
      CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL) STRICT;
      CREATE TABLE reminder_state (local_date TEXT NOT NULL, period TEXT NOT NULL, snoozed_until TEXT, dismissed_at TEXT, notified_at TEXT, PRIMARY KEY(local_date,period)) STRICT;
      CREATE TABLE treatment_events (id INTEGER PRIMARY KEY AUTOINCREMENT, effective_date TEXT, regimen_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    `);
    if (version === 2) db.exec("CREATE TABLE tracked_items (id TEXT PRIMARY KEY, category TEXT NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL, sort_order INTEGER NOT NULL) STRICT; INSERT INTO tracked_items VALUES ('custom:symptom', 'symptoms', 'Custom symptom', 0, 0);");
    db.prepare('INSERT INTO checkins(id,kind,local_date,period,scheduled_for,observed_at,recorded_at,updated_at,mood,anxiety,irritability,energy,focus,functioning,sleep_quality,appetite,night_sleep_hours,day_sleep_hours,sleep_start,wake_time,context_json,symptoms_json,activation_json,notes,red_flags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(41, 'scheduled', '2026-08-01', 'day', null, null, '2026-08-01T06:10:00.000Z', '2026-08-01T06:10:00.000Z', ...Object.values(legacyScales), 7.5, null, '04:00', '11:30', '[]', version === 2 ? '["custom:symptom"]' : '[]', '[]', 'legacy', '');
    db.exec(`PRAGMA user_version = ${version}`);
  } finally { db.close(); }
}

test('prepareDatabase migrates schema 0 fixture directly to v3 with values and backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-migrate-')); const dbPath = join(root, 'med-checkin.sqlite'); const backupDir = join(root, 'backups'); copyFileSync(fixturePath, dbPath);
  try {
    const result = prepareDatabase({ dbPath, backupDir, now: new Date('2026-08-07T01:02:03.000Z'), log() {} });
    assert.equal(result.migrated, true); assert.equal(existsSync(result.backupPath), true); assert.deepEqual(readdirSync(backupDir), ['pre-migration-20260807T010203Z.sqlite']); assertV3(dbPath, 41);
    const repo = createRepository(dbPath); try { assert.equal(repo.getScheduledCheckin('2026-07-31', 'day').scales.mood, 7); } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const version of [1, 2]) test(`prepareDatabase migrates schema ${version} directly to v3 and retains data`, () => {
  const root = mkdtempSync(join(tmpdir(), `med-checkin-v${version}-`)); const dbPath = join(root, 'med-checkin.sqlite'); const backupDir = join(root, 'backups'); buildV1OrV2(dbPath, version);
  try {
    const result = prepareDatabase({ dbPath, backupDir, now: new Date('2026-08-07T01:02:03.000Z'), log() {} }); assert.equal(result.migrated, true); assertV3(dbPath, 41);
    const repo = createRepository(dbPath); try { if (version === 2) assert.deepEqual(repo.listTrackedItems().find((item) => item.id === 'custom:symptom'), { id: 'custom:symptom', category: 'symptoms', label: 'Custom symptom', active: false, sortOrder: 0 }); assert.throws(() => repo.createCheckin({ kind: 'scheduled', period: 'day', localDate: '2026-08-01', observedAt: '2026-08-01T07:00:00.000Z', scales: Object.fromEntries(repo.listScaleDefinitions().filter((item) => item.active).map((item) => [item.id, 5])) }), /unique|constraint/i); } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepareDatabase creates v3 directly for a clean install', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-clean-')); const dbPath = join(root, 'med-checkin.sqlite');
  try { const result = prepareDatabase({ dbPath, backupDir: join(root, 'backups') }); assert.equal(result.migrated, false); assertV3(dbPath); } finally { rmSync(root, { recursive: true, force: true }); }
});
