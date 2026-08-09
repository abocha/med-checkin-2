import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../backend/repository.mjs';

test('fresh repository has no treatment history or effective regimen', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-treatment-'));
  const repo = createRepository(join(root, 'test.sqlite'));
  try {
    assert.deepEqual(repo.listTreatmentEvents(), []);
    assert.equal(repo.getEffectiveTreatment('2026-07-06'), null);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

test('treatment events enforce one baseline/date and validate regimen snapshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'med-checkin-treatment-'));
  const repo = createRepository(join(root, 'test.sqlite'));
  const now = new Date('2026-08-07T01:00:00.000Z');
  try {
    repo.createTreatmentEvent({ effectiveDate: null, regimen: [], note: '' }, now);
    repo.createTreatmentEvent({ effectiveDate: '2026-07-07', regimen: [], note: '' }, now);
    assert.throws(() => repo.createTreatmentEvent({ effectiveDate: null, regimen: [], note: '' }, now), /baseline|unique/i);
    assert.throws(() => repo.createTreatmentEvent({ effectiveDate: '2026-07-07', regimen: [], note: '' }, now), /date|unique/i);
    assert.throws(() => repo.createTreatmentEvent({
      effectiveDate: '2026-08-01', regimen: [{ name: '', amount: 5, unit: 'mg' }], note: ''
    }, now), /name/i);

    const created = repo.createTreatmentEvent({ effectiveDate: '2026-08-01', regimen: [], note: 'stopped' }, now);
    assert.deepEqual(created.regimen, []);
    assert.equal(created.createdAt, now.toISOString());
    const updated = repo.updateTreatmentEvent(created.id, {
      effectiveDate: '2026-08-01',
      regimen: [{ name: 'Example', amount: 2.5, unit: 'mg', timing: 'morning' }],
      note: 'resumed'
    }, new Date('2026-08-07T02:00:00.000Z'));
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.updatedAt, '2026-08-07T02:00:00.000Z');
    assert.equal(repo.deleteTreatmentEvent(created.id), true);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});
