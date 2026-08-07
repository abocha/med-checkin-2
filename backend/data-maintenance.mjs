import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACTIVATION_FIELDS, CONTEXT_FIELDS, DEFAULT_SETTINGS, SCALE_FIELDS, SYMPTOM_FIELDS, normalizeCheckin
} from './domain.mjs';
import { createTimestampedBackup } from './backups.mjs';
import { prepareDatabase as prepareDatabaseDefault } from './migrations.mjs';
import { LATEST_SCHEMA_VERSION } from './schema.mjs';
import { normalizeTreatmentEvent } from './treatment.mjs';

const PORTABLE_FORMAT = 'med-checkin-2';
const PORTABLE_VERSION = 1;
const PORTABLE_SETTINGS = ['dayTime', 'eveningTime', 'catchupHours', 'repeatMinutes'];
const BACKUP_PATTERN = /^(?:med-checkin-(\d{4}-\d{2}-\d{2})|(?:manual|pre-migration|pre-restore|pre-import)-(\d{8}T\d{6}Z))\.sqlite$/;
const V1_REQUIRED_COLUMNS = Object.freeze({
  checkins: [
    'id', 'kind', 'local_date', 'period', 'scheduled_for', 'observed_at', 'recorded_at', 'updated_at',
    'mood', 'anxiety', 'irritability', 'energy', 'focus', 'functioning', 'sleep_quality', 'appetite',
    'night_sleep_hours', 'day_sleep_hours', 'sleep_start', 'wake_time', 'context_json',
    'symptoms_json', 'activation_json', 'notes', 'red_flags'
  ],
  settings: ['key', 'value_json'],
  reminder_state: ['local_date', 'period', 'snoozed_until', 'dismissed_at', 'notified_at'],
  treatment_events: ['id', 'effective_date', 'regimen_json', 'note', 'created_at', 'updated_at']
});

function backupSortKey(name) {
  const match = BACKUP_PATTERN.exec(name);
  return match?.[2] ?? `${match?.[1]?.replaceAll('-', '') ?? ''}T000000Z`;
}

function backupInfo(path) {
  const stats = statSync(path);
  return { name: basename(path), size: stats.size, modifiedAt: stats.mtime.toISOString() };
}

export function listBackups(backupDir) {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => BACKUP_PATTERN.test(name))
    .sort((a, b) => backupSortKey(b).localeCompare(backupSortKey(a)))
    .map((name) => backupInfo(join(backupDir, name)));
}

export function createManualBackup({ repo, dbPath, backupDir, now = new Date() }) {
  repo.checkpoint();
  return createTimestampedBackup({ dbPath, backupDir, prefix: 'manual', now });
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function validateV1Schema(db) {
  for (const [table, requiredColumns] of Object.entries(V1_REQUIRED_COLUMNS)) {
    const columns = tableColumns(db, table);
    if (requiredColumns.some((column) => !columns.has(column))) {
      throw new TypeError(`Unrecognized Med Check-in schema: incomplete ${table} table`);
    }
  }
}

export function validateBackupFile(path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const quickCheck = db.prepare('PRAGMA quick_check').get();
    if (Object.values(quickCheck)[0] !== 'ok') throw new TypeError('SQLite integrity check failed');
    const userVersion = Number(db.prepare('PRAGMA user_version').get().user_version);
    if (userVersion > LATEST_SCHEMA_VERSION) throw new TypeError(`Backup uses newer schema version ${userVersion}`);
    if (![0, LATEST_SCHEMA_VERSION].includes(userVersion)) throw new TypeError(`Unsupported schema version ${userVersion}`);
    const hasCheckins = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkins'").get();
    if (!hasCheckins) throw new TypeError('Backup is not a recognized Med Check-in database');
    const columns = tableColumns(db, 'checkins');
    if (userVersion === 0 && !columns.has('slot')) throw new TypeError('Unrecognized legacy Med Check-in schema');
    if (userVersion === 1) validateV1Schema(db);
    return { userVersion };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`Invalid SQLite backup: ${error.message}`);
  } finally {
    try { db?.close(); } catch {}
  }
}

function removeSidecars(dbPath) {
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

export function restoreDatabase({
  repo, dbPath, backupDir, backupName, now = new Date(), prepareDatabase = prepareDatabaseDefault
}) {
  if (typeof backupName !== 'string' || basename(backupName) !== backupName) throw new TypeError('Restore requires a recognized app backup');
  const recognized = new Set(listBackups(backupDir).map((item) => item.name));
  if (!recognized.has(backupName)) throw new TypeError('Restore requires a recognized app backup');
  const source = resolve(backupDir, backupName);
  const validated = validateBackupFile(source);
  repo.checkpoint();
  const preRestoreBackupPath = createTimestampedBackup({ dbPath, backupDir, prefix: 'pre-restore', now });
  let repositoryClosed = false;
  try {
    repo.close();
    repositoryClosed = true;
    removeSidecars(dbPath);
    copyFileSync(source, dbPath);
    prepareDatabase({ dbPath, backupDir, now });
    return {
      name: backupName,
      preRestoreBackupPath,
      restoredUserVersion: validated.userVersion,
      restartRequired: true
    };
  } catch (error) {
    if (repositoryClosed) {
      removeSidecars(dbPath);
      copyFileSync(preRestoreBackupPath, dbPath);
      try { prepareDatabase({ dbPath, backupDir, now }); } catch {}
      error.repositoryClosed = true;
      error.preRestoreBackupPath = preRestoreBackupPath;
    }
    throw error;
  }
}

function validTimestamp(value, field, { nullable = false, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError(`Invalid ${field}`);
  return value;
}

function validateFlags(values, allowed, field) {
  if (!Array.isArray(values) || values.some((value) => !allowed.includes(value))) throw new TypeError(`Invalid ${field}`);
}

function validateObservation(input, ids, scheduledIdentities) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid observation');
  if (input.id !== undefined) {
    if (!Number.isInteger(input.id) || input.id <= 0 || ids.has(input.id)) throw new TypeError('Invalid or duplicate observation id');
    ids.add(input.id);
  }
  for (const field of SCALE_FIELDS) {
    if (input[field] !== null && typeof input[field] !== 'number') throw new TypeError(`Invalid ${field}`);
  }
  validateFlags(input.context ?? [], CONTEXT_FIELDS, 'context');
  validateFlags(input.symptoms ?? [], SYMPTOM_FIELDS, 'symptoms');
  validateFlags(input.activation ?? [], ACTIVATION_FIELDS, 'activation');
  if (input.notes !== undefined && typeof input.notes !== 'string') throw new TypeError('Invalid notes');
  if (input.redFlags !== undefined && typeof input.redFlags !== 'string') throw new TypeError('Invalid redFlags');
  const allowMissingObservedAt = input.kind === 'scheduled' && input.observedAt === null;
  const normalized = normalizeCheckin(input, { allowMissingObservedAt });
  const recordedAt = validTimestamp(input.recordedAt, 'recordedAt', { optional: true });
  const updatedAt = validTimestamp(input.updatedAt, 'updatedAt', { optional: true });
  if (input.kind === 'scheduled') {
    const identity = `${normalized.localDate}|${normalized.period}`;
    if (scheduledIdentities.has(identity)) throw new TypeError('Duplicate scheduled identity');
    scheduledIdentities.add(identity);
  }
  return { ...normalized, ...(input.id === undefined ? {} : { id: input.id }), recordedAt, updatedAt };
}

function validateTreatment(input, ids, identities) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid treatment event');
  if (input.id !== undefined) {
    if (!Number.isInteger(input.id) || input.id <= 0 || ids.has(input.id)) throw new TypeError('Invalid or duplicate treatment event id');
    ids.add(input.id);
  }
  const normalized = normalizeTreatmentEvent(input);
  const identity = normalized.effectiveDate ?? 'baseline';
  if (identities.has(identity)) throw new TypeError('Duplicate treatment date or baseline');
  identities.add(identity);
  return {
    ...normalized,
    ...(input.id === undefined ? {} : { id: input.id }),
    createdAt: validTimestamp(input.createdAt, 'createdAt', { optional: true }),
    updatedAt: validTimestamp(input.updatedAt, 'updatedAt', { optional: true })
  };
}

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Invalid portable settings');
  const keys = Object.keys(settings).sort();
  if (keys.join('|') !== [...PORTABLE_SETTINGS].sort().join('|')) throw new TypeError('Portable settings must contain only the supported values');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.dayTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.eveningTime)) throw new TypeError('Invalid reminder time');
  if (!Number.isFinite(settings.catchupHours) || settings.catchupHours < 1 || settings.catchupHours > 12) throw new TypeError('Invalid catchupHours');
  if (!Number.isFinite(settings.repeatMinutes) || settings.repeatMinutes < 15 || settings.repeatMinutes > 240) throw new TypeError('Invalid repeatMinutes');
  return Object.fromEntries(PORTABLE_SETTINGS.map((key) => [key, settings[key]]));
}

export function validatePortableImport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Invalid portable JSON');
  if (payload.format !== PORTABLE_FORMAT) throw new TypeError('Invalid portable format');
  if (payload.formatVersion !== PORTABLE_VERSION) throw new TypeError(`Unsupported portable format version ${payload.formatVersion}`);
  validTimestamp(payload.exportedAt, 'exportedAt');
  if (!Array.isArray(payload.observations) || !Array.isArray(payload.treatmentEvents)) throw new TypeError('Invalid portable collections');
  const observationIds = new Set();
  const scheduledIdentities = new Set();
  const treatmentIds = new Set();
  const treatmentIdentities = new Set();
  return {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_VERSION,
    exportedAt: payload.exportedAt,
    observations: payload.observations.map((item) => validateObservation(item, observationIds, scheduledIdentities)),
    treatmentEvents: payload.treatmentEvents.map((item) => validateTreatment(item, treatmentIds, treatmentIdentities)),
    settings: validateSettings(payload.settings)
  };
}

export function previewPortableImport(payload) {
  const data = validatePortableImport(payload);
  const dates = data.observations.map((item) => item.localDate).sort();
  return {
    format: data.format,
    formatVersion: data.formatVersion,
    observationCount: data.observations.length,
    extraCount: data.observations.filter((item) => item.kind === 'extra').length,
    treatmentEventCount: data.treatmentEvents.length,
    dateFrom: dates[0] ?? null,
    dateTo: dates.at(-1) ?? null
  };
}

export function buildPortableExport(repo, now = new Date()) {
  const settings = repo.getSettings();
  return {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_VERSION,
    exportedAt: now.toISOString(),
    observations: repo.listAllCheckins(),
    treatmentEvents: repo.listTreatmentEvents(),
    settings: Object.fromEntries(PORTABLE_SETTINGS.map((key) => [key, settings[key] ?? DEFAULT_SETTINGS[key]]))
  };
}

export function replacePortableData({ repo, dbPath, backupDir, payload, now = new Date() }) {
  const data = validatePortableImport(payload);
  repo.checkpoint();
  const preImportBackupPath = createTimestampedBackup({ dbPath, backupDir, prefix: 'pre-import', now });
  const result = repo.replacePortableData(data, now);
  return { ...previewPortableImport(data), ...result, preImportBackupPath };
}

export function createDataMaintenance({ repo, dbPath, backupDir, now = () => new Date(), prepareDatabase = prepareDatabaseDefault }) {
  return {
    listBackups: () => listBackups(backupDir),
    createBackup: () => backupInfo(createManualBackup({ repo, dbPath, backupDir, now: now() })),
    restoreBackup: (name) => restoreDatabase({ repo, dbPath, backupDir, backupName: name, now: now(), prepareDatabase }),
    exportPortable: () => buildPortableExport(repo, now()),
    previewImport: (payload) => previewPortableImport(payload),
    replaceImport: (payload) => replacePortableData({ repo, dbPath, backupDir, payload, now: now() })
  };
}
