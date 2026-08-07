import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadDrafts() {
  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const context = { localStorage: storage };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL('../resources/draft-store.js', import.meta.url), 'utf8'), context);
  return { drafts: context.MedCheckinDrafts, storage };
}

test('draft store writes, reads, and removes a scheduled draft without mixing identities', () => {
  const { drafts } = loadDrafts();
  const dayKey = drafts.scheduledKey('2026-08-07', 'day');
  const eveningKey = drafts.scheduledKey('2026-08-07', 'evening');

  drafts.write(dayKey, { values: { mood: '6' }, savedAt: '2026-08-07T08:00:00.000Z' });

  assert.equal(JSON.stringify(drafts.read(dayKey)), JSON.stringify({ values: { mood: '6' }, savedAt: '2026-08-07T08:00:00.000Z' }));
  assert.equal(drafts.read(eveningKey), null);
  drafts.remove(dayKey);
  assert.equal(drafts.read(dayKey), null);
});

test('draft store names Extra and saved-entry drafts with the approved identities', () => {
  const { drafts } = loadDrafts();
  assert.equal(drafts.extraKey('local-123'), 'extra:local-123');
  assert.equal(drafts.checkinKey(42), 'checkin:42');
});
