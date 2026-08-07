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
  remindersPausedUntil: null
});

function normalizeScale(value, field, required) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw new TypeError(`${field} is required`);
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10) throw new TypeError(`Invalid ${field}`);
  return Math.round(number * 10) / 10;
}

function optionalHours(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 24) throw new TypeError('Invalid sleep hours');
  return Math.round(number * 10) / 10;
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeTimestamp(value, field, { nullable = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new TypeError(`${field} is required`);
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError(`Invalid ${field}`);
  return value;
}

export function normalizeCheckin(input = {}, { allowMissingObservedAt = false } = {}) {
  if (!isLocalDate(input.localDate)) throw new TypeError('Invalid localDate');

  const kind = input.kind;
  const period = input.period;
  if (!['scheduled', 'extra'].includes(kind)) throw new TypeError('Invalid kind');
  if (kind === 'scheduled' && !['day', 'evening'].includes(period)) throw new TypeError('Invalid period');
  if (kind === 'extra' && period !== null) throw new TypeError('Extra period must be null');

  const normalized = {
    kind,
    localDate: input.localDate,
    period,
    scheduledFor: normalizeTimestamp(input.scheduledFor, 'scheduledFor', { nullable: true }),
    observedAt: normalizeTimestamp(input.observedAt, 'observedAt', { nullable: allowMissingObservedAt }),
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

  for (const field of SCALE_FIELDS) normalized[field] = normalizeScale(input[field], field, kind === 'scheduled');
  if (kind === 'extra') {
    const hasMeaningfulValue = SCALE_FIELDS.some((field) => normalized[field] !== null)
      || normalized.nightSleepHours !== null || normalized.daySleepHours !== null
      || normalized.sleepStart !== null || normalized.wakeTime !== null
      || normalized.context.length > 0 || normalized.symptoms.length > 0 || normalized.activation.length > 0
      || normalized.notes.length > 0 || normalized.redFlags.length > 0;
    if (!hasMeaningfulValue) throw new TypeError('Extra must contain at least one meaningful value');
  }
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
  return Math.abs(date.getTime() - day.getTime()) <= Math.abs(date.getTime() - evening.getTime()) ? '13:00' : '22:00';
}

export function scheduledWindows(date, settings = DEFAULT_SETTINGS) {
  return [
    { slot: '13:00', period: 'day', scheduledAt: parseTimeOnDate(date, settings.dayTime) },
    { slot: '22:00', period: 'evening', scheduledAt: parseTimeOnDate(date, settings.eveningTime) }
  ];
}
