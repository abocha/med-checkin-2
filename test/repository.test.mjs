import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../backend/repository.mjs';

const activeValues = (definitions) => Object.fromEntries(definitions.filter((item) => item.active).map((item) => [item.id, 5]));
const scheduled = (repo, overrides = {}) => ({ kind: 'scheduled', period: 'day', localDate: '2026-07-31', scheduledFor: '2026-07-31T06:00:00.000Z', observedAt: '2026-07-31T06:05:00.000Z', scales: activeValues(repo.listScaleDefinitions()), nightSleepHours: 7.5, daySleepHours: null, sleepStart: '04:00', wakeTime: '11:30', context: ['caffeine'], symptoms: ['headache'], activation: [], notes: 'note', redFlags: '', ...overrides });

test('repository stores dynamic values atomically and preserves scheduled historical scale sets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-repo-')); const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    assert.equal(repo.listScaleDefinitions().length, 8);
    const first = repo.createCheckin(scheduled(repo), new Date('2026-07-31T06:10:00.000Z'));
    assert.deepEqual(first.scales, activeValues(repo.listScaleDefinitions()));
    const custom = repo.createScaleDefinition({ label: ' Brain fog ' });
    assert.match(custom.id, /^custom:/); assert.equal(custom.label, 'Brain fog');
    assert.throws(() => repo.updateCheckin(first.id, { ...first, scales: { ...first.scales, [custom.id]: 5 } }), /scale set|required/i);
    const withoutMood = { ...first.scales }; delete withoutMood.mood;
    assert.throws(() => repo.updateCheckin(first.id, { ...first, scales: withoutMood }), /scale set|required/i);
    const updated = repo.updateCheckin(first.id, { ...first, scales: { ...first.scales, mood: 9 } }, new Date('2026-07-31T06:20:00.000Z'));
    assert.equal(updated.scales.mood, 9); assert.equal(updated.recordedAt, first.recordedAt);
    assert.equal(repo.deleteCheckin(first.id), true); assert.equal(repo.getCheckinById(first.id), null);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('scale definitions preserve IDs across rename, archive, restore and complete reorder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-scales-')); const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    const custom = repo.createScaleDefinition({ label: 'Brain fog' });
    assert.equal(repo.updateScaleDefinition(custom.id, { label: 'Fog' }).id, custom.id);
    repo.updateScaleDefinition(custom.id, { active: false });
    assert.throws(() => repo.createCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T08:00:00.000Z', scales: { [custom.id]: 4 } }), /archived/i);
    const restored = repo.updateScaleDefinition(custom.id, { active: true }); assert.equal(restored.sortOrder, 8);
    const ids = repo.listScaleDefinitions().filter((item) => item.active).map((item) => item.id);
    assert.deepEqual(repo.reorderScaleDefinitions([...ids].reverse()).map((item) => item.sortOrder), ids.map((_, index) => index));
    assert.throws(() => repo.reorderScaleDefinitions(ids.slice(1)), /complete/i);
    const allButOne = repo.listScaleDefinitions().filter((item) => item.active).slice(1);
    for (const item of allButOne) repo.updateScaleDefinition(item.id, { active: false });
    assert.throws(() => repo.updateScaleDefinition(repo.listScaleDefinitions().find((item) => item.active).id, { active: false }), /active/i);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Extras may retain archived values during update but new scheduled entries reject caller snapshots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-extra-')); const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    const custom = repo.createScaleDefinition({ label: 'Fog' });
    const extra = repo.createCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T08:00:00.000Z', scales: { [custom.id]: 4 } });
    repo.updateScaleDefinition(custom.id, { active: false });
    assert.equal(repo.updateCheckin(extra.id, { ...extra, scales: { [custom.id]: 5 } }).scales[custom.id], 5);
    const newExtra = repo.createCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T09:00:00.000Z', scales: { mood: 3 } });
    assert.throws(() => repo.updateCheckin(newExtra.id, { ...newExtra, scales: { ...newExtra.scales, [custom.id]: 3 } }), /archived/i);
    assert.throws(() => repo.createCheckin(scheduled(repo, { period: 'evening', scaleSnapshot: ['mood', custom.id], scales: { mood: 5, [custom.id]: 4 } })), /scaleSnapshot|unsupported/i);
    assert.throws(() => repo.createCheckin(scheduled(repo, { period: 'evening', scaleSnapshot: repo.listScaleDefinitions().filter((item) => item.active).map((item) => item.id) })), /scaleSnapshot|unsupported/i);
    assert.throws(() => repo.createCheckin(scheduled(repo, { localDate: '2026-08-01', scaleSnapshot: ['unknown'], scales: { unknown: 5 } })), /snapshot/i);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('repository retains reminder/settings and tracked-item contracts alongside scale data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-existing-contracts-')); const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    const custom = repo.createTrackedItem({ category: 'symptoms', label: ' New symptom ' });
    const saved = repo.createCheckin(scheduled(repo, { symptoms: [custom.id] }));
    assert.equal(repo.updateTrackedItem(custom.id, { label: 'Renamed', active: false }).label, 'Renamed');
    assert.deepEqual(repo.getCheckinById(saved.id).symptoms, [custom.id]);
    const ids = repo.listTrackedItems().filter((item) => item.category === 'symptoms').map((item) => item.id);
    assert.equal(repo.reorderTrackedItems('symptoms', [...ids].reverse()).length, ids.length);
    repo.saveSettings({ dayTime: '12:30', catchupHours: 3 }); assert.equal(repo.getSettings().dayTime, '12:30');
    repo.saveReminderState('2026-07-31', 'day', { snoozedUntil: '2026-07-31T07:00:00.000Z' }); assert.equal(repo.getReminderStates('2026-07-31').day.snoozedUntil, '2026-07-31T07:00:00.000Z');
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Extra to scheduled transition requires the current active scale set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-kind-transition-')); const repo = createRepository(join(dir, 'test.sqlite'));
  try {
    const extra = repo.createCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T08:00:00.000Z', scales: { mood: 4 } });
    assert.throws(() => repo.updateCheckin(extra.id, { ...extra, kind: 'scheduled', period: 'day' }), /scale set|required/i);
    const transitioned = repo.updateCheckin(extra.id, { ...extra, kind: 'scheduled', period: 'day', scales: activeValues(repo.listScaleDefinitions()) });
    assert.deepEqual(transitioned.scales, activeValues(repo.listScaleDefinitions()));
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});
