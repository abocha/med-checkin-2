import { SCALE_FIELDS } from './domain.mjs';

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return Math.round((finite.reduce((a, b) => a + b, 0) / finite.length) * 100) / 100;
}

function metricMeans(rows) {
  return Object.fromEntries(SCALE_FIELDS.map((field) => [field, average(rows.map((row) => row[field]))]));
}

function countFlags(rows, field) {
  const counts = {};
  for (const row of rows) for (const value of row[field] ?? []) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function periodFor(row) {
  return row.period ?? (row.slot === '13:00' ? 'day' : row.slot === '22:00' ? 'evening' : null);
}

function dateOffset(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function localDate(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function completionStats(rows, settings, now) {
  if (!rows.length) return { completed: 0, opportunities: 0, rate: null };
  const firstDate = rows.reduce((first, row) => row.localDate < first ? row.localDate : first, rows[0].localDate);
  const today = localDate(now);
  const completed = new Set(rows.map((row) => `${row.localDate}|${row.period}`));
  let opportunities = 0;
  let completedCount = 0;
  for (let date = firstDate; date <= today; date = dateOffset(date, 1)) {
    for (const [period, time] of [['day', settings.dayTime ?? '13:00'], ['evening', settings.eveningTime ?? '22:00']]) {
      const key = `${date}|${period}`;
      const isCompleted = completed.has(key);
      const isPast = date < today || now >= new Date(`${date}T${time}:00`);
      if (!isPast && !isCompleted) continue;
      opportunities += 1;
      if (isCompleted) completedCount += 1;
    }
  }
  return { completed: completedCount, opportunities, rate: opportunities ? Math.round(completedCount / opportunities * 10000) / 100 : null };
}

export function buildAnalytics(rows, settings = {}, { now = new Date(), treatmentEvents = [] } = {}) {
  const scheduled = rows
    .filter((row) => row.kind !== 'extra')
    .map((row) => ({ ...row, period: periodFor(row) }))
    .filter((row) => ['day', 'evening'].includes(row.period));
  const ordered = [...scheduled].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.period.localeCompare(b.period));
  const byDate = new Map();
  for (const row of ordered) {
    const group = byDate.get(row.localDate) ?? [];
    group.push(row);
    byDate.set(row.localDate, group);
  }
  const daily = [...byDate.entries()].map(([date, dayRows]) => ({ date, count: dayRows.length, ...metricMeans(dayRows) }));
  const byDailyDate = new Map(daily.map((day) => [day.date, day]));
  for (const day of daily) {
    const window = [0, -1, -2].map((offset) => byDailyDate.get(dateOffset(day.date, offset))).filter(Boolean);
    day.rolling = Object.fromEntries(SCALE_FIELDS.map((field) => [field, average(window.map((item) => item[field]))]));
  }

  const pairedDeltas = [];
  for (const dayRows of byDate.values()) {
    const day = dayRows.find((row) => row.period === 'day');
    const evening = dayRows.find((row) => row.period === 'evening');
    if (!day || !evening) continue;
    pairedDeltas.push(Object.fromEntries(SCALE_FIELDS.map((field) => [field,
      Number.isFinite(day[field]) && Number.isFinite(evening[field]) ? evening[field] - day[field] : null
    ])));
  }
  const pairedDelta = Object.fromEntries(SCALE_FIELDS.map((field) => [field, average(pairedDeltas.map((row) => row[field]))]));

  return {
    generatedAt: now.toISOString(),
    count: ordered.length,
    days: daily.length,
    overall: metricMeans(ordered),
    daily,
    pairedDelta,
    pairedDays: pairedDeltas.length,
    frequencies: {
      context: countFlags(ordered, 'context'),
      symptoms: countFlags(ordered, 'symptoms'),
      activation: countFlags(ordered, 'activation')
    },
    completion: completionStats(ordered, settings, now),
    treatmentMarkers: treatmentEvents
      .filter((event) => event.effectiveDate)
      .map((event) => ({ id: event.id, effectiveDate: event.effectiveDate, note: event.note }))
  };
}
