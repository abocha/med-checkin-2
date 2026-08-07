# Med Check-in 2.2 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Med Check-in 2.2 as a reliability-first upgrade with versioned migrations, semantic Day/Evening check-ins, unlimited Extras, truthful timestamps and measurements, structured treatment history, recoverable drafts, complete history, safe backup/restore and JSON portability, treatment-aware analytics, correct reminders, and Windows CI.

**Architecture:** Preserve the existing local Windows/PowerShell tray + Node.js + SQLite + browser UI architecture. Add a migration boundary before repository startup, keep the existing `checkins` table name while evolving its schema to support `kind`, `period`, stable keys, and nullable Extra measurements, add treatment snapshot tables, and add narrowly scoped data-maintenance operations for restore/import. Frontend changes stay in the existing static-resource model, with one standalone draft-store module for testability.

**Tech Stack:** Node.js 22.23.1 ESM, built-in `node:sqlite` `DatabaseSync`, built-in `node:test`, static HTML/CSS/JavaScript, Windows PowerShell 5.1 tray host, GitHub Actions `windows-latest`.

## Global Constraints

- This is a personal-use Windows application: one user, one local data store, no accounts or cloud abstractions.
- Preserve the existing loopback-only authenticated API, PowerShell tray host, offline-after-install behavior, installer model, SQLite storage, exports, and watchdog unless this approved plan requires a change.
- All eight core scales remain numeric 0-10 scales.
- Scheduled Day/Evening entries require all eight scales; Extras may contain any subset but must not be empty.
- Missing values remain missing. Never synthesize neutral/default measurements.
- `recorded_at` is backend-owned and immutable under ordinary edits; `updated_at` changes on every successful ordinary edit; `observed_at` may be historical; migrated legacy `observed_at` remains null.
- `scheduled_for` is a creation-time snapshot for new scheduled records and may remain null for migrated legacy rows.
- Extras never clear reminders and never contribute to scheduled analytics/completion by default.
- v1 import is explicitly out of scope for 2.2.
- Portable JSON settings are limited to `dayTime`, `eveningTime`, `catchupHours`, and `repeatMinutes`; transient pause/reminder state is not portable.
- Do not add dependencies unless the primary agent explicitly re-opens the approved design with the user.
- Follow root `AGENTS.md`; preserve unrelated work; discover commands from manifests rather than guessing.
- Use TDD for behavior changes: focused failing test, minimal implementation, focused pass, then broader gate.
- Run `npm test` before each task commit that changes shared backend/frontend contracts; run the full package/release gate at the end.

## Agent Ownership and Review Contract

The **primary agent** owns the worktree, SDD ledger, integration, repository accountability, cross-task interfaces, and final result. Delegation is opt-in and bounded as follows.

| Task | Implementer in charge | Reason | Review |
| --- | --- | --- | --- |
| 1. Migration foundation | **primary agent** | schema/migration/data-integrity decisions | `sol_reviewer`, Risk Gate A |
| 2. Observation persistence | **primary agent** | immutable timestamps, uniqueness, stable identity | `sol_reviewer`, Risk Gate A |
| 3. HTTP/reminder contract | **primary agent** | API + persistence/reminder coupling | `sol_reviewer`, Risk Gate A |
| 4. Treatment persistence/backfill | **primary agent** | longitudinal medical-data integrity | `sol_reviewer`, Risk Gate A |
| 5. Capture UI/drafts | `terra_workhorse` | predetermined multi-file UI/state work | `terra_reviewer`, Integration Gate B |
| 6. History/treatment UI | `terra_workhorse` | predetermined multi-view integration | `terra_reviewer`, Integration Gate B |
| 7. Analytics 2.2 | `terra_workhorse` | approved formulas across backend/frontend | `terra_reviewer`, Integration Gate B |
| 8. Restore/import portability | **primary agent** | destructive recovery, conflicts, rollback | `sol_reviewer`, Risk Gate C |
| 9. Reminder polish/data folder | `luna_implementer` | narrow pattern-following work | `terra_reviewer`, Integration Gate B |
| 10. Windows CI/release docs | `luna_implementer` | mechanical config/docs/package work | `terra_reviewer`, Integration Gate B |
| 11. Final integration | **primary agent** | whole-branch accountability | final `sol_reviewer` |

Do **not** use `terra_explorer` unless execution uncovers a genuinely unknown path not resolved by the approved design/current repository. If used, give it one bounded read-only trace; it must stop on newly discovered contract, architecture, concurrency, or data-integrity ambiguity.

`luna_implementer` must stop immediately if its task reveals migration, security, privacy, data-integrity, public-contract, or architecture decisions. `terra_workhorse` must stop when the locked interfaces below cannot be implemented without widening scope or choosing a new contract.

### Review gates

- **Risk Gate A:** after Tasks 1-4, one coherent `sol_reviewer` review of migration, record identity/timestamps, reminder migration, treatment backfill, and API/repository persistence contracts.
- **Integration Gate B:** after Tasks 5-7, 9, and 10, one `terra_reviewer` review of capture/history/treatment/analytics/reminder/CI integration.
- **Risk Gate C:** after Task 8, reuse `sol_reviewer` for restore/import/conflict/rollback behavior.
- **Final review:** after Task 11 fresh verification, `sol_reviewer` performs the whole-branch exceptional-risk review.

## File Structure and Locked Interfaces

### New files

- `backend/schema.mjs` - latest schema DDL and `LATEST_SCHEMA_VERSION`.
- `backend/migrations.mjs` - legacy detection, ordered migrations, safety backup, `prepareDatabase()`.
- `backend/treatment.mjs` - treatment validation/effective-regimen helpers.
- `backend/data-maintenance.mjs` - backup recognition/validation, staged restore, portability validation/preview.
- `resources/draft-store.js` - localStorage draft API exposed as `globalThis.MedCheckinDrafts`.
- `test/migrations.test.mjs`
- `test/treatment.test.mjs`
- `test/data-maintenance.test.mjs`
- `test/draft-store.test.mjs`
- `test/fixtures/build-v211-fixture.mjs`
- `test/fixtures/med-checkin-2.1.1.sqlite` - generated synthetic fixture only.
- `.github/workflows/windows-ci.yml`

### Core interfaces

```js
// backend/schema.mjs
export const LATEST_SCHEMA_VERSION = 1;
export function createLatestSchema(db) {}

// backend/migrations.mjs
export function prepareDatabase({ dbPath, backupDir, now = new Date(), log = () => {} }) {}

// backend/domain.mjs
export function normalizeCheckin(input = {}, { now = new Date(), settings = DEFAULT_SETTINGS, existing = null } = {}) {}
export function periodForTime(date, settings = DEFAULT_SETTINGS) {}
export function scheduledWindows(date, settings = DEFAULT_SETTINGS) {}
export function scheduledAtForPeriod(localDate, period, settings = DEFAULT_SETTINGS) {}

// backend/repository.mjs
repo.createCheckin(input, now)
repo.updateCheckin(id, input, now)
repo.getScheduledCheckin(localDate, period)
repo.getCheckinById(id)
repo.listCheckins({ limit, offset, from, to, kind, period })
repo.listAllCheckins({ from, to, kind, period })
repo.deleteCheckin(id)
repo.listTreatmentEvents()
repo.createTreatmentEvent(event, now)
repo.updateTreatmentEvent(id, event, now)
repo.deleteTreatmentEvent(id)
repo.getEffectiveTreatment(localDate)
repo.exportPortableState()
repo.applyPortableImport(validatedImport, { mode })

// backend/treatment.mjs
export function normalizeTreatmentEvent(input) {}
export function effectiveTreatmentForDate(events, localDate) {}

// backend/data-maintenance.mjs
export const PORTABLE_FORMAT = 'med-checkin-2';
export const PORTABLE_FORMAT_VERSION = 1;
export function listBackups({ backupDir }) {}
export function validateBackupFile({ filePath, latestSchemaVersion }) {}
export function stageRestore({ repo, dbPath, backupDir, dataDir, backupName, now }) {}
export function applyPendingRestore({ dbPath, backupDir, dataDir, now, prepareDatabase }) {}
export function validatePortableExport(payload) {}
export function previewPortableImport(localState, importedState) {}
```

Keep local API paths under `/api/v1`. Preserve `/api/v1/checkins` as the observation collection name to minimize unrelated churn.

---

### Task 1: Migration Foundation and Synthetic 2.1.1 Fixture

**Owner:** primary agent  
**Risk:** exceptional migration/data integrity  
**Files:**
- Create: `backend/schema.mjs`
- Create: `backend/migrations.mjs`
- Create: `test/migrations.test.mjs`
- Create: `test/fixtures/build-v211-fixture.mjs`
- Generate/commit: `test/fixtures/med-checkin-2.1.1.sqlite`
- Modify: `backend/main.mjs`
- Modify: `backend/backups.mjs`
- Test: `test/backups.test.mjs`

**Produces:** `LATEST_SCHEMA_VERSION = 1`, latest schema creation, and safe v0 -> v1 migration. Task 4 later amends the same migration with the approved treatment seed before release.

- [ ] **Step 1: Add the synthetic legacy fixture and failing migration test**

`test/fixtures/build-v211-fixture.mjs` must build the exact 2.1.1 tables with two synthetic check-ins, both reminder slots, and settings including `treatmentChangeDate`/`medicationLabel`. Use synthetic note strings such as `fixture day` and `fixture evening`.

Initial migration assertions:

```js
const result = prepareDatabase({ dbPath, backupDir, now: new Date('2026-08-07T12:00:00Z') });
assert.equal(result.fromVersion, 0);
assert.equal(result.toVersion, 1);
assert.equal(readUserVersion(dbPath), 1);
assert.equal(readCheckin(dbPath, 1).id, 1);
assert.equal(readCheckin(dbPath, 1).kind, 'scheduled');
assert.equal(readCheckin(dbPath, 1).period, 'day');
assert.equal(readCheckin(dbPath, 1).observed_at, null);
assert.equal(readCheckin(dbPath, 1).scheduled_for, null);
assert.ok(readCheckin(dbPath, 1).record_key);
```

Also assert reminder `13:00 -> day`, `22:00 -> evening`, user fields preserved, and a timestamped pre-migration backup exists.

- [ ] **Step 2: Generate fixture and verify the focused test fails**

```bash
node test/fixtures/build-v211-fixture.mjs
node --test test/migrations.test.mjs
```

Expected: fixture generation succeeds; test fails because migration modules do not exist yet.

- [ ] **Step 3: Implement the complete latest schema in `backend/schema.mjs`**

The 2.2 `checkins` table is:

```sql
CREATE TABLE checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('scheduled','extra')),
  local_date TEXT NOT NULL,
  period TEXT CHECK(period IN ('day','evening') OR period IS NULL),
  scheduled_for TEXT,
  observed_at TEXT,
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  mood REAL,
  anxiety REAL,
  irritability REAL,
  energy REAL,
  focus REAL,
  functioning REAL,
  sleep_quality REAL,
  appetite REAL,
  night_sleep_hours REAL,
  day_sleep_hours REAL,
  sleep_start TEXT,
  wake_time TEXT,
  context_json TEXT NOT NULL DEFAULT '[]',
  symptoms_json TEXT NOT NULL DEFAULT '[]',
  activation_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  red_flags TEXT NOT NULL DEFAULT '',
  CHECK((kind='scheduled' AND period IS NOT NULL) OR (kind='extra' AND period IS NULL))
) STRICT;
CREATE UNIQUE INDEX checkins_scheduled_identity
ON checkins(local_date, period)
WHERE kind='scheduled';
```

Create `settings`, semantic `reminder_state(local_date,period,...)`, and the treatment tables defined in the approved spec. Leave treatment tables empty in Task 1. Clean/empty databases create latest schema directly and set `user_version=1`; they are not treated as legacy migrations and do not receive a pre-migration backup.

- [ ] **Step 4: Implement `prepareDatabase()` and v0 -> v1 observation/reminder migration**

Legacy detection requires the existing `checkins.slot` contract, not merely `user_version=0`.

Sequence:

1. checkpoint legacy WAL;
2. create non-pruned `pre-migration-YYYYMMDDTHHMMSSZ.sqlite`;
3. begin transaction;
4. create temporary latest tables;
5. copy legacy check-ins row-by-row preserving integer IDs, `recorded_at`, `updated_at`, all measurements/sleep/JSON/note/red-flag fields; generate `record_key` with `randomUUID()`; set `kind='scheduled'`; map slot to period; set `observed_at=NULL`; set `scheduled_for=NULL`;
6. copy reminder state with slot-to-period mapping;
7. swap tables/indexes;
8. set `PRAGMA user_version=1` only as the final successful schema step;
9. commit; rollback/rethrow on failure.

Task 1 deliberately leaves legacy treatment settings untouched. Task 4 adds treatment seed + obsolete-setting removal to this same migration before 2.2 release.

- [ ] **Step 5: Wire database preparation before repository creation**

```js
prepareDatabase({ dbPath: DB_PATH, backupDir: BACKUP_DIR, log });
const repo = createRepository(DB_PATH);
```

`createRepository` stops creating/upgrading schema and may assert expected schema version.

- [ ] **Step 6: Add rollback/new-install tests and run focused tests**

Prove injected migration failure leaves `user_version=0` with readable recovery backup; prove an empty temp data directory creates latest schema without a migration backup.

```bash
node --test test/migrations.test.mjs test/backups.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run full suite and commit**

```bash
npm test
git add backend/schema.mjs backend/migrations.mjs backend/main.mjs backend/backups.mjs test/migrations.test.mjs test/backups.test.mjs test/fixtures/build-v211-fixture.mjs test/fixtures/med-checkin-2.1.1.sqlite
git commit -m "feat(db): add versioned 2.2 migration"
```

---

### Task 2: Observation Persistence, Timestamps, Extras, and Stable Identity

**Owner:** primary agent  
**Risk:** exceptional data integrity  
**Files:** `backend/domain.mjs`, `backend/repository.mjs`, `test/domain.test.mjs`, `test/repository.test.mjs`

- [ ] **Step 1: Write failing domain tests for scheduled vs Extra validation**

```js
assert.throws(
  () => normalizeCheckin({ kind:'scheduled', localDate:'2026-08-07', period:'day' }),
  /required scale/i
);
const extra = normalizeCheckin({
  kind:'extra',
  observedAt:'2026-08-08T02:07:00+07:00',
  notes:'awake'
});
assert.equal(extra.kind, 'extra');
assert.equal(extra.period, null);
assert.equal(extra.mood, null);
assert.throws(
  () => normalizeCheckin({ kind:'extra', observedAt:'2026-08-08T02:07:00+07:00' }),
  /empty extra/i
);
```

Also reject every non-null scale outside 0-10 or non-finite.

- [ ] **Step 2: Run focused domain tests and confirm failure**

```bash
node --test test/domain.test.mjs
```

- [ ] **Step 3: Replace slot/default-value logic in `backend/domain.mjs`**

- Missing scale -> `null`; never fallback 5.
- Scheduled -> `period` Day/Evening and all eight scales required.
- Extra -> `period=null`, at least one meaningful scale/flag/note/red-flag field, partial scales allowed.
- Validate ISO timestamps where supplied.
- `periodForTime()` chooses Day/Evening from configured schedule.
- `scheduledAtForPeriod(localDate, period, settings)` returns the configured timestamp for that target date.
- `scheduledWindows()` returns `{ period, scheduledAt }`.

- [ ] **Step 4: Write failing repository tests for identity/timestamps**

```js
const created = repo.createCheckin(input, new Date('2026-08-07T15:17:00Z'));
const edited = repo.updateCheckin(created.id, { ...input, mood:8 }, new Date('2026-08-07T15:24:00Z'));
assert.equal(edited.recordedAt, created.recordedAt);
assert.equal(edited.recordKey, created.recordKey);
assert.notEqual(edited.updatedAt, created.updatedAt);
```

Also cover duplicate scheduled identity rejection, multiple Extras on one date, retrospective `observedAt`, and after-midnight scheduled observation retaining target `localDate`.

- [ ] **Step 5: Implement explicit create/update repository methods**

`createCheckin(input, now)` generates `record_key=randomUUID()` and backend sets `recorded_at=updated_at=now`. `updateCheckin(id,input,now)` loads the row, preserves `record_key`/`recorded_at`, and changes `updated_at` only. Do not use scheduled-identity upsert semantics.

Add `getScheduledCheckin`, paged/filterable `listCheckins`, and uncapped `listAllCheckins` for analytics/export.

- [ ] **Step 6: Run focused/full tests and commit**

```bash
node --test test/domain.test.mjs test/repository.test.mjs
npm test
git add backend/domain.mjs backend/repository.mjs test/domain.test.mjs test/repository.test.mjs
git commit -m "feat(data): model scheduled and extra observations"
```

---

### Task 3: HTTP API and Reminder Contract Conversion

**Owner:** primary agent  
**Risk:** high API/data/reminder coupling  
**Files:** `backend/http-server.mjs`, `backend/reminders.mjs`, `backend/main.mjs`, `test/http-server.test.mjs`, `test/reminders.test.mjs`

- [ ] **Step 1: Add failing 2.2 HTTP contract tests**

Cover:

```text
POST scheduled -> success with kind=scheduled, period=day
POST duplicate date+period -> 409
POST Extra -> success
PUT /api/v1/checkins/:id -> recordedAt unchanged, updatedAt changed
GET /api/v1/checkin?date=...&period=day -> scheduled row
GET /api/v1/checkins?kind=extra -> only Extras
```

Ordinary client `recordedAt`/`recordKey` must not override server values.

- [ ] **Step 2: Run focused HTTP test and confirm failure**

```bash
node --test test/http-server.test.mjs
```

- [ ] **Step 3: Convert create/edit/bootstrap/list handlers**

POST creates only; PUT by id edits. For scheduled create:

- if `scheduledFor` is omitted, derive it with `scheduledAtForPeriod(localDate,period,repo.getSettings())`;
- if a missed historical flow supplies `scheduledFor`, validate and preserve that explicit value;
- if `observedAt` is omitted, default it to server `now`.

For Extra, default omitted `observedAt` to server `now` and derive `localDate` from the normalized observation.

Bootstrap becomes:

```js
{
  settings,
  current: { localDate, period, checkin },
  recent,
  currentTreatment: null
}
```

Task 4 replaces `null` with effective treatment. Map validation errors to 400 and scheduled uniqueness to 409.

- [ ] **Step 4: Write failing semantic reminder tests**

`getDueReminder()` returns `period:'day'|'evening'`; completion keys are `${localDate}|${period}`; completed-set queries include only `kind='scheduled'`.

- [ ] **Step 5: Convert reminder endpoints/timers**

Use `{localDate,period}` in reminder state and API payloads. Saving a scheduled record clears only its period; Extra saves clear no reminder state.

- [ ] **Step 6: Run focused/full tests and commit**

```bash
node --test test/http-server.test.mjs test/reminders.test.mjs
npm test
git add backend/http-server.mjs backend/reminders.mjs backend/main.mjs test/http-server.test.mjs test/reminders.test.mjs
git commit -m "feat(api): use semantic check-in periods"
```

---

### Task 4: Structured Treatment Persistence and Known-History Backfill

**Owner:** primary agent  
**Risk:** exceptional longitudinal-data integrity  
**Files:**
- Create: `backend/treatment.mjs`, `test/treatment.test.mjs`
- Modify: `backend/repository.mjs`, `backend/http-server.mjs`, `backend/migrations.mjs`, `test/migrations.test.mjs`, `test/http-server.test.mjs`

- [ ] **Step 1: Write failing treatment validation/effective-date tests**

```js
const event = normalizeTreatmentEvent({
  effectiveDate:'2026-07-07',
  medications:[
    { medicationName:'Escitalopram', doseValue:10, doseUnit:'mg', timing:'morning' },
    { medicationName:'Atomoxetine', doseValue:80, doseUnit:'mg', timing:'morning' }
  ]
});
assert.equal(event.medications.length, 2);
```

Reject empty regimens, invalid dates, negative/non-finite doses, blank names/units. `effectiveTreatmentForDate()` selects latest dated event at/before date, else baseline.

- [ ] **Step 2: Write failing repository/API tests**

Cover one baseline max, one dated snapshot per date, CRUD, created/updated timestamp behavior, effective lookup, and bootstrap current treatment.

- [ ] **Step 3: Implement treatment repository CRUD transactionally**

Create/update event + item replacement occurs in one DB transaction. Preserve event `created_at`; update `updated_at`; delete cascades items and never edits check-ins.

- [ ] **Step 4: Amend the v0 -> v1 migration with the approved seed**

Before deleting legacy treatment settings, insert exactly:

```text
Baseline, effective_date NULL:
  Escitalopram 20 mg
  Atomoxetine 80 mg
2026-07-07:
  Escitalopram 10 mg
  Atomoxetine 80 mg
```

Do not invent a baseline date. Then remove obsolete `treatmentChangeDate`/`medicationLabel` settings keys. Clean 2.2 installs do not receive this migration seed automatically.

- [ ] **Step 5: Add treatment API and bootstrap integration**

Implement `GET/POST /api/v1/treatment-events` and `PUT/DELETE /api/v1/treatment-events/:id`. Return medication arrays in chronological event order. Bootstrap derives `currentTreatment` for today's local date.

- [ ] **Step 6: Extend migration tests for exact seed/settings removal**

Assert one undated baseline, one 2026-07-07 event, exact medication/dose values, and obsolete settings removed only after migration succeeds.

- [ ] **Step 7: Run focused/full tests and commit**

```bash
node --test test/treatment.test.mjs test/migrations.test.mjs test/http-server.test.mjs
npm test
git add backend/treatment.mjs backend/repository.mjs backend/http-server.mjs backend/migrations.mjs test/treatment.test.mjs test/migrations.test.mjs test/http-server.test.mjs
git commit -m "feat(treatment): add structured regimen history"
```

### Risk Gate A: `sol_reviewer`

Review Tasks 1-4 together. Required questions:

1. Can migration failure advance `user_version` or lose legacy rows/reminder state?
2. Can ordinary callers alter `record_key`/`recorded_at` or create ambiguous scheduled identities?
3. Can Extras satisfy reminders or scheduled uniqueness?
4. Does treatment backfill exactly match the approved known history without invented dates?
5. Are failures atomic and explicit?

Resolve load-bearing findings before Task 5.

---

### Task 5: Capture UI, Unset Scales, Extra, Missed Check-ins, and Draft Recovery

**Owner:** `terra_workhorse`  
**Bounded ownership:** `resources/index.html`, `resources/app.js`, `resources/styles.css`, new `resources/draft-store.js`, and related frontend tests. Do not change backend contracts.  
**Files:**
- Create: `resources/draft-store.js`, `test/draft-store.test.mjs`
- Modify: `resources/index.html`, `resources/app.js`, `resources/styles.css`, `test/frontend-smoke.test.mjs`
- Modify `test/startup-runtime.test.mjs` only if script ordering requires it.

- [ ] **Step 1: Write failing draft-store tests using a VM/localStorage stub**

Cover scheduled key, existing-record key, unique Extra draft key, read/write/remove, and malformed JSON returning null.

- [ ] **Step 2: Implement `MedCheckinDrafts`**

Expose:

```js
keyForScheduled(date, period)
keyForExisting(recordKey)
newExtraKey()
read(key)
write(key, value)
remove(key)
```

Namespace storage under `med-checkin-draft:` and load script before `app.js`.

- [ ] **Step 3: Convert capture UI to Day / Evening / Extra and genuine unset scales**

Day/Evening visible schedule labels come from settings. A new scheduled form shows `—` for each untouched scale and tracks an explicit set/unset bitmap. HTML range midpoint is not payload data until user interaction or **Use previous values** marks that scale set. Add concise 0/10 endpoint anchors.

- [ ] **Step 4: Implement `Use previous values`**

Copy only the eight scale values from the preceding scheduled observation and mark them set. Never copy sleep, flags, notes, red flags, identity, or timestamps.

- [ ] **Step 5: Implement Extra mode**

Extra shows editable `observedAt` default now, permits partial scales or note-only save, submits `kind:'extra'`, and has no scheduled period/reminder-completion behavior.

- [ ] **Step 6: Implement Add missed check-in**

History-launched dialog asks target date, Day/Evening, observation datetime, and scheduled datetime defaulted from current corresponding schedule but editable. Duplicate 409 opens/offers the existing record instead of overwriting.

- [ ] **Step 7: Implement dirty guard + crash drafts**

On mutation mark dirty and debounce-write full form + scale-set bitmap + identity. Before in-app navigation that would discard dirty state, show **Save / Discard / Cancel**; disable Save if invalid. On browser/window close where async dialog cannot block, keep the draft and allow close. Matching draft later shows explicit **Restore / Discard** with draft age. Successful save/explicit discard removes it.

- [ ] **Step 8: Switch save path to POST-create / PUT-edit**

Display server-provided observed/recorded/edited timing and never manufacture missing legacy observed/scheduled times.

- [ ] **Step 9: Run focused/full tests and commit**

```bash
node --test test/draft-store.test.mjs test/frontend-smoke.test.mjs test/startup-runtime.test.mjs
npm test
git add resources/draft-store.js resources/index.html resources/app.js resources/styles.css test/draft-store.test.mjs test/frontend-smoke.test.mjs test/startup-runtime.test.mjs
git commit -m "feat(ui): add truthful capture and draft recovery"
```

---

### Task 6: Complete History and Treatment UI

**Owner:** `terra_workhorse`  
**Bounded ownership:** frontend resources/tests only; Tasks 3-4 backend endpoints are fixed.  
**Files:** `resources/index.html`, `resources/app.js`, `resources/styles.css`, `test/frontend-smoke.test.mjs`

- [ ] **Step 1: Add failing smoke assertions for range/filter/treatment controls**

Require 7/30/90/All, custom from/to, Day/Evening/Extra, notes/symptoms/activation/red-flags filters, pagination/load-more, Add missed check-in, and treatment editor controls.

- [ ] **Step 2: Implement complete paged/ranged History**

Remove hardcoded `limit=200`. Reset offset on filter/range changes; load page-by-page; **All** means all pages with no hidden frontend cap.

- [ ] **Step 3: Implement timing/card rules**

Scheduled:

```text
Aug 7
Evening · scheduled 22:00
Observed 22:16
Recorded 22:17 · edited 22:24
```

Omit scheduled/observed/edited parts when their approved null/equality conditions apply. Extra renders `Extra · observed 02:07` plus record/edit timing.

- [ ] **Step 4: Implement treatment Settings UI**

Show current regimen/events; Add change pre-fills regimen effective immediately before selected date; Edit/Delete use Task 4 endpoints; Delete requires confirmation.

- [ ] **Step 5: Merge treatment events into History chronology as distinct cards**

Fetch separately; never route through check-in edit/delete handlers.

- [ ] **Step 6: Derive header label from current regimen**

If bootstrap has no current treatment, hide medication label. Remove hardcoded medication fallback from HTML/JS.

- [ ] **Step 7: Run tests and commit**

```bash
node --test test/frontend-smoke.test.mjs
npm test
git add resources/index.html resources/app.js resources/styles.css test/frontend-smoke.test.mjs
git commit -m "feat(ui): expand history and treatment timeline"
```

---

### Task 7: Treatment-Aware Analytics and Completion Metrics

**Owner:** `terra_workhorse`  
**Bounded ownership:** analytics module/API pass-through/chart/frontend/tests only. Do not change persistence/import contracts.  
**Files:** `backend/analytics.mjs`, `backend/http-server.mjs`, `resources/app.js`, `resources/index.html`, `resources/vendor/chart-lite.js`, `resources/styles.css`, `test/analytics.test.mjs`, `test/http-server.test.mjs`

**Locked signature:** `buildAnalytics(rows, settings, treatmentEvents, { from, to, now })`.

- [ ] **Step 1: Add failing analytics tests for exact formulas**

Cover scheduled-only daily means; Extras excluded; trailing window is current calendar date plus previous two calendar dates; missing date ignored but never replaced by older date; future data cannot alter earlier smoothed point; current Evening excluded from denominator before due unless completed early; completion never exceeds 100%; treatment first-seven window is effective date through +6 calendar days.

- [ ] **Step 2: Run focused test and confirm failure**

```bash
node --test test/analytics.test.mjs
```

- [ ] **Step 3: Implement analytics backend**

Filter scheduled rows before aggregation. Keep Extras separately as markers. Compute completion from calendar opportunities using selected range/current schedule. Preserve missing metrics as null. Add treatment markers and selected-event comparison.

- [ ] **Step 4: Add analytics API range/event handling without hidden row cap**

Validate `from`/`to`; query `repo.listAllCheckins`; pass treatment events. Do not reintroduce 1000-row truncation.

- [ ] **Step 5: Update Analytics UI**

Add 7/30/90/All/custom/Since treatment change, all-eight metric toggles, completion KPIs, treatment-event selection/markers, Extra markers, and descriptive-not-causal copy.

- [ ] **Step 6: Extend dependency-free ChartLite**

Treatment markers are distinct event markers; Extra markers are inspectable but not part of series/rolling calculations.

- [ ] **Step 7: Run focused/full tests and commit**

```bash
node --test test/analytics.test.mjs test/http-server.test.mjs
npm test
git add backend/analytics.mjs backend/http-server.mjs resources/app.js resources/index.html resources/vendor/chart-lite.js resources/styles.css test/analytics.test.mjs test/http-server.test.mjs
git commit -m "feat(analytics): add treatment-aware scheduled trends"
```

---

### Task 8: Backup Restore and Versioned JSON Portability

**Owner:** primary agent  
**Risk:** exceptional destructive/data-integrity/retry behavior  
**Files:**
- Create: `backend/data-maintenance.mjs`, `test/data-maintenance.test.mjs`
- Modify: `backend/backups.mjs`, `backend/repository.mjs`, `backend/http-server.mjs`, `backend/main.mjs`, `test/backups.test.mjs`, `test/http-server.test.mjs`, `test/repository.test.mjs`, `resources/index.html`, `resources/app.js`, `resources/styles.css`

**Portable format:**

```js
{
  format:'med-checkin-2',
  formatVersion:1,
  exportedAt:'<ISO timestamp>',
  observations:[],
  treatmentEvents:[],
  settings:{ dayTime:'13:00', eveningTime:'22:00', catchupHours:4, repeatMinutes:30 }
}
```

`remindersPausedUntil`, bearer tokens, reminder notification state, installation paths, and runtime files are not portable.

- [ ] **Step 1: Write failing backup recognition/validation tests**

Use temp valid legacy/latest DBs, corrupt bytes, and `user_version=99`. Recognize only app backup naming patterns and report basename/size/time. Reject corrupt/unsupported-newer candidates.

- [ ] **Step 2: Extend backup primitives**

Keep pruned daily automatic backups. Add non-pruned timestamped:

```text
manual-YYYYMMDDTHHMMSSZ.sqlite
pre-migration-YYYYMMDDTHHMMSSZ.sqlite
pre-restore-YYYYMMDDTHHMMSSZ.sqlite
pre-import-YYYYMMDDTHHMMSSZ.sqlite
```

Checkpoint and verify destination existence.

- [ ] **Step 3: Write failing staged-restore tests**

Prove:

1. stage by recognized basename only;
2. candidate validates before request;
3. pre-restore backup exists;
4. atomic `restore-request.json` is written under data dir;
5. startup apply closes over no live repo, replaces candidate, migrates older supported backup, removes request on success;
6. injected replacement/migration failure restores the original working DB and clears/quarantines the failed request so startup does not loop forever.

- [ ] **Step 4: Implement staged restore and controlled restart**

`stageRestore()` resolves `backupName` inside `backupDir`, validates candidate, calls `repo.checkpoint()`, creates pre-restore backup, then atomically writes pending request.

Startup is:

```js
const restoreResult = applyPendingRestore({
  dbPath: DB_PATH,
  backupDir: BACKUP_DIR,
  dataDir: DATA_DIR,
  now: new Date(),
  prepareDatabase
});
if (!restoreResult.applied) {
  prepareDatabase({ dbPath: DB_PATH, backupDir: BACKUP_DIR, log });
}
const repo = createRepository(DB_PATH);
```

`applyPendingRestore()` runs before repository open. For pending restore, copy candidate to temp, keep current DB as rollback copy, atomically install candidate, call `prepareDatabase()` on candidate, and restore original on any failure. Delete request only after success; on failure restore original and rename/delete request into an explicit failed-state artifact/log so retry is not automatic.

Add internal restart shutdown: respond to restore request first, then stop host, close API, checkpoint/close repo, and only then `spawnDetached(['--show'])`.

- [ ] **Step 5: Write failing portability validation/preview tests**

Reject wrong format/version, duplicate record keys, invalid timestamps/scales, scheduled identity conflicts, treatment duplicate dates, and non-whitelisted settings. Preview counts observations/Extras/treatment events/date range/source version/conflicts.

- [ ] **Step 6: Implement versioned export and preview endpoint**

`GET /api/v1/export.json` emits the locked format. Add a dedicated import JSON body limit of 10 MiB without raising the normal 256 KiB API body limit. `POST /api/v1/import/preview` performs full validation and returns preview only.

- [ ] **Step 7: Write failing Merge/Replace tests**

Merge:

- unknown `record_key` inserts preserving validated source audit timestamps through privileged importer;
- known key keeps local `recorded_at`;
- newer imported `updated_at` wins mutable content and imported `updated_at`;
- newer local wins;
- equal timestamp + different content rejects whole merge;
- different keys colliding on scheduled `(local_date,period)` reject whole merge;
- treatment baseline/effective-date conflicts use same newer/equal rule.

Replace transactionally replaces portable observations/treatment/settings while preserving local runtime secrets/paths.

- [ ] **Step 8: Implement privileged transactional import**

Before Merge/Replace, create pre-import backup and fully validate. `repo.applyPortableImport()` owns one DB transaction. Only this privileged path may preserve imported `record_key`, `recorded_at`, `updated_at`, `observed_at`, and `scheduled_for`.

- [ ] **Step 9: Add backup/import UI**

Settings data section adds **Create backup now**, **Restore backup…**, **Import JSON…**, preview, and explicit Merge/Replace confirmation. No arbitrary filesystem path reaches restore API.

- [ ] **Step 10: Run focused/full tests and commit**

```bash
node --test test/data-maintenance.test.mjs test/backups.test.mjs test/http-server.test.mjs test/repository.test.mjs
npm test
git add backend/data-maintenance.mjs backend/backups.mjs backend/repository.mjs backend/http-server.mjs backend/main.mjs resources/index.html resources/app.js resources/styles.css test/data-maintenance.test.mjs test/backups.test.mjs test/http-server.test.mjs test/repository.test.mjs
git commit -m "feat(data): add safe restore and portable import"
```

### Risk Gate C: `sol_reviewer`

Review Task 8 specifically for validation-before-replacement, repo-close-before-replacement, path containment, restart idempotency, rollback, transactionality, privilege boundary for imported audit timestamps, and deterministic conflict rules.

---

### Task 9: Reminder UI Consistency and Open Data Folder

**Owner:** `luna_implementer`  
**Bounded ownership:** reminder copy/settings display, predefined host action, PowerShell action handling, focused tests. Stop on broader process/security/data decisions.  
**Files:** `resources/index.html`, `resources/app.js`, `backend/host-actions.mjs`, `backend/http-server.mjs`, `windows/tray-host.ps1`, `test/frontend-smoke.test.mjs`, `test/http-server.test.mjs`, and the existing host-action test file.

- [ ] **Step 1: Add failing assertions**

Assert configured `repeatMinutes` drives both visible snooze copy and request value; pause status remains visible; Open data folder queues only backend-owned path data.

- [ ] **Step 2: Implement dynamic snooze + pause UI**

Render equivalent of `Remind me in ${settings.repeatMinutes} minutes` and submit exactly that value. Render `Reminders paused until … · Resume` until cleared/expired.

- [ ] **Step 3: Implement predefined Open data folder action**

Browser POSTs a fixed control command with no path. Backend, which already owns `dataDir`, queues:

```js
{ type:'open-data-folder', path:dataDir }
```

PowerShell opens exactly that backend-supplied path in Explorer. It does not accept/derive an arbitrary path from browser request data.

- [ ] **Step 4: Run focused/full tests and commit**

```bash
node --test test/frontend-smoke.test.mjs test/http-server.test.mjs
npm test
git add resources/index.html resources/app.js backend/host-actions.mjs backend/http-server.mjs windows/tray-host.ps1 test/frontend-smoke.test.mjs test/http-server.test.mjs
git commit -m "fix(reminders): honor configured actions"
```

---

### Task 10: Windows CI, Version 2.2.0, Packaging, and Active Docs

**Owner:** `luna_implementer`  
**Bounded ownership:** CI/config/version/docs/release verification only.  
**Files:** `.github/workflows/windows-ci.yml`, `package.json`, `package-lock.json`, `README.txt`, `resources/index.html`, `scripts/verify-release.mjs`, `scripts/package-windows.mjs` if version/layout requires it, `test/package-layout.test.mjs`, `test/frontend-smoke.test.mjs`

- [ ] **Step 1: Add failing version/layout assertions**

Expect `2.2.0`; require new runtime modules and `resources/draft-store.js`; ensure test fixture is not packaged into runtime.

- [ ] **Step 2: Update version metadata/docs**

Update package/package-lock/UI title/README for Day/Evening/Extra, treatment history, drafts, restore/import, and safety behavior. Preserve privacy/offline warnings.

- [ ] **Step 3: Add Windows CI**

```yaml
name: windows-ci
on: [push, pull_request]
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.23.1
      - run: npm ci --ignore-scripts
      - run: npm test
      - run: npm run package:windows
```

No deployment/release publication.

- [ ] **Step 4: Update release verifier/package layout**

Require new runtime modules/draft script and keep synthetic fixture/dev-only files out of release ZIP according to existing packaging policy.

- [ ] **Step 5: Run package gate and commit**

```bash
npm test
npm run package:windows
git add .github/workflows/windows-ci.yml package.json package-lock.json README.txt resources/index.html scripts/verify-release.mjs scripts/package-windows.mjs test/package-layout.test.mjs test/frontend-smoke.test.mjs
git commit -m "chore(release): prepare Med Check-in 2.2.0"
```

---

### Integration Gate B: `terra_reviewer`

Review Tasks 5-7, 9, and 10 together. Required questions:

1. Can navigation lose dirty data without prompt or recoverable draft?
2. Are Day/Evening/Extra UI identities consistent with backend payloads?
3. Does History really reach all data?
4. Are treatment events distinct from check-ins?
5. Do analytics implement exact approved formulas and exclude Extras?
6. Does reminder UI use configured values everywhere?
7. Does CI/package layout match the supported Windows release?

Escalate any data-integrity finding to `sol_reviewer`.

---

### Task 11: Final Integration, Regression Repair, and Release Verification

**Owner:** primary agent  
**Risk:** whole-branch integration  
**Scope:** fix only concrete regressions found by fresh verification/review; no new features.

- [ ] **Step 1: Re-read design acceptance criteria and map each to evidence in the SDD ledger**

Source: `docs/superpowers/specs/2026-08-07-med-checkin-2.2-reliability-design.md`, section 15.

- [ ] **Step 2: Run complete automated suite**

```bash
npm test
```

Expected: PASS with no tests skipped/disabled to hide regressions.

- [ ] **Step 3: Run release/package verification**

```bash
npm run package:windows
```

Run any explicit syntax checks from `scripts/verify-release.mjs` separately only if packaging does not already execute them.

- [ ] **Step 4: Run real migration smoke against a copy of the synthetic fixture**

Use a temporary data directory. Verify automatic migration, health/bootstrap, pre-migration backup, both migrated observations, reminder state, and exact treatment seed.

- [ ] **Step 5: Run fresh-2.2 smoke in an empty temporary data directory**

Create Day/Evening, two same-day Extras, edit a scheduled row and verify immutable recorded time/changing edit time, create/edit treatment event, export JSON, preview import, create manual backup, exercise staged restore in temp environment, and verify analytics/completion. Never use the real personal DB for destructive smoke tests.

- [ ] **Step 6: Repair only reproduced integration regressions using focused tests first**

For each regression: reproduce, add/update focused test, make minimum fix, rerun focused test, then `npm test`. Preserve unrelated work.

- [ ] **Step 7: Run final whole-branch `sol_reviewer` review**

Review migrations, restore/import, privacy/local API boundary, timestamp integrity, treatment history, reminders, analytics exclusions, and regression coverage. Follow the subagent-driven fix/re-review breaker rules for findings.

- [ ] **Step 8: Re-run final verification after review fixes**

```bash
npm test
npm run package:windows
```

Record exact fresh outcomes in the SDD ledger/final handoff.

- [ ] **Step 9: Commit integration fixes only if Step 6/7 produced code changes**

First run `git diff --name-only` and compare with the SDD ledger/working-tree ownership. Stage only the exact paths changed for verified Task 11 fixes, one path at a time, then:

```bash
git commit -m "fix: complete Med Check-in 2.2 integration"
```

If no code changed, do not create an empty commit.

---

## Plan Self-Review Checklist

Before execution begins, primary agent confirms:

- [ ] Every approved design acceptance criterion maps to a task/test above.
- [ ] No `luna_implementer` task contains migration, data-integrity, security/privacy, or architecture choices.
- [ ] `terra_workhorse` tasks have fixed backend interfaces and bounded ownership.
- [ ] Migration and restore/import have `sol_reviewer` gates.
- [ ] No task implements v1 import.
- [ ] No task adds cloud/accounts/multi-user/drug-database/AI-medical features.
- [ ] All eight scales remain 0-10.
- [ ] Legacy `observed_at`/`scheduled_for` are never fabricated.
- [ ] Extras cannot affect scheduled reminder completion or scheduled analytics by default.
- [ ] JSON Merge rules are deterministic and transactional.
- [ ] Restore accepts only recognized backup basenames and applies only after repository close.
- [ ] Open data folder path originates from backend-owned `dataDir`, never browser input.
- [ ] Windows CI/package verification target the actual supported platform.
