import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, normalizeCheckin } from './domain.mjs';
import { createLatestSchema, LATEST_SCHEMA_VERSION } from './schema.mjs';
import { activeScaleIds, normalizeScaleDefinition } from './scales.mjs';
import { normalizeTrackedItem, TRACKED_ITEM_CATEGORIES } from './tracked-items.mjs';
import { normalizeTreatmentEvent, rowToTreatmentEvent } from './treatment.mjs';

function parseJson(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function rowToTrackedItem(row) { return row && { id: row.id, category: row.category, label: row.label, active: Boolean(row.active), sortOrder: row.sort_order }; }
function rowToScaleDefinition(row) { return row && { id: row.id, label: row.label, active: Boolean(row.active), sortOrder: row.sort_order }; }
function rowToCheckin(row, scales) {
  if (!row) return null;
  return {
    id: row.id, kind: row.kind, localDate: row.local_date, period: row.period,
    slot: row.period === 'day' ? '13:00' : row.period === 'evening' ? '22:00' : null,
    scheduledFor: row.scheduled_for, observedAt: row.observed_at, recordedAt: row.recorded_at, updatedAt: row.updated_at,
    scales, nightSleepHours: row.night_sleep_hours, daySleepHours: row.day_sleep_hours,
    sleepStart: row.sleep_start, wakeTime: row.wake_time, context: parseJson(row.context_json, []),
    symptoms: parseJson(row.symptoms_json, []), activation: parseJson(row.activation_json, []),
    notes: row.notes ?? '', redFlags: row.red_flags ?? ''
  };
}
function observationValues(checkin, recordedAt, updatedAt) {
  return [
    checkin.kind, checkin.localDate, checkin.period, checkin.scheduledFor, checkin.observedAt, recordedAt, updatedAt,
    checkin.nightSleepHours, checkin.daySleepHours, checkin.sleepStart, checkin.wakeTime,
    JSON.stringify(checkin.context), JSON.stringify(checkin.symptoms), JSON.stringify(checkin.activation), checkin.notes, checkin.redFlags
  ];
}

export function createRepository(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkins'").get()) createLatestSchema(db);
  const version = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (version !== LATEST_SCHEMA_VERSION) { db.close(); throw new Error(`Database must be prepared before opening (schema version ${version})`); }

  const insert = db.prepare(`INSERT INTO checkins(kind,local_date,period,scheduled_for,observed_at,recorded_at,updated_at,night_sleep_hours,day_sleep_hours,sleep_start,wake_time,context_json,symptoms_json,activation_json,notes,red_flags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`);
  const update = db.prepare(`UPDATE checkins SET kind=?,local_date=?,period=?,scheduled_for=?,observed_at=?,updated_at=?,night_sleep_hours=?,day_sleep_hours=?,sleep_start=?,wake_time=?,context_json=?,symptoms_json=?,activation_json=?,notes=?,red_flags=? WHERE id=? RETURNING *`);
  const portableObservationInsert = db.prepare(`INSERT INTO checkins(id,kind,local_date,period,scheduled_for,observed_at,recorded_at,updated_at,night_sleep_hours,day_sleep_hours,sleep_start,wake_time,context_json,symptoms_json,activation_json,notes,red_flags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const getScheduled = db.prepare("SELECT * FROM checkins WHERE kind='scheduled' AND local_date=? AND period=?");
  const getById = db.prepare('SELECT * FROM checkins WHERE id=?');
  const scaleValuesByCheckin = db.prepare('SELECT scale_id, value FROM checkin_scale_values WHERE checkin_id=? ORDER BY scale_id');
  const scaleValueDelete = db.prepare('DELETE FROM checkin_scale_values WHERE checkin_id=?');
  const scaleValueInsert = db.prepare('INSERT INTO checkin_scale_values(checkin_id,scale_id,value) VALUES(?,?,?)');
  const deleteById = db.prepare('DELETE FROM checkins WHERE id=?');
  const settingUpsert = db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json');
  const reminderUpsert = db.prepare('INSERT INTO reminder_state(local_date,period,snoozed_until,dismissed_at,notified_at) VALUES(?,?,?,?,?) ON CONFLICT(local_date,period) DO UPDATE SET snoozed_until=excluded.snoozed_until,dismissed_at=excluded.dismissed_at,notified_at=excluded.notified_at');
  const treatmentByIdentity = db.prepare('SELECT * FROM treatment_events WHERE (effective_date = ?) OR (effective_date IS NULL AND ? IS NULL)');
  const treatmentById = db.prepare('SELECT * FROM treatment_events WHERE id=?');
  const treatmentInsert = db.prepare('INSERT INTO treatment_events(effective_date,regimen_json,note,created_at,updated_at) VALUES(?,?,?,?,?) RETURNING *');
  const treatmentUpdate = db.prepare('UPDATE treatment_events SET effective_date=?,regimen_json=?,note=?,updated_at=? WHERE id=? RETURNING *');
  const portableTreatmentInsert = db.prepare('INSERT INTO treatment_events(id,effective_date,regimen_json,note,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  const trackedItemInsert = db.prepare('INSERT INTO tracked_items(id,category,label,active,sort_order) VALUES(?,?,?,?,?) RETURNING *');
  const trackedItemById = db.prepare('SELECT * FROM tracked_items WHERE id=?');
  const trackedItemUpdate = db.prepare('UPDATE tracked_items SET label=?,active=? WHERE id=? RETURNING *');
  const trackedOrderUpdate = db.prepare('UPDATE tracked_items SET sort_order=? WHERE id=?');
  const portableTrackedItemInsert = db.prepare('INSERT INTO tracked_items(id,category,label,active,sort_order) VALUES(?,?,?,?,?)');
  const scaleDefinitionInsert = db.prepare('INSERT INTO scale_definitions(id,label,active,sort_order) VALUES(?,?,?,?) RETURNING *');
  const scaleDefinitionById = db.prepare('SELECT * FROM scale_definitions WHERE id=?');
  const scaleDefinitionUpdate = db.prepare('UPDATE scale_definitions SET label=?,active=?,sort_order=? WHERE id=? RETURNING *');
  const scaleOrderUpdate = db.prepare('UPDATE scale_definitions SET sort_order=? WHERE id=?');
  const portableScaleDefinitionInsert = db.prepare('INSERT INTO scale_definitions(id,label,active,sort_order) VALUES(?,?,?,?)');

  const hydrateCheckin = (row) => rowToCheckin(row, Object.fromEntries(scaleValuesByCheckin.all(row.id).map((value) => [value.scale_id, value.value])));
  const writeScaleValues = (id, scales) => { for (const [scaleId, value] of Object.entries(scales)) scaleValueInsert.run(id, scaleId, value); };
  const transaction = (work) => { db.exec('BEGIN IMMEDIATE'); try { const value = work(); db.exec('COMMIT'); return value; } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; } };
  const listDefinitions = () => db.prepare('SELECT * FROM scale_definitions ORDER BY active DESC, CASE WHEN active=1 THEN sort_order ELSE 0 END, id').all().map(rowToScaleDefinition);
  const normalizeForCreate = (input, repo) => {
    const definitions = repo.listScaleDefinitions();
    if (input.scaleSnapshot !== undefined) throw new TypeError('scaleSnapshot is unsupported');
    if (input.kind !== 'scheduled') return normalizeCheckin(input, { trackedItems: repo.listTrackedItems(), scaleDefinitions: definitions });
    return normalizeCheckin(input, { trackedItems: repo.listTrackedItems(), scaleDefinitions: definitions, requiredScaleIds: activeScaleIds(definitions) });
  };

  const repo = {
    createCheckin(input, now = new Date()) {
      const checkin = normalizeForCreate(input, this);
      const timestamp = now.toISOString();
      return transaction(() => { const row = insert.get(...observationValues(checkin, timestamp, timestamp)); writeScaleValues(row.id, checkin.scales); return hydrateCheckin(row); });
    },
    updateCheckin(id, input, now = new Date()) {
      const current = this.getCheckinById(id); if (!current) return null;
      const merged = { ...current, ...input };
      const definitions = this.listScaleDefinitions();
      const options = { allowMissingObservedAt: current.observedAt === null && merged.observedAt === null, trackedItems: this.listTrackedItems(), scaleDefinitions: definitions };
      if (merged.kind === 'scheduled') {
        const historicalIds = current.kind === 'scheduled' ? Object.keys(current.scales) : activeScaleIds(definitions);
        options.requiredScaleIds = historicalIds;
        options.allowedInactiveScaleIds = current.kind === 'scheduled' ? historicalIds : [];
      } else options.allowedInactiveScaleIds = Object.keys(current.scales);
      const checkin = normalizeCheckin(merged, options);
      return transaction(() => { const values = observationValues(checkin, current.recordedAt, now.toISOString()); values.splice(5, 1); const row = update.get(...values, Number(id)); scaleValueDelete.run(Number(id)); writeScaleValues(Number(id), checkin.scales); return hydrateCheckin(row); });
    },
    getScheduledCheckin(localDate, period) { const row = getScheduled.get(localDate, period); return row ? hydrateCheckin(row) : null; },
    getCheckinById(id) { const row = getById.get(Number(id)); return row ? hydrateCheckin(row) : null; },
    listCheckins({ limit = 100, offset = 0, ...filters } = {}) { return this.listAllCheckins(filters).slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.min(1000, Number(limit) || 100)); },
    listAllCheckins({ from = null, to = null, kind = null, period = null } = {}) {
      const conditions = [], params = []; if (from) { conditions.push('local_date >= ?'); params.push(from); } if (to) { conditions.push('local_date <= ?'); params.push(to); } if (kind) { conditions.push('kind = ?'); params.push(kind); } if (period) { conditions.push('period = ?'); params.push(period); }
      return db.prepare(`SELECT * FROM checkins ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY local_date DESC, COALESCE(observed_at,recorded_at) DESC,id DESC`).all(...params).map(hydrateCheckin);
    },
    listScaleDefinitions() { return listDefinitions(); },
    createScaleDefinition({ label } = {}) { const sortOrder = this.listScaleDefinitions().filter((item) => item.active).length; const item = normalizeScaleDefinition({ id: `custom:${randomUUID()}`, label, active: true, sortOrder }); return rowToScaleDefinition(scaleDefinitionInsert.get(item.id, item.label, 1, item.sortOrder)); },
    updateScaleDefinition(id, patch = {}) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !['label', 'active'].includes(key))) throw new TypeError('Invalid scale definition patch');
      const current = rowToScaleDefinition(scaleDefinitionById.get(id)); if (!current) return null;
      const activeCount = this.listScaleDefinitions().filter((item) => item.active).length;
      if (current.active && patch.active === false && activeCount === 1) throw new TypeError('At least one scale must remain active');
      return transaction(() => {
        const nextActive = patch.active ?? current.active;
        const next = normalizeScaleDefinition({ ...current, ...patch, active: nextActive, sortOrder: !current.active && nextActive ? activeCount : current.sortOrder });
        scaleDefinitionUpdate.get(next.label, Number(next.active), next.sortOrder, id);
        if (current.active && !next.active) this.listScaleDefinitions().filter((item) => item.active).forEach((item, index) => scaleOrderUpdate.run(index, item.id));
        return rowToScaleDefinition(scaleDefinitionById.get(id));
      });
    },
    reorderScaleDefinitions(orderedActiveIds) {
      if (!Array.isArray(orderedActiveIds)) throw new TypeError('Invalid scale order');
      const active = this.listScaleDefinitions().filter((item) => item.active); const ids = new Set(active.map((item) => item.id));
      if (orderedActiveIds.length !== active.length || new Set(orderedActiveIds).size !== orderedActiveIds.length || orderedActiveIds.some((id) => !ids.has(id))) throw new TypeError('Scale order must include the complete active set');
      transaction(() => orderedActiveIds.forEach((id, index) => scaleOrderUpdate.run(index, id))); return this.listScaleDefinitions().filter((item) => item.active);
    },
    listTrackedItems() { return db.prepare('SELECT * FROM tracked_items ORDER BY category,sort_order,id').all().map(rowToTrackedItem); },
    createTrackedItem({ category, label } = {}) { if (!TRACKED_ITEM_CATEGORIES.includes(category)) throw new TypeError('Invalid tracked item category'); const sortOrder = Number(db.prepare('SELECT COUNT(*) AS count FROM tracked_items WHERE category=?').get(category).count); const item = normalizeTrackedItem({ id: `custom:${randomUUID()}`, category, label, active: true, sortOrder }); return rowToTrackedItem(trackedItemInsert.get(item.id, item.category, item.label, 1, item.sortOrder)); },
    updateTrackedItem(id, patch = {}) { if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !['label', 'active'].includes(key))) throw new TypeError('Invalid tracked item patch'); const current = rowToTrackedItem(trackedItemById.get(id)); if (!current) return null; const item = normalizeTrackedItem({ ...current, ...patch }); return rowToTrackedItem(trackedItemUpdate.get(item.label, Number(item.active), item.id)); },
    reorderTrackedItems(category, orderedIds) { if (!TRACKED_ITEM_CATEGORIES.includes(category) || !Array.isArray(orderedIds)) throw new TypeError('Invalid tracked item order'); const current = this.listTrackedItems().filter((item) => item.category === category), ids = new Set(current.map((item) => item.id)); if (orderedIds.length !== current.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !ids.has(id))) throw new TypeError('Tracked item order must include the complete category'); transaction(() => orderedIds.forEach((id, index) => trackedOrderUpdate.run(index, id))); return this.listTrackedItems().filter((item) => item.category === category); },
    deleteCheckin(id) { return deleteById.run(Number(id)).changes > 0; },
    getSettings() { const entries = db.prepare('SELECT key,value_json FROM settings').all(); return { ...DEFAULT_SETTINGS, ...Object.fromEntries(entries.map((row) => [row.key, parseJson(row.value_json, null)])) }; },
    saveSettings(settings) { const merged = { ...this.getSettings(), ...settings }; transaction(() => Object.entries(merged).forEach(([key, value]) => settingUpsert.run(key, JSON.stringify(value)))); return merged; },
    getReminderStates(localDate) { return Object.fromEntries(db.prepare('SELECT * FROM reminder_state WHERE local_date=?').all(localDate).map((row) => [row.period, { snoozedUntil: row.snoozed_until, dismissedAt: row.dismissed_at, notifiedAt: row.notified_at }])); },
    saveReminderState(localDate, period, patch) { const semanticPeriod = period === '13:00' ? 'day' : period === '22:00' ? 'evening' : period; const next = { ...(this.getReminderStates(localDate)[semanticPeriod] ?? {}), ...patch }; reminderUpsert.run(localDate, semanticPeriod, next.snoozedUntil ?? null, next.dismissedAt ?? null, next.notifiedAt ?? null); return next; },
    clearReminderState(localDate, period) { db.prepare('DELETE FROM reminder_state WHERE local_date=? AND period=?').run(localDate, period === '13:00' ? 'day' : period === '22:00' ? 'evening' : period); },
    listTreatmentEvents() { return db.prepare('SELECT * FROM treatment_events ORDER BY effective_date IS NOT NULL,effective_date,id').all().map(rowToTreatmentEvent); },
    createTreatmentEvent(input, now = new Date()) { const event = normalizeTreatmentEvent(input); if (treatmentByIdentity.get(event.effectiveDate, event.effectiveDate)) throw new TypeError(event.effectiveDate === null ? 'Treatment baseline already exists' : 'Treatment date already exists'); const timestamp = now.toISOString(); return rowToTreatmentEvent(treatmentInsert.get(event.effectiveDate, JSON.stringify(event.regimen), event.note, timestamp, timestamp)); },
    updateTreatmentEvent(id, input, now = new Date()) { const current = treatmentById.get(Number(id)); if (!current) return null; const event = normalizeTreatmentEvent(input), duplicate = treatmentByIdentity.get(event.effectiveDate, event.effectiveDate); if (duplicate && duplicate.id !== current.id) throw new TypeError(event.effectiveDate === null ? 'Treatment baseline already exists' : 'Treatment date already exists'); return rowToTreatmentEvent(treatmentUpdate.get(event.effectiveDate, JSON.stringify(event.regimen), event.note, now.toISOString(), Number(id))); },
    deleteTreatmentEvent(id) { return db.prepare('DELETE FROM treatment_events WHERE id=?').run(Number(id)).changes > 0; },
    getEffectiveTreatment(localDate) { return rowToTreatmentEvent(db.prepare('SELECT * FROM treatment_events WHERE effective_date IS NOT NULL AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1').get(localDate) ?? db.prepare('SELECT * FROM treatment_events WHERE effective_date IS NULL LIMIT 1').get()); },
    replacePortableData(data, now = new Date()) {
      const fallbackTimestamp = now.toISOString();
      return transaction(() => { db.exec('DELETE FROM checkins; DELETE FROM treatment_events; DELETE FROM tracked_items; DELETE FROM scale_definitions;'); db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('checkins','treatment_events')").run(); for (const definition of data.scaleDefinitions) portableScaleDefinitionInsert.run(definition.id, definition.label, Number(definition.active), definition.sortOrder); for (const item of data.trackedItems) portableTrackedItemInsert.run(item.id, item.category, item.label, Number(item.active), item.sortOrder); for (const observation of data.observations) { const row = { ...observation, recordedAt: observation.recordedAt ?? fallbackTimestamp, updatedAt: observation.updatedAt ?? observation.recordedAt ?? fallbackTimestamp }; portableObservationInsert.run(observation.id ?? null, ...observationValues(row, row.recordedAt, row.updatedAt)); const id = observation.id ?? db.prepare('SELECT last_insert_rowid() AS id').get().id; writeScaleValues(id, observation.scales); } for (const event of data.treatmentEvents) portableTreatmentInsert.run(event.id ?? null, event.effectiveDate, JSON.stringify(event.regimen), event.note, event.createdAt ?? fallbackTimestamp, event.updatedAt ?? event.createdAt ?? fallbackTimestamp); for (const key of ['dayTime', 'eveningTime', 'catchupHours', 'repeatMinutes']) settingUpsert.run(key, JSON.stringify(data.settings[key])); return { observationsReplaced: data.observations.length, treatmentEventsReplaced: data.treatmentEvents.length }; });
    },
    exportRows() { return db.prepare('SELECT * FROM checkins ORDER BY local_date,id').all().map(hydrateCheckin); }, checkpoint() { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }, close() { db.close(); }
  };
  repo.getCheckin = (localDate, slot) => repo.getScheduledCheckin(localDate, slot === '13:00' ? 'day' : 'evening');
  repo.upsertCheckin = (input) => { const period = input.period ?? (input.slot === '13:00' ? 'day' : 'evening'); const semantic = { ...input, kind: input.kind ?? 'scheduled', period, observedAt: input.observedAt ?? input.recordedAt }; const existing = repo.getScheduledCheckin(input.localDate, period); return existing ? repo.updateCheckin(existing.id, semantic, new Date(input.updatedAt ?? Date.now())) : repo.createCheckin(semantic, new Date(input.recordedAt ?? Date.now())); };
  return repo;
}
