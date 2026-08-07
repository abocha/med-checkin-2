import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCheckin, slotForTime, DEFAULT_SETTINGS } from '../backend/domain.mjs';

const scales = {
  mood: 7, anxiety: 2, irritability: 1, energy: 6,
  focus: 8, functioning: 8, sleepQuality: 6, appetite: 5
};

test('normalizeCheckin requires all scheduled scales without clamping or fallback', () => {
  const base = {
    kind: 'scheduled', period: 'day', localDate: '2026-07-31',
    observedAt: '2026-07-31T06:05:00.000Z', ...scales
  };
  const result = normalizeCheckin(base, new Date('2026-07-31T06:06:00.000Z'));
  assert.equal(result.kind, 'scheduled');
  assert.equal(result.period, 'day');
  assert.equal(result.observedAt, base.observedAt);
  assert.equal(result.recordedAt, undefined);
  assert.equal(result.updatedAt, undefined);
  assert.throws(() => normalizeCheckin({ ...base, mood: undefined }), /mood/i);
  assert.throws(() => normalizeCheckin({ ...base, anxiety: 10.1 }), /anxiety/i);
  assert.throws(() => normalizeCheckin({ ...base, energy: -0.1 }), /energy/i);
});

test('normalizeCheckin accepts partial meaningful Extras and rejects empty Extras', () => {
  const extra = normalizeCheckin({
    kind: 'extra', period: null, localDate: '2026-07-31',
    observedAt: '2026-07-31T08:00:00.000Z', mood: 4, notes: 'retrospective'
  });
  assert.equal(extra.mood, 4);
  assert.equal(extra.anxiety, null);
  assert.equal(extra.notes, 'retrospective');
  assert.throws(() => normalizeCheckin({
    kind: 'extra', period: null, localDate: '2026-07-31',
    observedAt: '2026-07-31T08:00:00.000Z'
  }), /empty|meaningful/i);
});

test('normalizeCheckin validates observation identity and timestamp', () => {
  assert.throws(() => normalizeCheckin({ kind: 'scheduled', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T06:00:00.000Z', ...scales }), /period/i);
  assert.throws(() => normalizeCheckin({ kind: 'extra', period: 'day', localDate: '2026-07-31', observedAt: '2026-07-31T06:00:00.000Z', mood: 3 }), /period/i);
  assert.throws(() => normalizeCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: 'not-a-time', mood: 3 }), /observedAt/i);
  assert.throws(() => normalizeCheckin({ localDate: '2026-07-31', slot: '13:00', ...scales }), /kind/i);
});

test('slotForTime chooses the nearest active scheduled window', () => {
  assert.equal(slotForTime(new Date(2026, 6, 31, 13, 15), DEFAULT_SETTINGS), '13:00');
  assert.equal(slotForTime(new Date(2026, 6, 31, 21, 45), DEFAULT_SETTINGS), '22:00');
  assert.equal(slotForTime(new Date(2026, 6, 31, 5, 0), DEFAULT_SETTINGS), '13:00');
});
