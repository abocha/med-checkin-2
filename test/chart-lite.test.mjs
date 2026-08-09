import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function chartLite() {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../resources/vendor/chart-lite.js', import.meta.url), 'utf8'), context);
  return context.window.ChartLite;
}

test('trend renderer draws only selected valid eight-scale series', () => {
  const container = { innerHTML: '' };
  chartLite().renderTrend(container, [
    { date: '2026-08-01', anxiety: 2, sleepQuality: 7, mood: 5, energy: 6, focus: 5, functioning: 6 },
    { date: '2026-08-02', anxiety: 3, sleepQuality: 8, mood: 6, energy: 7, focus: 6, functioning: 7 }
  ], [], ['anxiety', 'sleepQuality', 'unknown']);
  assert.match(container.innerHTML, /Тревога/);
  assert.match(container.innerHTML, /Сон/);
  assert.doesNotMatch(container.innerHTML, /Настроение/);
  assert.doesNotMatch(container.innerHTML, /Энергия/);
  assert.equal((container.innerHTML.match(/<path /g) || []).length, 2);
});

test('trend renderer shows an empty selection instruction without throwing', () => {
  const container = { innerHTML: '' };
  chartLite().renderTrend(container, [{ date: '2026-08-01', mood: 5 }], [], []);
  assert.match(container.innerHTML, /выбери хотя бы один показатель/i);
});
