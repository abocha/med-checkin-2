# Med Check-in 2.2 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Med Check-in 2.2 as a reliability-first upgrade with versioned migrations, semantic Day/Evening check-ins, unlimited Extras, truthful timestamps and measurements, structured treatment history, recoverable drafts, complete history, safe backup/restore and JSON portability, treatment-aware analytics, correct reminders, and Windows CI.

**Architecture:** Preserve the existing local Windows/PowerShell tray + Node.js + SQLite + browser UI architecture. Add a migration boundary before repository startup, keep the existing `checkins` table name but evolve its schema to support `kind`/`period`/stable keys and nullable Extra measurements, add treatment snapshot tables, and add narrowly-scoped data-maintenance operations for restore/import. Frontend changes stay in the existing static-resource model, with one small standalone draft-store module for testability.

**Tech Stack:** Node.js 22.23.1 ESM, built-in `node:sqlite` `DatabaseSync`, built-in `node:test`, static HTML/CSS/JavaScript, Windows PowerShell 5.1 tray host, GitHub Actions `windows-latest`.

## Global Constraints

- This is a personal-use Windows application: one user, one local data store, no accounts or cloud abstractions.
- Preserve the existing loopback-only authenticated API, PowerShell tray host, offline-after-install behavior, installer model, SQLite storage, exports, and watchdog unless a change is required by this approved plan.
- All eight core scales remain numeric 0–10 scales.
- Scheduled Day/Evening entries require all eight scales; Extras may contain any subset but must not be empty.
- Missing values remain missing. Never synthesize neutral/default measurements.
- `recorded_at` is backend-owned and immutable under ordinary edits; `updated_at` changes on every successful ordinary edit; `observed_at` may be historical; migrated legacy `observed_at` remains null.
- `scheduled_for` is a creation-time snapshot for new scheduled records and may remain null for migrated legacy rows.
- Extras never clear reminders and never contribute to scheduled analytics/completion by default.
- v1 import is explicitly out of scope for 2.2.
- Do not add dependencies unless the primary agent explicitly re-opens the approved design with the user.
- Follow root `AGENTS.md`; preserve unrelated work; discover commands from manifests rather than guessing.
- Use TDD for behavior changes: focused failing test, minimal implementation, focused pass, then broader gate.
- Run `npm test` before each task commit that changes shared backend/frontend contracts; run the full release/package gate at the end.

## Agent Ownership and Review Contract

The **primary agent** owns the worktree, task ledger, integration, repository accountability, cross-task interfaces, and final result. Delegation is opt-in and bounded exactly as follows.

| Task | Implementer in charge | Why | Required review |
| --- | --- | --- | --- |
| 1. Migration foundation | **primary agent** | schema/migration/data-integrity decisions | `sol_reviewer` in Risk Gate A |
| 2. Observation persistence contract | **primary agent** | immutable timestamps, uniqueness, import identity | `sol_reviewer` in Risk Gate A |
| 3. HTTP/reminder semantic contract | **primary agent** | public local API + persistence/reminder coupling | `sol_reviewer` in Risk Gate A |
| 4. Treatment persistence and backfill | **primary agent** | medical-history data integrity and migration seed | `sol_reviewer` in Risk Gate A |
| 5. Capture UI, Extra, missed check-ins, drafts | `terra_workhorse` | predetermined multi-file UI/state integration | `terra_reviewer` in Integration Gate B |
| 6. History and treatment UI | `terra_workhorse` | predetermined multi-view integration | `terra_reviewer` in Integration Gate B |
| 7. Analytics 2.2 | `terra_workhorse` | backend/frontend integration with approved formulas | `terra_reviewer` in Integration Gate B |
| 8. Backup, restore, and JSON portability | **primary agent** | destructive recovery path, idempotency/conflict/data integrity | `sol_reviewer` in Risk Gate C |
| 9. Reminder polish and data-folder action | `luna_implementer` | narrow pattern-following UI/host action | `terra_reviewer` in Integration Gate B |
| 10. Windows CI, release metadata, docs | `luna_implementer` | mechanical repository/config/docs work | `terra_reviewer` in Integration Gate B |
| 11. Final integration and verification | **primary agent** | cross-subsystem accountability | final `sol_reviewer` whole-branch review |

Do **not** use `terra_explorer` for this implementation unless the primary agent encounters a genuinely unknown execution path not resolved by the approved design and current repository. If used, give it a read-only bounded trace; it must return control on any newly discovered contract/data-integrity/architecture ambiguity.

`luna_implementer` must stop immediately if its assigned task reveals migration, security, privacy, data-integrity, public-contract, or architecture decisions. `terra_workhorse` must stop when the approved interfaces below cannot be implemented without widening scope or choosing a new contract.

### Review gates

- **Risk Gate A:** after Tasks 1–4, one coherent `sol_reviewer` review of schema migration, record identity/timestamps, reminder migration, treatment backfill, and API/repository persistence contracts. Do not start destructive maintenance work until load-bearing findings are resolved.
- **Integration Gate B:** after Tasks 5–7, 9, and 10 are complete, one `terra_reviewer` review of capture/history/treatment/analytics/reminder/CI integration and regression risk.
- **Risk Gate C:** after Task 8, reuse `sol_reviewer` for restore/import/conflict/rollback semantics.
- **Final review:** after Task 11 verification, `sol_reviewer` performs the whole-branch exceptional-risk review because the release contains migrations, restore, import, and longitudinal health-data integrity changes.

## File Structure and Locked Interfaces

### New backend files

- `backend/schema.mjs` — latest schema DDL and `LATEST_SCHEMA_VERSION`.
- `backend/migrations.mjs` — legacy detection, ordered migrations, pre-migration backup, and `prepareDatabase()`.
- `backend/treatment.mjs` — treatment-event input validation and effective-regimen helpers.
- `backend/data-maintenance.mjs` — backup listing/validation, staged restore, portability format validation/preview helpers.

### New frontend file

- `resources/draft-store.js` — pure localStorage-backed draft keys/read/write/remove functions exposed as `globalThis.MedCheckinDrafts`.

### New test/support files

- `test/migrations.test.mjs`
- `test/treatment.test.mjs`
- `test/data-maintenance.test.mjs`
- `test/draft-store.test.mjs`
- `test/fixtures/build-v211-fixture.mjs`
- `test/fixtures/med-checkin-2.1.1.sqlite` — generated synthetic fixture, never real user data.
- `.github/workflows/windows-ci.yml`

### Core interfaces established by this plan

```js
// backend/schema.mjs
export const LATEST_SCHEMA_VERSION = 1;
export function createLatestSchema(db) {}

// backend/migrations.mjs
export function prepareDatabase({ dbPath, backupDir, now = new Date(), log = () => {} }) {}

// backend/domain.mjs
export function normalizeCheckin(input, { kind = input.kind, now = new Date() } = {}) {}
export function periodForTime(date, settings = DEFAULT_SETTINGS) {}
export function scheduledWindows(date, settings = DEFAULT_SETTINGS) {}

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

Keep local API paths under `/api/v1`. Preserve `/api/v1/checkins` as the observation collection name to reduce unrelated churn; extend its payload/queries instead of renaming the entire API to `/observations`.

---

### Task 1: Migration Foundation and Synthetic 2.1.1 Fixture

**Owner:** primary agent  
**Risk:** exceptional data-integrity/migration  
**Files:**
- Create: `backend/schema.mjs`
- Create: `backend/migrations.mjs`
- Create: `test/migrations.test.mjs`
- Create: `test/fixtures/build-v211-fixture.mjs`
- Generate/commit: `test/fixtures/med-checkin-2.1.1.sqlite`
- Modify: `backend/main.mjs`
- Modify: `backend/backups.mjs`
- Test: `test/backups.test.mjs`

**Interfaces:**
- Produces `LATEST_SCHEMA_VERSION = 1`, `createLatestSchema(db)`, and `prepareDatabase({ dbPath, backupDir, now, log })`.
- `prepareDatabase` must finish before `createRepository(DB_PATH)` is called.
- Legacy schema version `0` is the existing 2.1.1 DB with `slot IN ('13:00','22:00')` and no `record_key`/`kind`/`period` columns.

- [ ] **Step 1: Add a synthetic legacy fixture generator and failing migration test**

Create `test/fixtures/build-v211-fixture.mjs` using `DatabaseSync` to create the exact 2.1.1 tables and insert two representative check-ins, reminder state for both slots, and settings including `treatmentChangeDate` and `medicationLabel`. Use obviously synthetic values and notes such as `fixture day` / `fixture evening`.

Add `test/migrations.test.mjs` beginning with assertions like:

```js
const result = prepareDatabase({ dbPath, backupDir, now: new Date('2026-08-07T12:00:00Z') });
assert.equal(result.fromVersion, 0);
assert.equal(result.toVersion, 1);
assert.equal(readUserVersion(dbPath), 1);
assert.equal(readCheckin(dbPath, 1).id, 1);
assert.equal(readCheckin(dbPath, 1).period, 'day');
assert.equal(readCheckin(dbPath, 1).kind, 'scheduled');
assert.equal(readCheckin(dbPath, 1).observed_at, null);
assert.equal(readCheckin(dbPath, 1).scheduled_for, null);
assert.ok(readCheckin(dbPath, 1).record_key);
```

Also assert reminder `13:00 -> day`, `22:00 -> evening`, and presence of one timestamped pre-migration backup.

- [ ] **Step 2: Generate the fixture and verify the migration test fails for the right reason**

Run:

```bash
node test/fixtures/build-v211-fixture.mjs
node --test test/migrations.test.mjs
```

Expected: fixture generation succeeds; migration test fails because `prepareDatabase`/latest schema does not exist yet.

- [ ] **Step 3: Implement latest schema DDL in `backend/schema.mjs`**

Use the current `checkins` table name. The latest table must include:

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
record_key TEXT NOT NULL UNIQUE,
kind TEXT NOT NULL CHECK(kind IN ('scheduled','extra')),
local_date TEXT NOT NULL,
period TEXT CHECK(period IN ('day','evening') OR period IS NULL),
scheduled_for TEXT,
observed_at TEXT,
recorded_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
-- existing scale/sleep/json/note columns, with scale columns nullable
CHECK((kind='scheduled' AND period IS NOT NULL) OR (kind='extra' AND period IS NULL))
```

Create a partial unique index:

```sql
CREATE UNIQUE INDEX checkins_scheduled_identity
ON checkins(local_date, period)
WHERE kind='scheduled';
```

Create the migrated `reminder_state(local_date, period, snoozed_until, dismissed_at, notified_at, PRIMARY KEY(local_date,period))` and treatment tables specified in Task 4. New installs call `createLatestSchema` directly and set `PRAGMA user_version = 1`.

- [ ] **Step 4: Implement `prepareDatabase()` and the v0 -> v1 migration**

Migration sequence:

1. open legacy DB and checkpoint WAL;
2. create a timestamped non-pruned safety backup such as `pre-migration-20260807T120000Z.sqlite`;
3. begin transaction;
4. create new tables with temporary names;
5. copy legacy check-ins row-by-row, preserving integer IDs, `recorded_at`, `updated_at`, all user fields; generate `record_key` with `randomUUID()`; set `kind='scheduled'`; map `slot`; set `observed_at=NULL`; set `scheduled_for=NULL`;
6. copy reminder state with slot-to-period mapping;
7. create treatment seed rows per Task 4;
8. remove obsolete `treatmentChangeDate` and `medicationLabel` settings keys after the treatment rows exist;
9. swap temporary/live tables and indexes;
10. set `PRAGMA user_version = 1` as the final transactional schema step;
11. commit; on error roll back and rethrow.

Return `{ fromVersion, toVersion, backupPath }` for logging/tests.

- [ ] **Step 5: Wire migration before repository creation in `backend/main.mjs`**

Change startup order to:

```js
prepareDatabase({ dbPath: DB_PATH, backupDir: BACKUP_DIR, log });
const repo = createRepository(DB_PATH);
```

`createRepository` must no longer be responsible for inventing/upgrading schema. It may assert the expected schema version but CRUD and migration stay separate.

- [ ] **Step 6: Run focused migration/backup tests**

Run:

```bash
node --test test/migrations.test.mjs test/backups.test.mjs
```

Expected: PASS, including rollback test where an injected failing migration leaves `user_version=0` and the pre-migration backup readable.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm test
git add backend/schema.mjs backend/migrations.mjs backend/main.mjs backend/backups.mjs test/migrations.test.mjs test/backups.test.mjs test/fixtures/build-v211-fixture.mjs test/fixtures/med-checkin-2.1.1.sqlite
git commit -m "feat(db): add versioned 2.2 migration"
```

---

### Task 2: Observation Persistence, Timestamps, Extras, and Stable Identity

**Owner:** primary agent  
**Risk:** exceptional data integrity  
**Files:**
- Modify: `backend/domain.mjs`
- Modify: `backend/repository.mjs`
- Modify: `test/domain.test.mjs`
- Modify: `test/repository.test.mjs`

**Interfaces:**
- Consumes latest schema from Task 1.
- Produces `normalizeCheckin`, `periodForTime`, `createCheckin`, `updateCheckin`, scheduled lookup, full/paged listing, and privileged import hooks used by Task 8.

- [ ] **Step 1: Write failing domain tests for scheduled vs Extra validation**

Add tests proving:

```js
assert.throws(() => normalizeCheckin({ kind:'scheduled', localDate:'2026-08-07', period:'day' }), /required scale/i);
const extra = normalizeCheckin({ kind:'extra', observedAt:'2026-08-08T02:07:00+07:00', notes:'awake' });
assert.equal(extra.kind, 'extra');
assert.equal(extra.period, null);
assert.equal(extra.mood, null);
assert.throws(() => normalizeCheckin({ kind:'extra', observedAt:'2026-08-08T02:07:00+07:00' }), /empty extra/i);
```

Also test all non-null scales reject `<0`, `>10`, `NaN`, and infinity.

- [ ] **Step 2: Run domain tests and confirm failure**

```bash
node --test test/domain.test.mjs
```

Expected: FAIL on old slot/default-value behavior.

- [ ] **Step 3: Replace slot/default logic in `backend/domain.mjs`**

- Remove `clampScale(..., fallback=5)` semantics.
- Normalize a missing scale to `null`.
- For `kind='scheduled'`, require `period in {'day','evening'}` and all eight finite 0–10 scales.
- For `kind='extra'`, force `period=null`; require at least one meaningful scale/flag/note/red-flag field; derive `localDate` from `observedAt` local calendar date.
- Rename `slotForTime` to `periodForTime` and make `scheduledWindows()` return `{ period:'day'|'evening', scheduledAt }`.
- Keep configured `dayTime`/`eveningTime` values solely as schedule settings.

- [ ] **Step 4: Write failing repository tests for timestamp and uniqueness semantics**

Add tests equivalent to:

```js
const created = repo.createCheckin(input, new Date('2026-08-07T15:17:00Z'));
const edited = repo.updateCheckin(created.id, { ...input, mood: 8 }, new Date('2026-08-07T15:24:00Z'));
assert.equal(edited.recordedAt, created.recordedAt);
assert.notEqual(edited.updatedAt, created.updatedAt);
assert.equal(edited.recordKey, created.recordKey);
assert.throws(() => repo.createCheckin(input, later), /unique|duplicate/i);
```

Add multiple-Extra same-day tests and a scheduled-after-midnight test preserving target `localDate` while `observedAt` falls the next day.

- [ ] **Step 5: Implement explicit create/update repository methods**

`createCheckin(input, now)`:

- generate `record_key=randomUUID()`;
- server-set `recorded_at=updated_at=now.toISOString()`;
- for ordinary live scheduled entries default missing `observedAt` to now and snapshot `scheduledFor` from the caller-provided normalized value;
- insert; do not upsert on scheduled identity conflict.

`updateCheckin(id, input, now)`:

- load existing row;
- reject attempts to change `record_key` or ordinary `recorded_at`;
- keep existing `recorded_at`/`record_key`;
- server-set only `updated_at=now`;
- preserve uniqueness constraints.

Add `getScheduledCheckin(localDate, period)`, filters to `listCheckins`, and unbounded `listAllCheckins({from,to,kind,period})` for analytics/export.

- [ ] **Step 6: Run focused domain/repository tests**

```bash
node --test test/domain.test.mjs test/repository.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run full suite and commit**

```bash
npm test
git add backend/domain.mjs backend/repository.mjs test/domain.test.mjs test/repository.test.mjs
git commit -m "feat(data): model scheduled and extra observations"
```

---

### Task 3: HTTP API and Reminder Contract Conversion

**Owner:** primary agent  
**Risk:** high contract/data-integrity coupling  
**Files:**
- Modify: `backend/http-server.mjs`
- Modify: `backend/reminders.mjs`
- Modify: `backend/main.mjs`
- Modify: `test/http-server.test.mjs`
- Modify: `test/reminders.test.mjs`

**Interfaces:**
- Consumes repository/domain methods from Task 2.
- Preserves `/api/v1/checkins` collection naming.
- POST creates only; PUT `/api/v1/checkins/:id` edits; duplicate scheduled create returns 409.

- [ ] **Step 1: Add failing HTTP tests for the 2.2 observation API**

Cover:

```text
POST /api/v1/checkins scheduled -> 200/201 with kind=scheduled, period=day
POST duplicate same date+period -> 409
POST Extra -> success
PUT /api/v1/checkins/:id -> recordedAt unchanged, updatedAt changed
GET /api/v1/checkin?date=...&period=day -> scheduled row
GET /api/v1/checkins?kind=extra -> only Extras
```

Also assert client-provided `recordedAt` is ignored/rejected by ordinary create/update.

- [ ] **Step 2: Run focused HTTP tests and verify failure**

```bash
node --test test/http-server.test.mjs
```

- [ ] **Step 3: Convert API handlers**

Update `/api/v1/bootstrap` to return:

```js
{
  settings,
  current: { localDate, period, checkin },
  recent,
  currentTreatment // Task 4 may initially be null until wired
}
```

Change POST to `repo.createCheckin()`, add PUT-by-id to `repo.updateCheckin()`, convert scheduled lookup from `slot` to `period`, and pass list filters through safely.

Map validation/uniqueness failures to stable 400/409 JSON errors instead of generic 500.

- [ ] **Step 4: Add failing reminder tests using semantic periods**

Assert `getDueReminder()` returns `period:'day'|'evening'`, completed keys are `${localDate}|${period}`, and Extra rows are never included in the completed set.

- [ ] **Step 5: Convert reminders and main timer**

Update `backend/reminders.mjs` and `backend/main.mjs` to use period keys. Completion queries must filter `kind='scheduled'`. Migrate reminder endpoint payloads to `{ localDate, period }`.

- [ ] **Step 6: Run focused and full tests**

```bash
node --test test/http-server.test.mjs test/reminders.test.mjs
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/http-server.mjs backend/reminders.mjs backend/main.mjs test/http-server.test.mjs test/reminders.test.mjs
git commit -m "feat(api): use semantic check-in periods"
```

---

### Task 4: Structured Treatment Persistence and Known-History Backfill

**Owner:** primary agent  
**Risk:** exceptional longitudinal-data integrity  
**Files:**
- Create: `backend/treatment.mjs`
- Modify: `backend/repository.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `backend/migrations.mjs`
- Create: `test/treatment.test.mjs`
- Modify: `test/migrations.test.mjs`
- Modify: `test/http-server.test.mjs`

**Interfaces:**
- One optional undated baseline; max one dated snapshot per `effective_date`.
- Each event stores complete regimen items, not deltas.
- APIs: `GET/POST /api/v1/treatment-events`, `PUT/DELETE /api/v1/treatment-events/:id`.

- [ ] **Step 1: Write failing treatment-domain tests**

Test:

```js
const event = normalizeTreatmentEvent({
  effectiveDate: '2026-07-07',
  medications: [
    { medicationName:'Escitalopram', doseValue:10, doseUnit:'mg', timing:'morning' },
    { medicationName:'Atomoxetine', doseValue:80, doseUnit:'mg', timing:'morning' }
  ]
});
assert.equal(event.medications.length, 2);
```

Reject empty regimens, invalid dates, negative/non-finite doses, and blank medication/unit names.

- [ ] **Step 2: Implement treatment normalization/effective-date helper**

`effectiveTreatmentForDate(events, localDate)` chooses the latest dated event whose `effectiveDate <= localDate`; if none exists, returns the single baseline if present.

- [ ] **Step 3: Write failing repository/API tests**

Cover baseline uniqueness, dated-event uniqueness, create/update/delete, effective treatment lookup, and bootstrap/current-treatment output.

- [ ] **Step 4: Implement treatment repository CRUD transactionally**

When creating/updating an event, replace that event's medication items inside one transaction. Preserve event `created_at`; server-update `updated_at`. Deleting an event cascades items and never edits check-ins.

- [ ] **Step 5: Implement migration backfill exactly as approved**

For legacy v0 -> v1 only, seed:

```text
Baseline (effective_date NULL): Escitalopram 20 mg; Atomoxetine 80 mg
2026-07-07: Escitalopram 10 mg; Atomoxetine 80 mg
```

Use stable human-readable names exactly above and `dose_unit='mg'`. Do not invent a baseline date. After successful seed, delete obsolete treatment settings keys.

- [ ] **Step 6: Add/wire treatment API**

Return events with medication arrays in chronological order. `bootstrap.currentTreatment` is derived from today's local date. Do not hardcode a header label in backend settings.

- [ ] **Step 7: Run focused/full tests and commit**

```bash
node --test test/treatment.test.mjs test/migrations.test.mjs test/http-server.test.mjs
npm test
git add backend/treatment.mjs backend/repository.mjs backend/http-server.mjs backend/migrations.mjs test/treatment.test.mjs test/migrations.test.mjs test/http-server.test.mjs
git commit -m "feat(treatment): add structured regimen history"
```

### Risk Gate A: `sol_reviewer`

Before Task 5, review Tasks 1–4 as one batch. Required questions:

1. Can any migration failure advance `user_version` or lose legacy rows/reminder state?
2. Can ordinary API callers alter `record_key`/`recorded_at` or create ambiguous scheduled identities?
3. Can Extra entries accidentally satisfy reminders or scheduled uniqueness?
4. Does treatment backfill exactly preserve the approved known history without inventing dates?
5. Are schema/API validation failures atomic and explicit?

Resolve all load-bearing findings before continuing.

---

### Task 5: Capture UI, Unset Scales, Extra, Missed Check-ins, and Draft Recovery

**Owner:** `terra_workhorse`  
**Bounded ownership:** `resources/index.html`, `resources/app.js`, `resources/styles.css`, new `resources/draft-store.js`, related frontend tests only. Do not change backend contracts; stop if required.  
**Files:**
- Create: `resources/draft-store.js`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `resources/styles.css`
- Create: `test/draft-store.test.mjs`
- Modify: `test/frontend-smoke.test.mjs`
- Modify: `test/startup-runtime.test.mjs` only if script ordering/startup behavior requires it

**Interfaces:**
- Uses Task 3 API and Task 4 bootstrap treatment data verbatim.
- Draft storage API:

```js
MedCheckinDrafts.keyForScheduled(date, period)
MedCheckinDrafts.keyForExisting(recordKey)
MedCheckinDrafts.newExtraKey()
MedCheckinDrafts.read(key)
MedCheckinDrafts.write(key, value)
MedCheckinDrafts.remove(key)
```

- [ ] **Step 1: Write failing draft-store tests in a VM/localStorage stub**

Cover scheduled key, existing-record key, unique Extra draft key, round-trip, remove, and malformed stored JSON returning null rather than throwing.

- [ ] **Step 2: Implement `resources/draft-store.js` and include it before `app.js`**

Use an IIFE exposing only `globalThis.MedCheckinDrafts`. Namespace keys under `med-checkin-draft:`.

- [ ] **Step 3: Update form markup for semantic entry modes and unset scales**

Replace literal `13:00`/`22:00` buttons with Day/Evening buttons whose visible schedule text is populated from settings, plus an **Extra** action.

For each range row, track an explicit set/unset state. Initial new scheduled form output is `—` / Not set even if the HTML range element internally carries a midpoint for rendering. `formPayload()` must omit/null a scale until the user actually interacts with it or invokes **Use previous values**.

Add concise 0/10 endpoint anchors for each scale. All scales remain 0–10.

- [ ] **Step 4: Implement `Use previous values`**

Request/read the preceding scheduled observation and copy only the eight scale values. Mark those values explicitly set. Do not copy sleep, flags, notes, red flags, timestamps, or identity fields.

- [ ] **Step 5: Implement Extra capture mode**

Extra mode:

- hides/disables scheduled period identity;
- shows editable `observedAt`, default now;
- permits partial scales and note-only saves;
- submits `kind:'extra'`;
- never displays scheduled reminder completion copy.

- [ ] **Step 6: Implement Add missed check-in flow**

Add a History-launched dialog/form for target date, Day/Evening, observation date/time, and editable scheduled time. On duplicate 409, offer/open the existing scheduled record rather than overwriting it.

- [ ] **Step 7: Add dirty-state guard and crash drafts**

On any form mutation:

1. mark dirty;
2. debounce-write the full form state + explicit scale-set bitmap + identity to the matching draft key.

Before view/period/record/window transitions that would lose dirty state, use a three-choice in-app dialog: **Save / Discard / Cancel**. Disable Save when current form is invalid. For browser-level close paths where a custom async dialog cannot block, retain the local draft and let close proceed rather than pretending `beforeunload` can run arbitrary async save logic.

When opening an entry with a matching draft, explicitly show **Restore / Discard** with draft timestamp. Successful save or explicit discard removes the draft.

- [ ] **Step 8: Update save/edit behavior for POST-create vs PUT-edit**

New records POST. Existing records PUT by integer id. UI status displays recorded/edited timing from server response and never fabricates legacy observed/scheduled times.

- [ ] **Step 9: Run frontend-focused/full tests and commit**

```bash
node --test test/draft-store.test.mjs test/frontend-smoke.test.mjs test/startup-runtime.test.mjs
npm test
git add resources/draft-store.js resources/index.html resources/app.js resources/styles.css test/draft-store.test.mjs test/frontend-smoke.test.mjs test/startup-runtime.test.mjs
git commit -m "feat(ui): add truthful capture and draft recovery"
```

---

### Task 6: Complete History and Treatment UI

**Owner:** `terra_workhorse`  
**Bounded ownership:** frontend resources/tests only; backend endpoint behavior is fixed by Tasks 3–4.  
**Files:**
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `resources/styles.css`
- Modify: `test/frontend-smoke.test.mjs`

**Interfaces:**
- History uses paged `/api/v1/checkins` queries with `from/to/kind/period/limit/offset`.
- Treatment UI uses Task 4 endpoints; history may merge fetched treatment cards in memory but never treats them as check-ins.

- [ ] **Step 1: Add failing frontend smoke assertions for history controls**

Assert presence of 7/30/90/All range controls, custom date inputs, Day/Evening/Extra filters, note/symptom/activation/red-flag filters, pagination/load-more control, Add missed check-in, and treatment editor controls.

- [ ] **Step 2: Implement complete paged/ranged history loading**

Remove hardcoded `limit=200` assumption. Reset offset on filter/range changes. Continue loading until user stops or backend returns fewer than page size. **All** means all pages, not a hidden frontend cap.

- [ ] **Step 3: Implement History filters and timing presentation**

Scheduled card rules:

```text
Aug 7
Evening · scheduled 22:00   // omit scheduled time when scheduledFor=null
Observed ...                // only when present and meaningfully distinct
Recorded 22:17 · edited 22:24
```

Extra card rules:

```text
Aug 8
Extra · observed 02:07
Recorded 02:09
```

Omit edited time when `updatedAt === recordedAt`.

- [ ] **Step 4: Implement treatment Settings section**

Render current regimen and chronological events. Add-change pre-fills the effective regimen immediately before the selected date. Add/Edit/Delete use Task 4 APIs; Delete requires confirmation.

- [ ] **Step 5: Merge treatment markers into History chronology**

Fetch treatment events separately, render distinct event separators/cards, and never pass them through check-in edit/delete paths.

- [ ] **Step 6: Derive header medication label from current regimen**

Format regimen items from `bootstrap.currentTreatment`. If absent, hide the label entirely. Remove hardcoded medication fallback text from HTML/JS.

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
**Bounded ownership:** `backend/analytics.mjs`, chart/frontend analytics resources, analytics tests. Do not change persistence/import contracts.  
**Files:**
- Modify: `backend/analytics.mjs`
- Modify: `backend/http-server.mjs` only to pass query/range/treatment data into analytics
- Modify: `resources/app.js`
- Modify: `resources/index.html`
- Modify: `resources/vendor/chart-lite.js`
- Modify: `resources/styles.css`
- Modify: `test/analytics.test.mjs`
- Modify: `test/http-server.test.mjs`

**Interfaces:**
- `buildAnalytics(rows, settings, treatmentEvents, { from, to, now })` returns scheduled metrics, Extra markers, treatment markers, completion, and event comparison.
- Extras are display markers only and excluded from scheduled calculations.

- [ ] **Step 1: Replace/add failing analytics tests for exact approved formulas**

Test all of:

```text
scheduled-only daily means
Extras excluded from means/completion
trailing window = current calendar date + previous 2 calendar dates
missing date ignored but never replaced by day -3 or older
future row cannot alter earlier smoothed point
current-day Evening excluded from denominator before eveningTime unless already completed early
early completion never yields >100%
selected treatment first-seven window = effective date through +6 calendar days
```

- [ ] **Step 2: Run analytics tests and verify failures**

```bash
node --test test/analytics.test.mjs
```

- [ ] **Step 3: Implement analytics backend**

Filter `kind='scheduled'` before daily aggregation. Keep Extra rows separately as markers. Compute completion from calendar opportunities, not row count. Use treatment events as marker data and event-comparison boundaries. Preserve nulls.

- [ ] **Step 4: Add analytics API range/event query handling**

Allow `from`, `to`, and selected treatment event/date inputs. Query all matching rows without the old 1000-record hidden cap. Validate dates before use.

- [ ] **Step 5: Update Analytics UI controls**

Add 7/30/90/All/custom/Since treatment change, all-eight metric toggles, completion KPI blocks, treatment marker selection, and descriptive-causality disclaimer.

- [ ] **Step 6: Extend ChartLite for treatment and Extra markers**

Keep chart code dependency-free. Treatment markers are visually distinct vertical/event markers; Extra markers are inspectable points but are not included in series lines/rolling calculations.

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
**Risk:** exceptional destructive/data-integrity/retry/idempotency  
**Files:**
- Create: `backend/data-maintenance.mjs`
- Modify: `backend/backups.mjs`
- Modify: `backend/repository.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `backend/main.mjs`
- Create: `test/data-maintenance.test.mjs`
- Modify: `test/backups.test.mjs`
- Modify: `test/http-server.test.mjs`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `resources/styles.css`

**Interfaces:**
- Portable JSON top-level:

```js
{
  format: 'med-checkin-2',
  formatVersion: 1,
  exportedAt: '<ISO timestamp>',
  observations: [...],
  treatmentEvents: [...],
  settings: {...}
}
```

- Restore selection is by recognized backup basename from `BACKUP_DIR`, never arbitrary client path.
- Restore is staged while DB is open, applied after repository close on controlled restart.

- [ ] **Step 1: Write failing backup-list/validation tests**

Create temp valid legacy/latest SQLite files plus a corrupt file and unsupported `PRAGMA user_version=99` file. Assert `validateBackupFile()` accepts recognized legacy/latest, rejects corrupt/newer, and `listBackups()` returns only recognized automatic/manual/safety backup naming patterns with size/timestamp metadata.

- [ ] **Step 2: Extend backup primitives**

Keep daily automatic filenames/30-day pruning. Add timestamped non-pruned names for:

```text
manual-YYYYMMDDTHHMMSSZ.sqlite
pre-migration-YYYYMMDDTHHMMSSZ.sqlite
pre-restore-YYYYMMDDTHHMMSSZ.sqlite
pre-import-YYYYMMDDTHHMMSSZ.sqlite
```

All snapshots checkpoint first and verify the destination exists.

- [ ] **Step 3: Write failing staged-restore tests**

Test sequence:

1. stage recognized backup by basename;
2. verify pre-restore snapshot is created;
3. verify a small atomic `restore-request.json` is written inside data dir;
4. simulate closed DB/startup and call `applyPendingRestore()`;
5. confirm candidate validates, replaces working DB, and normal migration can advance older supported backup;
6. inject failure after candidate staging and prove original working DB is restored/recoverable.

- [ ] **Step 4: Implement staged restore and controlled restart**

`stageRestore()` must canonicalize/resolve backup basename inside `backupDir`, validate it, create pre-restore snapshot, then atomically write the pending request.

`main.mjs` startup order becomes:

```js
applyPendingRestore(...);   // no repository open yet
prepareDatabase(...);
const repo = createRepository(DB_PATH);
```

Extend shutdown with an internal restart path that closes API/repo, stops host, then calls existing `spawnDetached(['--show'])` after handles are closed. Do not restart before DB close.

- [ ] **Step 5: Write failing portable-format validation/preview tests**

Test malformed top-level format/version, duplicate `record_key`, invalid timestamps/scales, scheduled identity conflicts, treatment duplicate dates, and preview counts/date range/conflicts.

- [ ] **Step 6: Implement versioned export and preview endpoints**

`GET /api/v1/export.json` emits the locked format. Add a bounded import body reader specifically for portability JSON (for example 10 MiB) rather than globally raising the 256 KiB normal API body limit.

Add `POST /api/v1/import/preview` returning observation count, Extra count, treatment-event count, date range, source version, and deterministic warnings/conflicts.

- [ ] **Step 7: Write failing Merge/Replace repository tests**

Merge assertions:

- unknown `record_key` inserts preserving validated source audit timestamps through privileged import;
- known key keeps local `recorded_at`;
- newer imported `updated_at` wins mutable content;
- newer local wins;
- equal timestamp + different content rejects whole import;
- different keys colliding on `(local_date,period)` reject whole import;
- treatment baseline/date conflicts obey same newer/equal rules.

Replace assertions: portable observations/treatment/settings are replaced transactionally while runtime secrets/paths remain local.

- [ ] **Step 8: Implement transactional privileged import**

Before either Merge or Replace, create pre-import SQLite backup and fully validate input. `repo.applyPortableImport()` owns the DB transaction. Ordinary create/update timestamp restrictions remain unchanged; only this privileged path may preserve imported audit timestamps.

- [ ] **Step 9: Add backup/import UI**

Settings data section adds:

- Create backup now
- Restore backup… list
- Import JSON… file picker
- preview panel
- explicit Merge / Replace confirmation

Do not expose arbitrary filesystem paths. Show operation failures without stack traces and preserve diagnostics in logs.

- [ ] **Step 10: Run focused/full tests and commit**

```bash
node --test test/data-maintenance.test.mjs test/backups.test.mjs test/http-server.test.mjs test/repository.test.mjs
npm test
git add backend/data-maintenance.mjs backend/backups.mjs backend/repository.mjs backend/http-server.mjs backend/main.mjs resources/index.html resources/app.js resources/styles.css test/data-maintenance.test.mjs test/backups.test.mjs test/http-server.test.mjs test/repository.test.mjs
git commit -m "feat(data): add safe restore and portable import"
```

### Risk Gate C: `sol_reviewer`

Review Task 8 as its own exceptional-risk batch. Required questions:

1. Can restore ever overwrite the only good copy before candidate validation?
2. Is the repository definitely closed before SQLite replacement?
3. Can a restore request escape `BACKUP_DIR` by path traversal or crafted basename?
4. Can retry/restart apply the same pending restore ambiguously?
5. Do Merge/Replace validate before mutation and remain fully transactional?
6. Can ordinary callers reach privileged timestamp-preserving import behavior?
7. Are equal-timestamp conflicts and scheduled-identity conflicts rejected deterministically?

Resolve all load-bearing findings before final integration.

---

### Task 9: Reminder UI Consistency and Open Data Folder

**Owner:** `luna_implementer`  
**Bounded ownership:** reminder copy/settings display, host action enum/PowerShell implementation, focused tests. Stop on any broader process/security/data decision.  
**Files:**
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `backend/host-actions.mjs`
- Modify: `backend/http-server.mjs` only for the predefined open-data-folder control action
- Modify: `windows/tray-host.ps1`
- Modify: `test/frontend-smoke.test.mjs`
- Modify: `test/http-server.test.mjs`
- Modify: `test/host-actions.test.mjs` if present; otherwise add focused assertions to the nearest existing host-action test

**Interfaces:**
- Snooze visible value and request minutes equal `settings.repeatMinutes`.
- Pause status remains visibly rendered while `remindersPausedUntil > now`.
- Open data folder uses a fixed host action carrying the backend-owned data directory, never a browser-provided arbitrary path.

- [ ] **Step 1: Add failing UI/API/host assertions**

Assert hardcoded `30` snooze copy/request is absent, configured repeat value is rendered, pause status exists, and host action supports only the fixed `open-data-folder` command.

- [ ] **Step 2: Implement dynamic reminder copy and pause state**

Render `Remind me in ${settings.repeatMinutes} minutes` and submit the same number. Render `Reminders paused until … · Resume` until expired/resumed.

- [ ] **Step 3: Implement fixed Open data folder host action**

Backend queues `{ type:'open-data-folder' }`; PowerShell resolves the existing app data directory from its known runtime/app configuration and opens Explorer. Do not accept a path parameter from web UI.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/frontend-smoke.test.mjs test/http-server.test.mjs
npm test
git add resources/index.html resources/app.js backend/host-actions.mjs backend/http-server.mjs windows/tray-host.ps1 test/frontend-smoke.test.mjs test/http-server.test.mjs
git commit -m "fix(reminders): honor configured actions"
```

---

### Task 10: Windows CI, Version 2.2.0, Packaging, and Active Docs

**Owner:** `luna_implementer`  
**Bounded ownership:** CI/config/version/docs/release-verification only. No behavior redesign.  
**Files:**
- Create: `.github/workflows/windows-ci.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.txt`
- Modify: `resources/index.html`
- Modify: `scripts/verify-release.mjs`
- Modify: `scripts/package-windows.mjs` only where version/layout expectations require it
- Modify: `test/package-layout.test.mjs`
- Modify: `test/frontend-smoke.test.mjs`

**Interfaces:**
- Release version is `2.2.0` everywhere user-visible/package metadata expects it.
- CI uses Node `22.23.1` on `windows-latest`.

- [ ] **Step 1: Add failing version/layout assertions**

Update tests to expect `2.2.0`, new runtime files (`backend/schema.mjs`, `backend/migrations.mjs`, `backend/treatment.mjs`, `backend/data-maintenance.mjs`, `resources/draft-store.js`), and no accidental test fixture in packaged runtime.

- [ ] **Step 2: Update version metadata and README**

Update package/package-lock version, UI title/version, README behavior for Day/Evening/Extra, treatment history, drafts, restore/import, and backup safety. Preserve privacy/offline disclaimers.

- [ ] **Step 3: Add Windows GitHub Actions workflow**

Use:

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

Do not add deployment/release publication steps.

- [ ] **Step 4: Update release verifier/package layout**

Require the new runtime modules and draft script; reject test fixtures/dev docs from release ZIP where existing policy does so. Keep package generation deterministic within existing script conventions.

- [ ] **Step 5: Run package/release gate and commit**

```bash
npm test
npm run package:windows
git add .github/workflows/windows-ci.yml package.json package-lock.json README.txt resources/index.html scripts/verify-release.mjs scripts/package-windows.mjs test/package-layout.test.mjs test/frontend-smoke.test.mjs
git commit -m "chore(release): prepare Med Check-in 2.2.0"
```

---

### Integration Gate B: `terra_reviewer`

After Tasks 5–7, 9, and 10, review the ordinary integration batch. Required questions:

1. Can any navigation path lose dirty data without either a prompt or recoverable draft?
2. Are Day/Evening/Extra UI identities consistent with backend payloads?
3. Does History really reach all data rather than a hidden cap?
4. Are treatment events visually/behaviorally distinct from check-ins?
5. Do analytics follow the exact fixed-calendar formulas and exclude Extras from scheduled metrics?
6. Does reminder UI use configured values everywhere?
7. Do CI/package changes match the actual supported Windows release layout?

Escalate any data-integrity finding to `sol_reviewer` rather than fixing it in review.

---

### Task 11: Final Integration, Regression Repair, and Release Verification

**Owner:** primary agent  
**Risk:** whole-branch integration  
**Files:**
- Modify only files required to resolve concrete integration failures found by fresh verification/review.
- Do not add new features.

**Interfaces:** all prior tasks and approved design acceptance criteria.

- [ ] **Step 1: Re-read the approved design and map every acceptance criterion to fresh evidence**

Use `docs/superpowers/specs/2026-08-07-med-checkin-2.2-reliability-design.md` section 15. Create a local checklist in the SDD ledger, not a new committed scope document.

- [ ] **Step 2: Run the complete automated suite from a clean-enough worktree**

```bash
npm test
```

Expected: PASS with no skipped/disabled regression tests introduced to hide failures.

- [ ] **Step 3: Run syntax and release/package verification**

Run the repository's current release verifier through:

```bash
npm run package:windows
```

Also run any explicit `node --check` commands discovered in `scripts/verify-release.mjs` if they are not already exercised by packaging.

Expected: package and archive verification succeed.

- [ ] **Step 4: Perform a real migration smoke test using a copy of the synthetic 2.1.1 fixture**

Start the backend against a temporary data directory containing the fixture as `med-checkin.sqlite`. Verify health/bootstrap after automatic migration, inspect that the recovery backup exists, and confirm both migrated observations/reminder state/treatment seed are readable.

- [ ] **Step 5: Perform a fresh-2.2 smoke test**

Against an empty temporary data directory:

1. start backend;
2. create Day and Evening records;
3. create at least two Extras on one date;
4. edit one scheduled record and verify recorded/edit times;
5. create/edit a treatment event;
6. export JSON;
7. preview Merge/Replace using that export;
8. create manual backup;
9. exercise staged restore in a temporary/test environment;
10. verify analytics/completion endpoint.

No real personal DB is used for destructive smoke tests.

- [ ] **Step 6: Repair only concrete integration regressions, with focused tests first**

For every discovered regression: reproduce, add/update focused test, make minimum fix, rerun focused test, then `npm test`. Do not use this task for opportunistic refactors.

- [ ] **Step 7: Final whole-branch `sol_reviewer` review**

Review migration, restore/import, privacy/local API boundary, timestamp integrity, treatment history, reminder semantics, and tests. One final fix dispatch/re-review is allowed per the subagent-driven workflow; unresolved load-bearing findings block completion.

- [ ] **Step 8: Final verification after review fixes**

```bash
npm test
npm run package:windows
```

Capture exact fresh outcomes in the SDD ledger/final handoff.

- [ ] **Step 9: Commit final integration fixes if any**

If Step 6/7 required changes:

```bash
git add <only-the-files-changed-for-verified-fixes>
git commit -m "fix: complete Med Check-in 2.2 integration"
```

If no changes were needed, do not create an empty commit.

---

## Plan Self-Review Checklist

Before execution begins, the primary agent must confirm:

- [ ] Every design acceptance criterion maps to at least one task/test above.
- [ ] No task asks `luna_implementer` to decide migrations, data integrity, security, privacy, or contracts.
- [ ] `terra_workhorse` assignments have fixed backend interfaces and bounded frontend/analytics ownership.
- [ ] Migration and restore/import each have `sol_reviewer` gates.
- [ ] No task implements Med Check-in v1 import.
- [ ] No task adds cloud/accounts/multi-user/drug-database/AI-medical features.
- [ ] All eight core scales remain 0–10.
- [ ] Legacy `observed_at`/`scheduled_for` are not fabricated.
- [ ] Extras cannot affect scheduled reminder completion or scheduled analytics by default.
- [ ] JSON Merge conflict rules are deterministic and transactional.
- [ ] Restore never accepts an arbitrary browser-provided filesystem path.
- [ ] Windows CI and package verification run on the actual supported platform.
