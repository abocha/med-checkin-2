import test from 'node:test';
import assert from 'node:assert/strict';
import { getDueReminder, nextWakeup } from '../backend/reminders.mjs';
import { DEFAULT_SETTINGS } from '../backend/domain.mjs';

const local = (h, m = 0) => new Date(2026, 6, 31, h, m, 0, 0);

test('returns the scheduled slot inside its catch-up window', () => {
  const due = getDueReminder(local(13, 5), DEFAULT_SETTINGS, new Set(), {});
  assert.equal(due.slot, '13:00');
  assert.equal(due.localDate, '2026-07-31');
});

test('skips completed, dismissed, snoozed, and recently notified slots', () => {
  assert.equal(getDueReminder(local(13, 5), DEFAULT_SETTINGS, new Set(['2026-07-31|13:00']), {}), null);
  assert.equal(getDueReminder(local(13, 5), DEFAULT_SETTINGS, new Set(), {'13:00': { dismissedAt: local(13, 1).toISOString() }}), null);
  assert.equal(getDueReminder(local(13, 5), DEFAULT_SETTINGS, new Set(), {'13:00': { snoozedUntil: local(13, 30).toISOString() }}), null);
  assert.equal(getDueReminder(local(13, 5), DEFAULT_SETTINGS, new Set(), {'13:00': { notifiedAt: local(12, 50).toISOString() }}), null);
});

test('returns the evening slot after 22:00 and expires after catch-up window', () => {
  assert.equal(getDueReminder(local(22, 15), DEFAULT_SETTINGS, new Set(), {}).slot, '22:00');
  assert.equal(getDueReminder(new Date(2026, 7, 1, 3, 0), DEFAULT_SETTINGS, new Set(), {}), null);
});

test('nextWakeup chooses next future schedule', () => {
  assert.equal(nextWakeup(local(12), DEFAULT_SETTINGS).getHours(), 13);
  assert.equal(nextWakeup(local(14), DEFAULT_SETTINGS).getHours(), 22);
  const tomorrow = nextWakeup(local(23), DEFAULT_SETTINGS);
  assert.equal(tomorrow.getDate(), 1);
  assert.equal(tomorrow.getHours(), 13);
});
