/* global ChartLite, MedCheckinStartup */
const state = {
  apiBase: null, token: null, settings: null, currentDate: null, currentSlot: '13:00',
  currentRecord: null, activeReminder: null, eventSource: null, toastTimer: null
};

const metricLabels = {
  mood: 'Настроение', anxiety: 'Тревога', irritability: 'Раздражительность', energy: 'Энергия',
  focus: 'Концентрация', functioning: 'Функционирование', sleepQuality: 'Сон', appetite: 'Аппетит'
};
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
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function niceDate(value) { return new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric' }).format(new Date(`${value}T12:00:00`)); }
function round(value) { return value == null ? '—' : Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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
    headers: { authorization: `Bearer ${state.token}`, ...(options.body ? {'content-type':'application/json'} : {}), ...(options.headers || {}) }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
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

function switchView(name) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === name));
  if (name === 'history') loadHistory();
  if (name === 'analytics') loadAnalytics();
  if (name === 'settings') fillSettings();
}

function setRanges() {
  $$('input[type="range"]').forEach(input => {
    const output = input.parentElement.querySelector('output');
    const update = () => output.value = input.value;
    input.addEventListener('input', update);
    update();
  });
}

function selectedFlags(group) {
  return $$(`[data-flag-group="${group}"] input:checked`).map(input => input.value);
}
function setFlags(group, values = []) {
  const set = new Set(values);
  $$(`[data-flag-group="${group}"] input`).forEach(input => input.checked = set.has(input.value));
}

function resetForm() {
  const form = $('#checkin-form');
  form.reset();
  const defaults = { mood:7, anxiety:1, irritability:1, energy:6, focus:6, functioning:7, sleepQuality:6, appetite:5 };
  for (const [name, value] of Object.entries(defaults)) form.elements[name].value = value;
  form.elements.localDate.value = state.currentDate;
  form.elements.slot.value = state.currentSlot;
  setFlags('context'); setFlags('symptoms'); setFlags('activation');
  setRanges();
  state.currentRecord = null;
  $('#edit-state').textContent = 'Новая запись';
  $('#save-status').textContent = 'Изменения ещё не сохранены';
}

function fillForm(record) {
  const form = $('#checkin-form');
  resetForm();
  state.currentRecord = record;
  if (!record) return;
  for (const [name, value] of Object.entries(record)) {
    if (form.elements[name] && !Array.isArray(value)) form.elements[name].value = value ?? '';
  }
  setFlags('context', record.context); setFlags('symptoms', record.symptoms); setFlags('activation', record.activation);
  setRanges();
  $('#edit-state').textContent = 'Редактирование';
  $('#save-status').textContent = `Сохранено ${new Date(record.updatedAt).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}`;
}

async function loadCheckin(date, slot) {
  state.currentDate = date;
  state.currentSlot = slot;
  $('#checkin-title').textContent = slot === '13:00' ? 'Дневной чек-ин' : 'Вечерний чек-ин';
  $('#checkin-subtitle').textContent = `${niceDate(date)} · ${slot}`;
  $$('[data-slot]').forEach(button => button.classList.toggle('active', button.dataset.slot === slot));
  try {
    const record = await api(`/api/v1/checkin?date=${encodeURIComponent(date)}&slot=${encodeURIComponent(slot)}`);
    fillForm(record);
  } catch (error) {
    if (error.status === 404) resetForm(); else throw error;
  }
}

function formPayload() {
  const form = $('#checkin-form');
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  for (const name of Object.keys(metricLabels)) payload[name] = Number(payload[name]);
  payload.nightSleepHours = payload.nightSleepHours === '' ? null : Number(payload.nightSleepHours);
  payload.daySleepHours = payload.daySleepHours === '' ? null : Number(payload.daySleepHours);
  payload.context = selectedFlags('context');
  payload.symptoms = selectedFlags('symptoms');
  payload.activation = selectedFlags('activation');
  return payload;
}

async function saveCheckin(event) {
  event.preventDefault();
  const button = $('#save-checkin');
  button.disabled = true;
  $('#save-status').textContent = 'Сохраняю…';
  try {
    const saved = await api('/api/v1/checkins', { method:'POST', body: JSON.stringify(formPayload()) });
    fillForm(saved);
    state.activeReminder = null;
    $('#reminder-banner').classList.add('hidden');
    toast('Чек-ин сохранён');
    setTimeout(closeWindow, 450);
  } catch (error) {
    $('#save-status').textContent = 'Не удалось сохранить';
    toast(`Ошибка: ${error.message}`);
  } finally { button.disabled = false; }
}

async function loadHistory() {
  const list = $('#history-list');
  list.innerHTML = '<div class="empty">Загружаю записи…</div>';
  try {
    const { items } = await api('/api/v1/checkins?limit=200');
    if (!items.length) { list.innerHTML = '<div class="empty">Пока нет ни одной записи.</div>'; return; }
    list.innerHTML = items.map(item => `<article class="history-item">
      <div class="history-date">${escapeHtml(niceDate(item.localDate))}<small>${item.slot === '13:00' ? 'Дневной' : 'Вечерний'} · ${item.slot}</small></div>
      <div><div class="metric-chips">${['mood','energy','focus','functioning','anxiety'].map(key => `<span class="metric-chip">${metricLabels[key]} <b>${round(item[key])}</b></span>`).join('')}</div>${item.notes ? `<p class="muted" style="margin-top:8px">${escapeHtml(item.notes.slice(0,180))}</p>` : ''}</div>
      <div class="button-row"><button type="button" class="secondary" data-edit-id="${item.id}" data-date="${item.localDate}" data-item-slot="${item.slot}">Открыть</button><button type="button" class="ghost" data-delete-id="${item.id}">Удалить</button></div>
    </article>`).join('');
    $$('[data-edit-id]').forEach(button => button.addEventListener('click', async () => { switchView('checkin'); await loadCheckin(button.dataset.date, button.dataset.itemSlot); window.focus(); }));
    $$('[data-delete-id]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Удалить эту запись без возможности восстановления?')) return;
      await api(`/api/v1/checkins/${button.dataset.deleteId}`, { method:'DELETE' });
      toast('Запись удалена'); loadHistory();
    }));
  } catch (error) { list.innerHTML = `<div class="empty">Не удалось загрузить историю: ${escapeHtml(error.message)}</div>`; }
}

function comparisonTable(rows, columns) {
  return `<table class="comparison-table"><thead><tr><th>Показатель</th>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${row.label}</td>${columns.map(c => `<td>${round(c.values[row.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function loadAnalytics() {
  const data = await api('/api/v1/analytics');
  $('#analytics-kpis').innerHTML = [
    ['Чек-инов', data.count], ['Дней', data.days], ['Среднее настроение', round(data.overall.mood)], ['Средняя тревога', round(data.overall.anxiety)]
  ].map(([label,value]) => `<div class="kpi"><strong>${value}</strong><span>${label}</span></div>`).join('');
  ChartLite.renderTrend($('#trend-chart'), data.daily);
  const rows = ['mood','energy','focus','functioning','anxiety'].map(key => ({key,label:metricLabels[key]}));
  $('#paired-comparison').innerHTML = data.pairedDays
    ? `<p class="muted" style="margin-bottom:10px">Средняя разница «вечер минус день» на ${data.pairedDays} парных днях.</p>${comparisonTable(rows, [{label:'Δ вечером',values:data.pairedDelta}])}`
    : '<div class="empty">Нужно несколько дней с обеими отметками.</div>';
  const frequencyItems = Object.entries({...data.frequencies.symptoms, ...data.frequencies.activation, ...data.frequencies.context})
    .map(([key,value]) => ({label:flagLabels[key] || key,value})).sort((a,b) => b.value-a.value).slice(0,10);
  ChartLite.renderBars($('#frequency-chart'), frequencyItems);
  $('#period-comparison').innerHTML = comparisonTable(rows, [
    {label:'Первые 7 дней',values:data.periods.first7}, {label:'Позже',values:data.periods.later}
  ]);
}

function fillSettings() {
  if (!state.settings) return;
  const form = $('#settings-form');
  for (const [key, value] of Object.entries(state.settings)) if (form.elements[key]) form.elements[key].value = value ?? '';
}

async function saveSettings(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  data.catchupHours = Number(data.catchupHours); data.repeatMinutes = Number(data.repeatMinutes);
  state.settings = await api('/api/v1/settings', {method:'PUT', body:JSON.stringify(data)});
  $('#medication-label').textContent = state.settings.medicationLabel;
  toast('Настройки сохранены');
}

async function updatePause(until) {
  state.settings = await api('/api/v1/settings', { method:'PUT', body:JSON.stringify({ remindersPausedUntil: until }) });
  toast(until ? 'Напоминания приостановлены' : 'Напоминания возобновлены');
}

async function exportFile(format) {
  const content = await api(`/api/v1/export.${format}`);
  const extension = format === 'csv' ? 'csv' : 'json';
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const blob = new Blob([body], { type: extension === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `med-checkin-${localDate()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Экспорт подготовлен');
}

async function closeWindow() {
  try { await api('/api/v1/control/close-window', { method: 'POST' }); } catch {}
  setTimeout(() => window.close(), 100);
}

async function handleReminder(due) {
  if (!due) return;
  const key = `${due.localDate}|${due.slot}`;
  if (state.activeReminder?.key === key && Date.now() - state.activeReminder.seenAt < 120000) return;
  state.activeReminder = { key, due, seenAt: Date.now() };
  await api('/api/v1/reminders/notified', {method:'POST', body:JSON.stringify({localDate:due.localDate,slot:due.slot})});
  $('#reminder-banner').classList.remove('hidden');
  $('#reminder-copy').textContent = due.overdueMinutes ? `Чек-ин просрочен на ${due.overdueMinutes} мин.` : 'Пора отметить состояние.';
  switchView('checkin');
  await loadCheckin(due.localDate, due.slot);
  window.focus();
}

function connectEvents() {
  state.eventSource?.close();
  const stream = new EventSource(`${state.apiBase}/api/v1/events?token=${encodeURIComponent(state.token)}`);
  state.eventSource = stream;
  stream.addEventListener('connected', () => setConnection(true));
  stream.addEventListener('reminder', event => handleReminder(JSON.parse(event.data)));
  stream.addEventListener('settings-changed', event => { state.settings = JSON.parse(event.data); fillSettings(); });
  stream.addEventListener('quit', () => window.close());
  stream.onerror = () => setConnection(false);
}

function initBrowser() {
  const runtime = MedCheckinStartup.applyBrowserRuntime(window);
  if (!runtime.token) throw new Error('Отсутствует локальный ключ запуска. Открой приложение через ярлык или значок в трее.');
  state.token = runtime.token;
  state.apiBase = runtime.apiBase;
  connectEvents();
  return runtime;
}

async function bootstrap(runtime) {
  const data = await api('/api/v1/bootstrap');
  state.settings = data.settings;
  $('#medication-label').textContent = data.settings.medicationLabel;
  await loadCheckin(runtime.localDate || data.current.localDate, runtime.slot || data.current.slot);
  fillSettings(); setConnection(true);
  switchView(runtime.view || 'checkin');
}

function wireUi() {
  setRanges();
  $$('.tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-slot]').forEach(button => button.addEventListener('click', () => loadCheckin(state.currentDate || localDate(), button.dataset.slot)));
  $('#checkin-form').addEventListener('submit', saveCheckin);
  $('#hide-window').addEventListener('click', closeWindow);
  $('#refresh-history').addEventListener('click', loadHistory);
  $('#refresh-analytics').addEventListener('click', loadAnalytics);
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#pause-two-hours').addEventListener('click', () => updatePause(new Date(Date.now()+2*3600000).toISOString()));
  $('#resume-reminders').addEventListener('click', () => updatePause(null));
  $('#export-csv').addEventListener('click', () => exportFile('csv'));
  $('#export-json').addEventListener('click', () => exportFile('json'));
  $('#snooze-reminder').addEventListener('click', async () => {
    if (!state.activeReminder) return;
    const {localDate,slot} = state.activeReminder.due;
    await api('/api/v1/reminders/snooze', {method:'POST',body:JSON.stringify({localDate,slot,minutes:30})});
    $('#reminder-banner').classList.add('hidden'); state.activeReminder = null; await closeWindow();
  });
  $('#dismiss-reminder').addEventListener('click', async () => {
    if (!state.activeReminder) return;
    const {localDate,slot} = state.activeReminder.due;
    await api('/api/v1/reminders/dismiss', {method:'POST',body:JSON.stringify({localDate,slot})});
    $('#reminder-banner').classList.add('hidden'); state.activeReminder = null; await closeWindow();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  wireUi();
  try { const runtime = initBrowser(); await bootstrap(runtime); }
  catch (error) { setConnection(false); toast(`Не удалось запустить приложение: ${error.message}`); console.error(error); }
});
