# Med Check-in 2.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan. The numbered Tasks below are deliberately **ownership/review boundaries**. Checkbox steps inside a Task are implementation steps, not separate delegation or review units.

**Goal:** Ship Med Check-in 2.3.0 with configurable Context/Symptom/Activation items, neutral fresh-install treatment state, a small verified GitHub updater, exact reuse of the app-owned pinned Node runtime when possible, and all-eight-scale trend toggles while preserving 2.2.2 data and upgrade behavior.

**Architecture:** Keep observation storage structurally unchanged: `context_json`, `symptoms_json`, and `activation_json` continue to store stable IDs. Schema v2 adds a small `tracked_items` definition table that supplies labels, active/archive state, category, and ordering; portable JSON becomes version 2 so those definitions travel with the IDs. The updater is intentionally narrow: the backend checks one fixed official GitHub release source, remembers only update-check timing on disk, keeps any discovered candidate in memory, verifies the release ZIP against its `.sha256`, stages it, and asks the existing tray/installer lifecycle to launch the staged installer. No updater framework or shell redesign is introduced.

**Tech Stack:** Node.js 22.23.1 ESM; built-in `node:sqlite`, `fetch`, `crypto`, `fs`, `os`, `path`, and `child_process`; static HTML/CSS/JavaScript; Windows PowerShell 5.1 tray/installer scripts; Edge app mode; Node test runner; ZIP release packaging.

## Global Constraints

- Target release version: `2.3.0`.
- Keep the eight core 0-10 scales fixed. Do not add user-defined scales or change scheduled-observation completeness rules.
- Keep Context, Symptoms, and Activation semantically distinct. This is customization of those three existing groups, not a generic form builder.
- Never destructively delete tracked-item definitions. Rename, reorder, archive, and reactivate only.
- A 2.2.2 -> 2.3.0 migration must not rewrite observation rows merely to support tracked definitions. Preserve observation IDs/timestamps/stored flag IDs, treatment history, settings, reminder state, backups, and browser drafts.
- A fresh 2.3.0 database contains zero treatment events.
- Portable JSON remains explicit Replace-only. No Merge import and no general v1 CSV importer.
- Update checks use only the official `abocha/med-checkin-2` GitHub release source and send no check-in, treatment, settings, or other personal application data.
- Installation remains an explicit user action. No silent install, channels, prerelease channel, deltas, rollback orchestration, or new background Windows service.
- The browser never supplies a release URL, checksum URL, installer executable, or arbitrary command/path to execute.
- Reuse only the existing Med Check-in-owned runtime at `%LOCALAPPDATA%\Programs\MedCheckin2\runtime\node`, and only when `node.exe --version` succeeds and is exactly `v22.23.1`. Never use `PATH` Node.
- Preserve `windows/install.ps1`'s preparation-before-replacement property: a usable prepared application must exist before the old installed application is stopped/replaced.
- Ordinary update/install must preserve `%LOCALAPPDATA%\MedCheckin2`, including SQLite data, backups, settings, logs, and the dedicated Edge profile/drafts.
- Normal automated updater tests use injected/fake network behavior, not live GitHub.
- Do not add dependencies unless current repository constraints make the built-in implementation infeasible.
- Do not use the approved “small fixes” allowance for unrelated refactoring.
- Commits, branches, pushes, PRs, tags, releases, deployments, and destructive real-user-data operations remain separately authorization-gated by `AGENTS.md` and `.codex/PROJECT.md`.

## Review Policy for Codex / Superpowers

This plan intentionally draws review boundaries at subsystem ownership seams rather than at every test/edit cycle.

- **The three numbered Tasks are the only planned task-scoped review gates.** If `superpowers:subagent-driven-development` is used, do not split checkbox steps into additional numbered SDD tasks merely to obtain smaller reviews.
- One worker may own all steps inside a Task. The primary may also execute a Task inline when delegation would cost more than it saves.
- Do not add reviews after individual schema edits, route additions, UI substeps, commits, or focused test commands. Those are evidence inside the Task's single review package.
- Reviewer choice remains the primary's judgment from the actual diff:
  - Task 1 is an **exceptional-risk candidate** because it includes migration and Replace-import data integrity. Terra is sufficient for ordinary portions; Sol is appropriate when the resulting migration/Replace diff warrants it.
  - Task 2 is ordinary UI/API presentation work; Terra review is normally sufficient.
  - Task 3 is an **exceptional-risk candidate** because it controls verified downloads and executable/installer handoff. Use Sol only for the concrete high-consequence updater/installer surface if warranted by the resulting diff.
- If the chosen execution skill already performs a final whole-branch review, that is the plan's final broad review. Do not stack another duplicate broad Terra/Sol review on top of it unless review fixes introduce a new exceptional-risk surface.
- Re-review only the affected scope after fixes. Do not restart a full review chain for an unrelated small correction.

This section overrides the tendency to manufacture one review cycle per checklist item while preserving Superpowers' required task-level review discipline.

---

## Refined Implementation Contracts

These choices resolve implementation ambiguities in the approved design. They specify product/data contracts; they do not prescribe unnecessary internal helper structure.

### 1. Tracked-item definitions and identity

Add schema-v2 definitions with this public shape:
```js
{
  id: 'stress',
  category: 'context',
  label: 'Выраженный стресс',
  active: true,
  sortOrder: 1
}
```
The table is:
```sql
CREATE TABLE tracked_items (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('context','symptoms','activation')),
  label TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL
) STRICT;

CREATE INDEX tracked_items_category_order
  ON tracked_items(category, sort_order, id);
```
Create one small source module, expected at `backend/tracked-items.mjs`, for the shipped definitions and definition validation shared by schema/domain/import code. Preserve the exact existing 2.2.x IDs:
```text
context:
  caffeine, stress, conflict, illnessPain, physicalActivity, positiveProductiveDay

symptoms:
  dizziness, headache, nausea, sweating, palpitations, brainZaps, unusualDreams, crying

activation:
  reducedSleepNeed, racingThoughts, talkativeness, innerMotor, impulsivity, elevatedAgitated
```
Where 2.2.2 HTML and JavaScript use slightly different wording for the same ID, choose one clear existing shipped label and make the definition table the single authority from then on. This does not change historical identity.

Rules:

- built-in IDs and categories are immutable;
- custom IDs are server-generated opaque IDs such as `custom:${crypto.randomUUID()}`;
- labels are trimmed, non-empty, and bounded to a modest existing-UI-safe length (120 characters is sufficient);
- archive is `active = false`; there is no product delete operation;
- order is dense within a category after explicit reorder;
- active state controls new-entry availability, not historical validity;
- observation arrays continue to contain IDs only.

### 2. Observation validation

`normalizeCheckin` stays a pure domain normalizer but must be able to validate against a supplied tracked-definition set. Repository create/update uses the live definitions from SQLite.

For each of `context`, `symptoms`, and `activation`:

- a known ID in the correct category is valid even when archived;
- an unknown ID or an ID from the wrong category is invalid and returns the existing validation/HTTP-400 style failure;
- duplicates may be normalized away as today, but unknown IDs must never be silently filtered out.

This preserves old observations after rename/archive while preventing a custom selection from disappearing during save.

### 3. Schema migration and treatment seed

Set `LATEST_SCHEMA_VERSION = 2`.

Fresh database:
```text
create existing tables
create tracked_items
seed shipped tracked definitions
seed NO treatment events
PRAGMA user_version = 2
```
Schema 1 -> 2:
```text
create normal pre-migration backup
BEGIN IMMEDIATE
create tracked_items/index
seed shipped definitions
set user_version = 2
COMMIT
```
Do not rebuild `checkins` or `treatment_events` for v1 -> v2. This makes preservation of IDs/timestamps/treatment history structural rather than dependent on copy logic.

Legacy schema-0 migration remains supported. It should continue to migrate legacy observations/reminders into the current schema, but the new latest schema must no longer invent the personal treatment history. Existing schema-1 treatment rows remain untouched.

Tests that currently depend on the old personal treatment seed must create their own explicit treatment fixtures.

### 4. Repository tracked-item operations

Expose repository operations equivalent to:
```js
repo.listTrackedItems()
repo.createTrackedItem({ category, label })
repo.updateTrackedItem(id, { label, active })
repo.reorderTrackedItems(category, orderedIds)
```
No repository delete operation is needed.

Creation appends to the category. Reorder accepts the complete set of IDs for one category and writes dense `sortOrder` values. Reject duplicates, unknown IDs, wrong-category IDs, or a partial category list rather than guessing intent.

### 5. Portable JSON version 2

New exports use:
```json
{
  "format": "med-checkin-2",
  "formatVersion": 2,
  "exportedAt": "...",
  "trackedItems": [],
  "observations": [],
  "treatmentEvents": [],
  "settings": {}
}
```
Compatibility:

- v2 import requires and validates `trackedItems` and validates every observation flag ID against those definitions;
- v2 must retain every shipped built-in ID in its original category, while allowing rename/reorder/archive and custom definitions;
- v1 import remains accepted and materializes the shipped built-in definitions because 2.2.x exports could not contain custom IDs;
- exports are v2 only;
- preview adds `trackedItemCount` and preserves the source `formatVersion`;
- Replace import replaces tracked definitions together with observations, treatment events, and portable settings in the existing single destructive transaction;
- `reminder_state` remains local and is not replaced;
- pre-import backup/rollback guarantees remain unchanged.

Backup validation must recognize schema versions 0, 1, and 2. Schema 2 additionally requires the `tracked_items` table/columns. Restoring schema 1 still runs `prepareDatabase` and therefore upgrades it to schema 2 before reopen.

### 6. Browser tracked-item behavior

`GET /api/v1/bootstrap` includes all tracked definitions, including archived definitions.

Keep the HTTP surface small. Mutation routes are sufficient:
```text
POST /api/v1/tracked-items
  { category, label }

PUT /api/v1/tracked-items/:id
  { label?, active? }

PUT /api/v1/tracked-items/order
  { category, ids }
```
Each successful mutation returns the current tracked-item list (for example `{ items: [...] }`) so the same browser that made the change can replace `state.trackedItems` and rerender immediately. **Do not add tracked-item SSE synchronization unless implementation evidence shows a real second-writer problem.** There is no DELETE route.

New-entry forms render active items only. Editing an observation with an archived selected item must still show that archived item selected so saving the historical selection remains possible.

Do not build a pseudo-item system for impossible/corrupt IDs. The one realistic mismatch is a browser draft left behind after a Replace import removes a custom definition. In that case, do not silently drop the unknown draft ID; a simple warning/blocked-save treatment is sufficient. Keep the mechanism small.

Analytics frequency labels resolve through the live definitions so renamed IDs display their current labels without rewriting history.

### 7. Trend toggles

Expose all existing eight scales as selectable trend series:
```text
mood
anxiety
irritability
energy
focus
functioning
sleepQuality
appetite
```
Default selection remains:
```js
['mood', 'energy', 'focus', 'functioning']
```
Only presentation changes. Do not change `backend/analytics.mjs`, daily aggregation, smoothing, treatment markers, or completion calculations.

### 8. Update source and candidate

Use one fixed GitHub metadata source:
```text
https://api.github.com/repos/abocha/med-checkin-2/releases/latest
```
For a stable compatible tag `vX.Y.Z` / `X.Y.Z`, expect exact asset names:
```text
med-checkin-X.Y.Z-windows-installer.zip
med-checkin-X.Y.Z-windows-installer.zip.sha256
```
Offer an update only when:

- the tag is a plain stable semantic version;
- it is newer than the installed version by numeric SemVer comparison;
- it has the same major version as the installed version;
- both expected assets exist.

No GitHub authentication, channel selection, or prerelease handling is needed.

The current discovered candidate lives in memory. Do not persist a miniature release database. Persist only the last completed automatic/manual check time so frequent restarts do not cause repeated GitHub requests.

### 9. Update cadence and UI

Use the existing backend lifetime. A simple cadence is sufficient:
```text
startup -> short delayed due check
then -> roughly daily automatic check while the backend remains alive
manual Check for updates -> forced immediate check
```
The due check may use persisted `lastCheckedAt` to skip a network request when a recent check already completed. Do not implement an hourly timer whose only purpose is asking whether 24 hours have elapsed.

Status can remain a small in-memory object containing installed version, phase, last checked time, available version/release text when discovered, and the latest safe error message.

Use SSE for updater status because automatic checks are genuinely asynchronous. Reuse the existing event hub; one event such as `update-state` is enough.

Settings/About shows:

- installed version;
- last checked time / never;
- status;
- available version and plain-text release notes/summary when present;
- **Check for updates**;
- **Update** only when a compatible candidate exists.

Clicking **Update** is itself the required explicit confirmation. Do not add a second confirmation dialog unless the existing UX has a concrete unsaved-work hazard that makes it necessary.

Make availability visible without requiring a large second UI surface. An unobtrusive existing-nav/header indicator is enough if the About card would otherwise be hidden; a global banner is not required.

### 10. Update verification and handoff

`installAvailable()` uses the currently discovered in-memory candidate. If no candidate exists, it fails safely and the user can run **Check for updates** first. Do not re-fetch release metadata merely because the user clicked Update.

Installation preparation:
```text
download exact candidate ZIP
fetch exact candidate .sha256
parse SHA-256
verify downloaded ZIP digest
extract into app-created temp directory named MedCheckin2-update-*
verify expected MedCheckin2/INSTALL.bat exists
queue fixed host action containing only the staging directory
```
The release is tiny; an ordinary `arrayBuffer()`/file write plus SHA-256 is adequate. Do not add streaming/size-limit infrastructure unless the actual packaging size or runtime API creates a demonstrated need.

The checksum companion is trusted only as integrity metadata from the same fixed official release candidate. Parse a normal SHA-256 line robustly; no bespoke checksum mini-language is required.

Do not add redundant post-extraction version checks against both `VERSION.txt` and `package.json`; exact release tag + exact asset name + verified checksum + expected installer layout is sufficient for 2.3.

Host action:
```js
{ type: 'install-update', stagingDir }
```
The tray host must still defend the execution boundary: resolve the received directory, require it to be inside the current user's temp directory and have the `MedCheckin2-update-` prefix, construct `MedCheckin2\INSTALL.bat` itself, verify that file exists, and launch that constructed path. It must not accept `installerPath`, URL, command-line executable, or equivalent browser/backend-provided executable authority.

### 11. Node runtime reuse and packaging

The installer keeps Node `22.23.1` and the existing official SHA-256 fallback.

During preparation:
```text
candidate = installed MedCheckin2 runtime/node
candidate node.exe --version == v22.23.1 and exits successfully
    -> copy candidate runtime into prepared application
    -> verify the prepared copy is usable
otherwise
    -> use existing official Node download + SHA-256 path
```
Do not inspect system Node or `PATH`.

Package output becomes:
```text
dist/med-checkin-2.3.0-windows-installer.zip
dist/med-checkin-2.3.0-windows-installer.zip.sha256
```
The `.sha256` file uses a conventional line:
```text
<hex digest>  med-checkin-2.3.0-windows-installer.zip
```
Update version metadata consistently in the existing release/version sources. Do not rename stable scheduled-task identities merely because the product release is 2.3.0.

---

### Task 1: Persistence, migration, tracked definitions, and portable-data integrity

**Ownership boundary:** all persistent tracked-definition semantics and portable/backup compatibility. This is intentionally one task so Superpowers produces one data-integrity review package rather than separate schema/repository/import reviews of the same coupled change.

**Likely routing:** Terra workhorse candidate. Luna should not own migration/Replace decisions. Exceptional-risk review candidate based on the actual diff.

**Files:**
- Create: `backend/tracked-items.mjs`
- Modify: `backend/domain.mjs`
- Modify: `backend/schema.mjs`
- Modify: `backend/migrations.mjs`
- Modify: `backend/repository.mjs`
- Modify: `backend/data-maintenance.mjs`
- Modify focused tests: `test/domain.test.mjs`, `test/migrations.test.mjs`, `test/repository.test.mjs`, `test/treatment.test.mjs`, `test/data-maintenance.test.mjs`, `test/backup-smoke.test.mjs`

**Produces for Task 2:**
```js
TrackedItem = { id, category, label, active, sortOrder }

repo.listTrackedItems()
repo.createTrackedItem({ category, label })
repo.updateTrackedItem(id, { label, active })
repo.reorderTrackedItems(category, orderedIds)
```
and bootstrap/HTTP consumers can rely on schema version 2 plus portable format version 2.

- [ ] **Step 1: Lock the tracked-definition and check-in validation contract with focused tests.**

Add domain/repository cases that prove:
```text
custom symptom ID is accepted in symptoms
same ID is rejected in context/activation
archived known ID remains valid for an existing observation
unknown ID rejects instead of disappearing
rename/archive does not rewrite stored observation ID
reorder yields dense per-category order
custom ID is generated server-side and remains stable
no delete operation exists
```
Use explicit test definitions rather than relying on UI literals.

Run:
```text
node --test --test-concurrency=1 test/domain.test.mjs test/repository.test.mjs
```
Expected before implementation: failures because 2.2.2 still hardcodes allowed arrays and has no tracked-definition repository operations.

- [ ] **Step 2: Introduce the shared tracked-definition module and make domain validation definition-aware.**

Create the shipped definition list from the existing IDs/labels. Keep scale constants in `domain.mjs`; remove or derive the old Context/Symptom/Activation ID arrays so they are not a competing authority.

Keep `normalizeCheckin` pure. A suitable contract is:
```js
normalizeCheckin(input, { allowMissingObservedAt = false, trackedItems = BUILTIN_TRACKED_ITEMS } = {})
```
The exact helper decomposition inside `tracked-items.mjs` is up to the implementer; do not create abstractions beyond what schema, domain, repository, and portable validation actually reuse.

- [ ] **Step 3: Add migration tests for fresh v2, v1 -> v2, and legacy v0 -> v2 before changing schema code.**

The v1 fixture must contain at least:
```text
one observation with fixed id/recorded_at/updated_at and known flag IDs
explicit treatment rows with fixed ids/timestamps/regimen JSON
settings
reminder_state
```
Assert v1 -> v2 preserves those rows exactly while adding shipped tracked definitions and one normal pre-migration backup.

Assert fresh v2 has:
```text
PRAGMA user_version = 2
all shipped tracked definitions
zero treatment events
```
Assert the existing legacy v0 fixture still migrates observations/reminders correctly but does not invent personal treatment events.

Run:
```text
node --test --test-concurrency=1 test/migrations.test.mjs test/treatment.test.mjs
```
Expected before implementation: failures on schema version, missing tracked table, and old seed expectations.

- [ ] **Step 4: Implement schema v2 and the narrow migration.**

Change `backend/schema.mjs` so latest-schema creation creates/seeds `tracked_items` but does not seed treatment history. Remove the production `KNOWN_TREATMENT_EVENTS` personal seed.

Add the direct v1 -> v2 path described in the contract. Do not rebuild check-ins/treatment rows for that migration. Keep the existing backup-before-migration behavior.

For legacy v0, reuse the existing migration structure but target neutral schema v2.

- [ ] **Step 5: Make treatment-dependent tests explicit.**

Where tests need treatment history or analytics markers, insert those events in the fixture/test setup. The neutral baseline assertion should be equivalent to:
```js
assert.deepEqual(repo.listTreatmentEvents(), []);
assert.equal(repo.getEffectiveTreatment('2026-08-09'), null);
```
Do not weaken treatment uniqueness or analytics coverage just because the product seed disappeared.

- [ ] **Step 6: Implement repository tracked-item CRUD/order and live check-in validation.**

Repository row mapping is:
```js
{
  id: row.id,
  category: row.category,
  label: row.label,
  active: Boolean(row.active),
  sortOrder: row.sort_order
}
```
Creation generates the custom ID and appends within category. Update changes only label/active. Reorder validates the complete category ID set and writes dense order transactionally.

Before repository create/update normalizes a check-in, load the current definitions and pass them into `normalizeCheckin`.

Run:
```text
node --test --test-concurrency=1 test/domain.test.mjs test/migrations.test.mjs test/repository.test.mjs test/treatment.test.mjs
```
Expected: PASS.

- [ ] **Step 7: Convert portable JSON to v2 while retaining v1 import.**

Update `backend/data-maintenance.mjs` so validation first resolves a tracked-definition set, then validates observation IDs against it.

Required cases:
```text
v2 export includes trackedItems
v2 custom definition round-trips with rename/archive/order
v2 rejects duplicate definition IDs, invalid categories, blank labels, moved/missing built-ins, or observation IDs not represented in the correct category
v1 preview/import still succeeds and materializes shipped definitions
preview reports trackedItemCount and source formatVersion
```
Do not invent migration/merge semantics for arbitrary broken portable data.

- [ ] **Step 8: Extend Replace and backup compatibility with the smallest necessary changes.**

Inside the existing Replace transaction, replace tracked definitions together with observations/treatment/portable settings. Keep `reminder_state` untouched and preserve the pre-import backup + rollback behavior.

Backup validation accepts recognized versions 0, 1, 2; schema 2 requires the tracked-items shape. Restore of v1 proceeds through `prepareDatabase` to v2.

Add failure-path coverage proving a rejected/failed Replace does not leave the live database half-replaced.

Run:
```text
node --test --test-concurrency=1 test/data-maintenance.test.mjs test/backup-smoke.test.mjs
```
Expected: PASS.

- [ ] **Step 9: Run the Task 1 focused boundary gate and inspect the diff before review.**

Run:
```text
node --test --test-concurrency=1 \
  test/domain.test.mjs \
  test/migrations.test.mjs \
  test/repository.test.mjs \
  test/treatment.test.mjs \
  test/data-maintenance.test.mjs \
  test/backup-smoke.test.mjs
```
Verify from the diff/tests that:
```text
v1 -> v2 does not rewrite checkins/treatment rows
fresh latest schema has no treatment seed
observation arrays still store IDs
portable Replace remains one transaction and reminder_state remains local
```
**Task review gate:** one coherent review here. Reviewer model/routing is chosen from the actual diff under the Review Policy above. Do not insert separate reviews for schema, repository, and portable substeps.

---

### Task 2: Browser tracked-item workflow, HTTP surface, and eight-scale trend controls

**Ownership boundary:** browser-facing customization/presentation plus the small authenticated HTTP surface it needs. No persistence redesign belongs here.

**Likely routing:** Luna candidate if the Task 1 interfaces are stable and existing browser patterns remain straightforward; promote to Terra workhorse if draft/edit integration turns out materially broader. Ordinary Terra review is sufficient in normal circumstances.

**Files:**
- Modify: `backend/http-server.mjs`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `resources/styles.css`
- Modify: `resources/vendor/chart-lite.js`
- Modify: `test/http-server.test.mjs`
- Modify: `test/frontend-smoke.test.mjs`
- Create or modify focused chart test: `test/chart-lite.test.mjs`
- Keep `backend/analytics.mjs` unchanged unless repository evidence proves the approved presentation-only design impossible.

**Consumes from Task 1:** repository tracked-item operations, `TrackedItem` shape, portable v2 behavior, and definition-aware observation validation.

- [ ] **Step 1: Add focused HTTP tests for bootstrap and tracked-item mutations.**

Cover:
```text
bootstrap includes all definitions including archived
POST creates an active custom item and returns current items
PUT renames/archive/reactivates without changing id/category
PUT order applies a full-category order and returns current items
no DELETE route exists
tracked mutation requests normal persistence backup cadence via onPersisted()
check-in POST/PUT accepts correct-category custom/archived IDs and rejects wrong-category IDs
```
Do not add a tracked-item GET route unless implementation discovers a real need not covered by bootstrap + mutation responses.

Run:
```text
node --test --test-concurrency=1 test/http-server.test.mjs
```
Expected before implementation: missing bootstrap field/routes.

- [ ] **Step 2: Implement the narrow tracked-item HTTP contract.**

Use the existing authenticated `/api/v1` server and body/error conventions. Normal create does not accept caller-selected IDs/category mutation/sort positions beyond its contract.

After a successful mutation:
```text
perform normal persisted-data backup hook
return the current tracked-item list
```
Do not broadcast a `tracked-items-changed` SSE event. The initiating browser updates its own state from the response.

- [ ] **Step 3: Replace hardcoded check-in flag markup with dynamic category containers.**

Keep the existing three headings/semantic groups. `resources/index.html` should no longer be the authoritative list of built-in IDs/labels.

On bootstrap:
```js
state.trackedItems = data.trackedItems;
```
Render active definitions for a new entry. When editing an existing observation, also render any selected archived definitions from that observation so they can remain selected.

Preserve current draft, previous-values, edit, reset, and save behavior. If a stale local draft contains an ID no longer present after a Replace import, show a simple warning/block rather than silently discarding that selection; do not invent a full pseudo-definition subsystem.

- [ ] **Step 4: Add one compact tracked-items Settings manager.**

For each of Context, Symptoms, Activation support:
```text
add label
rename + Save
archive/reactivate
move up/down
```
Archived rows stay visible in Settings. There is no Delete control.

Mutation success replaces `state.trackedItems` with the returned list and rerenders the relevant Settings/form view.

- [ ] **Step 5: Make historical frequency labels resolve through live definitions.**

Remove `flagLabels` as a second hardcoded authority. Frequency output uses the definition matching the stored ID, falling back to the raw ID only for genuinely corrupt/foreign data.

- [ ] **Step 6: Add failing trend-renderer/UI coverage for selectable series.**

A focused renderer test should prove a selection such as:
```js
['anxiety', 'sleepQuality']
```
renders those valid series and does not render unselected Mood/Energy series. Unknown fields are ignored.

Frontend smoke coverage should prove eight fixed toggle controls are present and the initial selected set is Mood/Energy/Focus/Functioning.

Run:
```text
node --test --test-concurrency=1 test/chart-lite.test.mjs test/frontend-smoke.test.mjs
```
Expected before implementation: fixed-four chart behavior fails the new contract.

- [ ] **Step 7: Make ChartLite and the analytics card accept a selected fixed-field list.**

A suitable public renderer signature is:
```js
ChartLite.renderTrend(container, daily, treatmentMarkers, selectedFields)
```
Filter `selectedFields` against the eight existing scale names. Render only selected valid series and their legend entries. Keep treatment markers, date axis, y-axis, rolling values, and backend analytics payload unchanged.

Toggle changes rerender already-loaded analytics data; they do not call the backend to recalculate analytics merely because display selection changed.

If no metric is selected, show a small empty-state instruction instead of throwing.

- [ ] **Step 8: Run the complete Task 2 boundary gate.**

Run:
```text
node --test --test-concurrency=1 \
  test/http-server.test.mjs \
  test/frontend-smoke.test.mjs \
  test/draft-store.test.mjs \
  test/analytics.test.mjs \
  test/chart-lite.test.mjs
```
Expected: PASS, with `backend/analytics.mjs` calculation behavior unchanged.

Inspect the diff for duplicated tracked IDs/labels in `index.html`/`app.js`; the definition source should now be singular.

**Task review gate:** one ordinary coherent review here. Do not create separate reviews for HTTP, Settings, dynamic check-in rendering, or trend toggles.

---

### Task 3: GitHub updater, tray/installer handoff, Node reuse, and 2.3 distribution

**Ownership boundary:** the full update/distribution path from official release metadata through verified staging to the existing Windows installer, including the package/checksum contract the updater consumes. Keeping this as one task ensures the artifact names, updater assumptions, tray boundary, installer behavior, and release packaging are reviewed together rather than in partially integrated slices.

**Likely routing:** Terra workhorse candidate. The primary may keep small browser About/version edits inline within this boundary. Exceptional-risk review candidate based on the actual download/executable/destructive installer diff.

**Files:**
- Create: `backend/updates.mjs`
- Create: `test/updates.test.mjs`
- Modify: `backend/main.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `windows/tray-host.ps1`
- Modify: `windows/install.ps1`
- Modify: `scripts/package-windows.mjs`
- Modify: `scripts/verify-release.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Modify: `resources/styles.css`
- Modify: `README.txt`
- Modify focused tests: `test/http-server.test.mjs`, `test/frontend-smoke.test.mjs`, `test/package-layout.test.mjs`
- Do not hand-edit generated `dist/` artifacts.

**Updater service contract:**

A suitable factory remains injectable for deterministic tests:
```js
createUpdateService({
  installedVersion,
  dataDir,
  hostActions,
  fetchImpl = fetch,
  now = () => new Date(),
  extractArchive = defaultExtractArchive,
  onStatus = () => {}
})
```
Public behavior:
```js
getStatus()
check({ force = false } = {})
installAvailable()
```
The exact private helper structure is intentionally not specified.

- [ ] **Step 1: Add updater unit tests around the small actual contract.**

Use fake `fetchImpl`, clock, extractor, temp paths, and host queue. Cover:
```text
same/older version -> no update
newer same-major stable SemVer -> available
newer different-major -> not offered
malformed/non-stable tag -> not offered
missing expected ZIP or .sha256 -> safe error/no install
network failure -> safe status/no host action
checksum mismatch -> no extraction/host action
extract failure -> no host action
missing staged MedCheckin2/INSTALL.bat -> no host action
successful verified staging -> exactly one {type:'install-update', stagingDir} action
manual force check bypasses recent lastCheckedAt
non-force check may skip a request when lastCheckedAt is recent
installAvailable uses the discovered candidate without another metadata fetch
installAvailable with no current candidate fails safely
```
Do not test speculative limits, duplicate-asset pathology, custom URL-prefix grammars, or redundant extracted-version files unless implementation introduces those mechanisms for a demonstrated reason.

Run:
```text
node --test --test-concurrency=1 test/updates.test.mjs
```
Expected before implementation: module absent.

- [ ] **Step 2: Implement fixed-source check state with minimal persistence.**

Hardcode the official metadata endpoint in the service, not in browser input/config. Parse numeric stable SemVer and locate the exact ZIP/checksum asset names derived from the tag.

Persist only what is needed to suppress repeated checks across restarts, expected to be `lastCheckedAt` in a small local state file under `dataDir`. Corrupt/missing state is treated as no previous check and must not block startup.

Keep the discovered release name/notes/version/assets in memory. Bound or plain-text-render release text at the UI boundary; no HTML injection from GitHub release notes.

Run the updater unit test again after this stage.

- [ ] **Step 3: Implement verified staging without updater-framework machinery.**

On explicit Update:
```text
use current candidate
fetch expected ZIP and .sha256
compute SHA-256 of ZIP and compare
create OS-temp MedCheckin2-update-* directory
write/extract the verified ZIP
require staged MedCheckin2/INSTALL.bat
queue {type:'install-update', stagingDir}
```
Default extraction may use Windows PowerShell `Expand-Archive`; tests inject extraction so normal unit tests are platform-independent.

On failure, best-effort remove only the service-created staging directory and leave the running installation untouched. Do not stop the app from the updater service.

- [ ] **Step 4: Integrate one daily-ish automatic check, API routes, SSE, and About UI.**

Wire the service in `backend/main.mjs` using the installed version from the shipped `package.json` rather than another hardcoded product-version constant.

Scheduling should stay simple: after a short startup delay, check only if `lastCheckedAt` is due, then keep one timeout aimed at roughly 24 hours after the last completed check. A manual forced check resets that next due time. Do not create an hourly polling timer or Windows scheduled task for updates.

Authenticated routes:
```text
GET  /api/v1/updates
POST /api/v1/updates/check
POST /api/v1/updates/install
```
Bootstrap includes update status. `POST /check` forces a check; `POST /install` accepts no URL/path/version authority and invokes `installAvailable()`.

Broadcast one `update-state` SSE event when async state changes.

Settings/About shows installed/current update status, last check, available version/release summary, Check, and Update. Render release text as text, not `innerHTML`.

Do not require a second confirmation dialog. Add only a modest availability indicator outside About if needed to make a discovered update noticeable.

Update the shipped privacy wording so it accurately states that medical/check-in data stays local, no telemetry/account data is sent, and the app may contact the official GitHub repository to check/download updates.

- [ ] **Step 5: Add the fixed `install-update` tray action with a narrow execution boundary.**

In `windows/tray-host.ps1`, handle only the service-created staging-directory action.

Required safety properties:
```text
resolve stagingDir to a full path
require it under the current user's temp directory
require MedCheckin2-update-* staging name/prefix
construct MedCheckin2\INSTALL.bat inside that directory
require that file exists
Start-Process that constructed installer
never execute action.installerPath/action.url/action.command
```
Use proportionate PowerShell/package tests. Avoid brittle tests that assert every source line or helper name; assert the security contract and rely on the Windows smoke for actual behavior.

- [ ] **Step 6: Add exact app-owned Node runtime reuse without changing installer architecture.**

In `windows/install.ps1`, during the existing preparation phase:
```text
inspect only $InstallDir\runtime\node\node.exe
run --version
if exit success and stdout exactly v22.23.1:
    copy that runtime to the prepared app
    verify prepared node.exe is still usable/exact
else:
    execute the existing official Node archive download + SHA-256 path
```
A copy/read failure is a fallback condition; it must not damage the installed copy.

The installer must still finish preparing/validating the new application before the existing flow reaches `Stop-OldInstance` or directory replacement.

Tests/static inspection must also prove no `Get-Command node`, `where node`, or other PATH/system-runtime discovery was introduced.

- [ ] **Step 7: Update 2.3.0 release metadata and emit the checksum companion.**

Update the existing authoritative version references:
```text
package.json / package-lock root version
scripts/package-windows.mjs
scripts/verify-release.mjs
resources/index.html visible/title release text
tray visible version text if it is release-labelled
README.txt
```
Package output must be exactly:
```text
med-checkin-2.3.0-windows-installer.zip
med-checkin-2.3.0-windows-installer.zip.sha256
```
After existing release verification succeeds, compute SHA-256 with Node and write the conventional companion line. Package startup should remove stale output for the current archive/checksum so an old file cannot masquerade as this build.

Do not rename the stable Windows scheduled-task identity unless existing code already treats it as a release-versioned value; that would be unrelated migration work.

- [ ] **Step 8: Update README distribution/privacy wording.**

Document only behavior users need:
```text
fresh install / Node-version-change may download official pinned Node
normal upgrade may reuse exact app-owned Node 22.23.1
automatic/manual update checks contact official GitHub only
Update is explicit and ZIP integrity is SHA-256 verified
no medical/check-in/treatment data or telemetry is sent
ordinary upgrade preserves %LOCALAPPDATA%\MedCheckin2
portable JSON current export is v2; v1 imports remain accepted
```
Keep claims aligned with implemented behavior rather than explaining internal helper mechanics.

- [ ] **Step 9: Run the complete Task 3 boundary gate.**

Run:
```text
node --test --test-concurrency=1 \
  test/updates.test.mjs \
  test/http-server.test.mjs \
  test/frontend-smoke.test.mjs \
  test/package-layout.test.mjs
```
Then run the package gate because artifact naming/checksum/installer layout are part of this Task:
```text
npm run package:windows
```
Expected: PASS and both 2.3.0 ZIP + `.sha256` are produced. Do not count a package generated before the final Task 3 changes as evidence.

Inspect the integrated updater/distribution diff for these load-bearing facts:
```text
only fixed official GitHub metadata source
browser cannot provide executable/download authority
checksum precedes extraction/host launch
tray constructs installer inside validated temp staging
installer reuses only exact app-owned Node or falls back to verified download
old app is not stopped until preparation succeeds
%LOCALAPPDATA%\MedCheckin2 is not part of replacement/deletion
```
**Task review gate:** one coherent updater/distribution review here. Choose Terra/Sol from the actual diff under the Review Policy. Do not separately review updater service, API, tray host, Node reuse, and packaging as five independent gates.

---

## Final Integration and Release Validation

This is primary-orchestrator work, not a fourth implementation Task. If the chosen Superpowers execution mode performs a final whole-branch review, use that existing final review rather than adding another duplicate review layer.

- [ ] **Integration check: compare the complete diff against the approved design and all three Task contracts.**

Confirm no accidental scope additions such as custom scales, tracked deletion, Merge import, updater channels, PATH Node reuse, or tray-host redesign.

- [ ] **Run the normal repository gate once on the integrated tree.**
```text
npm test
```
Expected: PASS with zero failures. The planning baseline of 103 passing tests on the supplied 2.2.2 snapshot is historical context only, not post-implementation evidence.

- [ ] **Run the Windows package gate once on the integrated tree if Task 3 review/fixes touched release/runtime/distribution behavior after its earlier package run.**
```text
npm run package:windows
```
Expected: PASS and verified 2.3.0 archive/checksum outputs.

Do not mechanically rerun every focused Task command again when nothing relevant changed after that Task's passing boundary gate. Rerun the smallest affected focused tests after review fixes, then the repository/package gate as appropriate.

### Required real Windows smoke

Automated/static tests are not sufficient for installer/tray behavior. On a disposable/test Windows installation, validate both preparation branches:

**Upgrade/reuse path:**
```text
install/use released 2.2.2 with its app-owned Node 22.23.1
create/retain representative observations, treatment event, settings, backup, and unfinished browser draft
upgrade to 2.3.0
confirm installer reuses the existing private runtime path successfully
confirm DB/history/settings/backups/treatment/draft still exist
launch in Edge app mode
save a check-in
close/reopen
confirm tray/reminder controls still work
```
**Fallback path:**
```text
clean install (or disposable install without a reusable exact private runtime)
confirm installer follows the existing official Node 22.23.1 download + SHA-256 verification path
confirm resulting private runtime launches the app
```
**Updater handoff smoke:**

Exercise the staged-update path with a controlled/test candidate or once an authorized GitHub release exists:
```text
candidate discovered
Update clicked
verified staging completes before current app is stopped
tray launches only staged MedCheckin2\INSTALL.bat
installer completes and relaunches
local data/draft preserved
```
Do not publish/tag/create a GitHub release merely to satisfy this smoke without separate user authorization. If live-release evidence is unavailable, report the end-to-end GitHub portion as release/environment-owned rather than pretending local fake-network tests prove it.

### CI-owned evidence

Canonical GitHub Actions remains:
```text
windows-latest
Node 22.23.1
npm ci --ignore-scripts
npm test
npm run package:windows
```
If no authorized push/PR has run CI yet, report this as pending CI-owned evidence.

---

## Explicit Non-goals / Stop Conditions

Stop/escalate rather than widening scope if implementation appears to require:

- user-defined core scales or generic custom fields;
- deleting tracked definitions or rewriting historical observation IDs;
- portable JSON Merge semantics;
- a general legacy CSV importer;
- bundling the approved one-off legacy v1 CSV retrofit into the 2.3 product implementation; that remains a separate job;
- cloud sync/accounts/remote hosting;
- a third-party updater framework or new Windows background service;
- GitHub authentication, multiple channels, prerelease channel, delta updates, or rollback orchestration;
- replacing the tray host or Edge shell architecture;
- arbitrary system/PATH Node reuse;
- removing SHA-256 verification;
- deleting/recreating `%LOCALAPPDATA%\MedCheckin2` as part of update;
- unrelated dependency upgrades or installer refactors;
- repository behavior that materially contradicts the approved design/invariants. Return evidence to the primary/human instead of selecting a new product contract locally.

## Execution Orchestration

Apply `.codex/ORCHESTRATION.md` and `.codex/PROJECT.md`. The numbered Tasks above are deliberately aligned with coherent review/ownership boundaries so the primary does not need to invent finer-grained task agents.

### Repository map freshness

**Status:** `fresh-enough`

**Evidence observed 2026-08-09 from the supplied 2.2.2 source:**

- approved design: `docs/superpowers/specs/2026-08-09-med-checkin-2.3-design.md`;
- authority: `AGENTS.md`, `.codex/PROJECT.md`, `.codex/PLANNING_HANDOFF.md`, `.codex/ORCHESTRATION.md`;
- manifest/CI: `package.json`, `.github/workflows/windows-ci.yml`;
- persistence: `backend/domain.mjs`, `schema.mjs`, `migrations.mjs`, `repository.mjs`, `data-maintenance.mjs`, `treatment.mjs` and focused tests;
- browser: `resources/index.html`, `app.js`, `styles.css`, `vendor/chart-lite.js` and frontend/analytics tests;
- runtime/update handoff: `backend/main.mjs`, `http-server.mjs`, `host-actions.mjs`, `windows/tray-host.ps1`;
- distribution: `windows/install.ps1`, `scripts/package-windows.mjs`, `scripts/verify-release.mjs`, `test/package-layout.test.mjs`;
- baseline supplied snapshot: `npm test` -> **103 passed, 0 failed**.

**Explorer guidance:** skip a broad `terra_explorer` pass at implementation start when the worktree still matches this snapshot closely. Use focused exploration only if the implementation branch has drifted, an owning file has materially changed, or a concrete runtime/Windows edge is not mapped by this plan.

### Candidate ownership boundaries

1. **Task 1: persistence + migration + portable integrity**
   - likely role: Terra workhorse;
   - stop/escalate on any need to rewrite observation history, alter treatment semantics, add Merge behavior, or make reminder state portable;
   - exceptional-risk review candidate: migration/Replace/restore data integrity.

2. **Task 2: tracked-item browser/API + trend presentation**
   - likely role: Luna when interfaces are stable; Terra workhorse if draft/edit integration needs broader repository judgment;
   - stop/escalate on custom-scale or generic-form redesign;
   - ordinary review expected.

3. **Task 3: updater + runtime + Windows distribution**
   - likely role: Terra workhorse;
   - stop/escalate if implementation requires arbitrary executable authority, system Node, silent updating, new background service, or destructive data/profile replacement;
   - exceptional-risk review candidate: verified download/extraction/installer handoff and pre-stop replacement safety.

The primary owns integration of sequential edits to shared files such as `backend/http-server.mjs`, `resources/app.js`, and release metadata.

### Review routing

- Review **once after each numbered Task**, not after its internal checkbox steps.
- Use the executor's normal final whole-branch review once after integration; do not add a second duplicate final review.
- Terra vs Sol remains conditional on the actual diff. Sol is not mandatory merely because Task 1 or Task 3 was expected to be risky.
- If Task 1/3 contains the expected exceptional-risk code, the primary may route the task review or a narrow exceptional-risk slice to Sol according to runtime/reviewer capabilities; avoid doing both a redundant full Terra review and full Sol review of the same unchanged diff solely for ceremony.

### Validation ownership

- Task owner runs its focused boundary gate before returning work.
- Primary runs `npm test` on the integrated tree and `npm run package:windows` when release/distribution changes are integrated/fixed.
- GitHub Actions evidence remains CI-owned until an authorized push/PR runs it.
- Primary coordinates the real Windows upgrade/reuse/fallback/updater smoke; it must not infer shell behavior from static tests alone.
