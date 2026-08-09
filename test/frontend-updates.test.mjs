import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadPresentation() {
  const hook = {};
  const context = {
    __MED_CHECKIN_TEST__: hook,
    document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    window: { addEventListener() {} },
    MedCheckinStartup: {},
    MedCheckinDrafts: {},
    ChartLite: {},
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL('../resources/app.js', import.meta.url), 'utf8'), context);
  return hook.updatePresentation;
}

test('updatePresentation reports a current installation positively', () => {
  const updatePresentation = loadPresentation();
  assert.equal(typeof updatePresentation, 'function');
  assert.match(updatePresentation({
    installedVersion: '2.4.1',
    phase: 'current',
    lastCheckedAt: '2026-08-10T03:51:00.000Z',
    availableVersion: null,
    releaseNotes: null,
    error: null
  }).statusText, /последняя версия/i);
});

test('updatePresentation describes transitional updater phases', () => {
  const updatePresentation = loadPresentation();
  assert.match(updatePresentation({ installedVersion: '2.4.0', phase: 'downloading', availableVersion: '2.4.1', releaseNotes: 'notes', error: null }).statusText, /скачиваем|проверяем/i);
  assert.match(updatePresentation({ installedVersion: '2.4.0', phase: 'launching', availableVersion: '2.4.1', releaseNotes: 'notes', error: null }).statusText, /запускаем установщик/i);
  assert.match(updatePresentation({ installedVersion: '2.4.0', phase: 'installing', availableVersion: '2.4.1', releaseNotes: 'notes', error: null }).statusText, /перезапуст/i);
});

test('updatePresentation keeps a failed available update retryable', () => {
  const presentation = loadPresentation()({ phase: 'available', availableVersion: '2.4.1', error: 'launch failed' });
  assert.equal(presentation.showInstall, true);
  assert.equal(presentation.installDisabled, false);
  assert.equal(presentation.statusText, 'launch failed');
});
