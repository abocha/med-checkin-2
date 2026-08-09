import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCheckin, slotForTime, DEFAULT_SETTINGS } from '../backend/domain.mjs';
import { BUILTIN_SCALE_DEFINITIONS, activeScaleIds } from '../backend/scales.mjs';

const allScales = Object.fromEntries(BUILTIN_SCALE_DEFINITIONS.map((item) => [item.id, 5]));
const scheduled = (overrides = {}) => ({ kind: 'scheduled', period: 'day', localDate: '2026-07-31', observedAt: '2026-07-31T06:05:00.000Z', scales: allScales, ...overrides });

test('normalizeCheckin requires exactly supplied scheduled scale set', () => {
  const result = normalizeCheckin(scheduled(), { requiredScaleIds: activeScaleIds(BUILTIN_SCALE_DEFINITIONS) });
  assert.deepEqual(result.scales, allScales);
  assert.throws(() => normalizeCheckin(scheduled({ scales: { ...allScales, other: 1 } }), { requiredScaleIds: activeScaleIds(BUILTIN_SCALE_DEFINITIONS) }), /unknown|scale/i);
  const missing = { ...allScales }; delete missing.mood;
  assert.throws(() => normalizeCheckin(scheduled({ scales: missing }), { requiredScaleIds: activeScaleIds(BUILTIN_SCALE_DEFINITIONS) }), /set|required/i);
});

test('normalizeCheckin permits historical archived values only with explicit allowance and keeps Extras meaningful', () => {
  const definitions = BUILTIN_SCALE_DEFINITIONS.map((item) => ({ ...item }));
  definitions[0].active = false; definitions.slice(1).forEach((item, index) => { item.sortOrder = index; });
  assert.throws(() => normalizeCheckin(scheduled({ scales: { mood: 3 } }), { scaleDefinitions: definitions, requiredScaleIds: ['mood'] }), /archived/i);
  assert.deepEqual(normalizeCheckin(scheduled({ scales: { mood: 3 } }), { scaleDefinitions: definitions, requiredScaleIds: ['mood'], allowedInactiveScaleIds: ['mood'] }).scales, { mood: 3 });
  assert.equal(normalizeCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T08:00:00.000Z', scales: { mood: 4 } }).scales.mood, 4);
  assert.throws(() => normalizeCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T08:00:00.000Z', scales: {} }), /empty|meaningful/i);
});

test('normalizeCheckin validates observation identity and timestamp', () => {
  assert.throws(() => normalizeCheckin(scheduled({ period: null })), /period/i);
  assert.throws(() => normalizeCheckin({ kind: 'extra', period: 'day', localDate: '2026-07-31', observedAt: '2026-07-31T06:00:00.000Z', scales: { mood: 3 } }), /period/i);
  assert.throws(() => normalizeCheckin({ kind: 'extra', period: null, localDate: '2026-07-31', observedAt: 'not-a-time', scales: { mood: 3 } }), /observedAt/i);
});

test('normalizeCheckin preserves known archived tracked IDs and rejects wrong categories', () => {
  const trackedItems = [
    { id: 'custom:symptom-1', category: 'symptoms', label: 'Custom symptom', active: false, sortOrder: 0 },
    { id: 'context-1', category: 'context', label: 'Context', active: true, sortOrder: 0 },
    { id: 'activation-1', category: 'activation', label: 'Activation', active: true, sortOrder: 0 }
  ];
  const input = { kind: 'extra', period: null, localDate: '2026-07-31', observedAt: '2026-07-31T08:00:00.000Z', symptoms: ['custom:symptom-1'], scales: {} };
  assert.deepEqual(normalizeCheckin(input, { trackedItems }).symptoms, ['custom:symptom-1']);
  assert.throws(() => normalizeCheckin({ ...input, context: ['custom:symptom-1'], symptoms: [] }, { trackedItems }), /context/i);
  assert.throws(() => normalizeCheckin({ ...input, symptoms: ['unknown-item'] }, { trackedItems }), /symptoms/i);
});

test('slotForTime chooses the nearest active scheduled window', () => {
  assert.equal(slotForTime(new Date(2026, 6, 31, 13, 15), DEFAULT_SETTINGS), '13:00');
  assert.equal(slotForTime(new Date(2026, 6, 31, 21, 45), DEFAULT_SETTINGS), '22:00');
});
