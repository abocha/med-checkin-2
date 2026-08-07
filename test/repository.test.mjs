import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../backend/repository.mjs';

const scales = {
  mood: 7, anxiety: 1, irritability: 2, energy: 6,
  focus: 7, functioning: 8, sleepQuality: 6, appetite: 5
};

function sample(overrides = {}) {
  return {
    kind: 'scheduled', period: 'day', localDate: '2026-07-31',
    scheduledFor: '2026-07-31T06:00:00.000Z', observedAt: '2026-07-31T06:05:00.000Z',
    ...scales, nightSleepHours: 7.5, daySleepHours: null,
    sleepStart: '04:00', wakeTime: '11:30', context: ['caffeine'],
    symptoms: ['headache'], activation: [], notes: 'note', redFlags: '', ...overrides
  };
}

test('repository creates and edits scheduled observations with server-owned audit time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-repo-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    const created = repo.createCheckin(sample({ recordedAt: 'client-value' }), new Date('2026-07-31T06:10:00.000Z'));
    assert.equal(created.recordedAt, '2026-07-31T06:10:00.000Z');
    assert.equal(created.updatedAt, created.recordedAt);
    const updated = repo.updateCheckin(created.id, sample({ mood: 9 }), new Date('2026-07-31T06:20:00.000Z'));
    assert.equal(updated.id, created.id);
    assert.equal(updated.mood, 9);
    assert.equal(updated.recordedAt, created.recordedAt);
    assert.equal(updated.updatedAt, '2026-07-31T06:20:00.000Z');
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('repository rejects duplicate scheduled identity and allows unlimited Extras', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-repo-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    repo.createCheckin(sample(), new Date('2026-07-31T06:10:00.000Z'));
    assert.throws(() => repo.createCheckin(sample({ mood: 8 }), new Date('2026-07-31T06:11:00.000Z')), /unique|duplicate/i);
    repo.createCheckin(sample({ kind: 'extra', period: null, scheduledFor: null, mood: 4 }), new Date('2026-07-31T08:00:00.000Z'));
    repo.createCheckin(sample({ kind: 'extra', period: null, scheduledFor: null, mood: 5 }), new Date('2026-07-31T09:00:00.000Z'));
    assert.equal(repo.listCheckins({ kind: 'extra' }).length, 2);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('repository filters history and persists semantic reminder state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-repo-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    repo.createCheckin(sample({ localDate: '2026-07-30' }), new Date('2026-07-30T06:10:00.000Z'));
    const latest = repo.createCheckin(sample({ period: 'evening' }), new Date('2026-07-31T15:10:00.000Z'));
    assert.equal(repo.listCheckins({ limit: 10 })[0].id, latest.id);
    assert.equal(repo.listAllCheckins({ period: 'day' }).length, 1);
    assert.equal(repo.getScheduledCheckin('2026-07-31', 'evening').id, latest.id);
    assert.equal(repo.deleteCheckin(latest.id), true);

    repo.saveSettings({ dayTime: '12:30', catchupHours: 3 });
    assert.equal(repo.getSettings().dayTime, '12:30');
    repo.saveReminderState('2026-07-31', 'day', { snoozedUntil: '2026-07-31T07:00:00.000Z' });
    assert.equal(repo.getReminderStates('2026-07-31').day.snoozedUntil, '2026-07-31T07:00:00.000Z');
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});
