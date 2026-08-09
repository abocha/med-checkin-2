import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function chartLite() { const context = { window: {} }; vm.runInNewContext(readFileSync(new URL('../resources/vendor/chart-lite.js', import.meta.url), 'utf8'), context); return context.window.ChartLite; }

test('trend renderer draws selected dynamic series using definition labels', () => {
  const container = { innerHTML: '' };
  chartLite().renderTrend(container, [{ date: '2026-08-01', scales: { mood: 5, 'custom:clarity': 3 }, rolling: { mood: 5, 'custom:clarity': 3 } }], [], ['custom:clarity'], [{ id: 'mood', label: 'Настроение', active: true, sortOrder: 0 }, { id: 'custom:clarity', label: 'Ясность', active: false, sortOrder: 1 }]);
  assert.match(container.innerHTML, /Ясность/);
  assert.doesNotMatch(container.innerHTML, /Настроение/);
  assert.equal((container.innerHTML.match(/<path /g) || []).length, 1);
});

test('trend renderer ignores unknown selected IDs and handles empty selection', () => {
  const container = { innerHTML: '' };
  chartLite().renderTrend(container, [{ date: '2026-08-01', scales: { mood: 5 } }], [], ['unknown'], [{ id: 'mood', label: 'Настроение', active: true, sortOrder: 0 }]);
  assert.match(container.innerHTML, /выбери хотя бы один показатель/i);
});
