import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../backend/repository.mjs';

function sample(overrides = {}) {
  return {
    localDate: '2026-07-31', slot: '13:00', recordedAt: '2026-07-31T06:00:00.000Z',
    updatedAt: '2026-07-31T06:00:00.000Z', mood: 7, anxiety: 1,
    irritability: 2, energy: 6, focus: 7, functioning: 8,
    sleepQuality: 6, appetite: 5, nightSleepHours: 7.5, daySleepHours: null,
    sleepStart: '04:00', wakeTime: '11:30', context: ['caffeine'],
    symptoms: ['headache'], activation: [], notes: 'note', redFlags: '', ...overrides
  };
}

test('repository upserts one row per date and slot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-repo-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    repo.upsertCheckin(sample());
    repo.upsertCheckin(sample({ mood: 9, notes: 'updated' }));
    const rows = repo.listCheckins({ limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mood, 9);
    assert.equal(rows[0].notes, 'updated');
    assert.deepEqual(rows[0].context, ['caffeine']);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('repository orders history newest first and deletes by id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-repo-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    repo.upsertCheckin(sample({ localDate: '2026-07-30' }));
    const latest = repo.upsertCheckin(sample({ localDate: '2026-07-31', slot: '22:00' }));
    assert.equal(repo.listCheckins({ limit: 10 })[0].id, latest.id);
    assert.equal(repo.deleteCheckin(latest.id), true);
    assert.equal(repo.listCheckins({ limit: 10 }).length, 1);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('repository persists settings and reminder state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-repo-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    repo.saveSettings({ dayTime: '12:30', catchupHours: 3 });
    assert.equal(repo.getSettings().dayTime, '12:30');
    repo.saveReminderState('2026-07-31', '13:00', { snoozedUntil: '2026-07-31T07:00:00.000Z' });
    assert.equal(repo.getReminderStates('2026-07-31')['13:00'].snoozedUntil, '2026-07-31T07:00:00.000Z');
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});
