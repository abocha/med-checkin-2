export const SCALE_FIELDS = [
  'mood', 'anxiety', 'irritability', 'energy', 'focus',
  'functioning', 'sleepQuality', 'appetite'
];

export const CONTEXT_FIELDS = [
  'caffeine', 'stress', 'conflict', 'illnessPain',
  'physicalActivity', 'positiveProductiveDay'
];

export const SYMPTOM_FIELDS = [
  'dizziness', 'headache', 'nausea', 'sweating', 'palpitations',
  'brainZaps', 'unusualDreams', 'crying'
];

export const ACTIVATION_FIELDS = [
  'reducedSleepNeed', 'racingThoughts', 'talkativeness',
  'innerMotor', 'impulsivity', 'elevatedAgitated'
];

export const DEFAULT_SETTINGS = Object.freeze({
  dayTime: '13:00',
  eveningTime: '22:00',
  catchupHours: 4,
  repeatMinutes: 30,
  treatmentChangeDate: '2026-07-07',
  medicationLabel: 'Эсциталопрам 10 мг · Атомоксетин 80 мг',
  remindersPausedUntil: null
});

function clampScale(value, fallback = 5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(10, Math.max(0, Math.round(number * 10) / 10));
}

function optionalHours(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(24, Math.max(0, Math.round(number * 10) / 10));
}

function normalizeFlags(values, allowed) {
  if (!Array.isArray(values)) return [];
  const allowedSet = new Set(allowed);
  return [...new Set(values.filter((value) => allowedSet.has(value)))];
}

function normalizeText(value, maxLength = 8000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function isLocalDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

export function normalizeCheckin(input = {}, now = new Date()) {
  if (!isLocalDate(input.localDate)) throw new TypeError('Invalid localDate');
  if (!['13:00', '22:00'].includes(input.slot)) throw new TypeError('Invalid slot');

  const normalized = {
    localDate: input.localDate,
    slot: input.slot,
    recordedAt: input.recordedAt || now.toISOString(),
    updatedAt: now.toISOString(),
    nightSleepHours: optionalHours(input.nightSleepHours),
    daySleepHours: optionalHours(input.daySleepHours),
    sleepStart: /^\d{2}:\d{2}$/.test(input.sleepStart ?? '') ? input.sleepStart : null,
    wakeTime: /^\d{2}:\d{2}$/.test(input.wakeTime ?? '') ? input.wakeTime : null,
    context: normalizeFlags(input.context, CONTEXT_FIELDS),
    symptoms: normalizeFlags(input.symptoms, SYMPTOM_FIELDS),
    activation: normalizeFlags(input.activation, ACTIVATION_FIELDS),
    notes: normalizeText(input.notes),
    redFlags: normalizeText(input.redFlags)
  };

  for (const field of SCALE_FIELDS) normalized[field] = clampScale(input[field]);
  return normalized;
}

export function parseTimeOnDate(date, hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function slotForTime(date, settings = DEFAULT_SETTINGS) {
  const day = parseTimeOnDate(date, settings.dayTime);
  const evening = parseTimeOnDate(date, settings.eveningTime);
  const dayDistance = Math.abs(date.getTime() - day.getTime());
  const eveningDistance = Math.abs(date.getTime() - evening.getTime());
  return dayDistance <= eveningDistance ? '13:00' : '22:00';
}

export function scheduledWindows(date, settings = DEFAULT_SETTINGS) {
  return [
    { slot: '13:00', scheduledAt: parseTimeOnDate(date, settings.dayTime) },
    { slot: '22:00', scheduledAt: parseTimeOnDate(date, settings.eveningTime) }
  ];
}
