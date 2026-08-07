import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../backend/repository.mjs';
import { createHttpServer } from '../backend/http-server.mjs';
import { createHostActionQueue } from '../backend/host-actions.mjs';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-api-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  const app = createHttpServer({ repo, token: 'secret-token', dataDir: dir, resourcesDir: new URL('../resources/', import.meta.url) });
  await app.listen(0);
  const base = `http://127.0.0.1:${app.port}`;
  return { dir, repo, app, base, close: async () => { await app.close(); repo.close(); rmSync(dir, {recursive:true, force:true}); } };
}

const body = {
  localDate: '2026-07-31', slot: '13:00', mood: 7, anxiety: 1,
  irritability: 0, energy: 6, focus: 7, functioning: 8,
  sleepQuality: 6, appetite: 5, nightSleepHours: 7, daySleepHours: 0,
  context: ['caffeine'], symptoms: [], activation: [], notes: 'ok', redFlags: ''
};

async function api(base, path, options = {}) {
  return fetch(base + path, {
    ...options,
    headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
}

test('API rejects unauthenticated access', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.base + '/api/v1/settings');
    assert.equal(response.status, 401);
  } finally { await f.close(); }
});

test('API saves, updates, reads, lists, and deletes a check-in', async () => {
  const f = await fixture();
  try {
    let response = await api(f.base, '/api/v1/checkins', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    const first = await response.json();
    response = await api(f.base, '/api/v1/checkins', { method: 'POST', body: JSON.stringify({...body, mood: 9}) });
    const updated = await response.json();
    assert.equal(updated.id, first.id);
    assert.equal(updated.mood, 9);
    response = await api(f.base, '/api/v1/checkin?date=2026-07-31&slot=13%3A00');
    assert.equal((await response.json()).mood, 9);
    response = await api(f.base, '/api/v1/checkins?limit=10');
    assert.equal((await response.json()).items.length, 1);
    response = await api(f.base, `/api/v1/checkins/${first.id}`, { method: 'DELETE' });
    assert.equal(response.status, 204);
  } finally { await f.close(); }
});

test('API exposes settings, analytics, reminders, and exports', async () => {
  const f = await fixture();
  try {
    await api(f.base, '/api/v1/checkins', { method: 'POST', body: JSON.stringify(body) });
    let response = await api(f.base, '/api/v1/settings', { method: 'PUT', body: JSON.stringify({ dayTime: '12:30' }) });
    assert.equal((await response.json()).dayTime, '12:30');
    response = await api(f.base, '/api/v1/analytics');
    assert.equal((await response.json()).count, 1);
    response = await api(f.base, '/api/v1/reminders/snooze', { method: 'POST', body: JSON.stringify({localDate:'2026-07-31',slot:'22:00',minutes:15}) });
    assert.equal(response.status, 200);
    response = await api(f.base, '/api/v1/export.csv');
    const csv = await response.text();
    assert.match(csv, /localDate,slot/);
    assert.match(csv, /2026-07-31/);
  } finally { await f.close(); }
});

test('API rejects oversized JSON bodies', async () => {
  const f = await fixture();
  try {
    const response = await api(f.base, '/api/v1/checkins', { method: 'POST', body: JSON.stringify({notes:'x'.repeat(300000)}) });
    assert.equal(response.status, 413);
  } finally { await f.close(); }
});

test('API requests a durable backup after meaningful data changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-api-backup-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  let persisted = 0;
  const app = createHttpServer({ repo, token: 'secret-token', dataDir: dir, onPersisted: async () => { persisted += 1; } });
  await app.listen(0);
  const base = `http://127.0.0.1:${app.port}`;
  try {
    let response = await api(base, '/api/v1/checkins', { method: 'POST', body: JSON.stringify(body) });
    const saved = await response.json();
    await api(base, '/api/v1/settings', { method: 'PUT', body: JSON.stringify({ dayTime: '12:45' }) });
    await api(base, `/api/v1/checkins/${saved.id}`, { method: 'DELETE' });
    assert.equal(persisted, 3);
  } finally {
    await app.close(); repo.close(); rmSync(dir, { recursive: true, force: true });
  }
});


test('browser UI requires a valid launch token and serves local assets', async () => {
  const f = await fixture();
  try {
    let response = await fetch(f.base + '/app/');
    assert.equal(response.status, 401);

    response = await fetch(f.base + '/app/?token=secret-token&view=checkin');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /default-src/);
    const html = await response.text();
    assert.match(html, /Med Check-in 2\.1/);
    assert.doesNotMatch(html, /neutralino/i);

    response = await fetch(f.base + '/app/app.js');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), /checkin-form/);
  } finally { await f.close(); }
});

test('browser asset serving rejects path traversal', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.base + '/app/%2e%2e/backend/main.mjs');
    assert.equal(response.status, 404);
  } finally { await f.close(); }
});


test('host poll drains open and close commands and reports a due reminder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-host-api-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  const actions = createHostActionQueue();
  const controls = [];
  const app = createHttpServer({
    repo, token: 'secret-token', dataDir: dir, resourcesDir: new URL('../resources/', import.meta.url),
    hostActions: actions, now: () => new Date('2026-08-01T13:05:00'),
    onControl: async (command) => controls.push(command)
  });
  await app.listen(0);
  const base = `http://127.0.0.1:${app.port}`;
  try {
    await api(base, '/api/v1/control/show', { method: 'POST' });
    await api(base, '/api/v1/control/close-window', { method: 'POST' });
    let response = await api(base, '/api/v1/host/poll');
    const payload = await response.json();
    assert.deepEqual(payload.actions, [
      { type: 'open', view: 'checkin' },
      { type: 'close-window' }
    ]);
    assert.equal(payload.due.localDate, '2026-08-01');
    assert.equal(payload.due.slot, '13:00');

    response = await api(base, '/api/v1/host/poll');
    assert.deepEqual((await response.json()).actions, []);

    await api(base, '/api/v1/control/heartbeat', { method: 'POST' });
    assert.deepEqual(controls, ['heartbeat']);
  } finally {
    await app.close(); repo.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('host control accepts restart and quit commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'med-checkin-host-control-'));
  const repo = createRepository(join(dir, 'test.sqlite'));
  const controls = [];
  const app = createHttpServer({ repo, token: 'secret-token', dataDir: dir, onControl: async (command) => controls.push(command) });
  await app.listen(0);
  const base = `http://127.0.0.1:${app.port}`;
  try {
    for (const command of ['restart-host', 'quit']) {
      const response = await api(base, `/api/v1/control/${command}`, { method: 'POST' });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(controls, ['restart-host', 'quit']);
  } finally {
    await app.close(); repo.close(); rmSync(dir, { recursive: true, force: true });
  }
});
