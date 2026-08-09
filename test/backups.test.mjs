import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../backend/repository.mjs';
import { backupDatabase } from '../backend/backups.mjs';

function checkin(mood) {
  return {
    localDate: '2026-07-31', slot: '13:00', recordedAt: '2026-07-31T06:00:00.000Z',
    updatedAt: new Date().toISOString(), scales: { mood, anxiety: 1, irritability: 1,
      energy: 6, focus: 6, functioning: 7, sleepQuality: 6, appetite: 5 },
    nightSleepHours: 8, daySleepHours: null, sleepStart: null, wakeTime: null,
    context: [], symptoms: [], activation: [], notes: '', redFlags: ''
  };
}

test('backupDatabase checkpoints and refreshes the current day snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-backup-'));
  const dbPath = join(root, 'med-checkin.sqlite');
  const backupDir = join(root, 'backups');
  const repo = createRepository(dbPath);
  try {
    repo.upsertCheckin(checkin(6));
    const target = backupDatabase({ repo, dbPath, backupDir, now: new Date('2026-07-31T12:00:00') });
    assert.equal(existsSync(target), true);

    repo.upsertCheckin(checkin(9));
    backupDatabase({ repo, dbPath, backupDir, now: new Date('2026-07-31T22:30:00') });

    const snapshot = createRepository(target);
    try { assert.equal(snapshot.getCheckin('2026-07-31', '13:00').scales.mood, 9); }
    finally { snapshot.close(); }
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
