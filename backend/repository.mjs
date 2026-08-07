import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS, normalizeCheckin } from './domain.mjs';
import { createLatestSchema, LATEST_SCHEMA_VERSION } from './schema.mjs';
import { normalizeTreatmentEvent, rowToTreatmentEvent } from './treatment.mjs';

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function rowToCheckin(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    localDate: row.local_date,
    period: row.period,
    slot: row.period === 'day' ? '13:00' : row.period === 'evening' ? '22:00' : null,
    scheduledFor: row.scheduled_for,
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
    mood: row.mood,
    anxiety: row.anxiety,
    irritability: row.irritability,
    energy: row.energy,
    focus: row.focus,
    functioning: row.functioning,
    sleepQuality: row.sleep_quality,
    appetite: row.appetite,
    nightSleepHours: row.night_sleep_hours,
    daySleepHours: row.day_sleep_hours,
    sleepStart: row.sleep_start,
    wakeTime: row.wake_time,
    context: parseJson(row.context_json, []),
    symptoms: parseJson(row.symptoms_json, []),
    activation: parseJson(row.activation_json, []),
    notes: row.notes ?? '',
    redFlags: row.red_flags ?? ''
  };
}

function observationValues(checkin, recordedAt, updatedAt) {
  return [
    checkin.kind, checkin.localDate, checkin.period, checkin.scheduledFor, checkin.observedAt,
    recordedAt, updatedAt, checkin.mood, checkin.anxiety, checkin.irritability,
    checkin.energy, checkin.focus, checkin.functioning, checkin.sleepQuality, checkin.appetite,
    checkin.nightSleepHours, checkin.daySleepHours, checkin.sleepStart, checkin.wakeTime,
    JSON.stringify(checkin.context), JSON.stringify(checkin.symptoms), JSON.stringify(checkin.activation),
    checkin.notes, checkin.redFlags
  ];
}

export function createRepository(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const hasCheckins = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkins'").get();
  if (!hasCheckins) createLatestSchema(db);
  const version = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (version !== LATEST_SCHEMA_VERSION) {
    db.close();
    throw new Error(`Database must be prepared before opening (schema version ${version})`);
  }

  const insert = db.prepare(`
    INSERT INTO checkins (
      kind, local_date, period, scheduled_for, observed_at, recorded_at, updated_at,
      mood, anxiety, irritability, energy, focus, functioning, sleep_quality, appetite,
      night_sleep_hours, day_sleep_hours, sleep_start, wake_time, context_json,
      symptoms_json, activation_json, notes, red_flags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  const update = db.prepare(`
    UPDATE checkins SET
      kind=?, local_date=?, period=?, scheduled_for=?, observed_at=?, updated_at=?,
      mood=?, anxiety=?, irritability=?, energy=?, focus=?, functioning=?, sleep_quality=?, appetite=?,
      night_sleep_hours=?, day_sleep_hours=?, sleep_start=?, wake_time=?, context_json=?,
      symptoms_json=?, activation_json=?, notes=?, red_flags=?
    WHERE id=? RETURNING *
  `);
  const getScheduled = db.prepare("SELECT * FROM checkins WHERE kind='scheduled' AND local_date=? AND period=?");
  const getById = db.prepare('SELECT * FROM checkins WHERE id=?');
  const deleteById = db.prepare('DELETE FROM checkins WHERE id=?');
  const settingUpsert = db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json');
  const reminderUpsert = db.prepare(`
    INSERT INTO reminder_state(local_date,period,snoozed_until,dismissed_at,notified_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(local_date,period) DO UPDATE SET
      snoozed_until=excluded.snoozed_until,
      dismissed_at=excluded.dismissed_at,
      notified_at=excluded.notified_at
  `);
  const treatmentByIdentity = db.prepare(`
    SELECT * FROM treatment_events
    WHERE (effective_date = ?) OR (effective_date IS NULL AND ? IS NULL)
  `);
  const treatmentById = db.prepare('SELECT * FROM treatment_events WHERE id=?');
  const treatmentInsert = db.prepare(`
    INSERT INTO treatment_events(effective_date, regimen_json, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?) RETURNING *
  `);
  const treatmentUpdate = db.prepare(`
    UPDATE treatment_events SET effective_date=?, regimen_json=?, note=?, updated_at=?
    WHERE id=? RETURNING *
  `);

  function buildListQuery({ from = null, to = null, kind = null, period = null } = {}) {
    const conditions = [];
    const params = [];
    if (from) { conditions.push('local_date >= ?'); params.push(from); }
    if (to) { conditions.push('local_date <= ?'); params.push(to); }
    if (kind) { conditions.push('kind = ?'); params.push(kind); }
    if (period) { conditions.push('period = ?'); params.push(period); }
    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
  }

  const repo = {
    createCheckin(input, now = new Date()) {
      const checkin = normalizeCheckin(input);
      const timestamp = now.toISOString();
      return rowToCheckin(insert.get(...observationValues(checkin, timestamp, timestamp)));
    },
    updateCheckin(id, input, now = new Date()) {
      const current = this.getCheckinById(id);
      if (!current) return null;
      const checkin = normalizeCheckin({ ...current, ...input });
      const values = observationValues(checkin, current.recordedAt, now.toISOString());
      values.splice(5, 1);
      return rowToCheckin(update.get(...values, Number(id)));
    },
    getScheduledCheckin(localDate, period) { return rowToCheckin(getScheduled.get(localDate, period)); },
    getCheckinById(id) { return rowToCheckin(getById.get(Number(id))); },
    listCheckins({ limit = 100, offset = 0, ...filters } = {}) {
      const { where, params } = buildListQuery(filters);
      const rows = db.prepare(`SELECT * FROM checkins ${where} ORDER BY local_date DESC, COALESCE(observed_at, recorded_at) DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...params, Math.min(1000, Number(limit) || 100), Math.max(0, Number(offset) || 0));
      return rows.map(rowToCheckin);
    },
    listAllCheckins(filters = {}) {
      const { where, params } = buildListQuery(filters);
      return db.prepare(`SELECT * FROM checkins ${where} ORDER BY local_date DESC, COALESCE(observed_at, recorded_at) DESC, id DESC`).all(...params).map(rowToCheckin);
    },
    deleteCheckin(id) { return deleteById.run(Number(id)).changes > 0; },
    getSettings() {
      const entries = db.prepare('SELECT key,value_json FROM settings').all();
      const saved = Object.fromEntries(entries.map((row) => [row.key, parseJson(row.value_json, null)]));
      return { ...DEFAULT_SETTINGS, ...saved };
    },
    saveSettings(settings) {
      const merged = { ...this.getSettings(), ...settings };
      db.exec('BEGIN');
      try {
        for (const [key, value] of Object.entries(merged)) settingUpsert.run(key, JSON.stringify(value));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return merged;
    },
    getReminderStates(localDate) {
      const rows = db.prepare('SELECT * FROM reminder_state WHERE local_date=?').all(localDate);
      return Object.fromEntries(rows.map((row) => [row.period, {
        snoozedUntil: row.snoozed_until,
        dismissedAt: row.dismissed_at,
        notifiedAt: row.notified_at
      }]));
    },
    saveReminderState(localDate, period, patch) {
      const semanticPeriod = period === '13:00' ? 'day' : period === '22:00' ? 'evening' : period;
      const current = this.getReminderStates(localDate)[semanticPeriod] ?? {};
      const next = { ...current, ...patch };
      reminderUpsert.run(localDate, semanticPeriod, next.snoozedUntil ?? null, next.dismissedAt ?? null, next.notifiedAt ?? null);
      return next;
    },
    clearReminderState(localDate, period) {
      const semanticPeriod = period === '13:00' ? 'day' : period === '22:00' ? 'evening' : period;
      db.prepare('DELETE FROM reminder_state WHERE local_date=? AND period=?').run(localDate, semanticPeriod);
    },
    listTreatmentEvents() {
      return db.prepare('SELECT * FROM treatment_events ORDER BY effective_date IS NOT NULL, effective_date, id').all().map(rowToTreatmentEvent);
    },
    createTreatmentEvent(input, now = new Date()) {
      const event = normalizeTreatmentEvent(input);
      const existing = treatmentByIdentity.get(event.effectiveDate, event.effectiveDate);
      if (existing) throw new TypeError(event.effectiveDate === null ? 'Treatment baseline already exists' : 'Treatment date already exists');
      const timestamp = now.toISOString();
      return rowToTreatmentEvent(treatmentInsert.get(event.effectiveDate, JSON.stringify(event.regimen), event.note, timestamp, timestamp));
    },
    updateTreatmentEvent(id, input, now = new Date()) {
      const current = treatmentById.get(Number(id));
      if (!current) return null;
      const event = normalizeTreatmentEvent(input);
      const duplicate = treatmentByIdentity.get(event.effectiveDate, event.effectiveDate);
      if (duplicate && duplicate.id !== current.id) throw new TypeError(event.effectiveDate === null ? 'Treatment baseline already exists' : 'Treatment date already exists');
      return rowToTreatmentEvent(treatmentUpdate.get(event.effectiveDate, JSON.stringify(event.regimen), event.note, now.toISOString(), Number(id)));
    },
    deleteTreatmentEvent(id) { return db.prepare('DELETE FROM treatment_events WHERE id=?').run(Number(id)).changes > 0; },
    getEffectiveTreatment(localDate) {
      const dated = db.prepare('SELECT * FROM treatment_events WHERE effective_date IS NOT NULL AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1').get(localDate);
      const baseline = db.prepare('SELECT * FROM treatment_events WHERE effective_date IS NULL LIMIT 1').get();
      return rowToTreatmentEvent(dated ?? baseline);
    },
    exportRows() { return db.prepare('SELECT * FROM checkins ORDER BY local_date, id').all().map(rowToCheckin); },
    checkpoint() { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); },
    close() { db.close(); }
  };

  // Compatibility aliases are removed from HTTP usage in Task 2.
  repo.getCheckin = (localDate, slot) => repo.getScheduledCheckin(localDate, slot === '13:00' ? 'day' : 'evening');
  repo.upsertCheckin = (input) => {
    const period = input.period ?? (input.slot === '13:00' ? 'day' : 'evening');
    const semantic = { ...input, kind: input.kind ?? 'scheduled', period, observedAt: input.observedAt ?? input.recordedAt };
    const existing = repo.getScheduledCheckin(input.localDate, period);
    return existing
      ? repo.updateCheckin(existing.id, semantic, new Date(input.updatedAt ?? Date.now()))
      : repo.createCheckin(semantic, new Date(input.recordedAt ?? Date.now()));
  };
  return repo;
}
