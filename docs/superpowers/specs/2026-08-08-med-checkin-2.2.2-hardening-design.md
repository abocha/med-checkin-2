# Med Check-in 2.2.2 Distribution Hardening Design

Date: 2026-08-08
Status: approved design, pending implementation planning
Target: Med Check-in 2.2.2

## Purpose

Med Check-in 2.2.2 is a narrow maintenance release that makes the existing 2.2.1 application cleaner and safer to distribute to another user without expanding product scope.

The release addresses three concrete issues found while validating 2.2.1 for a second user:

1. the dedicated Microsoft Edge profile can grow to hundreds of megabytes because Edge provisions unrelated browser components and caches;
2. the static HTML contains a user-specific medication regimen before bootstrap replaces it;
3. existing privacy wording overstates the absence of network activity because the Edge shell can perform its own background/component networking.

The release must remain a small hardening patch rather than a bridge into 2.3 customization work.

## Scope

### In scope

- Harden the dedicated Edge launch arguments so the app-mode instance behaves more like a local application shell and less like a general browser.
- Reclaim known disposable Edge-profile bloat during install/upgrade using a strict allowlist.
- Preserve all application data and browser state not explicitly classified as disposable.
- Remove user-specific treatment text from the static HTML.
- Correct README/privacy wording so it accurately describes local application data and the dedicated Edge shell.
- Update version/package metadata from 2.2.1 to 2.2.2.
- Add focused regression coverage for the changed behavior.

### Explicitly out of scope

- custom symptoms, context items, activation items, or scales;
- schema migrations or portable-format changes;
- API contract changes;
- new settings or reminder behavior;
- onboarding redesign;
- treatment-management redesign;
- analytics redesign;
- moving drafts from browser storage into the backend;
- WebView2 or another browser-shell migration;
- new dependencies;
- cross-platform work;
- auto-update work;
- unrelated refactors or cleanup.

2.3 is expected to address user-configurable tracked-item definitions. 2.2.2 must not pre-implement that design.

## Invariants

The following must survive an upgrade from 2.2.1 unchanged:

- `%LOCALAPPDATA%\MedCheckin2\med-check-in.sqlite`;
- backups;
- treatment history;
- application settings;
- reminder state;
- saved observations;
- unfinished browser drafts.

The installer must not treat Edge-profile cleanup failure as an installation failure.

Unknown Edge-profile paths must be preserved by default.

No 2.2.2 change may alter the database schema, portable export/import format, or existing API behavior.

## Edge launch policy

Keep the current dedicated-profile/app-mode launch architecture.

Retain the existing arguments:

```text
--app=<local-url>
--user-data-dir=<MedCheckin2 edge-profile>
--no-first-run
--disable-sync
--disable-background-mode
--window-size=1040,900
```

Add:

```text
--disable-background-networking
--disable-component-update
--no-default-browser-check
```

Do not add a large collection of Edge-specific or undocumented feature flags. In particular, `--disable-default-apps`, `--disable-extensions`, disk-cache size tuning, and broad `--disable-features` lists are not required for 2.2.2 unless repository exploration finds a concrete existing dependency that changes this conclusion.

The goal is to suppress the observed sources of background component provisioning without turning the launcher into a fragile Chromium policy layer.

## Edge-profile cleanup policy

Cleanup runs during install/upgrade after the installer has stopped the dedicated Med Check-in Edge processes and before the new app instance is started.

Cleanup is strict allowlist-based. Anything not explicitly listed is left alone.

### Root-level disposable paths

Delete these paths when present:

```text
component_crx_cache
ProvenanceData
ProvenanceDataTensors
BrowserMetrics
GrShaderCache
ShaderCache
GPUPersistentCache
```

The first two are the primary observed offenders: approximately 199 MB and 169 MB respectively in a 2.2.1 profile.

### `Default` disposable paths

Delete these paths when present:

```text
Default\Cache
Default\Code Cache
Default\GPUCache
Default\DawnWebGPUCache
Default\DawnGraphiteCache
```

Do not expand this list merely because another Edge component looks unnecessary. The purpose is to reclaim material, clearly disposable bloat, not to maintain an exhaustive Chromium cleanup catalog.

### Protected state

The cleanup implementation must never target:

```text
Default\Local Storage
Default\Storage
Default\WebStorage
Default\Session Storage
Default\Preferences
Default\Secure Preferences
Default\Network
```

`Default\Local Storage` is especially important because Med Check-in stores unfinished check-in drafts there.

Application data paths such as `med-check-in.sqlite` and `backups` are outside `edge-profile` and must never participate in cleanup.

### Path safety

Before recursive deletion, each candidate path must be resolved and verified to be a descendant of the configured `edge-profile` directory.

The implementation should represent cleanup paths in one explicit, reviewable allowlist or equivalent isolated structure rather than scattering unrelated `Remove-Item` calls through the installer.

### Failure behavior

Each cleanup deletion is best-effort.

A locked file, changed Edge profile layout, access error, or other cleanup failure must not abort installation. The implementation may record a warning using existing diagnostics/logging facilities, but 2.2.2 must not introduce a new cleanup logging subsystem.

## Static treatment placeholder

The shipped HTML must not contain a real user's medication regimen.

Replace the current hard-coded treatment text with a neutral initial value such as:

```text
Лечение не указано
```

Existing bootstrap behavior remains authoritative and replaces the label when treatment data exists.

No treatment data model or UI redesign is part of this change.

## Privacy and README wording

Documentation must distinguish the local Med Check-in application from the Microsoft Edge shell.

The README should state, in substance:

- Med Check-in stores its database and backups locally on the computer.
- The Med Check-in backend does not send check-in or treatment data to an external service.
- The interface runs in a dedicated Edge app-mode profile.
- That Edge instance is launched with background networking and component updates disabled to minimize unrelated browser activity.

Do not claim that absolutely no network access can ever occur. Edge is external software and the project should make precise claims about Med Check-in's own data handling rather than stronger claims it cannot guarantee.

## Version and release metadata

Update all existing 2.2.1 release/version references through the repository's established release process to 2.2.2.

Use the current packaging and verification patterns rather than creating a new version source of truth.

## Testing and validation

Add focused regression coverage that verifies behavior rather than merely checking formatting.

Required coverage:

1. `windows/tray-host.ps1` retains the existing dedicated app/profile arguments and includes:
   - `--disable-background-networking`;
   - `--disable-component-update`;
   - `--no-default-browser-check`.
2. The installer cleanup targets the approved allowlist only.
3. Cleanup candidates are constrained beneath `edge-profile` before recursive deletion.
4. Cleanup is non-fatal when a candidate cannot be deleted.
5. `Default\Local Storage` is not a cleanup target.
6. `med-check-in.sqlite` and `backups` are not cleanup targets.
7. Static packaged HTML does not contain the previous user-specific medication names/regimen.
8. Release metadata consistently targets 2.2.2.

Do not build a large simulated Chromium profile framework unless existing test patterns make that simpler than focused source/behavior tests.

Run the repository's normal validation gates discovered from the manifest and CI. At design time those are expected to include:

```text
npm test
npm run package:windows
```

A final Windows smoke test should cover:

```text
install or upgrade
→ launch
→ existing data present
→ unfinished draft restoration still works
→ save a check-in
→ close and reopen
→ tray/reminder behavior still works
```

For an existing bloated 2.2.1 profile, upgrading to 2.2.2 should materially reduce its size by removing the approved disposable directories. No exact profile-size ceiling is required because Edge versions differ.

## Acceptance criteria

2.2.2 is complete when:

- existing Med Check-in data and drafts survive upgrade;
- known large Edge-profile artifacts are reclaimed on a best-effort basis;
- the dedicated Edge process is launched with the approved background/component suppression flags;
- static UI contains no user-specific medication regimen;
- README privacy/network wording is accurate and scoped to what the project controls;
- version/package metadata consistently reports 2.2.2;
- focused regression tests pass;
- `npm test` passes;
- `npm run package:windows` passes;
- the Windows smoke test succeeds.

## Codex role guidance

Implementation planning should follow the repository `AGENTS.md` role boundaries and use the smallest useful role set.

Expected split:

- `terra_explorer`: one read-only pass to confirm exact owning files, current patterns, and test locations before edits.
- `terra_workhorse`: Edge launch and installer cleanup implementation plus the associated integration-focused tests.
- `luna_implementer`: mechanical low-risk edits such as the neutral treatment placeholder, README/version metadata, and straightforward release tests.
- `terra_reviewer`: review the coherent finished 2.2.2 batch for correctness, installer regression, packaging consistency, and missing tests.
- `sol_reviewer`: one narrow review of recursive deletion/path containment/data-preservation logic because that portion carries disproportionate data-integrity risk.

Do not use Sol for mechanical version bumps or prose edits. Do not multiply agents per file or checklist item.
