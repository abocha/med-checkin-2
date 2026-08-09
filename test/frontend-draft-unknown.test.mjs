import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const scaleFields = ['mood', 'anxiety', 'irritability', 'energy', 'focus', 'functioning', 'sleepQuality', 'appetite'];

function createHarness() {
  const hook = {};
  const savedDrafts = new Map();
  const local = new Map();
  const groups = Object.fromEntries(['context', 'symptoms', 'activation'].map(category => [category, []]));
  const status = { textContent: '' };
  const toast = { classList: { add() {}, remove() {} }, textContent: '' };
  const inputs = Object.fromEntries(scaleFields.map(name => [name, {
    value: '1', dataset: { chosen: 'true' },
    parentElement: { classList: { toggle() {} }, querySelector: () => ({ value: '', textContent: '' }) }
  }]));
  const form = {
    elements: {
      ...inputs,
      notes: { value: '' }, redFlags: { value: '' },
      context: { value: '' }, symptoms: { value: '' }, activation: { value: '' }
    },
    formValues: { notes: '', redFlags: '' }
  };
  const document = {
    querySelector(selector) {
      if (selector === '#checkin-form') return form;
      if (selector === '#save-status') return status;
      if (selector === '#toast') return toast;
      return null;
    },
    querySelectorAll(selector) {
      const match = /^\[data-flag-group="(context|symptoms|activation)"\] input(?::checked)?$/.exec(selector);
      if (!match) return [];
      return selector.endsWith(':checked') ? groups[match[1]].filter(input => input.checked) : groups[match[1]];
    },
    addEventListener() {}
  };
  class FakeFormData {
    constructor(target) { this.target = target; }
    entries() { return Object.entries(this.target.formValues); }
  }
  const context = {
    __MED_CHECKIN_TEST__: hook,
    document,
    FormData: FakeFormData,
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) },
    MedCheckinDrafts: {
      scheduledKey: (date, period) => `scheduled:${date}:${period}`,
      write: (key, value) => savedDrafts.set(key, structuredClone(value)),
      remove: key => savedDrafts.delete(key)
    },
    clearTimeout,
    setTimeout: () => 1,
    console
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL('../resources/app.js', import.meta.url), 'utf8'), context);
  return { lifecycle: hook.draftLifecycle, form, groups, savedDrafts, status };
}

function validExtraPayload() {
  return { kind: 'extra', mood: 1, nightSleepHours: null, daySleepHours: null, sleepStart: '', wakeTime: '', context: [], symptoms: [], activation: [], notes: '', redFlags: '' };
}

test('restored unknown draft flag survives edit and reload, then explicit discard clears the block', () => {
  const harness = createHarness();
  const { lifecycle, form, groups, savedDrafts } = harness;
  lifecycle.state.currentDate = '2026-08-09';
  lifecycle.state.currentPeriod = 'day';
  lifecycle.state.currentKind = 'scheduled';
  groups.context.push({ value: 'known', checked: true });

  lifecycle.restoreDraft({ values: { context: ['removed'], symptoms: [], activation: [], scalesChosen: {}, notes: '' } });
  assert.equal(lifecycle.validForSave(validExtraPayload()), false);

  form.formValues.notes = 'edited';
  form.elements.notes.value = 'edited';
  lifecycle.markDirty();
  lifecycle.persistDraft();
  const persisted = savedDrafts.get('scheduled:2026-08-09:day');
  assert.deepEqual(Array.from(persisted.values.context), ['removed']);

  lifecycle.restoreDraft(persisted);
  assert.equal(lifecycle.validForSave(validExtraPayload()), false);
  lifecycle.discardDraft();
  assert.equal(lifecycle.validForSave(validExtraPayload()), true);
});
