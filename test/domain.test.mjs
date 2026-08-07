import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCheckin, slotForTime, DEFAULT_SETTINGS } from '../backend/domain.mjs';

test('normalizeCheckin clamps scales and normalizes optional values', () => {
  const result = normalizeCheckin({
    localDate: '2026-07-31', slot: '13:00', mood: 12, anxiety: -2,
    energy: '7', focus: 6, functioning: 8, irritability: 1,
    sleepQuality: 7, appetite: 5, nightSleepHours: '7.5', daySleepHours: '',
    context: ['caffeine', 'bogus'], symptoms: ['headache'], activation: [],
    notes: '  normal day  ', redFlags: ''
  }, new Date('2026-07-31T13:05:00+07:00'));
  assert.equal(result.mood, 10);
  assert.equal(result.anxiety, 0);
  assert.equal(result.energy, 7);
  assert.equal(result.nightSleepHours, 7.5);
  assert.equal(result.daySleepHours, null);
  assert.deepEqual(result.context, ['caffeine']);
  assert.equal(result.notes, 'normal day');
});

test('normalizeCheckin rejects invalid slot', () => {
  assert.throws(() => normalizeCheckin({ localDate: '2026-07-31', slot: '14:00' }), /slot/i);
});

test('slotForTime chooses the nearest active scheduled window', () => {
  assert.equal(slotForTime(new Date(2026, 6, 31, 13, 15), DEFAULT_SETTINGS), '13:00');
  assert.equal(slotForTime(new Date(2026, 6, 31, 21, 45), DEFAULT_SETTINGS), '22:00');
  assert.equal(slotForTime(new Date(2026, 6, 31, 5, 0), DEFAULT_SETTINGS), '13:00');
});
