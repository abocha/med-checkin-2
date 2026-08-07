/* global ChartLite, MedCheckinStartup, MedCheckinDrafts */
const state = {
  apiBase: null, token: null, settings: null, currentDate: null, currentKind: 'scheduled', currentPeriod: 'day',
  currentRecord: null, activeReminder: null, eventSource: null, toastTimer: null, extraDraftKey: null,
  dirty: false, draftTimer: null, suppressDirty: false
};

const metricLabels = {
  mood: 'Настроение', anxiety: 'Тревога', irritability: 'Раздражительность', energy: 'Энергия',
  focus: 'Концентрация', functioning: 'Функционирование', sleepQuality: 'Сон', appetite: 'Аппетит'
};
const scaleFields = Object.keys(metricLabels);
const flagLabels = {
  caffeine: 'Кофеин', stress: 'Стресс', conflict: 'Конфликт', illnessPain: 'Болезнь/боль',
  physicalActivity: 'Физическая активность', positiveProductiveDay: 'Приятный/продуктивный день',
  dizziness: 'Головокружение', headache: 'Головная боль', nausea: 'Тошнота/живот', sweating: 'Потливость',
  palpitations: 'Сердцебиение', brainZaps: 'Brain zaps', unusualDreams: 'Необычные сны', crying: 'Плаксивость',
  reducedSleepNeed: 'Меньше потребности во сне', racingThoughts: 'Ускорение мыслей', talkativeness: 'Разговорчивость',
  innerMotor: 'Внутренний мотор', impulsivity: 'Импульсивность', elevatedAgitated: 'Подъём/возбуждение'
};

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
  scaleFields.forEach(name => setScale(form.elements[name], null));
  setFlags('context'); setFlags('symptoms'); setFlags('activation');
  state.currentRecord = null;
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
  const form = $('#checkin-form');
  state.suppressDirty = true;
  state.currentRecord = record;
  state.extraDraftKey = null;
  for (const [name, value] of Object.entries(record)) {
    if (form.elements[name] && !Array.isArray(value) && !scaleFields.includes(name)) form.elements[name].value = value ?? '';
  }
  scaleFields.forEach(name => setScale(form.elements[name], record[name]));
  setFlags('context', record.context); setFlags('symptoms', record.symptoms); setFlags('activation', record.activation);
  state.dirty = false;
  $('#edit-state').textContent = 'Редактирование';
  $('#save-status').textContent = `Сохранено ${new Date(record.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  state.suppressDirty = false;
}

function draftValues() {
  const form = $('#checkin-form');
  const values = Object.fromEntries(new FormData(form).entries());
  values.context = selectedFlags('context'); values.symptoms = selectedFlags('symptoms'); values.activation = selectedFlags('activation');
  values.scalesChosen = Object.fromEntries(scaleFields.map(name => [name, form.elements[name].dataset.chosen === 'true']));
  for (const name of scaleFields) values[name] = form.elements[name].value;
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
  state.dirty = false;
}

function restoreDraft(draft) {
  const form = $('#checkin-form');
  state.suppressDirty = true;
  for (const [name, value] of Object.entries(draft.values)) {
    if (form.elements[name] && !Array.isArray(value) && name !== 'scalesChosen') form.elements[name].value = value ?? '';
  }
  setFlags('context', draft.values.context); setFlags('symptoms', draft.values.symptoms); setFlags('activation', draft.values.activation);
  scaleFields.forEach(name => setScale(form.elements[name], draft.values.scalesChosen?.[name] ? draft.values[name] : null));
  state.suppressDirty = false;
  state.dirty = true;
  $('#save-status').textContent = 'Восстановлен черновик';
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
  for (const name of scaleFields) payload[name] = form.elements[name].dataset.chosen === 'true' ? Number(form.elements[name].value) : null;
  payload.nightSleepHours = payload.nightSleepHours === '' ? null : Number(payload.nightSleepHours);
  payload.daySleepHours = payload.daySleepHours === '' ? null : Number(payload.daySleepHours);
  payload.context = selectedFlags('context'); payload.symptoms = selectedFlags('symptoms'); payload.activation = selectedFlags('activation');
  return payload;
}

function validForSave(payload) {
  if (payload.kind === 'scheduled' && scaleFields.some(name => payload[name] === null)) {
    toast('Для запланированного чек-ина выбери все восемь шкал.');
    return false;
  }
  if (payload.kind === 'extra') {
    const meaningful = scaleFields.some(name => payload[name] !== null)
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
    scaleFields.forEach(name => setScale(form.elements[name], previous[name]));
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

async function loadHistory() {
  const list = $('#history-list');
  list.innerHTML = '<div class="empty">Загружаю записи…</div>';
  try {
    const { items } = await api('/api/v1/checkins?limit=200');
    if (!items.length) { list.innerHTML = '<div class="empty">Пока нет ни одной записи.</div>'; return; }
    list.innerHTML = items.map(item => `<article class="history-item">
      <div class="history-date">${escapeHtml(niceDate(item.localDate))}<small>${item.kind === 'extra' ? 'Дополнительная запись' : `${periodLabel(item.period)} · ${item.scheduledFor ? new Date(item.scheduledFor).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'без времени'}`}</small></div>
      <div><div class="metric-chips">${['mood', 'energy', 'focus', 'functioning', 'anxiety'].filter(key => item[key] != null).map(key => `<span class="metric-chip">${metricLabels[key]} <b>${round(item[key])}</b></span>`).join('')}</div>${item.notes ? `<p class="muted" style="margin-top:8px">${escapeHtml(item.notes.slice(0, 180))}</p>` : ''}</div>
      <div class="button-row"><button type="button" class="secondary" data-edit-id="${item.id}">Открыть</button><button type="button" class="ghost" data-delete-id="${item.id}">Удалить</button></div>
    </article>`).join('');
    $$('[data-edit-id]').forEach(button => button.addEventListener('click', async () => {
      const record = await api(`/api/v1/checkins/${button.dataset.editId}`); await openRecord(record);
    }));
    $$('[data-delete-id]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Удалить эту запись без возможности восстановления?')) return;
      await api(`/api/v1/checkins/${button.dataset.deleteId}`, { method: 'DELETE' });
      toast('Запись удалена'); loadHistory();
    }));
  } catch (error) { list.innerHTML = `<div class="empty">Не удалось загрузить историю: ${escapeHtml(error.message)}</div>`; }
}

function comparisonTable(rows, columns) { return `<table class="comparison-table"><thead><tr><th>Показатель</th>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${row.label}</td>${columns.map(c => `<td>${round(c.values[row.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
async function loadAnalytics() {
  const data = await api('/api/v1/analytics');
  $('#analytics-kpis').innerHTML = [['Чек-инов', data.count], ['Дней', data.days], ['Среднее настроение', round(data.overall.mood)], ['Средняя тревога', round(data.overall.anxiety)]].map(([label, value]) => `<div class="kpi"><strong>${value}</strong><span>${label}</span></div>`).join('');
  ChartLite.renderTrend($('#trend-chart'), data.daily);
  const rows = ['mood', 'energy', 'focus', 'functioning', 'anxiety'].map(key => ({ key, label: metricLabels[key] }));
  $('#paired-comparison').innerHTML = data.pairedDays ? `<p class="muted" style="margin-bottom:10px">Средняя разница «вечер минус день» на ${data.pairedDays} парных днях.</p>${comparisonTable(rows, [{ label: 'Δ вечером', values: data.pairedDelta }])}` : '<div class="empty">Нужно несколько дней с обеими отметками.</div>';
  const frequencyItems = Object.entries({ ...data.frequencies.symptoms, ...data.frequencies.activation, ...data.frequencies.context }).map(([key, value]) => ({ label: flagLabels[key] || key, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  ChartLite.renderBars($('#frequency-chart'), frequencyItems);
  $('#period-comparison').innerHTML = comparisonTable(rows, [{ label: 'Первые 7 дней', values: data.periods.first7 }, { label: 'Позже', values: data.periods.later }]);
}

function fillSettings() { if (state.settings) for (const [key, value] of Object.entries(state.settings)) if ($('#settings-form').elements[key]) $('#settings-form').elements[key].value = value ?? ''; }
async function saveSettings(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); data.catchupHours = Number(data.catchupHours); data.repeatMinutes = Number(data.repeatMinutes);
  state.settings = await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify(data) }); toast('Настройки сохранены');
}
async function updatePause(until) { state.settings = await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify({ remindersPausedUntil: until }) }); toast(until ? 'Напоминания приостановлены' : 'Напоминания возобновлены'); }
async function exportFile(format) {
  const content = await api(`/api/v1/export.${format}`); const extension = format === 'csv' ? 'csv' : 'json'; const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: extension === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `med-checkin-${localDate()}.${extension}`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Экспорт подготовлен');
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
  stream.addEventListener('connected', () => setConnection(true)); stream.addEventListener('reminder', event => handleReminder(JSON.parse(event.data))); stream.addEventListener('settings-changed', event => { state.settings = JSON.parse(event.data); fillSettings(); }); stream.addEventListener('quit', () => window.close()); stream.onerror = () => setConnection(false);
}
function initBrowser() { const runtime = MedCheckinStartup.applyBrowserRuntime(window); if (!runtime.token) throw new Error('Отсутствует локальный ключ запуска. Открой приложение через ярлык или значок в трее.'); state.token = runtime.token; state.apiBase = runtime.apiBase; connectEvents(); return runtime; }
async function bootstrap(runtime) {
  const data = await api('/api/v1/bootstrap'); state.settings = data.settings; $('#medication-label').textContent = data.currentTreatment?.regimen?.map(item => `${item.name} ${item.amount} ${item.unit}`).join(' · ') || 'Лечение не указано';
  await loadCheckin(runtime.localDate || data.current.localDate, runtime.slot ? slotPeriod(runtime.slot) : data.current.period); fillSettings(); setConnection(true); await switchView(runtime.view || 'checkin');
}
function wireUi() {
  setRanges();
  $$('.tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-entry-kind]').forEach(button => button.addEventListener('click', () => startEntry(button.dataset.entryKind, button.dataset.period || null)));
  $('#checkin-form').addEventListener('submit', saveCheckin); $('#checkin-form').addEventListener('change', markDirty); $('#checkin-form').addEventListener('input', event => { if (event.target.type !== 'range') markDirty(); });
  $('#use-previous-values').addEventListener('click', usePreviousValues); $('#hide-window').addEventListener('click', closeWindow); $('#refresh-history').addEventListener('click', loadHistory); $('#add-missed-checkin').addEventListener('click', addMissedCheckin); $('#refresh-analytics').addEventListener('click', loadAnalytics); $('#settings-form').addEventListener('submit', saveSettings);
  $('#pause-two-hours').addEventListener('click', () => updatePause(new Date(Date.now() + 2 * 3600000).toISOString())); $('#resume-reminders').addEventListener('click', () => updatePause(null)); $('#export-csv').addEventListener('click', () => exportFile('csv')); $('#export-json').addEventListener('click', () => exportFile('json'));
  $('#snooze-reminder').addEventListener('click', async () => { if (!state.activeReminder) return; const { localDate: date, period } = state.activeReminder.due; await api('/api/v1/reminders/snooze', { method: 'POST', body: JSON.stringify({ localDate: date, period, minutes: state.settings?.repeatMinutes || 30 }) }); $('#reminder-banner').classList.add('hidden'); state.activeReminder = null; await closeWindow(); });
  $('#dismiss-reminder').addEventListener('click', async () => { if (!state.activeReminder) return; const { localDate: date, period } = state.activeReminder.due; await api('/api/v1/reminders/dismiss', { method: 'POST', body: JSON.stringify({ localDate: date, period }) }); $('#reminder-banner').classList.add('hidden'); state.activeReminder = null; await closeWindow(); });
  window.addEventListener('beforeunload', event => { if (!state.dirty) return; persistDraft(); event.preventDefault(); event.returnValue = ''; });
}

document.addEventListener('DOMContentLoaded', async () => {
  wireUi();
  try { const runtime = initBrowser(); await bootstrap(runtime); }
  catch (error) { setConnection(false); toast(`Не удалось запустить приложение: ${error.message}`); console.error(error); }
});
