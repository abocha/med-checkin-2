/* global ChartLite, MedCheckinStartup, MedCheckinDrafts */
const state = {
  apiBase: null, token: null, settings: null, currentDate: null, currentKind: 'scheduled', currentPeriod: 'day',
  currentRecord: null, activeReminder: null, eventSource: null, toastTimer: null, extraDraftKey: null,
  dirty: false, draftTimer: null, pauseTimer: null, suppressDirty: false, historyOffset: 0, historyItems: [], treatmentEvents: [], pendingImport: null,
  trackedItems: [], scaleDefinitions: [], selectedTrendFields: [], analyticsData: null, staleDraftFlags: [], staleDraftScaleIds: [], restoredDraftScaleSnapshot: null, updates: null
};
const trackedCategoryLabels = { context: 'Контекст дня', symptoms: 'Телесные и побочные симптомы', activation: 'Необычная активация' };

function $(selector, root = document) { return root.querySelector(selector); }
function $$(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function niceDate(value) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
function round(value) { return value == null ? '—' : Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function slotPeriod(slot) { return slot === '22:00' ? 'evening' : 'day'; }
function periodLabel(period) { return period === 'evening' ? 'Вечер' : 'День'; }
function timeForPeriod(period) { return period === 'evening' ? state.settings?.eveningTime : state.settings?.dayTime; }
function localDateTimeValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function isoFromLocalDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function dateDaysBefore(value, days) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() - days); return localDate(date); }
function formatStoredTime(value, { date = false } = {}) {
  return new Date(value).toLocaleString('ru-RU', date ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
}
function regimenText(regimen = []) { return regimen.length ? regimen.map(item => `${item.name} ${item.amount} ${item.unit}${item.timing ? ` · ${item.timing}` : ''}`).join(' · ') : 'Нет активных препаратов'; }
function scaleDefinitionMap() { return new Map(state.scaleDefinitions.map(definition => [definition.id, definition])); }
function activeScaleDefinitions() { return state.scaleDefinitions.filter(definition => definition.active).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)); }
function orderedDefinitionsForIds(ids = []) {
  const wanted = [...new Set(ids)]; const map = scaleDefinitionMap();
  return wanted.map((id, index) => map.get(id) || { id, label: `${id} (неизвестная шкала)`, active: false, sortOrder: 100000 + index })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
function currentRenderedScaleIds() { return $$('input[type="range"]').map(input => input.name).filter(Boolean); }
function clearScaleValue(event) {
  const id = event.currentTarget.dataset.scaleClear;
  const form = $('#checkin-form');
  const input = form?.elements?.[id];
  if (!input) return;
  setScale(input, null);
  markDirty();
}
function renderedScaleState() {
  const form = $('#checkin-form');
  const ids = currentRenderedScaleIds();
  return {
    ids,
    values: Object.fromEntries(ids.map(id => [id, form?.elements?.[id]?.value])),
    chosenIds: ids.filter(id => form?.elements?.[id]?.dataset?.chosen === 'true')
  };
}
function renderScaleInputs(ids = activeScaleDefinitions().map(definition => definition.id), { values = {}, chosenIds = null } = {}) {
  const container = $('#scale-inputs');
  const definitions = orderedDefinitionsForIds(ids);
  if (container) {
    const canClear = state.currentKind === 'extra';
    container.innerHTML = definitions.map(definition => `<label class="scale-row${definition.active ? '' : ' archived'}"><span>${escapeHtml(definition.label)}${definition.active ? '' : ' <small>(архивная)</small>'}</span><input type="range" name="${escapeHtml(definition.id)}" min="0" max="10" step="1"><output>—</output>${canClear ? `<button type="button" class="ghost scale-clear" data-scale-clear="${escapeHtml(definition.id)}">Очистить</button>` : ''}</label>`).join('');
    $$('[data-scale-clear]', container).forEach(button => button.addEventListener('click', clearScaleValue));
  }
  const form = $('#checkin-form');
  for (const definition of definitions) {
    const escapedId = globalThis.CSS?.escape ? globalThis.CSS.escape(definition.id) : definition.id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const input = form?.elements?.[definition.id] || $(`input[name="${escapedId}"]`);
    if (input) setScale(input, chosenIds === null ? values[definition.id] : (chosenIds.includes(definition.id) ? values[definition.id] : null));
  }
  setRanges();
}
function applyScaleDefinitions(items) {
  state.scaleDefinitions = Array.isArray(items) ? items.map(item => ({ ...item })) : [];
  renderScaleSettings();
  const existing = renderedScaleState();
  const preservedScheduled = state.currentKind === 'scheduled' && (state.currentRecord?.id || state.restoredDraftScaleSnapshot);
  if (preservedScheduled) {
    const ids = existing.ids.length ? existing.ids : (state.currentRecord?.scales ? Object.keys(state.currentRecord.scales) : state.restoredDraftScaleSnapshot);
    const fallbackValues = state.currentRecord?.scales || {};
    const values = existing.ids.length ? existing.values : fallbackValues;
    const chosenIds = existing.ids.length ? existing.chosenIds : Object.keys(fallbackValues);
    renderScaleInputs(ids, { values, chosenIds });
  }
  const pristineNewScheduled = state.currentKind === 'scheduled' && !state.currentRecord?.id && !state.dirty && !state.restoredDraftScaleSnapshot;
  if (pristineNewScheduled) {
    renderScaleInputs(activeScaleDefinitions().map(definition => definition.id));
  } else if (state.currentKind === 'scheduled' && !state.currentRecord?.id && (state.dirty || state.restoredDraftScaleSnapshot)) {
    $('#save-status').textContent = 'Настройки шкал изменились; текущий черновик сохранён без изменений.';
    toast('Настройки шкал изменились. Текущая запись сохранена без изменений.');
  }
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${state.token}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

function setConnection(online) {
  $('#connection-dot').classList.toggle('online', online);
  $('#connection-label').textContent = online ? 'Работает локально' : 'Нет связи с ядром';
}

function renderUpdates() {
  const update = state.updates;
  if (!update) return;
  $('#installed-version').textContent = `Версия ${update.installedVersion}`;
  const checked = update.lastCheckedAt ? `Последняя проверка: ${formatStoredTime(update.lastCheckedAt, { date: true })}.` : 'Проверка обновлений ещё не выполнялась.';
  const available = update.availableVersion ? ` Доступна версия ${update.availableVersion}.` : '';
  $('#update-status').textContent = update.error ? update.error : `${checked}${available}`;
  const notes = $('#update-notes'); notes.textContent = update.releaseNotes || ''; notes.hidden = !update.releaseNotes;
  $('#install-update').hidden = !update.availableVersion;
  $('#update-available').classList.toggle('hidden', !update.availableVersion);
}

async function checkUpdates() { try { state.updates = await api('/api/v1/updates/check', { method: 'POST' }); renderUpdates(); } catch (error) { toast(`Не удалось проверить обновления: ${error.message}`); } }
async function installUpdate() { try { state.updates = await api('/api/v1/updates/install', { method: 'POST' }); renderUpdates(); toast('Подготовка обновления…'); } catch (error) { toast(`Не удалось подготовить обновление: ${error.message}`); } }

function trackedItemsFor(category, selected = []) {
  const selectedSet = new Set(selected);
  return state.trackedItems.filter(item => item.category === category && (item.active || selectedSet.has(item.id)));
}

function currentFlagSelections() {
  return Object.fromEntries(['context', 'symptoms', 'activation'].map(category => [category, selectedFlags(category)]));
}

function findStaleDraftFlags(values = {}, trackedItems = state.trackedItems) {
  const known = new Map((trackedItems || []).map(item => [item.id, item.category]));
  return Object.keys(trackedCategoryLabels).flatMap(category => (values[category] || [])
    .filter(id => known.get(id) !== category)
    .map(id => ({ category, id })));
}

function buildDraftFlagValues(values = {}, staleFlags = []) {
  const result = Object.fromEntries(Object.keys(trackedCategoryLabels).map(category => [category, [...new Set(values[category] || [])]]));
  for (const stale of staleFlags || []) {
    if (result[stale.category] && typeof stale.id === 'string' && !result[stale.category].includes(stale.id)) result[stale.category].push(stale.id);
  }
  return result;
}

if (globalThis.__MED_CHECKIN_TEST__) {
  globalThis.__MED_CHECKIN_TEST__.draftLifecycle = { state, restoreDraft, persistDraft, validForSave, discardDraft, markDirty, normalizeDraftScaleState, findStaleDraftScaleIds, renderScaleInputs, applyScaleDefinitions };
}

function renderTrackedItems(selected = currentFlagSelections()) {
  for (const category of Object.keys(trackedCategoryLabels)) {
    const container = $(`[data-flag-group="${category}"]`);
    if (!container) continue;
    container.innerHTML = trackedItemsFor(category, selected[category] || []).map(item => `<label class="tracked-item${item.active ? '' : ' archived'}"><input type="checkbox" value="${escapeHtml(item.id)}"${selected[category]?.includes(item.id) ? ' checked' : ''}> ${escapeHtml(item.label)}${item.active ? '' : ' <small>(архивная)</small>'}</label>`).join('') || '<span class="muted">Нет доступных отметок.</span>';
  }
}

function renderTrackedSettings() {
  const root = $('#tracked-items-settings');
  if (!root) return;
  root.innerHTML = Object.entries(trackedCategoryLabels).map(([category, heading]) => {
    const items = state.trackedItems.filter(item => item.category === category);
    return `<section class="tracked-settings-group" data-settings-group="${category}"><div class="section-heading"><h4>${heading}</h4><form class="tracked-add-form" data-add-tracked-category="${category}"><input name="label" type="text" maxlength="120" required placeholder="Новая отметка"><button type="submit" class="secondary">Добавить</button></form></div><div class="tracked-settings-list">${items.map((item, index) => `<div class="tracked-settings-row${item.active ? '' : ' archived'}" data-tracked-id="${escapeHtml(item.id)}"><input type="text" data-tracked-label value="${escapeHtml(item.label)}"><label><input type="checkbox" data-tracked-active${item.active ? ' checked' : ''}> активна</label><button type="button" class="ghost" data-tracked-save>Сохранить</button><button type="button" class="ghost" data-tracked-up="${index > 0 ? '' : 'disabled'}"${index > 0 ? '' : ' disabled'}>↑</button><button type="button" class="ghost" data-tracked-down="${index < items.length - 1 ? '' : 'disabled'}"${index < items.length - 1 ? '' : ' disabled'}>↓</button></div>`).join('') || '<p class="muted">Нет отметок.</p>'}</div></section>`;
  }).join('');
  $$('[data-add-tracked-category]', root).forEach(form => form.addEventListener('submit', addTrackedItem));
  $$('[data-tracked-save]', root).forEach(button => button.addEventListener('click', saveTrackedItem));
  $$('[data-tracked-up]', root).forEach(button => button.addEventListener('click', event => moveTrackedItem(event, -1)));
  $$('[data-tracked-down]', root).forEach(button => button.addEventListener('click', event => moveTrackedItem(event, 1)));
}

function renderScaleSettings() {
  const root = $('#scale-definitions-settings');
  if (!root) return;
  const active = activeScaleDefinitions();
  const archived = state.scaleDefinitions.filter(item => !item.active).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  root.innerHTML = `<form class="tracked-add-form scale-add-form"><input name="label" type="text" maxlength="120" required placeholder="Новая шкала"><button type="submit" class="secondary">Добавить</button></form><div class="tracked-settings-list">${active.map((item, index) => `<div class="tracked-settings-row" data-scale-id="${escapeHtml(item.id)}"><input type="text" data-scale-label value="${escapeHtml(item.label)}"><button type="button" class="ghost" data-scale-save>Сохранить</button><button type="button" class="ghost" data-scale-up${index ? '' : ' disabled'}>↑</button><button type="button" class="ghost" data-scale-down${index < active.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="ghost" data-scale-archive${active.length === 1 ? ' disabled' : ''}>Архивировать</button></div>`).join('') || '<p class="muted">Нет активных шкал.</p>'}</div><h4>Архивные</h4><div class="tracked-settings-list">${archived.map(item => `<div class="tracked-settings-row archived" data-scale-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.label)}</span><button type="button" class="ghost" data-scale-restore>Вернуть</button></div>`).join('') || '<p class="muted">Нет архивных шкал.</p>'}</div>`;
  root.querySelector('form')?.addEventListener('submit', addScaleDefinition);
  $$('[data-scale-save]', root).forEach(button => button.addEventListener('click', saveScaleDefinition));
  $$('[data-scale-up]', root).forEach(button => button.addEventListener('click', event => moveScaleDefinition(event, -1)));
  $$('[data-scale-down]', root).forEach(button => button.addEventListener('click', event => moveScaleDefinition(event, 1)));
  $$('[data-scale-archive]', root).forEach(button => button.addEventListener('click', event => updateScaleDefinition(event, false)));
  $$('[data-scale-restore]', root).forEach(button => button.addEventListener('click', event => updateScaleDefinition(event, true)));
}
async function addScaleDefinition(event) {
  event.preventDefault(); const label = event.currentTarget.elements.label.value;
  try { const result = await api('/api/v1/scale-definitions', { method: 'POST', body: JSON.stringify({ label }) }); applyScaleDefinitions(result.scaleDefinitions); event.currentTarget.reset(); toast('Шкала добавлена'); }
  catch (error) { toast(`Не удалось добавить шкалу: ${error.message}`); }
}
async function saveScaleDefinition(event) {
  const row = event.currentTarget.closest('[data-scale-id]');
  try { const result = await api(`/api/v1/scale-definitions/${encodeURIComponent(row.dataset.scaleId)}`, { method: 'PUT', body: JSON.stringify({ label: row.querySelector('[data-scale-label]').value }) }); applyScaleDefinitions(result.scaleDefinitions); toast('Шкала обновлена'); }
  catch (error) { toast(`Не удалось обновить шкалу: ${error.message}`); }
}
async function updateScaleDefinition(event, active) {
  const row = event.currentTarget.closest('[data-scale-id]');
  try { const result = await api(`/api/v1/scale-definitions/${encodeURIComponent(row.dataset.scaleId)}`, { method: 'PUT', body: JSON.stringify({ active }) }); applyScaleDefinitions(result.scaleDefinitions); toast(active ? 'Шкала возвращена' : 'Шкала архивирована'); }
  catch (error) { toast(`Не удалось изменить шкалу: ${error.message}`); }
}
async function moveScaleDefinition(event, delta) {
  const id = event.currentTarget.closest('[data-scale-id]').dataset.scaleId; const ids = activeScaleDefinitions().map(item => item.id); const index = ids.indexOf(id); const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return; [ids[index], ids[target]] = [ids[target], ids[index]];
  try { const result = await api('/api/v1/scale-definitions/order', { method: 'PUT', body: JSON.stringify({ ids }) }); applyScaleDefinitions(result.scaleDefinitions); }
  catch (error) { toast(`Не удалось изменить порядок: ${error.message}`); }
}

function applyTrackedItems(items) {
  const selected = currentFlagSelections();
  state.trackedItems = Array.isArray(items) ? items : [];
  renderTrackedItems(selected);
  renderTrackedSettings();
}

async function addTrackedItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await api('/api/v1/tracked-items', { method: 'POST', body: JSON.stringify({ category: form.dataset.addTrackedCategory, label: form.elements.label.value }) });
    applyTrackedItems(result.items); form.reset(); toast('Отметка добавлена');
  } catch (error) { toast(`Не удалось добавить отметку: ${error.message}`); }
}

async function saveTrackedItem(event) {
  const row = event.currentTarget.closest('[data-tracked-id]');
  try {
    const result = await api(`/api/v1/tracked-items/${encodeURIComponent(row.dataset.trackedId)}`, { method: 'PUT', body: JSON.stringify({ label: row.querySelector('[data-tracked-label]').value, active: row.querySelector('[data-tracked-active]').checked }) });
    applyTrackedItems(result.items); toast('Отметка обновлена');
  } catch (error) { toast(`Не удалось обновить отметку: ${error.message}`); }
}

async function moveTrackedItem(event, delta) {
  const row = event.currentTarget.closest('[data-tracked-id]');
  const category = event.currentTarget.closest('[data-settings-group]').dataset.settingsGroup;
  const ids = state.trackedItems.filter(item => item.category === category).map(item => item.id);
  const index = ids.indexOf(row.dataset.trackedId); const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  try { const result = await api('/api/v1/tracked-items/order', { method: 'PUT', body: JSON.stringify({ category, ids }) }); applyTrackedItems(result.items); }
  catch (error) { toast(`Не удалось изменить порядок: ${error.message}`); }
}

async function switchView(name) {
  if (name !== 'checkin' && !await confirmLeavingDirty()) return;
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === name));
  if (name === 'history') loadHistory();
  if (name === 'analytics') loadAnalytics();
  if (name === 'settings') fillSettings();
}

function selectedFlags(group) { return $$(`[data-flag-group="${group}"] input:checked`).map(input => input.value); }
function setFlags(group, values = []) {
  const selected = new Set(values || []);
  $$(`[data-flag-group="${group}"] input`).forEach(input => { input.checked = selected.has(input.value); });
}

function renderScale(input) {
  const output = input.parentElement.querySelector('output');
  const chosen = input.dataset.chosen === 'true';
  output.value = chosen ? input.value : '—';
  output.textContent = chosen ? input.value : '—';
  input.parentElement.classList.toggle('unset', !chosen);
}

function setScale(input, value) {
  if (value === null || value === undefined || value === '') delete input.dataset.chosen;
  else { input.value = value; input.dataset.chosen = 'true'; }
  renderScale(input);
}

function setRanges() {
  $$('input[type="range"]').forEach(input => {
    if (!input.dataset.wired) {
      input.dataset.wired = 'true';
      input.addEventListener('input', () => { input.dataset.chosen = 'true'; renderScale(input); markDirty(); });
    }
    renderScale(input);
  });
}

function draftKey() {
  if (state.currentRecord?.id) return MedCheckinDrafts.checkinKey(state.currentRecord.id);
  if (state.currentKind === 'extra') return MedCheckinDrafts.extraKey(state.extraDraftKey);
  return MedCheckinDrafts.scheduledKey(state.currentDate, state.currentPeriod);
}

function makeExtraDraftKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resetForm({ kind = 'scheduled', period = 'day', date = localDate(), scheduledFor = null, observedAt = undefined } = {}) {
  const form = $('#checkin-form');
  state.suppressDirty = true;
  renderTrackedItems({ context: [], symptoms: [], activation: [] });
  form.reset();
  state.currentKind = kind;
  state.currentPeriod = kind === 'scheduled' ? period : null;
  state.currentDate = date;
  state.extraDraftKey = kind === 'extra' ? localStorage.getItem('med-checkin-extra-draft-key') || makeExtraDraftKey() : null;
  form.elements.kind.value = kind;
  form.elements.period.value = state.currentPeriod || '';
  form.elements.localDate.value = date;
  form.elements.scheduledFor.value = scheduledFor || '';
  const effectiveObservedAt = observedAt === undefined ? new Date().toISOString() : observedAt;
  form.elements.observedAt.value = effectiveObservedAt ?? '';
  form.elements.observedAtLocal.value = effectiveObservedAt ? localDateTimeValue(effectiveObservedAt) : '';
  renderScaleInputs(activeScaleDefinitions().map(definition => definition.id));
  setFlags('context'); setFlags('symptoms'); setFlags('activation');
  state.currentRecord = null;
  state.staleDraftFlags = [];
  state.staleDraftScaleIds = [];
  state.restoredDraftScaleSnapshot = null;
  state.dirty = false;
  $('#edit-state').textContent = kind === 'extra' ? 'Новая дополнительная запись' : 'Новая запись';
  $('#save-status').textContent = 'Изменения ещё не сохранены';
  $('#use-previous-values').hidden = kind !== 'scheduled';
  $('#checkin-kicker').textContent = kind === 'extra' ? 'наблюдение вне расписания' : 'запланированный чек-ин';
  $('#checkin-title').textContent = kind === 'extra' ? 'Дополнительная запись' : period === 'day' ? 'Дневной чек-ин' : 'Вечерний чек-ин';
  $('#checkin-subtitle').textContent = kind === 'extra' ? `Наблюдение: ${new Date(form.elements.observedAt.value).toLocaleString('ru-RU')}` : `${niceDate(date)} · ${timeForPeriod(period) || '—'}`;
  $$('[data-entry-kind]').forEach(button => button.classList.toggle('active', button.dataset.entryKind === kind && (kind === 'extra' || button.dataset.period === period)));
  state.suppressDirty = false;
}

function fillForm(record) {
  resetForm({
    kind: record.kind,
    period: record.period,
    date: record.localDate,
    scheduledFor: record.scheduledFor,
    observedAt: record.observedAt
  });
  renderTrackedItems({ context: record.context, symptoms: record.symptoms, activation: record.activation });
  const ids = record.kind === 'scheduled' ? Object.keys(record.scales || {}) : [...new Set([...activeScaleDefinitions().map(definition => definition.id), ...Object.keys(record.scales || {})])];
  renderScaleInputs(ids, { values: record.scales || {}, chosenIds: Object.keys(record.scales || {}) });
  const form = $('#checkin-form');
  state.suppressDirty = true;
  state.currentRecord = record;
  state.extraDraftKey = null;
  for (const [name, value] of Object.entries(record)) {
    if (form.elements[name] && !Array.isArray(value) && !(name in (record.scales || {}))) form.elements[name].value = value ?? '';
  }
  setFlags('context', record.context); setFlags('symptoms', record.symptoms); setFlags('activation', record.activation);
  state.dirty = false;
  $('#edit-state').textContent = 'Редактирование';
  $('#save-status').textContent = `Сохранено ${new Date(record.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  state.suppressDirty = false;
}

function draftValues() {
  const form = $('#checkin-form');
  const values = Object.fromEntries(new FormData(form).entries());
  for (const name of currentRenderedScaleIds()) delete values[name];
  Object.assign(values, buildDraftFlagValues({ context: selectedFlags('context'), symptoms: selectedFlags('symptoms'), activation: selectedFlags('activation') }, state.staleDraftFlags));
  values.scaleSnapshot = currentRenderedScaleIds();
  values.scales = Object.fromEntries(currentRenderedScaleIds().filter(name => form.elements[name]?.dataset.chosen === 'true').map(name => [name, Number(form.elements[name].value)]));
  values.scalesChosen = Object.fromEntries(currentRenderedScaleIds().map(name => [name, form.elements[name]?.dataset.chosen === 'true']));
  return values;
}

function persistDraft() {
  if (!state.dirty) return;
  if (state.currentKind === 'extra') localStorage.setItem('med-checkin-extra-draft-key', state.extraDraftKey);
  MedCheckinDrafts.write(draftKey(), { values: draftValues(), savedAt: new Date().toISOString() });
}

function markDirty() {
  if (state.suppressDirty) return;
  state.dirty = true;
  $('#save-status').textContent = 'Несохранённые изменения';
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(persistDraft, 300);
}

function discardDraft() {
  clearTimeout(state.draftTimer);
  MedCheckinDrafts.remove(draftKey());
  if (state.currentKind === 'extra') localStorage.removeItem('med-checkin-extra-draft-key');
  state.staleDraftFlags = [];
  state.staleDraftScaleIds = [];
  state.restoredDraftScaleSnapshot = null;
  if (state.currentKind === 'scheduled' && !state.currentRecord?.id) renderScaleInputs(activeScaleDefinitions().map(definition => definition.id));
  state.dirty = false;
}

function restoreDraft(draft) {
  const form = $('#checkin-form');
  state.suppressDirty = true;
  const normalized = normalizeDraftScaleState(draft.values || {});
  renderScaleInputs(normalized.scaleSnapshot, { values: normalized.scales, chosenIds: normalized.chosenIds });
  for (const [name, value] of Object.entries(draft.values)) {
    if (form.elements[name] && !Array.isArray(value) && name !== 'scalesChosen') form.elements[name].value = value ?? '';
  }
  state.staleDraftFlags = findStaleDraftFlags(draft.values);
  state.staleDraftScaleIds = findStaleDraftScaleIds(draft.values);
  state.restoredDraftScaleSnapshot = normalized.scaleSnapshot;
  setFlags('context', draft.values.context); setFlags('symptoms', draft.values.symptoms); setFlags('activation', draft.values.activation);
  state.suppressDirty = false;
  state.dirty = true;
  $('#save-status').textContent = 'Восстановлен черновик';
  if (state.staleDraftFlags.length || state.staleDraftScaleIds.length) toast('Черновик содержит неизвестные отметки после импорта. Отбрось черновик и начни запись заново.');
}

function findStaleDraftScaleIds(values = {}) {
  const known = scaleDefinitionMap();
  const snapshot = values.scaleSnapshot || Object.keys(values.scales || {});
  return [...new Set([...snapshot, ...Object.keys(values.scales || {})].filter(id => !known.has(id)))];
}
function normalizeDraftScaleState(values = {}) {
  const legacyIds = ['mood','anxiety','irritability','energy','focus','functioning','sleepQuality','appetite'];
  const snapshot = Array.isArray(values.scaleSnapshot) && values.scaleSnapshot.length ? [...new Set(values.scaleSnapshot)] : (values.scales && typeof values.scales === 'object' ? Object.keys(values.scales) : legacyIds);
  const scales = values.scales && typeof values.scales === 'object' ? { ...values.scales } : Object.fromEntries(legacyIds.filter(id => values[id] !== undefined && values[id] !== '').map(id => [id, Number(values[id])]));
  const hasChosenState = values.scalesChosen !== null && typeof values.scalesChosen === 'object' && !Array.isArray(values.scalesChosen);
  const chosenIds = Object.keys(values.scalesChosen || {}).filter(id => values.scalesChosen[id] && Object.hasOwn(scales, id));
  return { scaleSnapshot: snapshot, scales, chosenIds: hasChosenState ? chosenIds : Object.keys(scales) };
}

function chooseDialog(id, fallback) {
  const dialog = $(id);
  if (!dialog?.showModal) return Promise.resolve(fallback());
  return new Promise(resolve => {
    const onClick = event => {
      const value = event.target.closest('button')?.value;
      if (value) dialog.close(value);
    };
    const onClose = () => {
      dialog.removeEventListener('click', onClick);
      resolve(dialog.returnValue || 'cancel');
    };
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', onClose, { once: true });
    dialog.showModal();
  });
}

async function offerDraft() {
  const draft = MedCheckinDrafts.read(draftKey());
  if (!draft?.values) return;
  const age = draft.savedAt ? new Date(draft.savedAt).toLocaleString('ru-RU') : 'неизвестное время';
  $('#draft-dialog-copy').textContent = `Найден черновик (${age}). Восстановить его или отбросить?`;
  const choice = await chooseDialog('#draft-dialog', () => confirm(`Найден черновик (${age}). Восстановить его?`) ? 'restore' : 'discard');
  if (choice === 'restore') restoreDraft(draft);
  if (choice === 'discard') MedCheckinDrafts.remove(draftKey());
}

async function confirmLeavingDirty() {
  if (!state.dirty) return true;
  const choice = await chooseDialog('#dirty-dialog', () => prompt('Есть несохранённые изменения. Введите «сохранить», «отбросить» или «отмена».', 'отмена')?.trim().toLowerCase() === 'сохранить' ? 'save' : 'cancel');
  if (choice === 'save') return saveCheckin(null, { closeOnSuccess: false });
  if (choice === 'discard') { discardDraft(); return true; }
  return false;
}

function formPayload() {
  const form = $('#checkin-form');
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.kind = state.currentKind;
  payload.period = state.currentKind === 'scheduled' ? state.currentPeriod : null;
  payload.scheduledFor = state.currentKind === 'scheduled' ? (payload.scheduledFor || null) : null;
  const explicitObservedAt = isoFromLocalDateTime(payload.observedAtLocal);
  payload.observedAt = explicitObservedAt
    ?? (state.currentRecord?.observedAt === null ? null : (payload.observedAt || new Date().toISOString()));
  payload.localDate = state.currentKind === 'extra' ? localDate(new Date(payload.observedAt)) : state.currentDate;
  for (const name of currentRenderedScaleIds()) delete payload[name];
  payload.scales = Object.fromEntries(currentRenderedScaleIds().filter(name => form.elements[name]?.dataset.chosen === 'true').map(name => [name, Number(form.elements[name].value)]));
  payload.nightSleepHours = payload.nightSleepHours === '' ? null : Number(payload.nightSleepHours);
  payload.daySleepHours = payload.daySleepHours === '' ? null : Number(payload.daySleepHours);
  payload.context = selectedFlags('context'); payload.symptoms = selectedFlags('symptoms'); payload.activation = selectedFlags('activation');
  return payload;
}

function validForSave(payload) {
  if (state.staleDraftFlags.length || state.staleDraftScaleIds.length) { toast('Отбрось черновик с неизвестными отметками и начни запись заново.'); return false; }
  if (payload.kind === 'scheduled' && currentRenderedScaleIds().some(name => payload.scales?.[name] === undefined)) {
    toast('Для запланированного чек-ина выбери все шкалы.');
    return false;
  }
  if (payload.kind === 'scheduled' && !state.currentRecord?.id) {
    const activeIds = activeScaleDefinitions().map(definition => definition.id);
    const submittedIds = Object.keys(payload.scales || {});
    const matchesActive = activeIds.length === submittedIds.length && activeIds.every(id => submittedIds.includes(id));
    if (!matchesActive) {
      toast(state.restoredDraftScaleSnapshot
        ? 'Черновик сохранён, но его набор шкал устарел. Отбрось его и создай новую запись.'
        : 'Для новой запланированной записи выбери все текущие активные шкалы.');
      return false;
    }
  }
  if (payload.kind === 'extra') {
    const legacyScaleMeaningful = !payload.scales && Object.entries(payload).some(([key, value]) => !['id', 'localDate', 'period', 'kind', 'scheduledFor', 'observedAt', 'observedAtLocal', 'nightSleepHours', 'daySleepHours'].includes(key) && Number.isFinite(Number(value)));
    const meaningful = Object.keys(payload.scales || {}).length > 0 || legacyScaleMeaningful
      || payload.nightSleepHours !== null || payload.daySleepHours !== null || payload.sleepStart || payload.wakeTime
      || payload.context.length || payload.symptoms.length || payload.activation.length || payload.notes.trim() || payload.redFlags.trim();
    if (!meaningful) { toast('Добавь хотя бы одно наблюдение в дополнительную запись.'); return false; }
  }
  return true;
}

async function openRecord(record) {
  if (!await confirmLeavingDirty()) return;
  await switchView('checkin');
  fillForm(record);
  await offerDraft();
  window.focus();
}

async function saveCheckin(event, { closeOnSuccess = true } = {}) {
  event?.preventDefault();
  const payload = formPayload();
  if (!validForSave(payload)) return false;
  const button = $('#save-checkin');
  button.disabled = true;
  $('#save-status').textContent = 'Сохраняю…';
  try {
    const path = state.currentRecord?.id ? `/api/v1/checkins/${state.currentRecord.id}` : '/api/v1/checkins';
    const saved = await api(path, { method: state.currentRecord?.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    MedCheckinDrafts.remove(draftKey());
    MedCheckinDrafts.remove(MedCheckinDrafts.checkinKey(saved.id));
    if (state.currentKind === 'extra') localStorage.removeItem('med-checkin-extra-draft-key');
    fillForm(saved);
    state.activeReminder = null;
    $('#reminder-banner').classList.add('hidden');
    toast('Чек-ин сохранён');
    if (closeOnSuccess) setTimeout(closeWindow, 450);
    return true;
  } catch (error) {
    $('#save-status').textContent = 'Не удалось сохранить';
    if (error.status === 409 && error.payload?.existing) {
      const existing = error.payload.existing;
      if (confirm('Такая запланированная запись уже существует. Открыть существующую?')) openRecord(existing);
      return false;
    }
    toast(`Ошибка: ${error.message}`);
    return false;
  } finally { button.disabled = false; }
}

async function loadCheckin(date, period) {
  state.currentDate = date;
  state.currentKind = 'scheduled';
  state.currentPeriod = period;
  try {
    const record = await api(`/api/v1/checkin?date=${encodeURIComponent(date)}&period=${encodeURIComponent(period)}`);
    fillForm(record);
  } catch (error) {
    if (error.status !== 404) throw error;
    const time = timeForPeriod(period);
    resetForm({ kind: 'scheduled', period, date, scheduledFor: time ? isoFromLocalDateTime(`${date}T${time}`) : null });
  }
  await offerDraft();
}

async function startEntry(kind, period = null) {
  if (!await confirmLeavingDirty()) return;
  await switchView('checkin');
  if (kind === 'extra') { resetForm({ kind: 'extra', date: localDate(), observedAt: new Date().toISOString() }); await offerDraft(); }
  else await loadCheckin(state.currentDate || localDate(), period);
}

async function usePreviousValues() {
  try {
    const { items } = await api('/api/v1/checkins?limit=2&kind=scheduled');
    const previous = items.find(item => item.id !== state.currentRecord?.id);
    if (!previous) { toast('Нет предыдущей запланированной записи для копирования.'); return; }
    const form = $('#checkin-form');
    state.suppressDirty = true;
    for (const [name, value] of Object.entries(previous.scales || {})) if (form.elements[name]) setScale(form.elements[name], value);
    state.suppressDirty = false;
    markDirty();
  } catch (error) { toast(`Не удалось получить предыдущие значения: ${error.message}`); }
}

async function addMissedCheckin() {
  const date = prompt('Дата пропущенного чек-ина (ГГГГ-ММ-ДД):', state.currentDate || localDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
  const requested = prompt('Период: день или вечер:', 'день');
  const period = requested?.trim().toLowerCase().startsWith('в') ? 'evening' : requested?.trim().toLowerCase().startsWith('д') ? 'day' : null;
  if (!period) { toast('Выбери «день» или «вечер».'); return; }
  const defaultScheduled = `${date}T${timeForPeriod(period) || (period === 'day' ? '13:00' : '22:00')}`;
  const observed = prompt('Когда наблюдалось состояние (ГГГГ-ММ-ДДTЧЧ:ММ):', localDateTimeValue());
  if (!observed) return;
  const scheduled = prompt('Запланированное время (ГГГГ-ММ-ДДTЧЧ:ММ):', defaultScheduled);
  const observedAt = isoFromLocalDateTime(observed);
  const scheduledFor = isoFromLocalDateTime(scheduled);
  if (!observedAt || !scheduledFor) { toast('Укажи корректные дату и время.'); return; }
  if (!await confirmLeavingDirty()) return;
  await switchView('checkin');
  resetForm({ kind: 'scheduled', period, date, observedAt, scheduledFor });
}

function historyRequest(append) {
  const range = $('#history-range').value;
  const period = $('#history-period').value;
  const query = new URLSearchParams({ limit: '50', offset: String(append ? state.historyOffset : 0) });
  if (range === 'custom') {
    if ($('#history-from').value) query.set('from', $('#history-from').value);
    if ($('#history-to').value) query.set('to', $('#history-to').value);
  } else if (range !== 'all') query.set('from', dateDaysBefore(localDate(), Number(range) - 1));
  if (period === 'extra') query.set('kind', 'extra');
  if (period === 'day' || period === 'evening') { query.set('kind', 'scheduled'); query.set('period', period); }
  return query;
}

function timingLines(item) {
  const lines = [];
  if (item.observedAt) lines.push(`${item.kind === 'extra' ? 'Наблюдалось' : 'Наблюдалось'} ${formatStoredTime(item.observedAt, { date: true })}`);
  if (item.recordedAt) lines.push(`Записано ${formatStoredTime(item.recordedAt, { date: true })}`);
  if (item.updatedAt && item.updatedAt !== item.recordedAt) lines.push(`Изменено ${formatStoredTime(item.updatedAt, { date: true })}`);
  return lines.map(line => `<span>${escapeHtml(line)}</span>`).join('');
}

function renderHistory() {
  const list = $('#history-list');
  if (!state.historyItems.length) { list.innerHTML = '<div class="empty">Пока нет записей по этому фильтру.</div>'; return; }
  list.innerHTML = state.historyItems.map(item => `<article class="history-item">
    <div class="history-date">${escapeHtml(niceDate(item.localDate))}<small>${item.kind === 'extra' ? 'Дополнительная запись' : `${periodLabel(item.period)}${item.scheduledFor ? ` · запланировано ${formatStoredTime(item.scheduledFor)}` : ''}`}</small></div>
    <div><div class="metric-chips">${Object.entries(item.scales || {}).map(([key, value]) => { const definition = scaleDefinitionMap().get(key); return `<span class="metric-chip">${escapeHtml(definition?.label || `${key} (архивная)`)} <b>${round(value)}</b></span>`; }).join('')}</div>${item.notes ? `<p class="muted" style="margin-top:8px">${escapeHtml(item.notes.slice(0, 180))}</p>` : ''}<div class="record-timing">${timingLines(item)}</div></div>
    <div class="button-row"><button type="button" class="secondary" data-edit-id="${item.id}">Открыть</button><button type="button" class="ghost" data-delete-id="${item.id}">Удалить</button></div>
  </article>`).join('');
  $$('[data-edit-id]').forEach(button => button.addEventListener('click', async () => { const record = await api(`/api/v1/checkins/${button.dataset.editId}`); await openRecord(record); }));
  $$('[data-delete-id]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Удалить эту запись без возможности восстановления?')) return;
    await api(`/api/v1/checkins/${button.dataset.deleteId}`, { method: 'DELETE' }); toast('Запись удалена'); loadHistory();
  }));
}

async function loadHistory(append = false) {
  const list = $('#history-list');
  if (!append) { state.historyOffset = 0; state.historyItems = []; list.innerHTML = '<div class="empty">Загружаю записи…</div>'; }
  try {
    const { items } = await api(`/api/v1/checkins?${historyRequest(append)}`);
    state.historyItems.push(...items); state.historyOffset = state.historyItems.length; renderHistory();
    $('#load-more-history').hidden = items.length < 50;
  } catch (error) { list.innerHTML = `<div class="empty">Не удалось загрузить историю: ${escapeHtml(error.message)}</div>`; }
}

function comparisonTable(rows, columns) { return `<table class="comparison-table"><thead><tr><th>Показатель</th>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${row.label}</td>${columns.map(c => `<td>${round(c.values[row.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
function selectedTrendFields() { return $$('[data-trend-field]:checked').map(input => input.dataset.trendField); }
function renderTrendFields(data) {
  const root = $('#trend-fields'); if (!root) return;
  const usable = new Set(Object.keys(data.overall || {}));
  const ordered = state.scaleDefinitions.filter(definition => usable.has(definition.id)).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const selected = new Set(state.selectedTrendFields.filter(id => usable.has(id)));
  if (!selected.size) ordered.slice(0, 4).forEach(definition => selected.add(definition.id));
  state.selectedTrendFields = [...selected];
  root.innerHTML = ordered.map(definition => `<label><input type="checkbox" data-trend-field="${escapeHtml(definition.id)}"${selected.has(definition.id) ? ' checked' : ''}> ${escapeHtml(definition.label)}</label>`).join('') || '<span class="muted">Недостаточно данных для графика.</span>';
  $$('[data-trend-field]', root).forEach(input => input.addEventListener('change', () => { state.selectedTrendFields = selectedTrendFields(); renderAnalytics(data); }));
}
function renderAnalytics(data) {
  $('#analytics-kpis').innerHTML = [['Запланированных', data.count], ['Дней', data.days], ['Пар День/Вечер', data.pairedDays]].map(([label, value]) => `<div class="kpi"><strong>${value}</strong><span>${label}</span></div>`).join('');
  renderTrendFields(data);
  const completion = data.completion;
  $('#completion-stats').innerHTML = `<h3>Выполнение расписания</h3><p class="muted">${completion.opportunities ? `${completion.completed} из ${completion.opportunities} прошедших или отмеченных заранее запланированных периодов (${round(completion.rate)}%)` : 'Пока нет прошедших запланированных периодов.'}</p>`;
  ChartLite.renderTrend($('#trend-chart'), data.daily, data.treatmentMarkers, state.selectedTrendFields, state.scaleDefinitions);
  const rows = state.scaleDefinitions.filter(definition => Object.hasOwn(data.pairedDelta || {}, definition.id) && Number.isFinite(data.pairedDelta[definition.id])).map(definition => ({ key: definition.id, label: definition.label }));
  $('#paired-comparison').innerHTML = rows.length ? `<p class="muted" style="margin-bottom:10px">Средняя разница «вечер минус день» только за даты, где оба значения каждой шкалы присутствуют.</p>${comparisonTable(rows, [{ label: 'Δ вечером', values: data.pairedDelta }])}` : '<div class="empty">Нужно несколько дней с обеими отметками.</div>';
  const frequencyItems = Object.entries({ ...data.frequencies.symptoms, ...data.frequencies.activation, ...data.frequencies.context }).map(([key, value]) => ({ label: state.trackedItems.find(item => item.id === key)?.label || key, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  ChartLite.renderBars($('#frequency-chart'), frequencyItems);
}
async function loadAnalytics() {
  state.analyticsData = await api('/api/v1/analytics');
  renderAnalytics(state.analyticsData);
}

function effectiveRegimen(date = localDate()) {
  const eligible = state.treatmentEvents.filter(event => event.effectiveDate === null || event.effectiveDate <= date);
  return eligible[eligible.length - 1]?.regimen ?? [];
}

function renderRegimenFields(regimen = []) {
  const items = $('#treatment-regimen-items');
  items.innerHTML = regimen.map((item, index) => `<div class="treatment-medication" data-regimen-index="${index}">
    <label>Препарат<input type="text" data-treatment-field="name" value="${escapeHtml(item.name ?? '')}"></label>
    <label>Доза<input type="number" min="0.01" step="any" data-treatment-field="amount" value="${escapeHtml(item.amount ?? '')}"></label>
    <label>Ед.<input type="text" data-treatment-field="unit" value="${escapeHtml(item.unit ?? '')}"></label>
    <label>Когда<input type="text" data-treatment-field="timing" value="${escapeHtml(item.timing ?? '')}"></label>
    <button type="button" class="ghost" data-remove-medication="${index}">Убрать</button>
  </div>`).join('');
  $$('[data-remove-medication]', items).forEach(button => button.addEventListener('click', () => {
    const values = treatmentFormRegimen(); values.splice(Number(button.dataset.removeMedication), 1); renderRegimenFields(values);
  }));
}

function treatmentFormRegimen() {
  return $$('.treatment-medication', $('#treatment-regimen-items')).map(item => Object.fromEntries($$('[data-treatment-field]', item).map(input => [input.dataset.treatmentField, input.value])));
}

function renderTreatmentEvents() {
  $('#current-regimen').textContent = `Сегодня: ${regimenText(effectiveRegimen())}`;
  $('#medication-label').textContent = regimenText(effectiveRegimen());
  const events = $('#treatment-events');
  events.innerHTML = state.treatmentEvents.map(event => `<article class="treatment-event">
    <div><h4>${escapeHtml(event.effectiveDate ? `С ${niceDate(event.effectiveDate)}` : 'Исходная схема')}</h4><p>${escapeHtml(regimenText(event.regimen))}${event.note ? ` · ${escapeHtml(event.note)}` : ''}</p></div>
    <div class="button-row compact"><button type="button" class="secondary" data-edit-treatment="${event.id}">Изменить</button><button type="button" class="ghost" data-delete-treatment="${event.id}">Удалить</button></div>
  </article>`).join('') || '<div class="empty">Схема лечения ещё не указана.</div>';
  $$('[data-edit-treatment]', events).forEach(button => button.addEventListener('click', () => openTreatmentForm(state.treatmentEvents.find(event => event.id === Number(button.dataset.editTreatment)))));
  $$('[data-delete-treatment]', events).forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Удалить этот снимок схемы лечения?')) return;
    await api(`/api/v1/treatment-events/${button.dataset.deleteTreatment}`, { method: 'DELETE' }); await loadTreatmentEvents(); toast('Схема лечения удалена');
  }));
}

async function loadTreatmentEvents() {
  const { items } = await api('/api/v1/treatment-events'); state.treatmentEvents = items; renderTreatmentEvents();
}

function openTreatmentForm(event = null) {
  const form = $('#treatment-event-form'); form.hidden = false; form.elements.id.value = event?.id ?? '';
  form.elements.effectiveDate.value = event?.effectiveDate ?? localDate(); form.elements.note.value = event?.note ?? '';
  form.dataset.editing = event ? 'true' : '';
  renderRegimenFields(event?.regimen ?? effectiveRegimen(dateDaysBefore(form.elements.effectiveDate.value, 1)));
  form.elements.effectiveDate.focus();
}

async function saveTreatmentEvent(event) {
  event.preventDefault(); const form = event.currentTarget;
  const payload = { effectiveDate: form.elements.effectiveDate.value || null, regimen: treatmentFormRegimen(), note: form.elements.note.value };
  try {
    if (form.elements.id.value) await api(`/api/v1/treatment-events/${form.elements.id.value}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/v1/treatment-events', { method: 'POST', body: JSON.stringify(payload) });
    form.hidden = true; await loadTreatmentEvents(); toast('Схема лечения сохранена');
  } catch (error) { toast(`Не удалось сохранить схему: ${error.message}`); }
}

function renderReminderPauseState() {
  const status = $('#reminder-pause-status');
  const copy = $('#reminder-pause-copy');
  if (state.pauseTimer) { clearTimeout(state.pauseTimer); state.pauseTimer = null; }
  const until = state.settings?.remindersPausedUntil ? new Date(state.settings.remindersPausedUntil) : null;
  if (!status || !copy || !until || !Number.isFinite(until.getTime()) || until <= new Date()) {
    status?.classList.add('hidden');
    return;
  }
  status.classList.remove('hidden');
  copy.textContent = `До ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(until)}`;
  state.pauseTimer = setTimeout(renderReminderPauseState, Math.max(0, until.getTime() - Date.now()) + 50);
}
function renderReminderSettings() {
  if (!state.settings) return;
  $('#snooze-reminder').textContent = `Через ${state.settings.repeatMinutes} минут`;
  renderReminderPauseState();
}
async function fillSettings() {
  if (state.settings) for (const [key, value] of Object.entries(state.settings)) if ($('#settings-form').elements[key]) $('#settings-form').elements[key].value = value ?? '';
  renderReminderSettings();
  renderTrackedSettings();
  await Promise.all([loadTreatmentEvents(), loadBackups()]);
}
async function saveSettings(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); data.catchupHours = Number(data.catchupHours); data.repeatMinutes = Number(data.repeatMinutes);
  state.settings = await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify(data) }); renderReminderSettings(); toast('Настройки сохранены');
}
async function updatePause(until) { state.settings = await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify({ remindersPausedUntil: until }) }); renderReminderSettings(); toast(until ? 'Напоминания приостановлены' : 'Напоминания возобновлены'); }
async function exportFile(format) {
  const content = await api(`/api/v1/export.${format}`); const extension = format === 'csv' ? 'csv' : 'json'; const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: extension === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `med-checkin-${localDate()}.${extension}`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Экспорт подготовлен');
}
async function loadBackups() {
  const { items } = await api('/api/v1/backups');
  const list = $('#backup-list');
  list.innerHTML = items.length
    ? items.map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${Math.ceil(item.size / 1024)} КБ</option>`).join('')
    : '<option value="">Копий пока нет</option>';
  $('#restore-backup').disabled = !items.length;
}
async function createBackupNow() {
  try { await api('/api/v1/backups', { method: 'POST' }); await loadBackups(); toast('Резервная копия создана'); }
  catch (error) { toast(`Не удалось создать копию: ${error.message}`); }
}
async function restoreSelectedBackup() {
  const name = $('#backup-list').value;
  if (!name || !confirm(`Восстановить ${name}? Текущее состояние будет сохранено отдельно, затем приложение перезапустится.`)) return;
  try {
    await api('/api/v1/backups/restore', { method: 'POST', body: JSON.stringify({ name }) });
    toast('Копия восстановлена. Приложение перезапускается…');
  } catch (error) { toast(`Не удалось восстановить копию: ${error.message}`); }
}
async function selectImportFile(event) {
  state.pendingImport = null; $('#replace-import').disabled = true;
  const file = event.target.files[0];
  if (!file) { $('#import-preview').textContent = 'Сначала выберите файл. Данные не изменятся до подтверждения замены.'; return; }
  try {
    const payload = JSON.parse(await file.text());
    const preview = await api('/api/v1/import/preview', { method: 'POST', body: JSON.stringify(payload) });
    state.pendingImport = payload;
    $('#import-preview').textContent = `Наблюдений: ${preview.observationCount} (дополнительных: ${preview.extraCount})\nИзменений лечения: ${preview.treatmentEventCount}\nПериод: ${preview.dateFrom || '—'} — ${preview.dateTo || '—'}`;
    $('#replace-import').disabled = false;
  } catch (error) { $('#import-preview').textContent = `Файл не принят: ${error.message}`; }
}
async function replaceFromImport() {
  if (!state.pendingImport || !confirm('Полностью заменить наблюдения, историю лечения и переносимые настройки данными из файла? Перед заменой будет создана резервная копия.')) return;
  try {
    const result = await api('/api/v1/import/replace', { method: 'POST', body: JSON.stringify(state.pendingImport) });
    state.pendingImport = null; $('#replace-import').disabled = true; $('#import-json').value = '';
    $('#import-preview').textContent = `Заменено наблюдений: ${result.observationCount}. Резервная копия создана.`;
    MedCheckinDrafts.remove(draftKey()); state.staleDraftFlags = []; state.dirty = false;
    toast('Данные заменены из JSON'); setTimeout(() => window.location.reload(), 400);
  } catch (error) { toast(`Не удалось заменить данные: ${error.message}`); }
}
async function closeWindow() { if (!await confirmLeavingDirty()) return; try { await api('/api/v1/control/close-window', { method: 'POST' }); } catch {} setTimeout(() => window.close(), 100); }

async function handleReminder(due) {
  if (!due) return;
  if (!await confirmLeavingDirty()) return;
  const key = `${due.localDate}|${due.period}`;
  if (state.activeReminder?.key === key && Date.now() - state.activeReminder.seenAt < 120000) return;
  state.activeReminder = { key, due, seenAt: Date.now() };
  await api('/api/v1/reminders/notified', { method: 'POST', body: JSON.stringify({ localDate: due.localDate, period: due.period }) });
  $('#reminder-banner').classList.remove('hidden'); $('#reminder-copy').textContent = due.overdueMinutes ? `Чек-ин просрочен на ${due.overdueMinutes} мин.` : 'Пора отметить состояние.';
  await switchView('checkin'); await loadCheckin(due.localDate, due.period); window.focus();
}
function connectEvents() {
  state.eventSource?.close(); const stream = new EventSource(`${state.apiBase}/api/v1/events?token=${encodeURIComponent(state.token)}`); state.eventSource = stream;
  stream.addEventListener('connected', () => setConnection(true)); stream.addEventListener('reminder', event => handleReminder(JSON.parse(event.data))); stream.addEventListener('settings-changed', event => { state.settings = JSON.parse(event.data); fillSettings(); }); stream.addEventListener('update-state', event => { state.updates = JSON.parse(event.data); renderUpdates(); }); stream.addEventListener('quit', () => window.close()); stream.onerror = () => setConnection(false);
}
function initBrowser() { const runtime = MedCheckinStartup.applyBrowserRuntime(window); if (!runtime.token) throw new Error('Отсутствует локальный ключ запуска. Открой приложение через ярлык или значок в трее.'); state.token = runtime.token; state.apiBase = runtime.apiBase; connectEvents(); return runtime; }
async function bootstrap(runtime) {
  const data = await api('/api/v1/bootstrap'); state.settings = data.settings; state.updates = data.updates; applyScaleDefinitions(data.scaleDefinitions || []); applyTrackedItems(data.trackedItems || []); $('#medication-label').textContent = data.currentTreatment?.regimen?.map(item => `${item.name} ${item.amount} ${item.unit}`).join(' · ') || 'Лечение не указано'; renderUpdates();
  await loadCheckin(runtime.localDate || data.current.localDate, runtime.slot ? slotPeriod(runtime.slot) : data.current.period); fillSettings(); setConnection(true); await switchView(runtime.view || 'checkin');
}
function wireUi() {
  setRanges(); renderScaleSettings();
  $$('[data-trend-field]').forEach(input => input.addEventListener('change', () => {
    state.selectedTrendFields = selectedTrendFields();
    if (state.analyticsData) renderAnalytics(state.analyticsData);
  }));
  $$('.tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-entry-kind]').forEach(button => button.addEventListener('click', () => startEntry(button.dataset.entryKind, button.dataset.period || null)));
  $('#checkin-form').addEventListener('submit', saveCheckin); $('#checkin-form').addEventListener('change', markDirty); $('#checkin-form').addEventListener('input', event => { if (event.target.type !== 'range') markDirty(); });
  $('#use-previous-values').addEventListener('click', usePreviousValues); $('#hide-window').addEventListener('click', closeWindow); $('#refresh-history').addEventListener('click', () => loadHistory()); $('#add-missed-checkin').addEventListener('click', addMissedCheckin); $('#add-extra-from-history').addEventListener('click', () => startEntry('extra')); $('#load-more-history').addEventListener('click', () => loadHistory(true));
  ['history-range', 'history-period', 'history-from', 'history-to'].forEach(id => $(`#${id}`).addEventListener('change', event => { if (id !== 'history-range' && id !== 'history-period') $('#history-range').value = 'custom'; loadHistory(); }));
  $('#refresh-analytics').addEventListener('click', loadAnalytics); $('#settings-form').addEventListener('submit', saveSettings);
  $('#check-updates').addEventListener('click', checkUpdates); $('#install-update').addEventListener('click', installUpdate); $('#update-available').addEventListener('click', () => switchView('settings'));
  $('#add-treatment-event').addEventListener('click', () => openTreatmentForm()); $('#treatment-event-form').addEventListener('submit', saveTreatmentEvent); $('#cancel-treatment-event').addEventListener('click', () => { $('#treatment-event-form').hidden = true; });
  $('#add-treatment-medication').addEventListener('click', () => { const regimen = treatmentFormRegimen(); regimen.push({ name: '', amount: '', unit: 'mg', timing: '' }); renderRegimenFields(regimen); });
  $('#treatment-event-form').elements.effectiveDate.addEventListener('change', event => { if (!$('#treatment-event-form').dataset.editing && event.target.value) renderRegimenFields(effectiveRegimen(dateDaysBefore(event.target.value, 1))); });
  $('#pause-two-hours').addEventListener('click', () => updatePause(new Date(Date.now() + 2 * 3600000).toISOString())); $('#resume-reminders').addEventListener('click', () => updatePause(null)); $('#export-csv').addEventListener('click', () => exportFile('csv')); $('#export-json').addEventListener('click', () => exportFile('json'));
  $('#create-backup').addEventListener('click', createBackupNow); $('#restore-backup').addEventListener('click', restoreSelectedBackup); $('#import-json').addEventListener('change', selectImportFile); $('#replace-import').addEventListener('click', replaceFromImport);
  $('#open-data-folder').addEventListener('click', async () => { try { await api('/api/v1/control/open-data-folder', { method: 'POST' }); toast('Папка данных открыта'); } catch (error) { toast(`Не удалось открыть папку данных: ${error.message}`); } });
  $('#resume-paused-reminders').addEventListener('click', () => updatePause(null));
  $('#snooze-reminder').addEventListener('click', async () => { if (!state.activeReminder) return; const { localDate: date, period } = state.activeReminder.due; await api('/api/v1/reminders/snooze', { method: 'POST', body: JSON.stringify({ localDate: date, period, minutes: state.settings.repeatMinutes }) }); $('#reminder-banner').classList.add('hidden'); state.activeReminder = null; await closeWindow(); });
  $('#dismiss-reminder').addEventListener('click', async () => { if (!state.activeReminder) return; const { localDate: date, period } = state.activeReminder.due; await api('/api/v1/reminders/dismiss', { method: 'POST', body: JSON.stringify({ localDate: date, period }) }); $('#reminder-banner').classList.add('hidden'); state.activeReminder = null; await closeWindow(); });
  window.addEventListener('beforeunload', event => { if (!state.dirty) return; persistDraft(); event.preventDefault(); event.returnValue = ''; });
}

document.addEventListener('DOMContentLoaded', async () => {
  wireUi();
  try { const runtime = initBrowser(); await bootstrap(runtime); }
  catch (error) { setConnection(false); toast(`Не удалось запустить приложение: ${error.message}`); console.error(error); }
});
