import { SCALE_FIELDS } from './domain.mjs';

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return Math.round((finite.reduce((a, b) => a + b, 0) / finite.length) * 100) / 100;
}

function metricMeans(rows) {
  return Object.fromEntries(SCALE_FIELDS.map((field) => [field, average(rows.map((row) => Number(row[field])))]));
}

function countFlags(rows, field) {
  const counts = {};
  for (const row of rows) for (const value of row[field] ?? []) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function buildAnalytics(rows, settings = {}) {
  const ordered = [...rows].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.slot.localeCompare(b.slot));
  const byDate = new Map();
  for (const row of ordered) {
    const group = byDate.get(row.localDate) ?? [];
    group.push(row);
    byDate.set(row.localDate, group);
  }
  const daily = [...byDate.entries()].map(([date, dayRows]) => ({ date, count: dayRows.length, ...metricMeans(dayRows) }));
  for (let i = 0; i < daily.length; i++) {
    const start = Math.max(0, i - 1);
    const end = Math.min(daily.length, i + 2);
    const slice = daily.slice(start, end);
    daily[i].rolling = Object.fromEntries(SCALE_FIELDS.map((field) => [field, average(slice.map((day) => day[field]))]));
  }

  const pairedDeltas = [];
  for (const dayRows of byDate.values()) {
    const day = dayRows.find((row) => row.slot === '13:00');
    const evening = dayRows.find((row) => row.slot === '22:00');
    if (!day || !evening) continue;
    pairedDeltas.push(Object.fromEntries(SCALE_FIELDS.map((field) => [field, Number(evening[field]) - Number(day[field])] )));
  }
  const pairedDelta = Object.fromEntries(SCALE_FIELDS.map((field) => [field, average(pairedDeltas.map((row) => row[field]))]));

  const treatmentDate = settings.treatmentChangeDate || daily[0]?.date;
  const post = treatmentDate ? daily.filter((day) => day.date >= treatmentDate) : daily;
  const first7Dates = new Set(post.slice(0, 7).map((day) => day.date));
  const first7Rows = ordered.filter((row) => first7Dates.has(row.localDate));
  const laterRows = ordered.filter((row) => post.length > 7 && row.localDate > post[6].date);

  return {
    generatedAt: new Date().toISOString(),
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
    periods: {
      first7: metricMeans(first7Rows),
      later: metricMeans(laterRows)
    }
  };
}
