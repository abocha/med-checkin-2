import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalytics } from '../backend/analytics.mjs';

function row(date, period, scales, extra = {}) {
  return { kind: 'scheduled', localDate: date, period, observedAt: `${date}T${period === 'day' ? '13:00' : '22:00'}:00.000Z`, context: [], symptoms: [], activation: [], scales, ...extra };
}

test('buildAnalytics computes sparse dynamic scale means and paired deltas', () => {
  const result = buildAnalytics([
    row('2026-08-08', 'day', { mood: 4, 'custom:clarity': 2 }),
    row('2026-08-08', 'evening', { mood: 6 }),
    row('2026-08-09', 'day', { mood: 5, 'custom:clarity': 8 }),
    row('2026-08-09', 'evening', { mood: 7, 'custom:clarity': 4 })
  ]);
  assert.equal(result.overall.mood, 5.5);
  assert.equal(result.overall['custom:clarity'], 4.67);
  assert.equal(result.pairedDelta.mood, 2);
  assert.equal(result.pairedDelta['custom:clarity'], -4);
  assert.equal(result.daily[0].scales['custom:clarity'], 2);
  assert.equal('anxiety' in result.overall, false);
});

test('buildAnalytics uses only scheduled rows and a trailing three-calendar-day window', () => {
  const result = buildAnalytics([
    row('2026-07-01', 'day', { mood: 2 }),
    row('2026-07-04', 'day', { mood: 8 }),
    row('2026-07-04', 'evening', { mood: 6 }),
    row('2026-07-04', null, { mood: 10 }, { kind: 'extra', period: null })
  ]);
  assert.equal(result.count, 3);
  assert.equal(result.daily[1].scales.mood, 7);
  assert.equal(result.daily[1].rolling.mood, 7);
});

test('buildAnalytics counts only due or early-completed scheduled opportunities', () => {
  const result = buildAnalytics([row('2026-08-06', 'day', { mood: 6 }), row('2026-08-07', 'day', { mood: 7 })], { dayTime: '13:00', eveningTime: '22:00' }, { now: new Date('2026-08-07T12:00:00') });
  assert.deepEqual(result.completion, { completed: 2, opportunities: 3, rate: 66.67 });
});

test('buildAnalytics exposes dated treatment markers without a treatment comparison', () => {
  const result = buildAnalytics([row('2026-08-07', 'day', { mood: 7 })], {}, { treatmentEvents: [{ id: 1, effectiveDate: null, note: 'baseline' }, { id: 2, effectiveDate: '2026-08-07', note: 'dose changed' }] });
  assert.deepEqual(result.treatmentMarkers, [{ id: 2, effectiveDate: '2026-08-07', note: 'dose changed' }]);
});
