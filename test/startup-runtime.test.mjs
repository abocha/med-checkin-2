import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadStartupRuntime() {
  const source = readFileSync(new URL('../resources/startup-runtime.js', import.meta.url), 'utf8');
  const context = vm.createContext({ globalThis: {}, URL, URLSearchParams });
  vm.runInContext(source, context, { filename: 'startup-runtime.js' });
  return context.globalThis.MedCheckinStartup;
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); }
  };
}

test('browser runtime reads token and route from URL and persists token in the session', () => {
  const startup = loadStartupRuntime();
  const storage = memoryStorage();
  const runtime = startup.readBrowserRuntime({
    href: 'http://127.0.0.1:27841/app/?token=token-123&view=history&date=2026-08-01&slot=22%3A00',
    origin: 'http://127.0.0.1:27841'
  }, storage);

  assert.equal(runtime.token, 'token-123');
  assert.equal(runtime.apiBase, 'http://127.0.0.1:27841');
  assert.equal(runtime.view, 'history');
  assert.equal(runtime.localDate, '2026-08-01');
  assert.equal(runtime.slot, '22:00');
  assert.equal(storage.snapshot()['med-checkin-token'], 'token-123');
  assert.equal(runtime.cleanUrl, '/app/?view=history&date=2026-08-01&slot=22%3A00');
});

test('browser runtime can reload from session storage after token is removed from URL', () => {
  const startup = loadStartupRuntime();
  const storage = memoryStorage({ 'med-checkin-token': 'saved-token' });
  const runtime = startup.readBrowserRuntime({
    href: 'http://127.0.0.1:27841/app/?view=analytics',
    origin: 'http://127.0.0.1:27841'
  }, storage);
  assert.equal(runtime.token, 'saved-token');
  assert.equal(runtime.view, 'analytics');
});

test('applyBrowserRuntime scrubs the token from browser history', () => {
  const startup = loadStartupRuntime();
  const calls = [];
  const windowLike = {
    location: {
      href: 'http://127.0.0.1:27841/app/?token=secret&view=checkin',
      origin: 'http://127.0.0.1:27841'
    },
    sessionStorage: memoryStorage(),
    history: { replaceState(_state, _title, url) { calls.push(url); } }
  };
  const runtime = startup.applyBrowserRuntime(windowLike);
  assert.equal(runtime.token, 'secret');
  assert.deepEqual(calls, ['/app/?view=checkin']);
});
