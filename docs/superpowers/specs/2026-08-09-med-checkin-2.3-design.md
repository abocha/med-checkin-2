# Med Check-in 2.3 Design Brief

**Status:** Approved scope for implementation planning  
**Date:** 2026-08-09  
**Target:** Med Check-in 2.3  
**Scope:** Personal-use Windows application, one local data store

## Purpose

Med Check-in 2.3 makes the application easier to maintain across installations and more configurable without turning it into a generalized health platform.

The release has two main themes:

1. move user-specific tracked flags out of hardcoded application definitions;
2. make upgrades substantially easier and cheaper by adding GitHub-based update checks and reusing the app-owned Node runtime when possible.

It also closes a small distribution correctness bug left after 2.2.2 and picks up one modest analytics/UI deferral from 2.2.

## In scope

### 1. User-configurable tracked items

Make these existing tracked-item groups configurable:

- Context;
- Symptoms;
- Activation.

The implementation should preserve the current meaning of historical observations. Existing saved item IDs must remain interpretable after labels or active selections change.

Use stable item identity and a small definition model with, at minimum, the concepts of:

```text
id
category
label
active
sortOrder
```

Exact storage shape is an implementation-design decision, but the behavior must support:

- adding a new item;
- renaming an item without rewriting historical observations;
- reordering items;
- hiding/archiving an item from new-entry forms while preserving historical display;
- retaining the built-in 2.2.x items when upgrading an existing database.

Do not implement destructive deletion semantics that make old observations unintelligible.

The three categories remain semantically distinct. This is customization of the existing flag groups, not a generic arbitrary-form builder.

### 2. Custom scales remain deferred

The eight core 0-10 scales remain the fixed scheduled-observation model in 2.3.

Do **not** make the scale set user-configurable in this release. Those scales are schema fields and participate in required scheduled validation, history, analytics, smoothing, and completion behavior, so custom scales require a separate design rather than being bundled with configurable flags.

### 3. Remove the personal treatment seed from clean installations

A new installation must no longer receive a hardcoded personal treatment history.

Expected behavior:

```text
fresh database
-> no treatment events
-> UI shows the existing neutral/no-treatment state
```

Existing installations must keep their current treatment history unchanged.

This is a distribution correctness fix, not a redesign of treatment management.

### 4. Periodic GitHub update checks

Med Check-in should periodically check the official GitHub repository for a newer released version.

The application may perform the version check automatically at a modest interval, with roughly once per day as the intended behavior. The exact scheduling mechanism should fit the existing local runtime and should not require a new background service.

When a newer compatible release is available, the UI should make that visible and offer an explicit update action. Installation itself must remain user-confirmed.

Intended flow:

```text
periodic version check
-> newer release found
-> show available version and release notes/summary
-> user chooses Update
-> download the official release artifact
-> verify the expected artifact/integrity metadata
-> stop/restart through the existing installer lifecycle
-> preserve application data and browser drafts
-> launch the updated application
```

Also provide a manual **Check for updates** action and show the installed version / update state in an About or equivalent small settings surface.

The updater must use only the project's official GitHub release source. It must not send check-in, treatment, or other personal application data with update requests.

README/privacy wording must be updated to distinguish this intentional GitHub update traffic from medical-data handling.

Do not build silent unattended installation, a general updater framework, release channels, delta patching, or rollback orchestration in 2.3.

### 5. Reuse the private Node runtime on upgrade

The installer currently downloads the pinned Node runtime when preparing every installation. Change this so an upgrade can reuse the existing Med Check-in-owned runtime when it exactly matches the required pinned Node version and passes the required local validation.

Intended decision:

```text
existing Med Check-in private runtime exists
and matches the required pinned version
and is usable
    -> reuse/copy it into the prepared application
otherwise
    -> download the official pinned Node archive
       and retain SHA-256 verification
```

Do not use an arbitrary `node.exe` from `PATH` or another application installation. Med Check-in continues to own a predictable private runtime.

A Node-version bump naturally falls back to the normal verified download path.

The existing safety property remains: installation preparation completes before the installed application directory is replaced.

### 6. Trend-chart metric toggles

Expose all eight existing core scales as selectable series in the trend chart while keeping a sensible, uncluttered default selection.

This is a presentation/control improvement only. It must not change scale storage, scheduled validation, daily aggregation, trailing smoothing, or completion calculations.

### 7. Deferred 2.2.x fixes discovered during implementation

Small correctness or reliability fixes directly exposed by the work above may be included when they are clearly within the touched subsystem and can be covered proportionately.

Do not use this clause for opportunistic refactoring or unrelated backlog cleanup.

## Separate one-off job: legacy v1 CSV retrofit

The supplied legacy v1 CSV should be retrofitted, but this is **not** a general 2.3 product import feature.

Preferred approach:

1. take the user's current Med Check-in portable JSON export plus the legacy CSV;
2. convert legacy rows into current-format observations using the known v1 semantics;
3. detect and report conflicts/ambiguities rather than guessing;
4. resolve the small ambiguous set explicitly;
5. produce one valid current-format JSON dataset;
6. use the application's existing validated **Replace** import path, including its pre-import SQLite backup.

The supplied CSV contains duplicate same-date legacy Evening-slot rows, so a blind generic v1 importer would not map cleanly onto the current one-Day/one-Evening-per-date invariant.

This retrofit may be done before or after the 2.3 implementation, but it should be planned/executed independently from the release.

## Explicitly out of scope

2.3 does not include:

- user-defined core scales;
- a general v1 CSV import UI;
- JSON Merge import;
- synchronization or conflict resolution;
- cloud sync, accounts, sharing, or remote hosting;
- generic treatment-event comparison analytics;
- causal/significance/statistical analysis;
- silent/unattended updates;
- multiple update channels;
- binary/delta patching;
- arbitrary system Node reuse;
- WebView2 or browser-shell replacement;
- tray-host rewrite;
- broad installer architecture rewrite;
- unrelated refactors.

## Data and upgrade invariants

A 2.2.2 -> 2.3 upgrade must preserve:

- all observations and their IDs/timestamps;
- treatment history;
- settings and reminder state;
- backups;
- unfinished browser drafts;
- existing Context/Symptom/Activation meaning;
- portable-data safety guarantees;
- the one-user, local-data architecture.

New configurable tracked-item definitions must be seeded from the existing built-in definitions during migration so historical rows remain meaningful without rewriting them.

Update/install failures must not silently destroy the currently usable installation or `%LOCALAPPDATA%\MedCheckin2` data.

## Likely risk areas for implementation planning

The next thread should inspect current source before fixing exact ownership boundaries, but these surfaces deserve particular attention:

- tracked-item schema/migration and historical ID preservation;
- portable JSON compatibility if tracked-item definitions become portable data;
- update-source parsing, release artifact selection, download verification, and restart handoff;
- installer reuse of the existing private Node runtime without weakening preparation/verification safety;
- treatment-seed migration behavior for clean versus existing databases.

Actual `sol_reviewer` routing should follow the resulting diff, especially schema/data-integrity, destructive installer/update behavior, and download/integrity logic.

## Validation expectations

Implementation planning should discover and use the current repository commands through `AGENTS.md` and `.codex/PROJECT.md`.

At minimum, meaningful 2.3 work is expected to require:

```text
focused subsystem tests
npm test
npm run package:windows
```

Update/installer behavior also requires a real Windows upgrade smoke test from the previous released version, including preservation of existing data and drafts.

Update checks should be testable without depending on live GitHub during the normal automated test suite.

## Planning handoff

The next thread should use this file as the approved 2.3 scope, inspect the supplied/current source, and turn it into an implementation plan following:

- `AGENTS.md`;
- `.codex/PROJECT.md`;
- `.codex/PLANNING_HANDOFF.md` when available;
- `.codex/ORCHESTRATION.md` for later Codex execution.

The implementation plan should be detailed for the primary orchestrator but group delegated work by coherent ownership boundary rather than one child per numbered section. It should identify whether repository exploration is genuinely required, candidate Luna/Terra boundaries, concrete exceptional-risk review surfaces, and manual/CI validation ownership.
