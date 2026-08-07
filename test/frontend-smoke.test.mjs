import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../resources/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../resources/app.js', import.meta.url), 'utf8');
const startup = readFileSync(new URL('../resources/startup-runtime.js', import.meta.url), 'utf8');

test('frontend contains all primary views and core check-in controls', () => {
  for (const id of ['view-checkin','view-history','view-analytics','view-settings','checkin-form','save-checkin']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const name of ['mood','anxiety','irritability','energy','focus','functioning','sleepQuality','appetite']) {
    assert.match(html, new RegExp(`name=["']${name}["']`));
  }
});

test('frontend exposes semantic Day, Evening, Extra, missed-entry, and draft-recovery controls', () => {
  for (const id of ['day-checkin', 'evening-checkin', 'extra-checkin', 'use-previous-values', 'add-missed-checkin']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /draft-store\.js/);
  assert.match(js, /error\.status === 409/);
  assert.match(js, /MedCheckinDrafts/);
  assert.match(js, /beforeunload/);
});

test('frontend exposes bounded history filters, treatment events, and completion analytics', () => {
  for (const id of ['history-range', 'history-period', 'history-from', 'history-to', 'load-more-history', 'treatment-events', 'add-treatment-event', 'completion-stats']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(js, /treatment-events/);
  assert.match(js, /treatmentMarkers/);
  assert.match(js, /scheduledFor/);
  assert.match(js, /observedAt/);
});

test('frontend includes secondary sleep, context, symptom, activation, and red flag fields', () => {
  for (const name of ['nightSleepHours','daySleepHours','sleepStart','wakeTime','notes','redFlags']) {
    assert.match(html, new RegExp(`name=["']${name}["']`));
  }
  assert.match(html, /data-flag-group="context"/);
  assert.match(html, /data-flag-group="symptoms"/);
  assert.match(html, /data-flag-group="activation"/);
});

test('frontend is browser-hosted and contains no Neutralino runtime calls', () => {
  assert.doesNotMatch(html, /neutralino\.js/i);
  assert.doesNotMatch(js, /Neutralino/);
  assert.match(js, /EventSource/);
  assert.match(js, /window\.close/);
  assert.match(js, /URL\.createObjectURL/);
  assert.match(js, /control\/close-window/);
});

test('browser startup reads and removes the bearer token from the URL', () => {
  assert.match(startup, /sessionStorage/);
  assert.match(startup, /searchParams\.get\(['"]token['"]\)/);
  assert.match(startup, /history\.replaceState/);
  assert.match(startup, /readBrowserRuntime/);
});

test('backend serves the browser UI instead of launching Neutralino', () => {
  const main = readFileSync(new URL('../backend/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /resourcesDir/);
});


test('backend supervises the PowerShell tray host and stores host runtime state', () => {
  const main = readFileSync(new URL('../backend/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /WindowsPowerShell/);
  assert.match(main, /tray-host\.ps1/);
  assert.match(main, /-STA/);
  assert.match(main, /-AppRoot/);
  assert.match(main, /-Show/);
  assert.match(main, /hostPid/);
  assert.match(main, /hostHeartbeatAt/);
  assert.doesNotMatch(main, /neutralino/i);
  assert.doesNotMatch(main, /frontendHeartbeatAt/);
});
