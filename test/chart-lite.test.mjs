import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function chartLite() { const context = { window: {} }; vm.runInNewContext(readFileSync(new URL('../resources/vendor/chart-lite.js', import.meta.url), 'utf8'), context); return context.window.ChartLite; }

test('emotion graph draws actual zero and isolated points, breaks gaps, and distinguishes no-emotion marker', () => {
  const container = { innerHTML: '' };
  chartLite().renderEmotionalImpact(container, [
    { date: '2026-10-20', status: 'rated', value: 0 },
    { date: '2026-10-21', status: null, value: null },
    { date: '2026-10-22', status: 'none', value: null },
    { date: '2026-10-23', status: 'rated', value: 8 },
    { date: '2026-10-24', status: 'rated', value: 6 }
  ]);
  const line = container.innerHTML.match(/<path d="([^"]*)" fill="none" stroke="#315d69"/)[1];
  assert.equal((line.match(/M /g) || []).length, 2);
  assert.equal((line.match(/L /g) || []).length, 1);
  assert.equal((container.innerHTML.match(/<circle /g) || []).length, 3);
  assert.match(container.innerHTML, /cy="255"/); // Actual 0, not default midpoint or smoothed value.
  assert.match(container.innerHTML, /l 5 5 l -5 5 l -5 -5 Z/);
  assert.match(container.innerHTML, /<table/);
  assert.match(container.innerHTML, /Нет вечерней оценки/);
  chartLite().renderEmotionalImpact(container, [{ date: '2026-10-20', status: 'rated', value: 0 }]);
  assert.equal((container.innerHTML.match(/<circle /g) || []).length, 1);
});

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
