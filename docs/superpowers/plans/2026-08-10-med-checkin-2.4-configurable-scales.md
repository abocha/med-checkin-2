# Med Check-in 2.4 Configurable Scales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The three numbered Tasks below are deliberately coherent ownership/review boundaries; checkbox steps inside a Task are implementation steps, not separate delegation or review units.

**Goal:** Ship Med Check-in 2.4.0 with user-configurable stable-ID 0-10 scales, lossless direct migration from every database version currently supported by 2.3, dynamic check-in/history/analytics UI, and portable JSON v3 while preserving existing data, draft, reminder, treatment, backup, and updater guarantees.

**Architecture:** Replace the eight fixed scale columns with two native SQLite structures: `scale_definitions` and `checkin_scale_values`. Keep scale identity stable and presentation configurable, hydrate check-ins as `scales: { [id]: value }`, normalize portable v1/v2 data once at the import boundary, and render browser/analytics surfaces from definitions rather than hardcoded scale names. Do not create a generic form engine, migration framework, definition framework, or new dependency.

**Tech Stack:** Node.js 22.23.1 ESM; built-in `node:sqlite`, `crypto.randomUUID`, `http`, `fs`, and existing platform APIs; static HTML/CSS/JavaScript; native `<input type="range">`; Windows PowerShell 5.1 tray/installer scripts; Edge app mode; Node test runner; existing ZIP/checksum release packaging.

## Global Constraints

- Target release version: `2.4.0`.
- Approved design: `docs/superpowers/specs/2026-08-10-med-checkin-2.4-configurable-scales-design.md`.
- Preserve the eight built-in stable IDs exactly: `mood`, `anxiety`, `irritability`, `energy`, `focus`, `functioning`, `sleepQuality`, `appetite`.
- Scale values remain numeric and inclusive `0..10`; keep the current integer slider behavior. No custom bounds, units, polarity, types, or questionnaires.
- Scale definitions support add, rename, active/archive, restore, and active ordering only. No product delete operation.
- At least one scale must remain active.
- New scheduled observations require exactly the current active scale IDs. Existing scheduled observations retain exactly their historical scale set; values may change but may not be removed.
- Extra observations retain their looser meaningful-subset semantics. Existing Extras may retain/edit/remove historical archived values, but may add only currently active scales.
- Browser drafts preserve their creation-time scale-ID snapshot across ordinary configuration changes. A scale ID unknown after destructive Replace must remain represented in draft state and block save rather than being silently filtered.
- Schema v3 is the only canonical post-migration representation. Do not keep permanent fixed-built-in columns alongside custom values.
- Preserve direct upgrade paths from recognized schema v0, v1, and v2 to v3. Do not require an intermediate installed version.
- Portable JSON remains `format: "med-checkin-2"`, explicit Replace-only, and advances to `formatVersion: 3`. v1 and v2 remain accepted.
- CSV remains a wide convenience export, not a lossless interchange/import format.
- Completion remains schedule-based. Analytics remain descriptive and per-scale; no composite score, normalization, significance testing, causal inference, or treatment-effect analysis.
- Prefer SQLite PK/FK/CHECK/transaction guarantees and existing HTTP/browser primitives over application-level substitutes.
- Do not add dependencies unless an inspected repository constraint makes the approved built-in approach impossible.
- Do not refactor tracked items into a generic configurable-definition abstraction.
- Do not modify updater concurrency semantics, reminder identity, treatment semantics, install data location, or stable scheduled-task names.
- Commits, branches, pushes, PRs, tags, releases, deployments, and destructive real-user-data operations remain authorization-gated by `AGENTS.md` and `.codex/PROJECT.md`. The commit commands below are execution checkpoints only: run them only when the execution request explicitly authorizes commits; otherwise record `git status --short` / `git diff --stat` and continue without committing.

## Execution Orchestration

Apply `AGENTS.md`, `.codex/ORCHESTRATION.md`, `.codex/PROJECT.md`, and `.codex/PLANNING_HANDOFF.md`.

### Repository map freshness

**Status:** `fresh-enough` as of 2026-08-10.

The approved design and this plan were produced against the 2.3.0 source whose baseline `npm test` gate passed **126/126** immediately before planning. The relevant owner modules and focused tests were inspected directly. Skip a broad explorer pass unless implementation finds material drift from the paths/contracts below. Focused tracing inside a boundary is fine.

### Candidate ownership boundaries

1. **Task 1: persistence, migration, domain/repository, and portable-data integrity**
   - likely role: Terra workhorse candidate; this is predetermined but integration/data-integrity heavy;
   - includes the exceptional-risk surfaces: table rebuild, scale-value preservation, historical edit invariants, portable Replace atomicity;
   - one worker may own the entire Task even though it contains several red/green cycles.

2. **Task 2: HTTP, browser/drafts, analytics, and chart presentation**
   - likely role: Luna **high** candidate once Task 1 interfaces are stable; this is the planned controlled high-vs-xhigh workflow experiment from the 2.3 postmortem;
   - escalate to primary/Terra if draft lifecycle or cross-layer integration departs from the approved contract.

3. **Task 3: documentation, version, Windows-visible labels, and release/package integration**
   - likely role: bounded worker or primary integration;
   - do not spend an exceptional reviewer merely on mechanical metadata.

These are candidate routing units, not a requirement to spawn exactly three children. The primary owns routing, integration, and final repository validation.

### Review routing

- Within a Task, use focused tests after each coherent edit cycle. Do **not** create a reviewer after each checkbox.
- At the end of Task 1, run the full cheap `npm test` gate **before** exceptional-risk review. If the actual diff contains the expected migration/Replace surface, a narrow Sol review is justified for preservation/atomicity semantics after tests are green. Ordinary portions can be Terra-reviewed.
- Task 2 gets one coherent ordinary Terra review after its focused and full tests are green.
- After Task 3 and final integration, use one coherent whole-branch Terra review because cross-boundary regressions between persistence, browser, analytics, and packaging are plausible.
- Re-review only the scope changed by reviewer fixes. Use Sol again only if a fix introduces or materially changes an exceptional-risk data-integrity surface.
- Do not stack duplicate broad reviews merely because multiple workflow mechanisms make them available.

### Validation ownership

- focused owner checks: exact `node --test --test-concurrency=1 test/...` commands listed below;
- primary repository gate: `npm test` after each completed ownership boundary and before expensive review;
- package gate: `npm run package:windows` after release metadata is complete;
- CI evidence: existing Windows GitHub Actions sequence (`npm ci --ignore-scripts`, `npm test`, `npm run package:windows`);
- manual release smoke when authorized/available: disposable previous-release -> 2.4 upgrade preserving user data and browser drafts. Do not improvise destructive upgrade testing against the user's real installation.

---

## Refined Implementation Contracts

These signatures and shapes are the handoff contract between Tasks. The primary may choose equivalent small internal helper names when the current code makes that strictly simpler, but must preserve the public/domain behavior and test assertions.

### Scale module

Create `backend/scales.mjs` with these exports:

```js
export const SCALE_LABEL_MAX_LENGTH = 120;

export const BUILTIN_SCALE_DEFINITIONS = Object.freeze([
  { id: 'mood', label: 'Настроение', active: true, sortOrder: 0 },
  { id: 'anxiety', label: 'Тревога', active: true, sortOrder: 1 },
  { id: 'irritability', label: 'Раздражительность', active: true, sortOrder: 2 },
  { id: 'energy', label: 'Энергия', active: true, sortOrder: 3 },
  { id: 'focus', label: 'Концентрация', active: true, sortOrder: 4 },
  { id: 'functioning', label: 'Функционирование', active: true, sortOrder: 5 },
  { id: 'sleepQuality', label: 'Качество сна', active: true, sortOrder: 6 },
  { id: 'appetite', label: 'Аппетит', active: true, sortOrder: 7 }
]);

export const LEGACY_SCALE_COLUMNS = Object.freeze({
  mood: 'mood',
  anxiety: 'anxiety',
  irritability: 'irritability',
  energy: 'energy',
  focus: 'focus',
  functioning: 'functioning',
  sleepQuality: 'sleep_quality',
  appetite: 'appetite'
});

export function normalizeScaleDefinition(definition, { requireId = true } = {}) { /* contract below */ }
export function validateScaleDefinitions(definitions, { requireBuiltIns = true } = {}) { /* contract below */ }
export function activeScaleIds(definitions) { /* active definitions in sortOrder/id order */ }
export function normalizeScaleValues(values, definitions, { requiredIds = null, allowedInactiveIds = [] } = {}) { /* contract below */ }
```

Contract:

- definition IDs are non-empty strings no longer than 200 characters; repository-created custom IDs use `custom:${randomUUID()}`, while portable imports may preserve any non-built-in ID that satisfies this bounded stable-ID rule; labels are trimmed/non-empty/max 120; `active` is boolean; `sortOrder` is a non-negative integer;
- definition IDs are unique;
- with `requireBuiltIns: true`, every built-in ID appears exactly once; custom IDs are allowed;
- at least one definition is active;
- active definitions have dense `sortOrder` values `0..activeCount-1`; archived definitions may retain any non-negative `sortOrder` because their relative ordering is not product state;
- `normalizeScaleValues` requires a plain object, rejects unknown IDs and non-finite/out-of-range values, and rounds exactly as the current scale normalizer does;
- by default only active IDs may be newly supplied;
- `allowedInactiveIds` permits known archived IDs already owned by an existing observation/draft;
- when `requiredIds` is non-null, submitted keys must equal that set exactly.

Do not put display color, direction, unit, bounds, chart settings, or persistence code in this module.

### Repository-facing scale-definition operations

`createRepository()` must expose:

```js
repo.listScaleDefinitions()
repo.createScaleDefinition({ label })
repo.updateScaleDefinition(id, { label?, active? })
repo.reorderScaleDefinitions(orderedActiveIds)
```

Rules:

- `listScaleDefinitions()` returns active definitions first in active order, then archived definitions; consumers must key by stable ID, not array position;
- creation uses `custom:${randomUUID()}` and appends with `sortOrder = activeCount`;
- update accepts only `label` and/or `active`; trying to archive the final active definition throws the existing ordinary validation error type; archiving transactionally compacts the remaining active definitions back to dense `sortOrder = 0..n-1`;
- restore sets `active = true` and `sortOrder = activeCount`;
- reorder requires the complete active ID set exactly once and writes dense order in one transaction;
- there is no delete method.

### Check-in domain shape

Post-v3 check-ins use:

```js
{
  id,
  kind,
  localDate,
  period,
  // existing timestamps/sleep/flags/notes fields...
  scales: {
    mood: 6,
    'custom:<uuid>': 7
  }
}
```

`normalizeCheckin` becomes:

```js
normalizeCheckin(input = {}, {
  allowMissingObservedAt = false,
  trackedItems = BUILTIN_TRACKED_ITEMS,
  scaleDefinitions = BUILTIN_SCALE_DEFINITIONS,
  requiredScaleIds = null,
  allowedInactiveScaleIds = []
} = {})
```

It must use `normalizeScaleValues(input.scales, ...)`. The repository chooses the required/allowed sets from live state:

```text
create scheduled, ordinary  required = current active IDs; inactive allowed = none
create scheduled, restored draft
                            required = explicit draft scaleSnapshot; inactive allowed = snapshot
update scheduled            required = current stored IDs; inactive allowed = current stored IDs
create Extra                required = none; inactive allowed = none
update Extra                required = none; inactive allowed = current stored IDs
portable historical row     required = its submitted non-empty scheduled set; inactive allowed = that set
```

For Extra meaningful-content validation, replace the fixed-field test with `Object.keys(normalized.scales).length > 0` plus the existing sleep/flags/notes/red-flag checks.

### Restored scheduled draft payload

The browser may include this field only for creation of a restored scheduled draft:

```json
{
  "scaleSnapshot": ["mood", "energy", "custom:..."]
}
```

Repository create logic validates:

- it is a non-empty unique string array;
- every ID still exists;
- the snapshot set equals the submitted `scales` keys when the save is attempted;
- known archived definitions in that snapshot are allowed;
- this exception is not accepted as a way for ordinary new scheduled entries to choose an incomplete current set.

Do not persist `scaleSnapshot` to SQLite or return it as check-in data.

### Schema v3

`backend/schema.mjs` must make `LATEST_SCHEMA_VERSION = 3`, remove the eight scale columns from `checkins`, and create/seed:

```sql
CREATE TABLE IF NOT EXISTS scale_definitions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS checkin_scale_values (
  checkin_id INTEGER NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  scale_id TEXT NOT NULL REFERENCES scale_definitions(id),
  value REAL NOT NULL CHECK(value >= 0 AND value <= 10),
  PRIMARY KEY(checkin_id, scale_id)
) STRICT;
```

No new index is required for `scale_definitions` or `checkin_scale_values` at current scale. The PKs are sufficient for this local workload.

### Migration-specific SQLite invariant

Before renaming an existing v1/v2 `checkins` table, explicitly handle the existing index name:

```sql
DROP INDEX IF EXISTS checkins_scheduled_identity;
ALTER TABLE checkins RENAME TO checkins_legacy;
```

Reason: if the old named index remains attached to the renamed table, `CREATE UNIQUE INDEX IF NOT EXISTS checkins_scheduled_identity ... ON checkins(...)` can silently skip creation for the new table because the index name already exists. Migration tests must prove the resulting v3 index is attached to the new `checkins` table and duplicate scheduled identity is still rejected.

### Portable v3 normalized shape

Every accepted portable version is normalized to:

```js
{
  format: 'med-checkin-2',
  formatVersion: sourceVersion,
  exportedAt,
  scaleDefinitions: [...],
  trackedItems: [...],
  observations: [{ ...existingMetadata, scales: { ... } }],
  treatmentEvents: [...],
  settings: { ... }
}
```

For v1/v2 observation input, derive `scales` from the eight legacy JSON keys and then remove those keys from the normalized object. v1 seeds both built-in tracked items and built-in scales; v2 validates portable tracked items and seeds built-in scales; v3 validates both supplied definition sets.

The repository Replace transaction consumes only this normalized shape.

---

### Task 1: Persistence, migration, repository, and portable-data integrity

**Files:**
- Create: `backend/scales.mjs`
- Create: `test/scales.test.mjs`
- Modify: `backend/schema.mjs:1-75`
- Modify: `backend/migrations.mjs:1-118`
- Modify: `backend/domain.mjs:1-103`
- Modify: `backend/repository.mjs:1-302`
- Modify: `backend/data-maintenance.mjs:1-263`
- Modify: `test/migrations.test.mjs`
- Modify: `test/domain.test.mjs`
- Modify: `test/repository.test.mjs`
- Modify: `test/data-maintenance.test.mjs`
- Test fixture only if needed by existing helper: `test/fixtures/build-v211-fixture.mjs`; do not replace the checked fixture unless the existing migration test explicitly regenerates it.

**Interfaces:**
- Produces: `BUILTIN_SCALE_DEFINITIONS`, `LEGACY_SCALE_COLUMNS`, `validateScaleDefinitions`, `activeScaleIds`, `normalizeScaleValues`.
- Produces: schema v3 with `scale_definitions` and `checkin_scale_values`.
- Produces: repository scale-definition CRUD/archive/reorder methods and check-ins whose scale values live under `checkin.scales`.
- Produces: portable JSON v3 and v1/v2 -> normalized-v3 compatibility.
- Consumed by Task 2: `repo.listScaleDefinitions()`, dynamic check-in `scales`, bootstrap-safe definition objects, analytics-ready rows, portable preview/export APIs.

- [ ] **Step 1: Add failing pure scale-definition/value tests.**

Create `test/scales.test.mjs` with explicit built-in identity, definition, active-order, and value-validation cases:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SCALE_DEFINITIONS,
  activeScaleIds,
  normalizeScaleDefinition,
  normalizeScaleValues,
  validateScaleDefinitions
} from '../backend/scales.mjs';

const ids = ['mood','anxiety','irritability','energy','focus','functioning','sleepQuality','appetite'];

test('built-in scale IDs and labels are stable', () => {
  assert.deepEqual(BUILTIN_SCALE_DEFINITIONS.map(item => item.id), ids);
  assert.equal(BUILTIN_SCALE_DEFINITIONS.find(item => item.id === 'sleepQuality').label, 'Качество сна');
});

test('scale definitions require one active scale and dense active ordering', () => {
  const defs = BUILTIN_SCALE_DEFINITIONS.map(item => ({ ...item }));
  defs[1].active = false;
  defs[2].sortOrder = 1;
  defs[3].sortOrder = 2;
  defs[4].sortOrder = 3;
  defs[5].sortOrder = 4;
  defs[6].sortOrder = 5;
  defs[7].sortOrder = 6;
  assert.deepEqual(activeScaleIds(validateScaleDefinitions(defs)), ['mood','irritability','energy','focus','functioning','sleepQuality','appetite']);
  assert.throws(() => validateScaleDefinitions(defs.map(item => ({ ...item, active: false }))), /active/i);
});

test('scale values reject unknown, archived-new, and out-of-range values', () => {
  const defs = BUILTIN_SCALE_DEFINITIONS.map(item => item.id === 'anxiety' ? { ...item, active: false } : { ...item });
  assert.deepEqual(normalizeScaleValues({ mood: 6 }, defs), { mood: 6 });
  assert.throws(() => normalizeScaleValues({ missing: 4 }, defs), /unknown|scale/i);
  assert.throws(() => normalizeScaleValues({ anxiety: 4 }, defs), /archived|active/i);
  assert.deepEqual(normalizeScaleValues({ anxiety: 4 }, defs, { allowedInactiveIds: ['anxiety'] }), { anxiety: 4 });
  assert.throws(() => normalizeScaleValues({ mood: 11 }, defs), /mood|scale/i);
});
```

Also cover blank/oversized labels, duplicate IDs, missing built-ins during portable validation, exact `requiredIds` set equality, and rounding behavior matching 2.3.

- [ ] **Step 2: Run the new scale test and verify the module is missing.**

Run:

```text
node --test --test-concurrency=1 test/scales.test.mjs
```

Expected: FAIL because `backend/scales.mjs` does not yet exist.

- [ ] **Step 3: Implement `backend/scales.mjs` minimally to satisfy the approved contract.**

Use the interfaces in **Refined Implementation Contracts**. Keep validation pure. Use `Object.freeze` only for shipped constants; return new normalized objects/arrays rather than mutating caller data. Use a set comparison for `requiredIds` rather than relying on object key order.

Do **not** generate custom IDs here; repository creation owns `randomUUID()` because ID generation is a persistence mutation concern.

- [ ] **Step 4: Run pure scale tests to green.**

Run:

```text
node --test --test-concurrency=1 test/scales.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Add failing schema-v3 and direct-migration tests before changing schema code.**

Extend `test/migrations.test.mjs` so fresh DB and each supported source version prove the new structural contract. Add assertions equivalent to:

```js
assert.equal(readUserVersion(dbPath), 3);
const db = new DatabaseSync(dbPath, { readOnly: true });
const checkinColumns = db.prepare('PRAGMA table_info(checkins)').all().map(row => row.name);
assert.equal(checkinColumns.includes('mood'), false);
assert.equal(checkinColumns.includes('sleep_quality'), false);
assert.deepEqual(
  db.prepare('SELECT id,label,active,sort_order FROM scale_definitions ORDER BY sort_order').all().map(row => row.id),
  ['mood','anxiety','irritability','energy','focus','functioning','sleepQuality','appetite']
);
```

For each legacy observation, assert exact preservation in `checkin_scale_values`, for example:

```js
assert.deepEqual(
  db.prepare('SELECT scale_id,value FROM checkin_scale_values WHERE checkin_id=? ORDER BY scale_id').all(originalId),
  [
    // assert every non-null source value under its stable ID
  ]
);
```

Add a v2 migration case containing a custom tracked item and assert it survives unchanged.

Add the scheduled-index regression explicitly:

```js
const index = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type='index' AND name='checkins_scheduled_identity'").get();
assert.equal(index.tbl_name, 'checkins');
assert.match(index.sql, /ON checkins\(local_date, period\)/);
```

Then open the migrated repository and assert creating a second scheduled check-in for the same `localDate + period` still raises the existing duplicate-identity failure.

Retain assertions that migration creates exactly one pre-migration backup and attaches its path to thrown migration failures.

- [ ] **Step 6: Run migration tests and confirm they fail against schema v2.**

Run:

```text
node --test --test-concurrency=1 test/migrations.test.mjs
```

Expected: FAIL on `user_version`, missing scale tables, fixed scale columns, and/or migration preservation assertions.

- [ ] **Step 7: Implement schema v3 with a focused scale-schema helper.**

In `backend/schema.mjs`:

1. import `BUILTIN_SCALE_DEFINITIONS`;
2. set `LATEST_SCHEMA_VERSION = 3`;
3. keep `createTrackedItemsSchema(db)` intact;
4. add `createScaleSchema(db)` that creates `scale_definitions` and `checkin_scale_values` and `INSERT OR IGNORE`s the eight built-ins;
5. remove the eight fixed scale columns from new `checkins`;
6. call `createScaleSchema(db)` after `checkins` exists;
7. preserve every unrelated table/index definition unchanged.

The scale-value table must be created with the approved FK/CHECK/PK constraints. Do not add a speculative secondary index.

- [ ] **Step 8: Replace the version-specific migration branches with one direct-to-v3 migration path while preserving legacy transforms.**

In `backend/migrations.mjs`, keep the current early exits:

```text
newer than latest -> reject
already v3 -> no-op
no checkins table -> create fresh v3
```

For recognized existing v0/v1/v2 databases:

1. identify the source shape before closing the initial handle;
2. checkpoint WAL;
3. create the existing `pre-migration-*` backup;
4. open writable DB with FK/busy timeout;
5. `BEGIN IMMEDIATE`;
6. execute `DROP INDEX IF EXISTS checkins_scheduled_identity` **before** renaming v1/v2 `checkins`;
7. rename source `checkins` to `checkins_legacy`;
8. for schema v0, preserve the existing `reminder_state` rename/slot transform path;
9. call `createLatestSchema(db, { setUserVersion: false })` so v3 tables/seed definitions exist;
10. copy all non-scale check-in columns, transforming v0 `slot` to semantic period exactly as 2.3 does;
11. backfill each non-null legacy scale using `LEGACY_SCALE_COLUMNS` and stable IDs;
12. preserve v2 `tracked_items` as-is; seed tracked items only where the older source lacked them through the existing `createLatestSchema` behavior;
13. preserve the existing removal of obsolete legacy personal-treatment setting keys only on the legacy-v0 path where 2.3 already did so;
14. restore migrated reminder rows for v0;
15. drop legacy tables;
16. set `PRAGMA user_version = 3`;
17. commit; on failure rollback, attach `backupPath`, log fatal, and rethrow.

A simple scale backfill loop is acceptable and clearer than metaprogrammed SQL:

```js
for (const [scaleId, column] of Object.entries(LEGACY_SCALE_COLUMNS)) {
  db.exec(`
    INSERT INTO checkin_scale_values(checkin_id, scale_id, value)
    SELECT id, '${scaleId}', ${column}
    FROM checkins_legacy
    WHERE ${column} IS NOT NULL
  `);
}
```

All interpolated identifiers/IDs here come from the shipped constant, never user input.

- [ ] **Step 9: Run migration tests to green before touching repository behavior.**

Run:

```text
node --test --test-concurrency=1 test/migrations.test.mjs
```

Expected: PASS, including v0/v1/v2 direct migration, exact scale backfill, custom tracked-item preservation, pre-migration backup, and scheduled unique-index attachment.

- [ ] **Step 10: Rewrite domain tests around dynamic `scales` before modifying `backend/domain.mjs`.**

Update `test/domain.test.mjs` to stop constructing the eight top-level properties. Use a helper such as:

```js
const allScales = Object.fromEntries(BUILTIN_SCALE_DEFINITIONS.map(item => [item.id, 5]));
const scheduled = overrides => ({
  kind: 'scheduled', localDate: '2026-08-10', period: 'day',
  scheduledFor: '2026-08-10T13:00:00.000Z', observedAt: '2026-08-10T13:01:00.000Z',
  scales: allScales,
  context: [], symptoms: [], activation: [], notes: '', redFlags: '',
  ...overrides
});
```

Required cases:

- ordinary scheduled normalization with `requiredScaleIds: activeScaleIds(defs)` accepts exactly the active set;
- missing or extra ID fails exact-set validation;
- an archived ID succeeds only when included in `allowedInactiveScaleIds`;
- Extra with `{ scales: { mood: 5 } }` is meaningful;
- Extra with empty `scales` and all other meaningful fields empty still fails;
- unknown scale ID fails rather than being filtered.

Preserve all existing timestamp/identity/tracked-item tests.

- [ ] **Step 11: Run domain tests and verify fixed `SCALE_FIELDS` behavior fails.**

Run:

```text
node --test --test-concurrency=1 test/domain.test.mjs
```

Expected: FAIL on the new `scales` contract.

- [ ] **Step 12: Replace fixed-scale normalization in `backend/domain.mjs`.**

Remove exported `SCALE_FIELDS`. Import the approved scale helpers. Extend `normalizeCheckin` options exactly as defined above and assign:

```js
normalized.scales = normalizeScaleValues(input.scales ?? {}, scaleDefinitions, {
  requiredIds: requiredScaleIds,
  allowedInactiveIds: allowedInactiveScaleIds
});
```

Do not infer scheduled required IDs inside pure domain code; repository/import callers supply the contract relevant to their operation. This keeps historical edit/import semantics explicit.

Replace Extra meaningful-content checks over fixed fields with the dynamic `scales` object. Leave tracked-item, sleep, timestamps, local-date, and scheduling helpers unchanged.

- [ ] **Step 13: Run scale + domain tests together.**

Run:

```text
node --test --test-concurrency=1 test/scales.test.mjs test/domain.test.mjs
```

Expected: PASS.

- [ ] **Step 14: Add failing repository tests for dynamic values, historical edits, definitions, and atomicity.**

Update `test/repository.test.mjs` sample data to use `scales`. Add tests that prove:

1. fresh repository returns the eight active built-ins;
2. `createScaleDefinition({label:'Brain fog'})` creates `custom:<uuid>`, trims label, and appends active order;
3. rename preserves ID;
4. archiving makes it unavailable for a new scheduled/Extra addition but does not invalidate an observation already containing it;
5. archiving the final active definition is rejected;
6. restore appends; active reorder requires the complete active set;
7. scheduled create stores exactly active IDs;
8. scheduled update may change values but rejects removing an existing scale or adding a newly created scale;
9. Extra update may remove its historical value and may keep/edit an archived value, but cannot newly add an archived ID;
10. deleting a check-in cascades its `checkin_scale_values` rows;
11. a failed base/scale write does not leave a partial check-in.

For the historical-set case, make the sequence explicit:

```js
const first = repo.createCheckin(scheduled({ scales: activeValues(repo.listScaleDefinitions()) }));
const custom = repo.createScaleDefinition({ label: 'Brain fog' });
assert.throws(() => repo.updateCheckin(first.id, { ...first, scales: { ...first.scales, [custom.id]: 5 } }), /scale set|required/i);
assert.throws(() => repo.updateCheckin(first.id, { ...first, scales: without(first.scales, 'mood') }), /scale set|required/i);
```

Add a restored-new-scheduled case using `scaleSnapshot` where one definition has since been archived; it succeeds only when every snapshot ID still exists and submitted keys equal the snapshot. Unknown snapshot ID fails.

- [ ] **Step 15: Run repository tests and confirm fixed-column SQL fails the new contract.**

Run:

```text
node --test --test-concurrency=1 test/repository.test.mjs
```

Expected: FAIL until repository hydration/writes/definition methods are implemented.

- [ ] **Step 16: Implement repository hydration and atomic scale-value writes with simple prepared statements.**

In `backend/repository.mjs`:

- import `randomUUID` and scale helpers;
- make `rowToCheckin(row, scales)` return the existing non-scale fields plus `scales`;
- remove fixed scale columns from `observationValues`, insert/update SQL, and portable insert SQL;
- prepare:

```sql
SELECT scale_id, value FROM checkin_scale_values WHERE checkin_id=? ORDER BY scale_id;
DELETE FROM checkin_scale_values WHERE checkin_id=?;
INSERT INTO checkin_scale_values(checkin_id, scale_id, value) VALUES(?,?,?);
```

- add a small `hydrateCheckin(row)` that queries the child values and builds `Object.fromEntries(...)`;
- use it consistently in `getScheduledCheckin`, `getCheckinById`, `listCheckins`, `listAllCheckins`, and `exportRows`.

For this personal local DB, one child query per returned check-in is acceptable. Do not add a complex join/aggregation/cache until measured evidence says it is needed.

Wrap create and update base-row + child-value writes in one explicit transaction. On update, replace only that check-in's child rows after normalization succeeds. Preserve server-owned `recordedAt`/`updatedAt` behavior.

- [ ] **Step 17: Implement repository scale-definition operations and operation-specific normalization.**

Add row mapping and prepared statements for `scale_definitions`. Implement the four approved methods. Archiving must run its `active = 0` update plus dense re-numbering of the remaining active definitions in one transaction so the invariant enforced by `validateScaleDefinitions` remains true immediately after every mutation.

For check-in create/update, derive live definitions once per operation and call `normalizeCheckin` with these rules:

```js
const definitions = this.listScaleDefinitions();
const activeIds = activeScaleIds(definitions);
```

- ordinary scheduled create: `requiredScaleIds = activeIds`;
- restored scheduled create: validate explicit `input.scaleSnapshot`, then use it as `requiredScaleIds` and `allowedInactiveScaleIds`;
- scheduled update: load current row first, use `Object.keys(current.scales)` for both required/allowed historical IDs;
- Extra create: no required IDs and no inactive allowance;
- Extra update: `allowedInactiveScaleIds = Object.keys(current.scales)`.

Reject a `scaleSnapshot` on ordinary Extra creation. Ignore no unknown patch fields silently; preserve the repository's current validation style.

- [ ] **Step 18: Run repository/domain/scale tests to green.**

Run:

```text
node --test --test-concurrency=1 test/scales.test.mjs test/domain.test.mjs test/repository.test.mjs
```

Expected: PASS.

- [ ] **Step 19: Add failing backup-schema and portable-v3 tests before changing data maintenance.**

Update `test/data-maintenance.test.mjs` fixtures so current-format observations use `scales`. Retain explicit v1/v2 legacy fixtures with the eight old JSON properties so compatibility is proven rather than assumed.

Add cases that assert:

```js
const exported = buildPortableExport(repo, now);
assert.equal(exported.format, 'med-checkin-2');
assert.equal(exported.formatVersion, 3);
assert.deepEqual(exported.scaleDefinitions, repo.listScaleDefinitions());
assert.deepEqual(exported.observations[0].scales, repo.getCheckinById(exported.observations[0].id).scales);
```

Add v1 and v2 preview/import cases asserting they normalize to built-in scale definitions and `observation.scales`.

Add v3 validation failures for:

- missing built-in scale ID;
- duplicate definition ID;
- zero active definitions;
- observation unknown scale ID;
- out-of-range value;
- scheduled observation with zero scale values;
- malformed active ordering.

Add a v3 Replace round trip with custom + archived definitions and sparse historical scale sets. Assert reminder state remains local.

Add a failed-Replace case where invalid scale data is rejected **before** live DB contents change and before repository deletion statements can execute.

Extend backup validation tests:

- schema v1 accepted;
- schema v2 accepted and requires `tracked_items`;
- schema v3 accepted and requires `scale_definitions` + `checkin_scale_values` plus the v3 check-in columns;
- incomplete v3 and newer schema rejected.

- [ ] **Step 20: Run data-maintenance tests and verify v2/fixed-scale assumptions fail.**

Run:

```text
node --test --test-concurrency=1 test/data-maintenance.test.mjs
```

Expected: FAIL on portable version, schema validation, legacy normalization, or Replace structure.

- [ ] **Step 21: Implement v3 backup validation and one-time portable normalization.**

In `backend/data-maintenance.mjs`:

1. remove `SCALE_FIELDS` import;
2. set `PORTABLE_VERSION = 3`;
3. define explicit required columns for schema v3:
   - rebuilt `checkins` without fixed scale columns;
   - `tracked_items`;
   - `scale_definitions`;
   - `checkin_scale_values`;
4. permit backup versions `[0,1,2,3]` and dispatch the correct validator;
5. keep v1/v2 validators for restore compatibility;
6. validate portable versions `[1,2,3]`;
7. for v1/v2, materialize `BUILTIN_SCALE_DEFINITIONS` and convert the eight legacy observation properties into a `scales` object;
8. for v3, validate `payload.scaleDefinitions`;
9. validate every normalized observation against its definition set; for scheduled historical rows require a non-empty submitted scale set but do not require the imported *current active* set, because historical configs legitimately differ;
10. add `scaleDefinitionCount` to preview alongside the existing bounded counts/date range;
11. export `scaleDefinitions: repo.listScaleDefinitions()` and current observations with `scales`.

Keep settings/treatment/tracked-item validation and source `formatVersion` reporting intact.

- [ ] **Step 22: Extend repository Replace to replace scale definitions + values in the existing single transaction.**

In `repo.replacePortableData(data, now)`:

```text
BEGIN IMMEDIATE
DELETE checkins            # cascades child scale rows
DELETE treatment events
DELETE tracked items
DELETE scale definitions   # now safe because child rows are gone
insert normalized scale definitions
insert normalized tracked items
insert each observation base row + its scale values
insert treatment events/settings
COMMIT
```

Keep `reminder_state` untouched. Preserve source IDs/timestamps and `sqlite_sequence` handling. Roll back the entire transaction on any failure.

Do not create a second transaction solely for scale data.

- [ ] **Step 23: Run the complete Task 1 focused suite.**

Run:

```text
node --test --test-concurrency=1 \
  test/scales.test.mjs \
  test/migrations.test.mjs \
  test/domain.test.mjs \
  test/repository.test.mjs \
  test/data-maintenance.test.mjs \
  test/backups.test.mjs \
  test/backup-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 24: Run the cheap full repository gate before any exceptional-risk reviewer.**

Run:

```text
npm test
```

Expected: PASS. Any failures from stale fixed-scale integration expectations are implementation work, not reviewer work; fix them now and rerun until green.

- [ ] **Step 25: Review Task 1 as one persistence/data-integrity package.**

Reviewer brief must explicitly inspect:

- exact v0/v1/v2 scale preservation;
- `checkins_scheduled_identity` attachment after table rebuild;
- FK/cascade behavior;
- scheduled historical set invariants;
- restored-draft snapshot exception not becoming a generic incomplete-scheduled bypass;
- v1/v2 portable normalization only at the boundary;
- v3 Replace validation-before-destruction and one-transaction semantics;
- reminder/local-only state preservation.

Use Sol only if the actual diff still contains this exceptional-risk surface, which is expected. Do not ask the reviewer to rediscover basic test failures already caught by `npm test`.

- [ ] **Step 26: Apply review fixes narrowly and rerun Task 1 validation.**

Run the directly affected focused files, then:

```text
npm test
```

Expected: PASS.

- [ ] **Step 27: Conditional Task 1 checkpoint commit.**

If commits were explicitly authorized for execution:

```bash
git add backend/scales.mjs backend/schema.mjs backend/migrations.mjs backend/domain.mjs backend/repository.mjs backend/data-maintenance.mjs test/scales.test.mjs test/migrations.test.mjs test/domain.test.mjs test/repository.test.mjs test/data-maintenance.test.mjs test/backups.test.mjs test/backup-smoke.test.mjs
git commit -m "feat: make check-in scales configurable"
```

Otherwise record:

```text
git status --short
git diff --stat
```

and continue without committing.

---

### Task 2: HTTP, browser drafts/UI, analytics, and dynamic chart presentation

**Files:**
- Modify: `backend/http-server.mjs:95-390`
- Modify: `backend/analytics.mjs:1-101`
- Modify: `resources/index.html:1-225`
- Modify: `resources/app.js:1-720`
- Modify: `resources/vendor/chart-lite.js`
- Modify only if selectors/layout require it: `resources/styles.css:53,135-172`
- Expected no change: `resources/draft-store.js` (its JSON persistence is already shape-agnostic)
- Modify: `test/http-server.test.mjs`
- Modify: `test/analytics.test.mjs`
- Modify: `test/chart-lite.test.mjs`
- Modify: `test/frontend-smoke.test.mjs`
- Modify: `test/frontend-draft-unknown.test.mjs`
- Modify `test/draft-store.test.mjs` only if an actual generic-store regression appears; do not change it merely because draft payload fields changed.

**Interfaces:**
- Consumes from Task 1: `repo.listScaleDefinitions()`, scale-definition mutations, dynamic `checkin.scales`, restored scheduled `scaleSnapshot`, portable preview/export/Replace.
- Produces: bootstrap `scaleDefinitions`; scale-definition HTTP routes; dynamic CSV; dynamic analytics maps; definition-driven form/history/settings/trend/chart UI; backward-compatible 2.3 browser-draft restoration.

- [ ] **Step 1: Rewrite analytics tests for `scales` maps and add sparse/custom/archived cases.**

Update `test/analytics.test.mjs` row fixtures from top-level scale properties to:

```js
function row(date, period, scales, extra = {}) {
  return {
    kind: 'scheduled', localDate: date, period,
    observedAt: `${date}T${period === 'day' ? '13:00' : '22:00'}:00.000Z`,
    context: [], symptoms: [], activation: [],
    scales,
    ...extra
  };
}
```

Assert map-shaped results:

```js
const result = buildAnalytics([
  row('2026-08-08', 'day', { mood: 4, 'custom:clarity': 2 }),
  row('2026-08-08', 'evening', { mood: 6 }),
  row('2026-08-09', 'day', { mood: 5, 'custom:clarity': 8 }),
  row('2026-08-09', 'evening', { mood: 7, 'custom:clarity': 4 })
], settings, options);

assert.equal(result.overall.mood, 5.5);
assert.equal(result.overall['custom:clarity'], 14 / 3);
assert.equal(result.pairedDelta.mood, 2);
assert.equal(result.pairedDelta['custom:clarity'], -4); // only 2026-08-09 has both values
assert.equal(result.daily[0].scales['custom:clarity'], 2);
```

Keep tests proving Extras are excluded, rolling windows use trailing three calendar days, completion remains schedule-based, and treatment markers remain descriptive only.

- [ ] **Step 2: Run analytics tests and verify fixed `SCALE_FIELDS` logic fails.**

Run:

```text
node --test --test-concurrency=1 test/analytics.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement dynamic analytics without definition-aware business semantics.**

In `backend/analytics.mjs`:

- remove `SCALE_FIELDS` import;
- derive the union of scale IDs present in scheduled rows;
- average `row.scales?.[id]` only when finite;
- daily entries become `{ date, count, scales, rolling }`;
- rolling maps use the same dynamic IDs and current trailing-three-calendar-day window;
- `pairedDelta[id]` averages only dates where both scheduled Day and Evening contain finite values for that ID;
- retain `pairedDays` as the count of dates having both scheduled observations, independent of any individual scale's missingness;
- preserve flag frequencies, completion, generatedAt, treatment markers, scheduled-only filtering.

Do not import scale definitions or labels into analytics math. IDs are data identity; labels remain presentation/bootstrap data.

- [ ] **Step 4: Run analytics tests to green.**

Run:

```text
node --test --test-concurrency=1 test/analytics.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Add failing chart tests for dynamic IDs and definition labels.**

Change `test/chart-lite.test.mjs` to pass map-shaped daily data and definition objects:

```js
chartLite().renderTrend(container, [
  { date: '2026-08-01', scales: { mood: 5, 'custom:clarity': 3 }, rolling: { mood: 5, 'custom:clarity': 3 } }
], [], ['custom:clarity'], [
  { id: 'mood', label: 'Настроение', active: true, sortOrder: 0 },
  { id: 'custom:clarity', label: 'Ясность', active: false, sortOrder: 1 }
]);
assert.match(container.innerHTML, /Ясность/);
assert.doesNotMatch(container.innerHTML, /Настроение/);
```

Keep the empty-selection case and add an unknown selected ID case that is ignored without throwing.

- [ ] **Step 6: Run chart tests and verify the hardcoded palette/label map fails.**

Run:

```text
node --test --test-concurrency=1 test/chart-lite.test.mjs
```

Expected: FAIL.

- [ ] **Step 7: Make `ChartLite.renderTrend` definition-driven while keeping a fixed render-time palette.**

Change the signature to:

```js
renderTrend(container, daily, treatmentMarkers = [], selectedIds = [], definitions = [])
```

Build a definition map from `definitions`, filter selected IDs to IDs present in data + definitions, assign colors from a small existing-style palette by selected/render order, and read points with:

```js
const value = day.rolling?.[id] ?? day.scales?.[id];
```

Use `definition.label` for legend text. Keep the existing SVG/no-selection/treatment-marker rendering approach. Do not persist colors or add color to definitions.

- [ ] **Step 8: Run chart + analytics tests to green.**

Run:

```text
node --test --test-concurrency=1 test/analytics.test.mjs test/chart-lite.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Add failing HTTP tests for bootstrap, scale-definition routes, dynamic check-ins, and CSV.**

Extend `test/http-server.test.mjs`:

1. bootstrap includes the eight `scaleDefinitions`;
2. authenticated `POST /api/v1/scale-definitions` returns a custom active definition;
3. `PUT /api/v1/scale-definitions/:id` renames/archive/restores;
4. archiving the final active definition returns 400;
5. `PUT /api/v1/scale-definitions/order` requires the complete active list;
6. POST scheduled check-in accepts `scales` and rejects an incomplete ordinary active set;
7. PUT existing scheduled rejects scale-set alteration;
8. POST restored scheduled with valid `scaleSnapshot` can preserve a known archived ID; unknown snapshot ID is 400;
9. Extra rules match Task 1;
10. CSV header uses current scale labels and includes custom/archived columns only when represented in exported rows.

For CSV, assert with current labels rather than stable IDs because the approved CSV contract is presentation-oriented:

```js
const csv = await (await api(f.base, '/api/v1/export.csv')).text();
assert.match(csv.split('\n')[0], /Настроение/);
assert.match(csv.split('\n')[0], /Ясность/);
```

Do not require unique CSV headers when labels intentionally duplicate.

- [ ] **Step 10: Run HTTP tests and verify routes/bootstrap/CSV fail.**

Run:

```text
node --test --test-concurrency=1 test/http-server.test.mjs
```

Expected: FAIL.

- [ ] **Step 11: Implement the small scale-definition HTTP surface and bootstrap data.**

In `backend/http-server.mjs`:

- add `scaleDefinitions: repo.listScaleDefinitions()` to `/api/v1/bootstrap`;
- mirror tracked-item mutation style with:

```text
POST /api/v1/scale-definitions
PUT  /api/v1/scale-definitions/order
PUT  /api/v1/scale-definitions/:id
```

Return the mutation result plus refreshed definitions in the same compact pattern used for tracked items. Call existing `onPersisted()` after meaningful mutations. There is no DELETE route and no archive/restore action route.

Pass check-in JSON bodies through unchanged so Task 1 repository validation remains authoritative, including optional restored-draft `scaleSnapshot`.

- [ ] **Step 12: Make CSV export dynamic without turning it into an interchange schema.**

Change:

```js
rowsToCsv(rows)
```

to:

```js
rowsToCsv(rows, scaleDefinitions)
```

Keep existing fixed metadata/sleep/flag/note columns. Then append definition columns whose IDs occur in at least one exported row's `scales`. Use current `definition.label` as the header and `row.scales?.[definition.id] ?? ''` as the value.

Order columns by `repo.listScaleDefinitions()` output. Do not emit ID metadata rows, schemas, or CSV import support.

Update the CSV route to pass `repo.listScaleDefinitions()`.

- [ ] **Step 13: Run HTTP + Task 1 data tests to green.**

Run:

```text
node --test --test-concurrency=1 test/http-server.test.mjs test/repository.test.mjs test/data-maintenance.test.mjs
```

Expected: PASS.

- [ ] **Step 14: Rewrite frontend smoke expectations before editing HTML/JS.**

In `test/frontend-smoke.test.mjs`, remove assertions that eight static `name="..."` sliders and eight static `data-trend-field` checkboxes exist in HTML.

Replace them with structural assertions:

```js
assert.match(html, /id=["']scale-inputs["']/);
assert.match(html, /id=["']scale-definitions-settings["']/);
assert.match(html, /id=["']trend-fields["']/);
assert.doesNotMatch(html, /name=["']mood["']/);
assert.doesNotMatch(html, /data-trend-field=["']mood["']/);
assert.match(js, /scaleDefinitions/);
assert.match(js, /renderScaleInputs/);
assert.match(js, /renderScaleSettings/);
assert.match(js, /scaleSnapshot/);
```

Keep all unrelated browser hosting/reminder/treatment/maintenance assertions.

- [ ] **Step 15: Add failing draft-lifecycle tests for dynamic scales and 2.3 draft compatibility.**

Refactor `test/frontend-draft-unknown.test.mjs` harness so dynamic inputs can be created by `renderScaleInputs` rather than precreating eight hardcoded elements.

Add three explicit cases:

1. **2.3 scheduled draft upgrade:** legacy draft values contain fixed scale fields plus `scalesChosen`; restore produces a snapshot of the eight built-in IDs and preserves chosen/unset values without injecting a new custom definition;
2. **configuration change:** a new-format draft with `scaleSnapshot: ['mood','anxiety']` restores exactly those known IDs even if another scale is now active;
3. **Replace removed ID:** draft contains `custom:removed`; after bootstrap definitions no longer contain it, edits/persistence keep the unknown ID in the saved draft and `validForSave` remains false until explicit discard.

Use the existing unknown tracked-flag test as the behavioral pattern; extend rather than invent a separate draft framework.

- [ ] **Step 16: Run frontend smoke/draft tests and confirm current static UI fails.**

Run:

```text
node --test --test-concurrency=1 test/frontend-smoke.test.mjs test/frontend-draft-unknown.test.mjs test/draft-store.test.mjs
```

Expected: FAIL in smoke/dynamic-draft expectations; `draft-store.test.mjs` should remain green because the storage module is generic.

- [ ] **Step 17: Replace static scale/trend markup with containers and add the minimal settings surface.**

In `resources/index.html`:

- replace the current eight rows inside `.scale-grid` with:

```html
<div id="scale-inputs" class="scale-grid"></div>
```

- leave `#trend-fields` but remove the eight static checkbox labels so JS owns its contents;
- add a Settings card before tracked items:

```html
<section class="card scale-definitions-card">
  <div class="section-heading">
    <div><h3>Шкалы</h3><p>Переименуй, архивируй или верни шкалы. Старые записи сохраняют значения по их постоянным идентификаторам.</p></div>
  </div>
  <div id="scale-definitions-settings" class="scale-definitions-settings"></div>
</section>
```

Do not add drag handles, color controls, units, directions, descriptions, or delete buttons.

In `resources/styles.css`, reuse existing layout rules where practical. Add only the selectors needed to make scale-definition rows match the existing tracked-settings visual rhythm and mobile stacking. Do not introduce a general component stylesheet refactor.

- [ ] **Step 18: Replace hardcoded scale state/labels with definition helpers in `resources/app.js`.**

At state initialization, replace static metric constants with:

```js
state.scaleDefinitions = [];
state.selectedTrendFields = [];
state.staleDraftScaleIds = [];
state.restoredDraftScaleSnapshot = null;
```

Add small helpers with these responsibilities:

```js
function scaleDefinitionMap() { /* Map id -> definition */ }
function activeScaleDefinitions() { /* active ordered */ }
function orderedDefinitionsForIds(ids) { /* known IDs, active/display order then stable fallback */ }
function renderScaleInputs(ids, { values = {}, chosenIds = [] } = {}) { /* native range inputs */ }
function collectScaleDraftState() { /* { scaleSnapshot, scales, scalesChosen } or equivalent */ }
function findStaleDraftScaleIds(draftValues) { /* unknown stable IDs, preserved */ }
function normalizeDraftScaleState(values) { /* current + 2.3 legacy draft forms */ }
```

`renderScaleInputs` must create the existing native slider structure and call current `renderScale`/range input behavior. Every input gets `name = definition.id`, `min=0`, `max=10`, `step=1`; labels come from current definitions. Mark archived historical definitions visibly with restrained text/class, not a new interaction model.

- [ ] **Step 19: Make form reset/edit/previous-value behavior operate on applicable scale IDs.**

Update:

- `resetForm`: render current active definitions for a new scheduled/Extra form;
- `fillForm(record)`: render exactly `Object.keys(record.scales)` for scheduled history; for existing Extra render active IDs plus any historical IDs on the record, deduplicated;
- `setRanges`: bind after dynamic inputs are rendered;
- `usePreviousValues`: copy only IDs present in both the previous record and current target form;
- `formPayload`: return `scales` from chosen current inputs; never emit eight top-level scale properties;
- `validForSave`: scheduled form requires every rendered snapshot scale to be chosen; Extra keeps existing meaningful-content rules; stale scale IDs block save.

For an ordinary new scheduled entry, do not send `scaleSnapshot`: repository checks current active definitions. For a **restored unsaved scheduled draft**, send `scaleSnapshot = state.restoredDraftScaleSnapshot` with create POST. For editing a saved record, do not send it because repository owns the stored set.

- [ ] **Step 20: Preserve 2.3 and 2.4 draft shapes without modifying the generic draft store.**

When writing a new draft, store scale state explicitly, for example:

```js
values.scaleSnapshot = currentlyRenderedScaleIds;
values.scales = { mood: 6, energy: 4 };
values.scalesChosen = { mood: true, energy: true, anxiety: false };
```

`normalizeDraftScaleState(values)` must recognize 2.3 drafts where `values.scales`/`scaleSnapshot` are absent but fixed keys and `values.scalesChosen` exist:

```js
const legacyIds = ['mood','anxiety','irritability','energy','focus','functioning','sleepQuality','appetite'];
```

For that legacy shape:

- snapshot = all eight built-in IDs (the 2.3 form contained all eight controls);
- chosen values come from `scalesChosen` + fixed fields;
- unset values remain unset, so scheduled save remains disabled until complete;
- do not inject definitions created after that draft.

When a normalized snapshot contains unknown IDs after Replace, retain the IDs and any stored values in draft state, set `state.staleDraftScaleIds`, show one clear toast/status message, keep edits persistable, and block save until `discardDraft()` clears them. Do not silently remove unknown IDs during `markDirty()` or `persistDraft()`.

- [ ] **Step 21: Add scale settings operations patterned after tracked items, without a generic abstraction.**

Implement:

```js
function renderScaleSettings()
function applyScaleDefinitions(items)
async function addScaleDefinition(event)
async function saveScaleDefinition(event)
async function moveScaleDefinition(event, delta)
```

The settings UI contains:

- one active list in `sortOrder`;
- add text input + button;
- inline rename;
- Archive button disabled when active count is 1;
- Up/Down buttons only for active definitions;
- separate archived list with Restore;
- no Delete.

Mutation routes are the Task 2 API endpoints. After mutation, replace `state.scaleDefinitions` with the server response and rerender relevant settings; do not manually synthesize server state.

- [ ] **Step 22: Make history and analytics presentation definition-driven.**

History cards must iterate each `item.scales` key using current definitions for labels, not a hardcoded selected subset. Preserve existing metadata/timing/flags/treatment display.

Analytics UI changes:

1. configuration-independent KPI cards only: scheduled observation count, represented days, paired Day/Evening days;
2. build trend-checkbox controls from scale IDs actually represented in `data.overall`/`data.daily`, ordered by current definitions;
3. when no still-valid selection exists, select the first up to **four** usable scale IDs by definition order. This replaces the old semantic default list without inventing special meaning for built-in IDs;
4. preserve checked IDs that still have data across reloads;
5. call:

```js
ChartLite.renderTrend(
  $('#trend-chart'),
  data.daily,
  data.treatmentMarkers,
  state.selectedTrendFields,
  state.scaleDefinitions
);
```

6. generate the paired comparison rows from scale definitions whose IDs exist in `data.pairedDelta` and whose value is finite/non-null;
7. wording should say the delta is Evening minus Day for dates where both values exist; do not imply every scale uses all `pairedDays`.

Keep completion/frequency/treatment-marker sections unchanged except for data-shape adaptation.

- [ ] **Step 23: Bootstrap scale definitions before any scale-dependent rendering.**

In `bootstrap(runtime)`, after fetching `/api/v1/bootstrap`:

```js
applyScaleDefinitions(data.scaleDefinitions || []);
applyTrackedItems(data.trackedItems || []);
```

Do not use hardcoded scale fallbacks in normal v2.4 operation. The backend always seeds at least one definition. Then initialize form/view/draft flows using the loaded definitions.

After Replace import/restart-required flow, keep current draft cleanup semantics for the current key; other retained drafts will detect unknown IDs the next time they are restored.

- [ ] **Step 24: Expose only focused test hooks needed by the existing VM harness.**

If `resources/app.js` already exposes `__MED_CHECKIN_TEST__.draftLifecycle`, extend that object with the dynamic draft functions/state needed by `test/frontend-draft-unknown.test.mjs`. Do not add a production global API or test-only behavior branch beyond the existing hook convention.

- [ ] **Step 25: Run the complete Task 2 focused suite.**

Run:

```text
node --test --test-concurrency=1 \
  test/analytics.test.mjs \
  test/chart-lite.test.mjs \
  test/http-server.test.mjs \
  test/frontend-smoke.test.mjs \
  test/frontend-draft-unknown.test.mjs \
  test/draft-store.test.mjs
```

Expected: PASS.

- [ ] **Step 26: Run the full repository gate before Task 2 review.**

Run:

```text
npm test
```

Expected: PASS.

- [ ] **Step 27: Perform one coherent ordinary review of Task 2.**

Terra review brief:

- dynamic form lifecycle for new scheduled, existing scheduled, new/edit Extra;
- no current-config injection into old records/drafts;
- 2.3 draft compatibility;
- unknown draft scale IDs survive edits and remain blocked;
- last-active UX is backed by server enforcement;
- archived values can be historical but not newly injected;
- analytics missing values are absent, never zero;
- chart labels come from definitions and colors remain presentation-only;
- no hidden fixed-eight assumptions remain in browser/API/analytics/CSV.

This is the intended Luna-high implementation experiment if the primary used Luna high for the boundary. Record orchestration metrics later only if the user asks for measurement; do not add runtime telemetry to Med Check-in.

- [ ] **Step 28: Apply Task 2 review fixes and rerun focused + full tests.**

Run affected focused files, then:

```text
npm test
```

Expected: PASS.

- [ ] **Step 29: Conditional Task 2 checkpoint commit.**

If commits were explicitly authorized for execution:

```bash
git add backend/http-server.mjs backend/analytics.mjs resources/index.html resources/app.js resources/vendor/chart-lite.js resources/styles.css test/http-server.test.mjs test/analytics.test.mjs test/chart-lite.test.mjs test/frontend-smoke.test.mjs test/frontend-draft-unknown.test.mjs
git commit -m "feat: render configurable scales across the app"
```

Do not add `resources/draft-store.js` if it remained unchanged. Without commit authorization, record status/diff and continue.

---

### Task 3: Release integration, product documentation, versioning, and package validation

**Files:**
- Modify: `README.txt`
- Modify: `.codex/PROJECT.md:37-42,104-167` and any release-version facts that remain useful for future orchestration
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `resources/index.html:7,15` for visible 2.4 version text
- Modify: `windows/install.ps1:8,249,415,422-427`
- Modify: `windows/tray-host.ps1:364`
- Modify: `windows/uninstall.ps1:46`
- Modify: `scripts/package-windows.mjs:7,12`
- Modify: `scripts/verify-release.mjs:14,143`
- Modify: `test/package-layout.test.mjs:222-310`
- Update other 2.3 release-visible strings only if `rg` shows they are current runtime/release metadata rather than historical docs/tests.
- Do **not** rewrite `test/updates.test.mjs` semver fixtures merely because their synthetic installed version is 2.3.0; they test updater behavior independently unless a release-current assertion specifically requires 2.4.

**Interfaces:**
- Consumes: completed 2.4 behavior from Tasks 1-2.
- Produces: coherent 2.4.0 package metadata, Windows-visible labels, updated repository adapter, README user contract, verified Windows archive/checksum.

- [ ] **Step 1: Update release/package tests first to expect 2.4.0 and the new runtime module.**

In `test/package-layout.test.mjs`:

- rename the release-visible-label test to 2.4;
- expect `$AppName = 'Med Check-in 2.4.0'`, diagnostics text 2.4.0, shortcut description/name `Med Check-in 2.4`, tray text 2.4;
- expect installer cleanup to include old `2.0`, `2.1`, `2.2`, and `2.3` shortcuts before creating 2.4;
- expect uninstaller cleanup to include `2.0` through `2.4`;
- preserve `$MainTaskName = 'Med Check-in 2.0'` and watchdog task identity exactly;
- expect `package.json`, lockfile, package script, verifier, title, and visible header to be `2.4.0` / `2.4`;
- add `backend/scales.mjs` to the runtime-module presence assertions alongside migrations/data-maintenance/treatment.

Do not change updater mutual-exclusion tests.

- [ ] **Step 2: Run package-layout tests and verify they fail on 2.3 metadata.**

Run:

```text
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: FAIL on 2.3 version/label assertions and potentially the new runtime-file assertion only if package verification has a hardcoded runtime list.

- [ ] **Step 3: Bump application/package metadata to 2.4.0 without changing dependency graph.**

Set:

```json
"version": "2.4.0"
```

in `package.json`, root `package-lock.json.version`, and `package-lock.json.packages[""].version`. Do not run an install command that rewrites unrelated lockfile content; this package has no dependency change.

Update `scripts/package-windows.mjs`:

```js
const VERSION = '2.4.0';
const archiveName = 'med-checkin-2.4.0-windows-installer.zip';
```

Update `scripts/verify-release.mjs` expected version and header text to 2.4.0/2.4.

- [ ] **Step 4: Update Windows-visible release labels while preserving stable scheduled-task identities.**

In `windows/install.ps1`:

- `$AppName = 'Med Check-in 2.4.0'`;
- diagnostics heading `Med Check-in 2.4.0 installation diagnostics`;
- shortcut description/name `Med Check-in 2.4`;
- cleanup list includes old 2.3 shortcut as well as prior versions;
- **do not rename** `$MainTaskName = 'Med Check-in 2.0'` or `$WatchdogTaskName = 'Med Check-in 2.0 Watchdog'`.

In `windows/tray-host.ps1`, set notify icon text to `Med Check-in 2.4`.

In `windows/uninstall.ps1`, recognize/remove `Med Check-in 2.4.lnk` in addition to prior names.

Do not touch updater operation guards, process-safety rules, Node-runtime verification, or installer preparation order.

- [ ] **Step 5: Update visible HTML/README product version and describe configurable scales accurately.**

In `resources/index.html`, change only release display metadata:

```html
<title>Med Check-in 2.4.0</title>
<h1>Med Check-in <span>2.4</span></h1>
```

In `README.txt`:

- title/current shortcut version -> 2.4.0/2.4;
- replace prose that describes the eight scales as fixed with concise configurable-scale behavior;
- document add/rename/reorder/archive/restore and at-least-one-active rule at user level;
- state old observations keep their historical scale identities/values;
- update portable JSON description to format v3 with scale definitions and v1/v2 compatibility;
- keep Replace-only, backup, local-data/privacy, updater, treatment, reminder, and install semantics unchanged;
- do not add implementation-detail documentation that belongs only in design/plan.

- [ ] **Step 6: Update `.codex/PROJECT.md` to the new durable orchestration facts.**

Change persistent-data owner list to include `backend/scales.mjs`.

Replace current-product contract lines about fixed eight scales and portable v2 with concise v3 truths:

```text
- Scale definitions have stable IDs and configurable labels/active order; at least one is active.
- New scheduled observations require the current active scale set; saved scheduled observations retain their historical scale set.
- Scale values are stored relationally in schema v3; archive affects new entry, not historical identity.
- Portable JSON current format is v3 with scale definitions; v1/v2 remain accepted and normalize at import; Replace only.
- Browser drafts preserve their captured scale-ID set and block rather than discard IDs unknown after Replace.
```

Add `backend/scales.mjs` and `checkin_scale_values`/scale definition integrity to the relevant ownership-boundary/risk text. Keep updater mutual-exclusion invariant exactly; it remains useful and unchanged.

- [ ] **Step 7: Search for release-current 2.3 strings and classify before editing.**

Run:

```text
rg -n "2\.3\.0|Med Check-in 2\.3|2\.3" --glob '!docs/superpowers/specs/**' --glob '!docs/superpowers/plans/**' --glob '!node_modules/**' .
```

Expected remaining 2.3 strings fall into two categories:

1. **must update:** current product/package/Windows labels or release verifier assertions;
2. **must remain:** historical compatibility cleanup (`Med Check-in 2.3.lnk`) and synthetic updater fixtures that intentionally model upgrade/version comparisons.

Do not mass-replace category 2.

- [ ] **Step 8: Run package-layout tests to green.**

Run:

```text
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Run the full repository gate after all release integration.**

Run:

```text
npm test
```

Expected: PASS with more than the 2.3 baseline's 126 tests because new scale/migration/UI regressions were added.

- [ ] **Step 10: Build and verify the 2.4.0 Windows package.**

Run:

```text
npm run package:windows
```

Expected outputs:

```text
dist/med-checkin-2.4.0-windows-installer.zip
dist/med-checkin-2.4.0-windows-installer.zip.sha256
```

The packaging command must run the existing verifier successfully. Confirm the `.sha256` line names the 2.4.0 archive exactly.

- [ ] **Step 11: Run repository hygiene checks that exist without inventing new gates.**

Run:

```text
git diff --check
git status --short
```

Expected: no whitespace errors; only intended source/test/docs/version files plus the approved plan/spec are changed. `dist/` should remain uncommitted per existing repository practice unless the user explicitly directs otherwise.

- [ ] **Step 12: Perform one final coherent whole-branch review.**

Terra reviewer brief must cross boundaries rather than repeat Task-local review:

- schema v3 migration output matches runtime repository assumptions;
- portable v1/v2 normalization matches browser/API current shape;
- scale archive/restore and historical edit rules agree across repository, HTTP, and UI;
- draft snapshots cannot bypass ordinary scheduled completeness;
- analytics/chart/history labels remain stable-ID driven after rename/archive;
- CSV is dynamic but JSON remains the lossless format;
- version/package/installer changes did not alter scheduled task identity or updater mutual exclusion;
- no new dependency or generic framework slipped in.

If review finds an exceptional migration/Replace defect, route the narrow fix/re-review to Sol; otherwise keep fixes/re-review with Terra/primary.

- [ ] **Step 13: Apply final review fixes and rerun the exact affected focused tests plus both final gates.**

Always finish with fresh evidence from:

```text
npm test
npm run package:windows
git diff --check
```

Expected: all pass after the last source change. Do not cite an archive produced before final review fixes as release evidence.

- [ ] **Step 14: Conditional final checkpoint commit.**

If commits were explicitly authorized for execution:

```bash
git add README.txt .codex/PROJECT.md package.json package-lock.json resources/index.html windows/install.ps1 windows/tray-host.ps1 windows/uninstall.ps1 scripts/package-windows.mjs scripts/verify-release.mjs test/package-layout.test.mjs
git commit -m "chore: prepare Med Check-in 2.4.0"
```

Then inspect `git status --short`. Do not push, tag, create a release, deploy, or mutate GitHub release state without separate explicit authorization.

Without commit authorization, leave the working tree uncommitted and report the validated diff.

---

## Final Acceptance Checklist

Before implementation is reported complete, the primary must be able to point to test or inspection evidence for every item:

- [ ] fresh schema v3 has no fixed scale columns and has seeded scale definitions + relational values;
- [ ] schema v0/v1/v2 upgrade directly to v3 with pre-migration backup and exact legacy scale preservation;
- [ ] migrated `checkins_scheduled_identity` is attached to the new table and still enforces uniqueness;
- [ ] scale add/rename/order/archive/restore works with stable IDs and at least one active scale;
- [ ] new scheduled entries require current active IDs exactly;
- [ ] saved scheduled entries preserve historical scale sets and cannot lose/add values through ordinary edit;
- [ ] Extras keep approved looser semantics;
- [ ] archived historical scale values remain editable but cannot be newly added elsewhere;
- [ ] 2.3 drafts restore without shape loss; 2.4 drafts preserve snapshot IDs; unknown post-Replace IDs block instead of disappearing;
- [ ] history, analytics, paired deltas, trend selectors, and chart labels work for renamed/custom/archived/sparse scales;
- [ ] missing scale values are never treated as zero;
- [ ] completion remains schedule-based;
- [ ] portable v3 round-trips definitions/values and v1/v2 normalize at the import boundary;
- [ ] invalid Replace cannot partially mutate live portable data and reminder transient state stays local;
- [ ] CSV uses current dynamic labels but no CSV import/interchange machinery was added;
- [ ] README and `.codex/PROJECT.md` describe the new durable contracts without stale fixed-eight/v2 claims;
- [ ] version-visible metadata is 2.4.0/2.4 while stable scheduled-task identities remain unchanged;
- [ ] no dependency, generic form builder, generic migration framework, or generic definitions abstraction was introduced;
- [ ] `npm test` passes after the final source change;
- [ ] `npm run package:windows` passes and emits verified 2.4.0 ZIP + checksum after the final source change;
- [ ] `git diff --check` passes;
- [ ] any real/disposable Windows upgrade smoke is reported separately from automated evidence, never improvised on real user data.

## Codex Launch Prompt

Use this compact parent prompt when handing the approved plan to Codex:

> Read the active `AGENTS.md`, `.codex/ORCHESTRATION.md`, `.codex/PROJECT.md`, the approved design at `docs/superpowers/specs/2026-08-10-med-checkin-2.4-configurable-scales-design.md`, and this implementation plan. Implement Med Check-in 2.4.0 as the primary orchestrator. Treat the design/plan as scope and acceptance contracts, but group execution/delegation by the three coherent ownership boundaries rather than checkbox steps. The repository map is fresh-enough; skip redundant broad exploration unless current code materially differs. Prefer native SQLite/Node/browser solutions and YAGNI. Use Luna high as the bounded UI/product worker experiment if Task 2 remains suitable; use Terra for integration-heavy work/ordinary review; use Sol review only for the actual exceptional migration/Replace integrity surface. Run focused tests during work, `npm test` before expensive review, and the final `npm test` + `npm run package:windows` + `git diff --check` after all fixes. Preserve authorization gates: do not commit/push/tag/release/deploy or touch real user data unless the user's execution request explicitly authorizes that mutation.
