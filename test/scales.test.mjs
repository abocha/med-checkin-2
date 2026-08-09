import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SCALE_DEFINITIONS,
  activeScaleIds,
  normalizeScaleDefinition,
  normalizeScaleValues,
  validateScaleDefinitions
} from '../backend/scales.mjs';

const ids = ['mood', 'anxiety', 'irritability', 'energy', 'focus', 'functioning', 'sleepQuality', 'appetite'];

test('built-in scale IDs and labels are stable', () => {
  assert.deepEqual(BUILTIN_SCALE_DEFINITIONS.map((item) => item.id), ids);
  assert.equal(BUILTIN_SCALE_DEFINITIONS.find((item) => item.id === 'sleepQuality').label, 'Качество сна');
});

test('scale definitions require one active scale and dense active ordering', () => {
  const definitions = BUILTIN_SCALE_DEFINITIONS.map((item) => ({ ...item }));
  definitions[1].active = false;
  definitions.slice(2).forEach((item, index) => { item.sortOrder = index + 1; });
  assert.deepEqual(activeScaleIds(validateScaleDefinitions(definitions)), ['mood', 'irritability', 'energy', 'focus', 'functioning', 'sleepQuality', 'appetite']);
  assert.throws(() => validateScaleDefinitions(definitions.map((item) => ({ ...item, active: false }))), /active/i);
  assert.throws(() => validateScaleDefinitions(definitions.slice(1)), /built-in|missing/i);
  assert.throws(() => validateScaleDefinitions([...definitions, { ...definitions[0] }]), /duplicate/i);
  assert.throws(() => normalizeScaleDefinition({ id: 'x', label: ' ', active: true, sortOrder: 0 }), /label/i);
  assert.throws(() => normalizeScaleDefinition({ id: 'x', label: 'x'.repeat(121), active: true, sortOrder: 0 }), /label/i);
});

test('scale values reject unknown, archived-new, out-of-range, and non-exact sets', () => {
  const definitions = BUILTIN_SCALE_DEFINITIONS.map((item) => item.id === 'anxiety' ? { ...item, active: false } : { ...item });
  definitions.filter((item) => item.active).forEach((item, index) => { item.sortOrder = index; });
  assert.deepEqual(normalizeScaleValues({ mood: 6.04 }, definitions), { mood: 6 });
  assert.throws(() => normalizeScaleValues({ missing: 4 }, definitions), /unknown|scale/i);
  assert.throws(() => normalizeScaleValues({ anxiety: 4 }, definitions), /archived|active/i);
  assert.deepEqual(normalizeScaleValues({ anxiety: 4 }, definitions, { allowedInactiveIds: ['anxiety'] }), { anxiety: 4 });
  assert.throws(() => normalizeScaleValues({ mood: 11 }, definitions), /mood|scale/i);
  assert.throws(() => normalizeScaleValues({ mood: 4 }, definitions, { requiredIds: ['mood', 'energy'] }), /set|required/i);
  for (const invalid of [null, '', true, false, '6']) {
    assert.throws(() => normalizeScaleValues({ mood: invalid }, definitions), /mood|scale/i);
  }
});
