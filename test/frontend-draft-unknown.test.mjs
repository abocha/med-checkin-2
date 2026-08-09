import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const builtins = [
  ['mood', 'Настроение'], ['anxiety', 'Тревога'], ['irritability', 'Раздражительность'], ['energy', 'Энергия'],
  ['focus', 'Концентрация'], ['functioning', 'Функционирование'], ['sleepQuality', 'Качество сна'], ['appetite', 'Аппетит']
];

function createHarness(definitions = builtins.map(([id, label], sortOrder) => ({ id, label, active: true, sortOrder }))) {
  const hook = {};
  const savedDrafts = new Map();
  const local = new Map();
  const groups = Object.fromEntries(['context', 'symptoms', 'activation'].map(category => [category, []]));
  const status = { textContent: '' };
  const toast = { classList: { add() {}, remove() {} }, textContent: '' };
  const scaleRoot = { _html: '', _clearButtons: [], querySelector: () => null, querySelectorAll(selector) { return selector === '[data-scale-clear]' ? this._clearButtons : []; } };
  const form = { elements: { notes: { value: '' }, redFlags: { value: '' }, context: { value: '' }, symptoms: { value: '' }, activation: { value: '' } }, formValues: { notes: '', redFlags: '' } };
  const output = () => ({ value: '', textContent: '' });
  function scaleInputs() { return Object.values(form.elements).filter(input => input.type === 'range'); }
  function makeScaleInput(name) {
    const input = { name, type: 'range', value: '1', dataset: {}, parentElement: { classList: { toggle() {} }, querySelector: output }, addEventListener() {} };
    form.elements[name] = input;
    return input;
  }
  Object.defineProperty(scaleRoot, 'innerHTML', {
    get() { return this._html; },
    set(value) { this._html = value; for (const name of scaleInputs().map(input => input.name)) delete form.elements[name]; for (const name of [...value.matchAll(/name="([^"]+)"/g)].map(match => match[1])) makeScaleInput(name); this._clearButtons = [...value.matchAll(/data-scale-clear="([^"]+)"/g)].map(match => { const button = { dataset: { scaleClear: match[1] }, listener: null, addEventListener(type, listener) { if (type === 'click') this.listener = listener; }, click() { this.listener?.({ currentTarget: this }); } }; return button; }); }
  });
  const document = {
    querySelector(selector) { if (selector === '#checkin-form') return form; if (selector === '#scale-inputs') return scaleRoot; if (selector === '#save-status') return status; if (selector === '#toast') return toast; return null; },
    querySelectorAll(selector) {
      if (selector === 'input[type="range"]') return scaleInputs();
      const match = /^\[data-flag-group="(context|symptoms|activation)"\] input(?::checked)?$/.exec(selector);
      if (!match) return [];
      return selector.endsWith(':checked') ? groups[match[1]].filter(input => input.checked) : groups[match[1]];
    },
    addEventListener() {}
  };
  class FakeFormData { constructor(target) { this.target = target; } entries() { return Object.entries(this.target.formValues); } }
  const context = {
    __MED_CHECKIN_TEST__: hook, document, FormData: FakeFormData,
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) },
    MedCheckinDrafts: { scheduledKey: (date, period) => `scheduled:${date}:${period}`, write: (key, value) => savedDrafts.set(key, structuredClone(value)), remove: key => savedDrafts.delete(key) },
    clearTimeout, setTimeout: () => 1, console
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL('../resources/app.js', import.meta.url), 'utf8'), context);
  hook.draftLifecycle.state.scaleDefinitions = definitions;
  return { lifecycle: hook.draftLifecycle, form, scaleRoot, scaleInputs, savedDrafts, status };
}

function validExtraPayload(scales = { mood: 1 }) {
  return { kind: 'extra', scales, nightSleepHours: null, daySleepHours: null, sleepStart: '', wakeTime: '', context: [], symptoms: [], activation: [], notes: '', redFlags: '' };
}

test('2.3 fixed-field draft normalizes to the eight-ID snapshot without later definitions', () => {
  const harness = createHarness([...builtins, ['custom:new', 'Новая']].map(([id, label], sortOrder) => ({ id, label, active: true, sortOrder })));
  const normalized = harness.lifecycle.normalizeDraftScaleState({ mood: '6', anxiety: '', scalesChosen: { mood: true, anxiety: false } });
  assert.deepEqual(Array.from(normalized.scaleSnapshot), builtins.map(([id]) => id));
  assert.deepEqual(Array.from(normalized.chosenIds), ['mood']);
  assert.deepEqual(Object.fromEntries(Object.entries(normalized.scales)), { mood: 6 });
});

test('new-format draft restores exactly its captured known IDs after later activation', () => {
  const harness = createHarness([
    { id: 'mood', label: 'Настроение', active: true, sortOrder: 0 },
    { id: 'anxiety', label: 'Тревога', active: true, sortOrder: 1 },
    { id: 'custom:new', label: 'Новая', active: true, sortOrder: 2 }
  ]);
  harness.lifecycle.restoreDraft({ values: { scaleSnapshot: ['mood', 'anxiety'], scales: { mood: 6, anxiety: 3 }, scalesChosen: { mood: true, anxiety: true } } });
  assert.deepEqual(harness.scaleInputs().map(input => input.name), ['mood', 'anxiety']);
  assert.deepEqual(harness.scaleInputs().map(input => Number(input.value)), [6, 3]);
});

test('unknown post-Replace scale ID remains persisted and blocks save until discard', () => {
  const harness = createHarness([{ id: 'mood', label: 'Настроение', active: true, sortOrder: 0 }]);
  harness.lifecycle.state.currentDate = '2026-08-09'; harness.lifecycle.state.currentPeriod = 'day'; harness.lifecycle.state.currentKind = 'scheduled';
  harness.lifecycle.restoreDraft({ values: { scaleSnapshot: ['mood', 'custom:removed'], scales: { mood: 6, 'custom:removed': 4 }, scalesChosen: { mood: true, 'custom:removed': true }, notes: '' } });
  harness.lifecycle.applyScaleDefinitions([{ id: 'mood', label: 'Настроение обновлено', active: true, sortOrder: 0 }]);
  harness.form.formValues.notes = 'edited';
  harness.lifecycle.markDirty(); harness.lifecycle.persistDraft();
  const persisted = harness.savedDrafts.get('scheduled:2026-08-09:day');
  assert.deepEqual(persisted.values.scaleSnapshot, ['mood', 'custom:removed']);
  assert.equal(persisted.values.scales['custom:removed'], 4);
  assert.equal(harness.lifecycle.validForSave(validExtraPayload()), false);
  harness.lifecycle.discardDraft();
  assert.equal(harness.lifecycle.validForSave(validExtraPayload()), true);
});

test('restored scheduled draft with a known old subset is preserved but blocked by the current active set', () => {
  const harness = createHarness([
    { id: 'mood', label: 'Настроение', active: true, sortOrder: 0 },
    { id: 'anxiety', label: 'Тревога', active: true, sortOrder: 1 },
    { id: 'energy', label: 'Энергия', active: true, sortOrder: 2 }
  ]);
  harness.lifecycle.state.currentKind = 'scheduled';
  harness.lifecycle.restoreDraft({ values: { scaleSnapshot: ['mood', 'anxiety'], scales: { mood: 6, anxiety: 3 }, scalesChosen: { mood: true, anxiety: true } } });
  assert.equal(harness.lifecycle.validForSave({ kind: 'scheduled', scales: { mood: 6, anxiety: 3 } }), false);
});

test('restored scheduled draft with an unknown scale remains preserved but blocked by the current active set', () => {
  const harness = createHarness([{ id: 'mood', label: 'Настроение', active: true, sortOrder: 0 }]);
  harness.lifecycle.state.currentKind = 'scheduled';
  harness.lifecycle.restoreDraft({ values: { scaleSnapshot: ['mood', 'custom:removed'], scales: { mood: 6, 'custom:removed': 4 }, scalesChosen: { mood: true, 'custom:removed': true } } });
  assert.equal(harness.lifecycle.validForSave({ kind: 'scheduled', scales: { mood: 6, 'custom:removed': 4 } }), false);
});

test('existing Extra renders a clear control for active and archived scale values', () => {
  const harness = createHarness([
    { id: 'mood', label: 'Настроение', active: true, sortOrder: 0 },
    { id: 'custom:old', label: 'Старая', active: false, sortOrder: 1 }
  ]);
  harness.lifecycle.state.currentKind = 'extra';
  harness.lifecycle.renderScaleInputs(['mood', 'custom:old'], { values: { mood: 5, 'custom:old': 3 }, chosenIds: ['mood', 'custom:old'] });
  assert.match(harness.scaleRoot._html, /data-scale-clear/);
  harness.scaleRoot._clearButtons.find(button => button.dataset.scaleClear === 'custom:old').click();
  assert.equal(harness.form.elements['custom:old'].dataset.chosen, undefined);
});

test('pristine new scheduled form adopts scale-definition mutations', () => {
  const harness = createHarness([{ id: 'mood', label: 'Настроение', active: true, sortOrder: 0 }]);
  harness.lifecycle.state.currentKind = 'scheduled';
  harness.lifecycle.state.currentRecord = null;
  harness.lifecycle.state.dirty = false;
  harness.lifecycle.renderScaleInputs(['mood'], { values: {}, chosenIds: [] });
  harness.lifecycle.applyScaleDefinitions([
    { id: 'mood', label: 'Настроение обновлено', active: true, sortOrder: 0 },
    { id: 'energy', label: 'Энергия', active: true, sortOrder: 1 }
  ]);
  assert.deepEqual(harness.scaleInputs().map(input => input.name), ['mood', 'energy']);
  assert.match(harness.scaleRoot._html, /Настроение обновлено/);
});

test('dirty new scheduled form preserves its inputs when definitions mutate', () => {
  const harness = createHarness([{ id: 'mood', label: 'Настроение', active: true, sortOrder: 0 }]);
  harness.lifecycle.state.currentKind = 'scheduled';
  harness.lifecycle.state.currentRecord = null;
  harness.lifecycle.state.dirty = true;
  harness.lifecycle.renderScaleInputs(['mood'], { values: { mood: 7 }, chosenIds: ['mood'] });
  harness.lifecycle.applyScaleDefinitions([
    { id: 'mood', label: 'Настроение обновлено', active: true, sortOrder: 0 },
    { id: 'energy', label: 'Энергия', active: true, sortOrder: 1 }
  ]);
  assert.deepEqual(harness.scaleInputs().map(input => input.name), ['mood']);
  assert.match(harness.status.textContent, /настройки шкал изменились/i);
});

test('saved scheduled history keeps its stored scale set and values while labels/archive state update', () => {
  const harness = createHarness([{ id: 'mood', label: 'Настроение', active: true, sortOrder: 0 }]);
  harness.lifecycle.state.currentKind = 'scheduled';
  harness.lifecycle.state.currentRecord = { id: 42, kind: 'scheduled', scales: { mood: 7, 'custom:old': 3 } };
  harness.lifecycle.renderScaleInputs(['mood', 'custom:old'], { values: { mood: 7, 'custom:old': 3 }, chosenIds: ['mood', 'custom:old'] });
  harness.lifecycle.applyScaleDefinitions([
    { id: 'mood', label: 'Настроение архивное', active: false, sortOrder: 0 },
    { id: 'custom:old', label: 'Старая шкала', active: false, sortOrder: 1 },
    { id: 'energy', label: 'Энергия', active: true, sortOrder: 0 }
  ]);
  assert.deepEqual(harness.scaleInputs().map(input => input.name), ['mood', 'custom:old']);
  assert.deepEqual(harness.scaleInputs().map(input => Number(input.value)), [7, 3]);
  assert.match(harness.scaleRoot._html, /Настроение архивное/);
  assert.match(harness.scaleRoot._html, /Старая шкала/);
  assert.doesNotMatch(harness.scaleRoot._html, /Энергия/);
});

test('restored scheduled snapshot keeps known IDs and chosen state while labels/archive state update', () => {
  const harness = createHarness([
    { id: 'mood', label: 'Настроение', active: true, sortOrder: 0 },
    { id: 'custom:old', label: 'Старая', active: true, sortOrder: 1 }
  ]);
  harness.lifecycle.state.currentKind = 'scheduled';
  harness.lifecycle.restoreDraft({ values: { scaleSnapshot: ['mood', 'custom:old'], scales: { mood: 6 }, scalesChosen: { mood: true, 'custom:old': false } } });
  harness.lifecycle.applyScaleDefinitions([
    { id: 'mood', label: 'Настроение архивное', active: false, sortOrder: 0 },
    { id: 'custom:old', label: 'Старая архивная', active: false, sortOrder: 1 },
    { id: 'energy', label: 'Энергия', active: true, sortOrder: 0 }
  ]);
  assert.deepEqual(harness.scaleInputs().map(input => input.name), ['mood', 'custom:old']);
  assert.equal(Number(harness.form.elements.mood.value), 6);
  assert.equal(harness.form.elements.mood.dataset.chosen, 'true');
  assert.equal(harness.form.elements['custom:old'].dataset.chosen, undefined);
  assert.match(harness.scaleRoot._html, /Старая архивная/);
  assert.doesNotMatch(harness.scaleRoot._html, /Энергия/);
});
