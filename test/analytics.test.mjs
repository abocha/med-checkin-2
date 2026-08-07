import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics } from '../backend/analytics.mjs';

const row = (localDate, slot, mood, energy, extra = {}) => ({
  id: Math.random(), localDate, slot, mood, energy, anxiety: 1, irritability: 0,
  focus: 6, functioning: 7, sleepQuality: 6, appetite: 5,
  context: [], symptoms: [], activation: [], ...extra
});

test('buildAnalytics computes daily means and paired evening deltas', () => {
  const result = buildAnalytics([
    row('2026-07-30', '13:00', 6, 5), row('2026-07-30', '22:00', 8, 7),
    row('2026-07-31', '13:00', 7, 6, { symptoms: ['headache'], context: ['stress'] })
  ], { treatmentChangeDate: '2026-07-07' });
  assert.equal(result.daily.length, 2);
  assert.equal(result.daily[0].mood, 7);
  assert.equal(result.pairedDelta.mood, 2);
  assert.equal(result.frequencies.symptoms.headache, 1);
  assert.equal(result.frequencies.context.stress, 1);
});

test('buildAnalytics adds centered rolling values and period comparison', () => {
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(row(`2026-07-${String(i).padStart(2,'0')}`, '13:00', i <= 7 ? 9 : 6, 7));
  const result = buildAnalytics(rows, { treatmentChangeDate: '2026-07-01' });
  assert.equal(result.daily[4].rolling.mood, 9);
  assert.equal(result.periods.first7.mood, 9);
  assert.equal(result.periods.later.mood, 6);
});
