# Med Check-in Project Orchestration Adapter

This file contains repository-specific facts used by the portable orchestration workflow.

It is intentionally tracked even though the rest of `.codex/` is normally shared from
`abocha/codex-workflow` and ignored. Keep this adapter concise and current. If it conflicts with
`AGENTS.md` or a more-specific nested instruction file, the active instruction chain wins.

## Repository shape

Med Check-in is a single-user local Windows application.

- Runtime: Node.js 22.23.1, ESM, built-in `node:sqlite` / `DatabaseSync`.
- UI: static browser application under `resources/`.
- Desktop shell: Windows PowerShell tray host plus Microsoft Edge app mode with a dedicated profile.
- Backend: local HTTP server on `127.0.0.1`, protected by a random bearer token stored in local runtime state.
- Install directory: `%LOCALAPPDATA%\Programs\MedCheckin2`.
- Persistent data directory: `%LOCALAPPDATA%\MedCheckin2`.
- Primary database: `%LOCALAPPDATA%\MedCheckin2\med-checkin.sqlite`.
- Backups: `%LOCALAPPDATA%\MedCheckin2\backups`.
- Browser drafts live in the dedicated Edge profile, including `edge-profile\Default\Local Storage`.
- There is no cloud sync or application telemetry.

Do not introduce cloud sync, cross-platform packaging, a different desktop shell, Merge import,
identity redesign, or broad architecture changes unless an approved plan explicitly includes them.

## Canonical documentation

Use the smallest route that answers the task.

- Repository operating policy: `AGENTS.md`.
- Product behavior, installation, data location, privacy, restore/import behavior, and current release notes: `README.txt`.
- Supported commands and package version: `package.json`.
- Canonical CI sequence and Node version: `.github/workflows/windows-ci.yml`.
- Release contents and archive verification: `scripts/package-windows.mjs`, `scripts/verify-release.mjs`, and `test/package-layout.test.mjs`.
- Persistent-data contracts: `backend/domain.mjs`, `backend/schema.mjs`, `backend/migrations.mjs`, `backend/repository.mjs`, `backend/treatment.mjs`, plus their corresponding tests.
- Backup, restore, and portable Replace import: `backend/backups.mjs`, `backend/data-maintenance.mjs`, `test/backups.test.mjs`, `test/backup-smoke.test.mjs`, `test/data-maintenance.test.mjs`.
- Local HTTP/runtime behavior: `backend/main.mjs`, `backend/http-server.mjs`, `backend/reminders.mjs`, `backend/host-actions.mjs`, `backend/supervisor.mjs`, `backend/process-safety.mjs`, plus corresponding tests.
- Browser UI and draft behavior: `resources/index.html`, `resources/app.js`, `resources/draft-store.js`, `resources/startup-runtime.js`, `test/frontend-smoke.test.mjs`, `test/draft-store.test.mjs`, `test/startup-runtime.test.mjs`.
- Windows install/tray/uninstall behavior: `windows/install.ps1`, `windows/tray-host.ps1`, `windows/uninstall.ps1`, and `test/package-layout.test.mjs`.

There is no separate repository-wide architecture SSOT. Do not spend time searching for one.
Inspect the owning module and its focused tests instead.

Files under `docs/superpowers/specs/` and `docs/superpowers/plans/` are change-specific design and
implementation artifacts. Treat an explicitly active approved plan as the task contract, but do not
assume older plans override current code, `README.txt`, manifests, CI, or `AGENTS.md`.

## Supported commands

Discover exact targeted files from `test/`; do not invent lint, type-check, or other gates that are
not present in the manifest or CI.

### Narrow / focused validation

For a single subsystem or regression file:

```text
node --test --test-concurrency=1 test/<relevant>.test.mjs
```

Common examples:

```text
node --test --test-concurrency=1 test/data-maintenance.test.mjs
node --test --test-concurrency=1 test/frontend-smoke.test.mjs
node --test --test-concurrency=1 test/package-layout.test.mjs
```

### Normal repository gate

```text
npm test
```

This runs the full Node test suite serially.

### Build / packaging

```text
npm run package:windows
```

The packaging command also runs release-archive verification.

### Canonical CI-owned checks

GitHub Actions runs on `windows-latest` with Node 22.23.1:

```text
npm ci --ignore-scripts
npm test
npm run package:windows
```

For release/distribution changes, treat the Windows CI environment as important evidence even when a
local package build also succeeds.

## Current product and data contracts

These are current behavior, not permission to redesign them silently.

- Scheduled observations are semantic `day` and `evening` entries; Extra observations use
  `kind = "extra"` and `period = null`.
- Scheduled observations require all eight primary scales. Extra observations may contain a meaningful
  subset but may not be empty.
- Reminder times are configurable, while Day/Evening identity remains semantic rather than being the
  literal configured clock time.
- Treatment history stores complete regimen snapshots at each effective change.
- SQLite schema compatibility is migration-controlled; backup/restore validation must reject incomplete
  or newer incompatible schemas before replacing live data.
- Portable JSON uses the `med-checkin-2` versioned format and supports explicit Replace import only.
  It does not provide Merge import.
- Restore and Replace import create recoverable pre-operation SQLite backups before destructive replacement.
- Reminder transient state remains local and is not replaced by portable import.
- Browser drafts are local state and must survive ordinary application upgrades.

When a change intentionally alters one of these contracts, update this adapter if the fact remains
useful to future orchestration.

## Common ownership boundaries

These are likely coherent delegation boundaries, not mandatory agent-per-section assignments.

### Domain, schema, and repository persistence

Likely files:

- `backend/domain.mjs`
- `backend/schema.mjs`
- `backend/migrations.mjs`
- `backend/repository.mjs`
- `backend/treatment.mjs`
- corresponding `test/*.test.mjs`

Important contracts: semantic Day/Evening/Extra identity, validation rules, SQLite schema,
migrations, timestamps, treatment snapshots, and repository writes.

### Backup, restore, and portable data lifecycle

Likely files:

- `backend/backups.mjs`
- `backend/data-maintenance.mjs`
- related HTTP routes in `backend/http-server.mjs`
- `test/backups.test.mjs`
- `test/backup-smoke.test.mjs`
- `test/data-maintenance.test.mjs`

Important contracts: validation before replacement, pre-operation backups, rollback/recovery,
portable-format compatibility, and preservation of local-only state.

### Browser UI, drafts, and analytics presentation

Likely files:

- `resources/index.html`
- `resources/app.js`
- `resources/draft-store.js`
- `resources/startup-runtime.js`
- `resources/styles.css`
- `backend/analytics.mjs` when calculations change
- frontend/draft/analytics tests

Important contracts: browser draft recovery, bearer-token startup handoff, semantic forms/history,
and keeping static shipped HTML free of user-specific data.

### Local runtime, reminders, and process supervision

Likely files:

- `backend/main.mjs`
- `backend/http-server.mjs`
- `backend/reminders.mjs`
- `backend/host-actions.mjs`
- `backend/supervisor.mjs`
- `backend/process-safety.mjs`
- `windows/tray-host.ps1`
- corresponding runtime/reminder/process tests

Important contracts: loopback-only API, bearer-token authorization, owned-process termination,
tray heartbeat, scheduled reminder semantics, and quit/restart behavior.

### Windows distribution and release mechanics

Likely files:

- `windows/install.ps1`
- `windows/install.bat`
- `windows/launch-hidden.vbs`
- `windows/tray-host.ps1`
- `windows/uninstall.ps1`
- `scripts/package-windows.mjs`
- `scripts/verify-release.mjs`
- `package.json`
- `package-lock.json`
- `README.txt`
- `test/package-layout.test.mjs`

Important contracts: pinned and SHA-256-verified Node runtime, clean replacement of installed app
files, preservation of `%LOCALAPPDATA%\MedCheckin2`, scheduled-task registration, dedicated Edge
profile handling, archive contents, bootstrap encoding/line-ending requirements, and consistent
release metadata.

## Exceptional-risk surfaces

Use narrow `sol_reviewer` review when the actual diff touches a concrete high-consequence surface,
not merely because these files exist.

- SQLite schema changes, migrations, repository write semantics, identity/timestamp preservation,
  treatment persistence, or compatibility rules.
- Backup validation, restore, portable Replace import, rollback, WAL/SHM handling, or any operation
  capable of replacing the live database.
- Recursive deletion, installer/uninstaller cleanup, path-containment logic, or anything that could
  remove `%LOCALAPPDATA%\MedCheckin2` or browser draft storage.
- Changes to local bearer-token handling, loopback binding, runtime token exposure/removal, fixed host
  actions, or other security/privacy boundaries.
- Process ownership, supervisor/watchdog behavior, tray/backend coordination, retry/idempotency, or
  concurrency where a mistake could kill unrelated processes or corrupt state.
- Release installer download/integrity verification or similarly high-consequence distribution logic.

## Manual or environment validation

Automated tests are necessary but not sufficient for Windows shell/distribution behavior.

### Installer, tray, Edge, or release changes

When these surfaces change and the plan calls for release-level confidence, use a real Windows smoke
check after automated validation:

```text
install or upgrade from the previous released build
-> existing SQLite data/backups/settings/treatment history still present
-> unfinished browser draft still recoverable when relevant
-> application launches in Edge app mode
-> save a check-in
-> close and reopen
-> tray/reminder controls still work
```

If scheduled-task, logon, watchdog, snooze/dismiss, or quit/restart behavior changed, exercise the
specific affected Windows behavior rather than inferring it from packaging success.

### Persistence, restore, or import changes

Use synthetic or temporary databases and temporary directories for destructive tests. Never point a
test or experiment at the real `%LOCALAPPDATA%\MedCheckin2` database or backups.

Validate both the success path and failure/recovery path when replacement, migration, or rollback
behavior changes.

### CI/environment ownership

The canonical hosted gate is Windows GitHub Actions. If it has not run yet, report that validation as
CI-owned rather than claiming it from local evidence.

## Mutation and release constraints

These mirror repository policy and exist here so orchestration does not guess.

- Local code/test edits: authorized by an explicit implementation request within its approved scope.
- Commits: require explicit user authorization, including plan-specific commit authorization.
- Branch creation: requires explicit user authorization.
- Push / PR creation: requires explicit user authorization.
- Release / tag / deployment: requires explicit user authorization.
- Dependency additions/upgrades or intentional lockfile rewrites: only when required by the approved
  change and their impact is clear.
- Destructive or difficult-to-reverse actions: resolve exact targets first and ask before performing
  them unless the approved request explicitly authorizes that exact action.
- Removing application data is never implied by uninstall/update work. Normal uninstall/update must
  preserve `%LOCALAPPDATA%\MedCheckin2`; full data removal requires explicit direction.

## Notes for the primary orchestrator

- Preserve unrelated worktree changes and local generated artifacts.
- Treat an approved implementation plan as the scope and acceptance contract.
- Prefer the smallest useful delegated role set and group adjacent tasks by coherent ownership boundary.
- Skip redundant `terra_explorer` work when the active plan already contains a fresh exact map of the
  relevant files, contracts, tests, and commands.
- Give delegated workers bounded deliverables, acceptance criteria, validation, and stop conditions;
  do not replay every parent-plan micro-step unless the risk genuinely requires it.
- Child validation does not replace primary integration. Run `npm test` for meaningful shared or
  cross-cutting changes and `npm run package:windows` when release/distribution behavior is in scope.
- Use `terra_reviewer` for ordinary coherent implementation review. Add `sol_reviewer` only for a
  concrete exceptional-risk surface in the actual diff.
- Do not infer success from stale test output or a previous package build.
