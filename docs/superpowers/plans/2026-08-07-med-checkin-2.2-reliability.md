# Med Check-in 2.2 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for this plan. The user explicitly prefers a quota-efficient execution with selective delegation rather than the review-after-every-task overhead of subagent-driven development.

**Goal:** Deliver the modest 2.2 reliability upgrade defined in `docs/superpowers/specs/2026-08-07-med-checkin-2.2-reliability-design.md` without broadening the app into a synchronization platform or generalized health system.

**Architecture:** Preserve the current Windows PowerShell tray + Node.js + SQLite + static browser UI architecture. Add one explicit schema migration, evolve the existing check-in model to scheduled Day/Evening plus Extra, store treatment snapshots as JSON in one table, and add simple backup restore plus Replace-only JSON import.

**Tech Stack:** Node.js 22.23.1 ESM, built-in `node:sqlite` `DatabaseSync`, built-in `node:test`, static HTML/CSS/JavaScript, Windows PowerShell 5.1 tray host, GitHub Actions `windows-latest`.

## Global Constraints

- Personal-use Windows app: one user, one local database.
- Preserve loopback-only authenticated API, PowerShell tray host, watchdog, offline behavior, installer shape, and existing architecture.
- No new dependencies unless the required behavior cannot reasonably be implemented with the current stack.
- All eight core scales remain numeric 0-10.
- Scheduled Day/Evening entries require all eight scales; Extras may be partial but not empty.
- Never fabricate missing scale values.
- Keep integer check-in IDs. Do **not** add UUID/stable synchronization keys.
- `recorded_at` is backend-owned and immutable under ordinary edits; `updated_at` changes on successful edits; `observed_at` may be retrospective; migrated legacy `observed_at` remains null.
- Extras never clear scheduled reminders and never enter scheduled analytics/completion by default.
- Treatment history uses one `treatment_events` table with `regimen_json`; do not create medication-item normalization tables.
- JSON import is **Replace only**. Do not implement Merge, conflict resolution, synchronization, or version-vector-like behavior.
- v1 import remains out of scope.
- Analytics changes stay lean: scheduled-only calculations, trailing smoothing, completion, and treatment markers. Do not build generic treatment comparison controls or all-metric chart configurators.
- Use synthetic/temp databases for destructive migration/restore/import tests, never the real personal database.
- Do not restart implementation from scratch because a reviewer prefers a different architecture. Reviewer findings must be judged against the approved scope and actual acceptance criteria.

## Execution and Agent Ownership

The **primary agent** owns the worktree, repository accountability, integration, persistent-data decisions, and final handoff.

Use delegated agents only for these bounded tasks:

| Task | Owner | Boundary |
| --- | --- | --- |
| 1. Migration + observation persistence | **primary agent** | schema/data integrity |
| 2. Treatment + API/reminder semantics | **primary agent** | treatment persistence and API contracts |
| 3. Capture UI + drafts + Extra/missed | `terra_workhorse` | fixed backend contracts, frontend/state integration only |
| 4. History + treatment UI + lean analytics | `terra_workhorse` | fixed persistence contracts; no analytics scope expansion |
| 5. Backup restore + Replace-only JSON import | **primary agent** | destructive/recovery path |
| 6. Reminder polish + Open data folder | `luna_implementer` | narrow pattern-following UI/host work |
| 7. Windows CI + version/docs | `luna_implementer` | mechanical config/package/docs |
| 8. Final integration | **primary agent** | regression fixes and verification only |

`luna_implementer` must stop before architecture, migration, security/privacy, or data-integrity decisions. `terra_workhorse` must stop if the fixed backend contract cannot support its task without a new design choice.

Do not use `terra_explorer` unless a genuinely unknown execution path blocks progress.

### Review budget

There are only **two planned reviews**:

1. **Checkpoint A after Task 2:** one `terra_reviewer` review of migration, observation persistence, treatment persistence, and reminder/API contracts.
2. **Final Checkpoint after Task 8:** one `terra_reviewer` whole-branch review focused on correctness, regression, packaging, and plausible data-loss risks.

There is **no mandatory `sol_reviewer` pass**. Escalate one narrowly scoped question to `sol_reviewer` only if a reviewer or primary agent finds a concrete exceptional-risk issue that cannot be resolved from code/tests. Do not ask Sol for a broad speculative audit.

Reviewer instructions:

- report actionable issues grounded in reachable current-app behavior;
- prioritize reproducible/plausible data loss, incorrect migration, broken restore, invalid writes, security boundary violations, and meaningful regressions;
- do not block release on astronomically rare hypothetical states that require architectural rewrites but have no plausible path in this one-user local app;
- suggestions outside 2.2 acceptance criteria are non-blocking notes.

---

## Locked Data Interfaces

### Observation shape

```js
{
  id: Number,
  kind: 'scheduled' | 'extra',
  localDate: 'YYYY-MM-DD',
  period: 'day' | 'evening' | null,
  scheduledFor: String | null,
  observedAt: String | null,
  recordedAt: String,
  updatedAt: String,
  mood: Number | null,
  anxiety: Number | null,
  irritability: Number | null,
  energy: Number | null,
  focus: Number | null,
  functioning: Number | null,
  sleepQuality: Number | null,
  appetite: Number | null,
  // existing sleep/JSON flags/notes/redFlags fields
}
```

### Treatment shape

```js
{
  id: Number,
  effectiveDate: 'YYYY-MM-DD' | null,
  regimen: [
    { name: String, amount: Number, unit: String, timing: String | null }
  ],
  note: String,
  createdAt: String,
  updatedAt: String
}
```

An empty `regimen` array is valid and means no active medication.

### Portable JSON format

```js
{
  format: 'med-checkin-2',
  formatVersion: 1,
  exportedAt: '<ISO timestamp>',
  observations: [],
  treatmentEvents: [],
  settings: {
    dayTime: '13:00',
    eveningTime: '22:00',
    catchupHours: 4,
    repeatMinutes: 30
  }
}
```

Import supports only full **Replace** of portable data after validation, preview, confirmation, and pre-import backup.

---

### Task 1: Versioned Migration and Observation Persistence

**Owner:** primary agent  
**Files:**
- Create: `backend/schema.mjs`
- Create: `backend/migrations.mjs`
- Create: `test/migrations.test.mjs`
- Create: `test/fixtures/build-v211-fixture.mjs`
- Generate: `test/fixtures/med-checkin-2.1.1.sqlite`
- Modify: `backend/repository.mjs`
- Modify: `backend/domain.mjs`
- Modify: `backend/main.mjs`
- Modify: `backend/backups.mjs`
- Modify tests: `test/repository.test.mjs`, `test/domain.test.mjs`, `test/backups.test.mjs`

**Produces:** `LATEST_SCHEMA_VERSION = 1`; latest schema; `prepareDatabase({ dbPath, backupDir, now, log })`; semantic observation CRUD.

- [ ] **Step 1: Build a synthetic 2.1.1 fixture and failing migration tests**

Fixture contains two scheduled legacy rows (`13:00`, `22:00`), representative scales/sleep/flags/notes, both reminder-state rows, and current settings. Use obviously synthetic notes such as `fixture day` and `fixture evening`.

Assert after migration:

```js
assert.equal(day.id, legacyDayId);
assert.equal(day.kind, 'scheduled');
assert.equal(day.period, 'day');
assert.equal(day.observedAt, null);
assert.equal(day.scheduledFor, null);
assert.equal(day.recordedAt, legacyRecordedAt);
assert.equal(evening.period, 'evening');
assert.equal(readUserVersion(dbPath), 1);
```

Also assert reminder state maps 13:00 -> day and 22:00 -> evening and a pre-migration backup exists.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

```bash
node test/fixtures/build-v211-fixture.mjs
node --test test/migrations.test.mjs
```

Expected: fixture succeeds; test fails because the migration layer does not exist yet.

- [ ] **Step 3: Implement schema version 1**

Keep table name `checkins`; add `kind`, `period`, `scheduled_for`, `observed_at`; make scale columns nullable; preserve existing user fields.

Enforce:

```sql
CHECK(kind IN ('scheduled','extra'))
CHECK(period IN ('day','evening') OR period IS NULL)
CHECK((kind='scheduled' AND period IS NOT NULL) OR (kind='extra' AND period IS NULL))
```

and partial uniqueness:

```sql
CREATE UNIQUE INDEX checkins_scheduled_identity
ON checkins(local_date, period)
WHERE kind='scheduled';
```

Update `reminder_state` to semantic `period`.

- [ ] **Step 4: Implement v0 -> v1 migration and startup hook**

Order:

1. checkpoint;
2. create timestamped `pre-migration-*.sqlite` backup;
3. transactionally rebuild/copy tables;
4. map slots to periods;
5. preserve existing IDs/timestamps/data;
6. set legacy `observed_at`/`scheduled_for` null;
7. migrate reminder state;
8. create treatment seed described in Task 2 inside the new treatment table schema;
9. remove obsolete authoritative treatment settings only after seed succeeds;
10. set `PRAGMA user_version = 1` after successful migration.

Call `prepareDatabase()` before `createRepository()` in `backend/main.mjs`.

- [ ] **Step 5: Replace fallback scale normalization with explicit validation**

`normalizeCheckin()` behavior:

- scheduled: all eight scales required, finite, 0-10;
- extra: each supplied scale finite, 0-10; partial allowed; at least one meaningful field overall;
- new records require valid `observedAt`;
- scheduled requires Day/Evening; Extra requires null period.

Remove `clampScale(..., 5)` style fallback behavior.

- [ ] **Step 6: Update repository create/update semantics**

`createCheckin(input, now)` sets backend `recorded_at = updated_at = now`. `updateCheckin(id, input, now)` preserves `recorded_at` and changes `updated_at`.

Add/retain helpers needed later:

```js
repo.getScheduledCheckin(localDate, period)
repo.getCheckinById(id)
repo.listCheckins({ limit, offset, from, to, kind, period })
repo.listAllCheckins({ from, to, kind, period })
```

- [ ] **Step 7: Run focused tests, then full suite**

```bash
node --test test/migrations.test.mjs test/domain.test.mjs test/repository.test.mjs test/backups.test.mjs
npm test
```

- [ ] **Step 8: Commit Task 1**

```bash
git add backend/schema.mjs backend/migrations.mjs backend/repository.mjs backend/domain.mjs backend/main.mjs backend/backups.mjs test/migrations.test.mjs test/fixtures/build-v211-fixture.mjs test/fixtures/med-checkin-2.1.1.sqlite test/repository.test.mjs test/domain.test.mjs test/backups.test.mjs
git commit -m "feat(data): migrate check-ins to semantic observations"
```

---

### Task 2: Treatment Snapshots, HTTP Contracts, and Reminder Semantics

**Owner:** primary agent  
**Files:**
- Create: `backend/treatment.mjs`
- Create: `test/treatment.test.mjs`
- Modify: `backend/repository.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `backend/reminders.mjs`
- Modify: `backend/main.mjs`
- Modify tests: `test/http-server.test.mjs`, `test/reminders.test.mjs`, `test/repository.test.mjs`, `test/migrations.test.mjs`

**Produces:** treatment CRUD/effective-regimen resolution; Day/Evening/Extra API contract; semantic reminder completion.

- [ ] **Step 1: Add failing treatment tests**

Cover:

```js
baseline.effectiveDate === null
regimenOn('2026-07-06') // baseline
regimenOn('2026-07-07') // 10 mg escitalopram snapshot
```

Assert at most one baseline and one event per date; empty regimen array accepted; malformed regimen item rejected.

- [ ] **Step 2: Implement treatment table access and validation**

Store `regimen_json` as one validated JSON array. Expose:

```js
repo.listTreatmentEvents()
repo.createTreatmentEvent(event, now)
repo.updateTreatmentEvent(id, event, now)
repo.deleteTreatmentEvent(id)
repo.getEffectiveTreatment(localDate)
```

Known seed after migration:

```text
baseline: Escitalopram 20 mg; Atomoxetine 80 mg
2026-07-07: Escitalopram 10 mg; Atomoxetine 80 mg
```

- [ ] **Step 3: Add failing HTTP tests for semantic observations**

Require POST create, PUT edit, list filters, duplicate scheduled 409, partial Extra acceptance, empty Extra 400, and server-owned audit timestamps.

- [ ] **Step 4: Implement/adjust `/api/v1/checkins` routes**

Preserve collection naming. Payloads use `kind`/`period`, not legacy slot identity. Do not allow ordinary clients to set `recordedAt`/`updatedAt`.

Add treatment endpoints under `/api/v1/treatment-events` and include current treatment in bootstrap/settings data used by the UI.

- [ ] **Step 5: Convert reminders to semantic periods**

`getDueReminder()` and runtime completion sets use Day/Evening. Saving Day clears Day only; Evening clears Evening only; Extra clears neither. Visible snooze data comes from `repeatMinutes`.

- [ ] **Step 6: Run focused/full tests and commit**

```bash
node --test test/treatment.test.mjs test/http-server.test.mjs test/reminders.test.mjs test/repository.test.mjs test/migrations.test.mjs
npm test
git add backend/treatment.mjs backend/repository.mjs backend/http-server.mjs backend/reminders.mjs backend/main.mjs test/treatment.test.mjs test/http-server.test.mjs test/reminders.test.mjs test/repository.test.mjs test/migrations.test.mjs
git commit -m "feat(core): add treatment history and semantic API"
```

### Checkpoint A: one `terra_reviewer`

Review only Tasks 1-2. Focus on reachable correctness issues: migration preservation, schema constraints, timestamp ownership, treatment seed/resolution, duplicate scheduled protection, and reminder semantics.

Do not request architectural rewrites for speculative edge cases. Primary agent fixes concrete findings and reruns focused tests + `npm test` before continuing.

---

### Task 3: Capture UI, Extra, Missed Check-ins, and Draft Recovery

**Owner:** `terra_workhorse`  
**Bounded ownership:** frontend resources and frontend-focused tests; backend contracts from Tasks 1-2 are fixed.

**Files:**
- Create: `resources/draft-store.js`
- Create: `test/draft-store.test.mjs`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `resources/styles.css`
- Modify: `test/frontend-smoke.test.mjs`

- [ ] **Step 1: Add failing draft-store tests**

Expose a small dependency-free API on `globalThis.MedCheckinDrafts` for read/write/remove. Keys:

```text
scheduled:<YYYY-MM-DD>:day|evening
extra:<generated-local-key>
checkin:<integer-id>
```

- [ ] **Step 2: Remove fake defaults from scheduled scales**

A fresh scheduled form visually starts unset. Track whether each scale has an intentional value; do not submit midpoint DOM values that the user never chose.

- [ ] **Step 3: Add explicit Use previous values**

Copy only the eight scales from the immediately preceding saved scheduled observation.

- [ ] **Step 4: Implement Day / Evening / Extra capture paths**

Day/Evening show configured clock time beside label. Extra has no period, defaults observation time to now, allows partial scales/note/flags, and rejects empty submit.

- [ ] **Step 5: Implement Add missed check-in**

Ask target date, Day/Evening, observation datetime, scheduled datetime. On duplicate 409, offer/open existing entry rather than overwrite it.

- [ ] **Step 6: Implement dirty guard + drafts**

Debounce-save dirty form state to localStorage. In-app destructive navigation offers Save / Discard / Cancel. On reopen, matching draft offers Restore / Discard with age. Successful save/discard deletes draft.

- [ ] **Step 7: Run tests and commit**

```bash
node --test test/draft-store.test.mjs test/frontend-smoke.test.mjs
npm test
git add resources/draft-store.js resources/index.html resources/app.js resources/styles.css test/draft-store.test.mjs test/frontend-smoke.test.mjs
git commit -m "feat(ui): add Extra entries and draft recovery"
```

---

### Task 4: Complete History, Treatment UI, and Lean Analytics

**Owner:** `terra_workhorse`  
**Bounded ownership:** history/treatment/analytics UI plus approved analytics formulas. No persistence redesign, no generic treatment-comparison engine.

**Files:**
- Modify: `backend/analytics.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `resources/styles.css`
- Modify: `resources/vendor/chart-lite.js` only if treatment markers require it
- Modify tests: `test/analytics.test.mjs`, `test/http-server.test.mjs`, `test/frontend-smoke.test.mjs`

- [ ] **Step 1: Add failing analytics tests for the lean formulas**

Cover:

- scheduled rows only;
- Extras excluded;
- daily value averages available Day/Evening;
- trailing window is current calendar date + previous two dates only;
- missing dates do not pull in older observations;
- current not-yet-due period excluded from completion denominator unless completed early.

- [ ] **Step 2: Implement lean analytics backend**

Keep existing useful summary/day-evening/frequency behavior. Replace centered smoothing with trailing smoothing. Add completion stats and dated treatment marker data. Remove/simplify the old one-off `first 7 vs later` treatment card rather than generalizing it.

- [ ] **Step 3: Make History reach all rows**

Implement 7/30/90/All/custom range plus Day/Evening/Extra filter and pagination/load-more. Remove hardcoded effective 200-row ceiling.

- [ ] **Step 4: Implement honest timing display**

Show scheduled time only when stored; show observed time when known/useful; show recorded time; show edited time only when different. Never infer legacy missing timestamps.

- [ ] **Step 5: Implement Treatment settings UI**

Show current regimen and chronological events. Add event pre-fills prior effective regimen. Edit/Delete use fixed Task 2 endpoints. Treatment timeline entries may appear in History as distinct cards.

- [ ] **Step 6: Add treatment markers and completion to existing analytics UI**

Do not add all-eight-metric toggles, arbitrary treatment selectors, or Extra values into scheduled trend calculations.

- [ ] **Step 7: Run tests and commit**

```bash
node --test test/analytics.test.mjs test/http-server.test.mjs test/frontend-smoke.test.mjs
npm test
git add backend/analytics.mjs backend/http-server.mjs resources/index.html resources/app.js resources/styles.css resources/vendor/chart-lite.js test/analytics.test.mjs test/http-server.test.mjs test/frontend-smoke.test.mjs
git commit -m "feat(ui): complete history treatment and lean analytics"
```

If `resources/vendor/chart-lite.js` is unchanged, omit it from `git add`.

---

### Task 5: Safe SQLite Restore and Replace-Only JSON Portability

**Owner:** primary agent  
**Files:**
- Create: `backend/data-maintenance.mjs`
- Create: `test/data-maintenance.test.mjs`
- Modify: `backend/backups.mjs`
- Modify: `backend/repository.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `backend/main.mjs`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify tests: `test/backups.test.mjs`, `test/http-server.test.mjs`, `test/repository.test.mjs`

- [ ] **Step 1: Add failing backup/restore validation tests**

Use temp databases. Cover recognized automatic/manual backup listing, corrupt SQLite rejection, unsupported newer schema rejection, and creation of a pre-restore backup before replacement.

- [ ] **Step 2: Extend backup primitives minimally**

Support timestamped manual and safety backups:

```text
manual-YYYYMMDDTHHMMSSZ.sqlite
pre-migration-YYYYMMDDTHHMMSSZ.sqlite
pre-restore-YYYYMMDDTHHMMSSZ.sqlite
pre-import-YYYYMMDDTHHMMSSZ.sqlite
```

Keep existing automatic retention behavior.

- [ ] **Step 3: Implement the simplest safe restore flow**

Required invariants only:

1. selected backup comes from the app backup directory/list;
2. validate SQLite + recognized schema before mutation;
3. checkpoint and create pre-restore backup;
4. close live repository before replacing DB;
5. replace and restart/reopen;
6. if restored DB is legacy supported version, normal migration upgrades it;
7. if restore/migration fails, current/pre-restore DB remains recoverable and the app reports failure rather than silently using ambiguous state.

Reuse existing host/restart mechanisms. Do **not** build generalized retries, quarantine queues, or recovery orchestration unless required to satisfy these invariants.

- [ ] **Step 4: Add failing versioned JSON Replace tests**

Validate exact format/version, observation/treatment/settings shapes, duplicate scheduled identities, invalid scales/timestamps, and preview counts/date range. No merge/conflict tests exist because Merge is out of scope.

- [ ] **Step 5: Implement export + preview + Replace**

`GET /api/v1/export.json` emits the locked portable format.

`POST /api/v1/import/preview` validates without mutation.

`POST /api/v1/import/replace`:

1. validates whole payload;
2. creates pre-import SQLite backup;
3. transactionally replaces portable check-ins, treatment events, and whitelisted settings;
4. preserves validated source IDs/timestamps where provided;
5. leaves runtime token/path/reminder notification state local.

No UUIDs. No Merge. No timestamp conflict resolution.

- [ ] **Step 6: Add Settings UI**

Add Create backup now, Restore backup, Import JSON, preview, and explicit Replace confirmation.

- [ ] **Step 7: Run tests and commit**

```bash
node --test test/data-maintenance.test.mjs test/backups.test.mjs test/http-server.test.mjs test/repository.test.mjs
npm test
git add backend/data-maintenance.mjs backend/backups.mjs backend/repository.mjs backend/http-server.mjs backend/main.mjs resources/index.html resources/app.js test/data-maintenance.test.mjs test/backups.test.mjs test/http-server.test.mjs test/repository.test.mjs
git commit -m "feat(data): add safe restore and JSON replacement import"
```

---

### Task 6: Reminder UI Consistency and Open Data Folder

**Owner:** `luna_implementer`  
**Bounded ownership:** mechanical reminder copy/pause display and predefined host action only.

**Files:** `resources/index.html`, `resources/app.js`, `backend/host-actions.mjs`, `backend/http-server.mjs`, `windows/tray-host.ps1`, relevant existing tests.

- [ ] **Step 1: Add focused failing assertions**

Assert configured `repeatMinutes` drives visible snooze copy and request; pause state stays visible; Open data folder browser request contains no arbitrary path.

- [ ] **Step 2: Implement dynamic reminder copy/state**

Render equivalent of `Remind me in ${settings.repeatMinutes} minutes` and submit that exact value. Render paused-until status with Resume.

- [ ] **Step 3: Implement fixed Open data folder action**

Browser sends a fixed command. Backend queues its already-owned `dataDir`. PowerShell opens exactly that path in Explorer. Browser input never supplies a filesystem path.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/frontend-smoke.test.mjs test/http-server.test.mjs
npm test
git add resources/index.html resources/app.js backend/host-actions.mjs backend/http-server.mjs windows/tray-host.ps1 test/frontend-smoke.test.mjs test/http-server.test.mjs
git commit -m "fix(reminders): honor configured reminder actions"
```

---

### Task 7: Windows CI, 2.2.0 Metadata, Packaging, and Docs

**Owner:** `luna_implementer`  
**Bounded ownership:** mechanical CI/version/package/docs updates only.

**Files:** `.github/workflows/windows-ci.yml`, `package.json`, `package-lock.json`, `README.txt`, `resources/index.html`, release/package verifier files and package-layout tests as required by existing packaging code.

- [ ] **Step 1: Update version expectations to 2.2.0**

Update package metadata, UI/version text, and existing package-layout assertions.

- [ ] **Step 2: Add minimal Windows CI**

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

No deployment or release publication.

- [ ] **Step 3: Update active README/release verification**

Document Day/Evening/Extra, drafts, treatment snapshots, restore/Replace import, and local/offline safety behavior. Ensure new runtime modules/scripts are packaged and synthetic fixtures/tests are not.

- [ ] **Step 4: Run tests/package and commit**

```bash
npm test
npm run package:windows
```

Stage only files actually changed, then:

```bash
git commit -m "chore(release): prepare Med Check-in 2.2.0"
```

---

### Task 8: Final Integration and Verification

**Owner:** primary agent  
**Scope:** integration/regression fixes only. No new features.

- [ ] **Step 1: Map spec acceptance criteria to implemented tasks/tests**

Use section 15 of the approved scope-trimmed design. If a criterion is missing, implement the smallest missing behavior before final review.

- [ ] **Step 2: Run full automated suite**

```bash
npm test
```

Expected: PASS without skipped/disabled tests hiding regressions.

- [ ] **Step 3: Run Windows package gate**

```bash
npm run package:windows
```

- [ ] **Step 4: Run migration smoke on a copy of the synthetic fixture**

In a temp data directory verify:

- automatic v0 -> v1 migration;
- pre-migration backup;
- both semantic scheduled rows;
- preserved legacy timestamps/data;
- reminder state;
- treatment baseline and 2026-07-07 snapshot.

- [ ] **Step 5: Run fresh-2.2 smoke in a temp data directory**

Verify Day, Evening, two same-day Extras, scheduled edit preserving `recorded_at`, treatment add/edit, JSON export/preview/Replace, manual backup, restore of an app-created backup, reminder semantics, History paging/range, and lean analytics.

- [ ] **Step 6: Fix only reproduced regressions**

For each failure: reproduce, focused test, smallest fix, focused pass, then `npm test`. Do not refactor unrelated architecture.

### Final Checkpoint: one `terra_reviewer`

Review the whole branch once. Focus on:

- migration/data preservation;
- invalid-write prevention;
- restore/Replace import safety;
- Extras isolation from scheduled reminders/analytics;
- treatment resolution;
- dirty/draft regression risk;
- Windows package/CI correctness.

Findings must be actionable and plausible in this app. Nonessential redesign suggestions are non-blocking. If a finding proposes a major rewrite, the primary agent must first determine whether it demonstrates an actual failed acceptance criterion; do not restart from scratch merely because the alternative architecture is theoretically stronger.

Escalate to `sol_reviewer` only for one concrete exceptional-risk question that remains unresolved after inspecting code/tests.

- [ ] **Step 7: Apply concrete review fixes and rerun final gates**

```bash
npm test
npm run package:windows
```

- [ ] **Step 8: Commit final integration fixes if any**

Inspect `git diff --name-only`, stage only Task 8 fixes, and commit:

```bash
git commit -m "fix: complete Med Check-in 2.2 integration"
```

Do not create an empty commit.

---

## Definition of Done

- All 13 acceptance criteria in the scope-trimmed design are satisfied.
- `npm test` passes freshly.
- `npm run package:windows` passes freshly.
- Synthetic legacy migration smoke passes.
- Fresh temp-data smoke covers create/edit/Extra/treatment/export-Replace/backup-restore/reminders/history/analytics.
- Two planned `terra_reviewer` checkpoints are complete and concrete findings resolved.
- No mandatory Sol review was spent unless a specific exceptional-risk blocker genuinely required it.
- JSON Merge, UUID identity, normalized medication items, generalized treatment analytics, cloud/multi-user features, and v1 import remain absent.
- Final handoff lists exact commands/results and any remaining environment-owned validation.