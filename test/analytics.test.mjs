import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics } from '../backend/analytics.mjs';

const row = (localDate, slot, mood, energy, extra = {}) => ({
  id: Math.random(), kind: 'scheduled', period: slot === '22:00' ? 'evening' : 'day', localDate, slot, mood, energy, anxiety: 1, irritability: 0,
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

test('buildAnalytics uses only scheduled rows and a trailing three-calendar-day window', () => {
  const result = buildAnalytics([
    row('2026-07-01', '13:00', 2, 4),
    row('2026-07-04', '13:00', 8, 6),
    row('2026-07-04', '22:00', 6, 8),
    row('2026-07-04', null, 10, 10, { kind: 'extra', period: null, slot: null })
  ]);
  assert.equal(result.count, 3);
  assert.equal(result.daily.length, 2);
  assert.equal(result.daily[1].mood, 7);
  assert.equal(result.daily[1].rolling.mood, 7);
  assert.deepEqual(result.frequencies, { context: {}, symptoms: {}, activation: {} });
});

test('buildAnalytics counts only due or early-completed scheduled opportunities', () => {
  const result = buildAnalytics([
    row('2026-08-06', '13:00', 6, 6),
    row('2026-08-07', '13:00', 7, 7)
  ], { dayTime: '13:00', eveningTime: '22:00' }, { now: new Date('2026-08-07T12:00:00') });
  assert.deepEqual(result.completion, { completed: 2, opportunities: 3, rate: 66.67 });
});

test('buildAnalytics exposes dated treatment markers without a treatment comparison', () => {
  const result = buildAnalytics([row('2026-08-07', '13:00', 7, 7)], {}, {
    treatmentEvents: [
      { id: 1, effectiveDate: null, regimen: [], note: 'baseline' },
      { id: 2, effectiveDate: '2026-08-07', regimen: [{ name: 'Example', amount: 2, unit: 'mg' }], note: 'dose changed' }
    ]
  });
  assert.deepEqual(result.treatmentMarkers, [{ id: 2, effectiveDate: '2026-08-07', note: 'dose changed' }]);
  assert.equal('periods' in result, false);
});
