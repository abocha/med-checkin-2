# Med Check-in 2.2.2 Distribution Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Med Check-in 2.2.2 as a narrow distribution-hardening patch that suppresses unnecessary Edge background/component activity, safely reclaims known Edge-profile bloat, removes user-specific treatment text from static UI, and corrects release/privacy metadata without changing application data contracts.

**Architecture:** Keep the existing Node.js + SQLite backend, PowerShell tray host, dedicated Edge app-mode profile, installer, and packaging flow unchanged. Add only three Edge launch switches, an installer-local allowlisted cleanup routine that runs after the dedicated Edge instance is stopped, and mechanical UI/docs/version updates. Cleanup is lexically constrained beneath `%LOCALAPPDATA%\MedCheckin2\edge-profile`, preserves unknown profile state by default, and treats each deletion failure as non-fatal.

**Tech Stack:** Node.js 22.23.1, Node built-in test runner, Windows PowerShell 5.1, Microsoft Edge app mode, SQLite, existing ZIP packaging/verifier scripts.

## Global Constraints

- Follow root `AGENTS.md` and any more-specific instruction file discovered for a touched path.
- Read `docs/superpowers/specs/2026-08-08-med-checkin-2.2.2-hardening-design.md` before editing; it is the scope and acceptance contract.
- Do not add or upgrade dependencies.
- Do not change database schema, migrations, portable JSON format, API contracts, reminder behavior, tracked fields, or user settings.
- Do not move drafts out of browser storage.
- Do not add `--disable-default-apps`, `--disable-extensions`, disk-cache size tuning, broad `--disable-features` lists, or unrelated Edge flags.
- Do not expand the cleanup allowlist merely because another Edge directory appears unnecessary.
- Preserve `%LOCALAPPDATA%\MedCheckin2\med-check-in.sqlite`, backups, treatment history, settings, reminder state, observations, and unfinished browser drafts.
- Unknown Edge-profile paths are preserved by default.
- Edge cleanup failures must never fail the installation.
- Windows bootstrap files must remain ASCII-safe with CRLF line endings; `windows/tray-host.ps1` must remain UTF-8 with BOM, matching existing repository checks.
- Do not create a new logging subsystem or perform unrelated refactors.
- Use frequent focused commits; do not combine unrelated implementation tasks.

## Execution Model and Agent Roles

Before Task 1, the primary Codex agent should inspect repository status and re-read `AGENTS.md`, then delegate one bounded read-only pass to `terra_explorer`:

> Trace the current Edge launch path, installer stop/install order, package-layout regression tests, static treatment placeholder, privacy README wording, and version/release constants for Med Check-in 2.2.2. Confirm the exact owning files and any nested `AGENTS.md`/`AGENTS.override.md`. Do not choose new architecture or edit files. Report only evidence that changes the approved plan or confirms the file map.

Expected implementation split:

- Tasks 1-2: `terra_workhorse`, because they modify Windows process/filesystem behavior and need integration judgment.
- Task 3: `luna_implementer`, because it is mechanical UI/docs/version work with explicit acceptance criteria.
- Final coherent diff: `terra_reviewer`.
- Recursive deletion/path-containment portion only: `sol_reviewer`.

If exploration discovers a nested instruction file or a repository contract that conflicts with this plan, stop before editing and surface the conflict. Do not silently widen scope.

## File Map

**Modify:**

- `windows/tray-host.ps1` — dedicated Edge launch arguments in `Open-App`.
- `windows/install.ps1` — Edge-profile cleanup allowlist, containment guard, best-effort cleanup function, invocation order, version/diagnostic strings.
- `test/package-layout.test.mjs` — focused regression tests for Edge launch, cleanup safety, static personalization, and 2.2.2 metadata.
- `resources/index.html` — neutral initial treatment label and 2.2.2 document title.
- `README.txt` — 2.2.2 heading plus accurate privacy/network wording.
- `package.json` — version 2.2.2.
- `package-lock.json` — version 2.2.2 in root metadata.
- `scripts/package-windows.mjs` — 2.2.2 package/archive constants.
- `scripts/verify-release.mjs` — 2.2.2 verifier constant.

**Create:** none.

**Do not modify:** backend modules, migrations, schema, draft-store, APIs, analytics, treatment model, reminder logic, CI workflow, uninstall behavior.

---

### Task 1: Harden the dedicated Edge app-mode launch

**Owner:** `terra_workhorse`

**Files:**
- Modify: `windows/tray-host.ps1` in `Open-App`
- Test: `test/package-layout.test.mjs`

**Interfaces:**
- Consumes: existing `$script:EdgeProfile`, `Build-AppUrl`, `Find-Edge`, and `Start-Process` launch flow.
- Produces: the same Edge app-mode invocation plus exactly three new suppression switches: `--disable-background-networking`, `--disable-component-update`, and `--no-default-browser-check`.

- [ ] **Step 1: Add a failing regression test for the dedicated Edge launch contract**

Add this focused test near the existing Windows packaging/launcher tests in `test/package-layout.test.mjs`:

```js
test('dedicated Edge launch suppresses background networking and component provisioning', () => {
  const script = readFileSync(join(root, 'windows/tray-host.ps1'), 'utf8');
  for (const required of [
    '--app=',
    '--user-data-dir=',
    '--no-first-run',
    '--disable-sync',
    '--disable-background-mode',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-default-browser-check'
  ]) {
    assert.match(script, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const excluded of [
    '--disable-default-apps',
    '--disable-extensions',
    '--disk-cache-size',
    '--disable-features'
  ]) {
    assert.doesNotMatch(script, new RegExp(excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
```

- [ ] **Step 2: Run the focused test file and verify the new test fails for the missing switches**

Run:

```bash
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: FAIL in `dedicated Edge launch suppresses background networking and component provisioning`, with at least `--disable-background-networking` missing.

- [ ] **Step 3: Add only the approved launch switches**

In `windows/tray-host.ps1`, keep the current `Open-App` flow and change only the `$arguments` array to include the three new switches:

```powershell
$arguments = @(
  ('--app=' + $url),
  ('--user-data-dir="' + $script:EdgeProfile + '"'),
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-background-mode',
  '--disable-background-networking',
  '--disable-component-update',
  '--window-size=1040,900'
)
```

Do not alter fallback-to-default-browser behavior when Edge is unavailable.

- [ ] **Step 4: Run the focused test file and verify it passes**

Run:

```bash
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Verify PowerShell encoding requirements were preserved**

Run the repository test file above again after any editor/formatter action. The existing `Windows bootstrap scripts are ASCII-safe...` and tray-host BOM checks must remain green.

- [ ] **Step 6: Commit Task 1**

```bash
git add windows/tray-host.ps1 test/package-layout.test.mjs
git commit -m "fix(edge): harden dedicated app-mode launch"
```

---

### Task 2: Reclaim known Edge-profile bloat safely during upgrade

**Owner:** `terra_workhorse`

**Files:**
- Modify: `windows/install.ps1` around data-path constants, `Stop-DedicatedEdge` / `Stop-OldInstance`, and the top-level install sequence
- Test: `test/package-layout.test.mjs`

**Interfaces:**
- Consumes: `$DataDir`, existing `Stop-OldInstance`, existing dedicated Edge stop behavior, and the current top-level order `Prepare-Application -> Stop-OldInstance -> Install-PreparedApplication`.
- Produces: `$EdgeProfileDir`, one explicit `$EdgeCleanupRelativePaths` allowlist, `Test-EdgeCleanupTarget([string]$Path) -> [bool]`, and `Clear-DisposableEdgeProfile` with per-target non-fatal deletion.

The exact cleanup allowlist is:

```text
component_crx_cache
ProvenanceData
ProvenanceDataTensors
BrowserMetrics
GrShaderCache
ShaderCache
GPUPersistentCache
Default\Cache
Default\Code Cache
Default\GPUCache
Default\DawnWebGPUCache
Default\DawnGraphiteCache
```

No other Edge-profile paths belong in 2.2.2.

- [ ] **Step 1: Add failing tests for the cleanup allowlist, protected state, containment guard, failure tolerance, and install order**

Add tests to `test/package-layout.test.mjs` using source inspection, consistent with the existing installer tests:

```js
test('installer Edge cleanup is allowlisted and preserves draft/data paths', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  for (const relative of [
    'component_crx_cache',
    'ProvenanceData',
    'ProvenanceDataTensors',
    'BrowserMetrics',
    'GrShaderCache',
    'ShaderCache',
    'GPUPersistentCache',
    'Default\\Cache',
    'Default\\Code Cache',
    'Default\\GPUCache',
    'Default\\DawnWebGPUCache',
    'Default\\DawnGraphiteCache'
  ]) {
    assert.match(script, new RegExp(relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const protectedPath of [
    'Default\\Local Storage',
    'Default\\Storage',
    'Default\\WebStorage',
    'Default\\Session Storage',
    'med-check-in.sqlite',
    'backups'
  ]) {
    assert.doesNotMatch(script, new RegExp(`EdgeCleanupRelativePaths[\\s\\S]*${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('installer constrains Edge cleanup beneath its dedicated profile and treats deletion failures as non-fatal', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.match(script, /function Test-EdgeCleanupTarget/);
  assert.match(script, /\[IO\.Path\]::GetFullPath/);
  assert.match(script, /StringComparison\]::OrdinalIgnoreCase/);
  assert.match(script, /function Clear-DisposableEdgeProfile/);
  assert.match(script, /foreach \(\$relativePath in \$EdgeCleanupRelativePaths\)/);
  assert.match(script, /Remove-Item.+-Recurse.+-Force.+-ErrorAction Stop/);
  assert.match(script, /catch \{/);
});

test('installer cleans Edge profile only after stopping the old instance and before installing the prepared app', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const stop = script.lastIndexOf('Stop-OldInstance');
  const clean = script.lastIndexOf('Clear-DisposableEdgeProfile');
  const install = script.lastIndexOf('Install-PreparedApplication');
  assert.ok(stop > -1 && clean > stop && install > clean);
});
```

If the first protected-path assertion is too broad because a protected name occurs elsewhere in installer prose, isolate the `$EdgeCleanupRelativePaths` array text first and assert against that slice. Do not weaken the requirement itself.

- [ ] **Step 2: Run the focused test file and verify the cleanup tests fail**

Run:

```bash
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: FAIL because the cleanup symbols and allowlist do not yet exist.

- [ ] **Step 3: Define the dedicated profile path and explicit cleanup allowlist**

Near the existing `$DataDir` constants in `windows/install.ps1`, add ASCII-only PowerShell source:

```powershell
$EdgeProfileDir = Join-Path $DataDir 'edge-profile'
$EdgeCleanupRelativePaths = @(
  'component_crx_cache',
  'ProvenanceData',
  'ProvenanceDataTensors',
  'BrowserMetrics',
  'GrShaderCache',
  'ShaderCache',
  'GPUPersistentCache',
  'Default\Cache',
  'Default\Code Cache',
  'Default\GPUCache',
  'Default\DawnWebGPUCache',
  'Default\DawnGraphiteCache'
)
```

Reuse `$EdgeProfileDir` inside `Stop-DedicatedEdge` instead of constructing a second profile path there.

- [ ] **Step 4: Implement the lexical containment guard**

Add this helper before `Clear-DisposableEdgeProfile`:

```powershell
function Test-EdgeCleanupTarget([string]$Path) {
  try {
    $root = [IO.Path]::GetFullPath($EdgeProfileDir).TrimEnd('\')
    $candidate = [IO.Path]::GetFullPath($Path)
    return $candidate.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}
```

This is deliberately simple because every deletion candidate originates from the fixed relative-path allowlist. Do not introduce native path APIs, junction traversal logic, or generalized filesystem-cleanup abstractions unless the later Sol review identifies a concrete correctness issue.

- [ ] **Step 5: Implement best-effort per-target cleanup**

Add:

```powershell
function Clear-DisposableEdgeProfile {
  if (-not (Test-Path -LiteralPath $EdgeProfileDir)) { return }

  foreach ($relativePath in $EdgeCleanupRelativePaths) {
    $target = Join-Path $EdgeProfileDir $relativePath
    try {
      if (-not (Test-EdgeCleanupTarget $target)) {
        Write-Warning ('Skipping Edge cleanup target outside the dedicated profile: ' + $relativePath)
        continue
      }
      if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
      }
    } catch {
      Write-Warning ('Could not clean Edge profile path ' + $relativePath + ': ' + $_.Exception.Message)
    }
  }
}
```

Keep warnings ASCII-only. Do not call `Write-InstallDiagnostics` from each cleanup failure and do not throw from this function.

- [ ] **Step 6: Invoke cleanup at the only approved lifecycle point**

In the top-level installer `try` block, preserve staging first, then use this order:

```powershell
Write-Step 'Removing the previous application version'
Stop-OldInstance
Write-Step 'Cleaning disposable Edge profile data'
Clear-DisposableEdgeProfile
Write-Step 'Installing the prepared application'
Install-PreparedApplication
```

Do not run cleanup before `Stop-OldInstance`, during normal app startup, or from the uninstaller.

- [ ] **Step 7: Run the focused test file and verify it passes**

Run:

```bash
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: PASS, including existing data-preservation and bootstrap-format tests.

- [ ] **Step 8: Inspect the diff specifically for destructive-path mistakes**

Run:

```bash
git diff -- windows/install.ps1 test/package-layout.test.mjs
```

Verify manually before committing:

- every cleanup entry is relative to `$EdgeProfileDir`;
- there is no `Remove-Item $DataDir -Recurse`;
- there is no wildcard cleanup;
- `Default\Local Storage` is absent from the allowlist;
- each `Remove-Item` failure is caught;
- cleanup runs after `Stop-OldInstance` and before `Install-PreparedApplication`.

- [ ] **Step 9: Commit Task 2**

```bash
git add windows/install.ps1 test/package-layout.test.mjs
git commit -m "fix(installer): reclaim disposable Edge profile data"
```

---

### Task 3: Remove static personalization, correct privacy wording, and prepare 2.2.2 metadata

**Owner:** `luna_implementer`

**Files:**
- Modify: `resources/index.html`
- Modify: `README.txt`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `windows/install.ps1`
- Modify: `scripts/package-windows.mjs`
- Modify: `scripts/verify-release.mjs`
- Test: `test/package-layout.test.mjs`

**Interfaces:**
- Consumes: existing bootstrap behavior that replaces `#medication-label` from `/api/v1/bootstrap`; existing packaging/verifier version constants.
- Produces: neutral static label `Лечение не указано`, accurate privacy/network copy, and consistent release version `2.2.2` everywhere already covered by the current release process.

- [ ] **Step 1: Change the metadata/personalization regression test first**

Update the existing release metadata test in `test/package-layout.test.mjs` from 2.2.1 to 2.2.2 and add assertions that static HTML does not contain the previous personal regimen:

```js
test('release metadata and verifier target Med Check-in 2.2.2 without a personal static regimen', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const packageScript = readFileSync(join(root, 'scripts/package-windows.mjs'), 'utf8');
  const verifierScript = readFileSync(join(root, 'scripts/verify-release.mjs'), 'utf8');
  const ui = readFileSync(join(root, 'resources/index.html'), 'utf8');
  assert.equal(packageJson.version, '2.2.2');
  assert.equal(packageLock.version, '2.2.2');
  assert.equal(packageLock.packages[''].version, '2.2.2');
  assert.match(packageScript, /med-checkin-2\.2\.2-windows-installer\.zip/);
  assert.match(packageScript, /2\.2\.2/);
  assert.match(verifierScript, /2\.2\.2/);
  assert.match(ui, /<title>Med Check-in 2\.2\.2<\/title>/);
  assert.match(ui, /<h1>Med Check-in <span>2\.2<\/span><\/h1>/);
  assert.match(ui, /id="medication-label"[^>]*>Лечение не указано<\/p>/);
  assert.doesNotMatch(ui, /Эсциталопрам/);
  assert.doesNotMatch(ui, /Атомоксетин/);
});
```

Preserve any existing assertions in that test that verify `package:windows`, `VERSION.txt`, and verifier presence.

- [ ] **Step 2: Run the focused test file and verify the version/personalization test fails**

Run:

```bash
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: FAIL because repository metadata still reports 2.2.1 and the static regimen is still present.

- [ ] **Step 3: Update package versions without creating a tag or commit**

Run:

```bash
npm version 2.2.2 --no-git-tag-version
```

Verify it changed only the expected version fields in `package.json` and `package-lock.json`.

- [ ] **Step 4: Update the remaining release constants and static UI**

Make these exact mechanical changes:

- `resources/index.html`: title `Med Check-in 2.2.2`; replace the initial medication label contents with `Лечение не указано`; keep `<h1>Med Check-in <span>2.2</span></h1>` unchanged.
- `scripts/package-windows.mjs`: `VERSION = '2.2.2'` and archive name `med-checkin-2.2.2-windows-installer.zip`.
- `scripts/verify-release.mjs`: `VERSION = '2.2.2'`.
- `windows/install.ps1`: `$AppName = 'Med Check-in 2.2.2'` and installation-diagnostics heading `Med Check-in 2.2.2 installation diagnostics`.
- `README.txt`: heading `MED CHECK-IN 2.2.2`.

Do not rename the existing `Med Check-in 2.2` Start-menu/Desktop shortcut; this is a 2.2 patch release.

- [ ] **Step 5: Replace only the inaccurate README privacy/network claims**

Keep the existing local-data and security details, but replace the claim `После установки приложение не обращается в интернет.` with wording equivalent to this approved text:

```text
Приватность
-----------
База данных и резервные копии Med Check-in хранятся локально на этом компьютере.
Backend слушает только 127.0.0.1, защищён случайным локальным ключом и не отправляет
чек-ины или данные о лечении во внешние сервисы. Облачной синхронизации и телеметрии
у приложения нет.

Интерфейс работает в отдельном профиле Microsoft Edge. Med Check-in запускает этот
экземпляр с отключёнными фоновыми сетевыми запросами и обновлением компонентов, чтобы
минимизировать постороннюю сетевую активность браузера. Проект не обещает абсолютное
отсутствие любой сетевой активности самого Edge, поскольку это внешнее приложение.

Некорректные шкалы, даты, дубликаты плановых записей, пустые Дополнительно,
несовместимые резервные копии и неподходящий JSON отклоняются до изменения данных.
Переустановка приложения не удаляет медицинские записи автоматически.
```

Keep the rest of README structure and product behavior unchanged.

- [ ] **Step 6: Run the focused regression test file**

Run:

```bash
node --test --test-concurrency=1 test/package-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Inspect the release-metadata diff for accidental scope expansion**

Run:

```bash
git diff -- package.json package-lock.json resources/index.html README.txt windows/install.ps1 scripts/package-windows.mjs scripts/verify-release.mjs test/package-layout.test.mjs
```

Verify there are no dependency changes, no generated dependency churn, no UI redesign, and no changed product behavior beyond the approved release metadata/privacy/static-placeholder edits.

- [ ] **Step 8: Commit Task 3**

```bash
git add package.json package-lock.json resources/index.html README.txt windows/install.ps1 scripts/package-windows.mjs scripts/verify-release.mjs test/package-layout.test.mjs
git commit -m "chore(release): prepare Med Check-in 2.2.2"
```

---

### Task 4: Full validation, risk-focused reviews, and Windows smoke test

**Owner:** primary Codex agent

**Files:** no planned production edits; fixes are allowed only for findings within the approved 2.2.2 scope.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: fresh validation evidence, reviewer findings resolved or explicitly accepted, and a release-ready 2.2.2 patch.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS with fresh output. If a failure appears, inspect the first fresh failure before editing; do not rerun unchanged failures without a hypothesis.

- [ ] **Step 2: Build and verify the Windows installer archive**

Run:

```bash
npm run package:windows
```

Expected: PASS and creation of `dist/med-checkin-2.2.2-windows-installer.zip`; the packaging script must invoke `scripts/verify-release.mjs` successfully.

- [ ] **Step 3: Run a coherent `terra_reviewer` review of the complete implementation batch**

Give `terra_reviewer` the approved design/spec and the complete diff. Ask it to report only actionable findings in:

- installer lifecycle/order regressions;
- Edge launch behavior regressions;
- packaging/version inconsistencies;
- missing or misleading tests;
- accidental scope expansion;
- preservation of existing app behavior.

If no actionable findings exist, record that result and the residual manual-test gap.

- [ ] **Step 4: Run one narrow `sol_reviewer` pass on deletion/data-preservation logic**

Limit the review to the cleanup changes in `windows/install.ps1` plus their tests. Ask specifically whether any code path can:

- escape `$EdgeProfileDir`;
- recursively delete application data or browser draft state;
- fail the installer because cleanup fails;
- run cleanup while the dedicated Edge process may still be active;
- broaden deletion beyond the approved allowlist.

Do not ask Sol to review version bumps, README prose, or static HTML unless those files are directly relevant to a finding.

If Sol identifies a concrete path-safety or data-integrity issue, fix it within the existing architecture, rerun the focused tests plus `npm test`, and send the same narrow diff back to `sol_reviewer` for follow-up. Do not respond by building a generalized cleanup framework.

- [ ] **Step 5: Re-run validation after any review-driven code changes**

If review causes edits, run:

```bash
node --test --test-concurrency=1 test/package-layout.test.mjs
npm test
npm run package:windows
```

Expected: all PASS.

- [ ] **Step 6: Perform the upgrade smoke test on Windows with a real 2.2.1 data/profile state**

Use a machine/profile with Med Check-in 2.2.1 installed and existing data. Before upgrade:

1. Confirm history/treatment/settings exist.
2. Create an unfinished check-in draft and allow at least the existing draft debounce interval to elapse.
3. Close the Med Check-in window without explicitly discarding that draft.
4. Record approximate `%LOCALAPPDATA%\MedCheckin2\edge-profile` size and confirm at least one approved cleanup directory exists if testing the reclamation behavior.

Install the freshly built 2.2.2 package over 2.2.1, then verify:

1. installation completes even if a disposable cleanup target is manually made undeletable/locked for one test run;
2. the app launches normally;
3. existing history, treatment data, settings, and reminder state are still present;
4. the unfinished draft still triggers the existing restore/discard prompt and restores correctly;
5. a new check-in can be saved;
6. close/reopen works;
7. tray/reminder behavior still works;
8. approved disposable directories that were deletable are removed during upgrade;
9. the Edge profile is materially smaller when the large observed offenders existed before upgrade.

Do not require a fixed MB ceiling.

- [ ] **Step 7: Final scope audit**

Run:

```bash
git diff <base-commit>...HEAD --stat
git diff <base-commit>...HEAD
```

Confirm the final implementation touches only the approved files unless a reviewer-required in-scope test support change was necessary. Explicitly verify there are no backend/schema/API/draft-store/dependency changes.

- [ ] **Step 8: Final implementation handoff**

Report:

- concise summary of the three behavioral fixes;
- commits created;
- exact validation commands run and their fresh outcomes;
- Windows smoke-test result;
- `terra_reviewer` result;
- narrow `sol_reviewer` result;
- any residual risk, especially that Edge command-line switches are browser implementation behavior rather than a Med Check-in-controlled network sandbox.

Do not create a PR, push, release, or deployment unless the user separately asks for it.

## Definition of Done

- Existing application data and unfinished drafts survive a 2.2.1 -> 2.2.2 upgrade.
- Dedicated Edge launch retains app/profile isolation and adds only the three approved suppression switches.
- Installer cleanup uses only the approved allowlist, remains beneath `edge-profile`, and is non-fatal per target.
- Static HTML contains `Лечение не указано` rather than a real user's medication regimen.
- README accurately distinguishes Med Check-in's local data handling from the external Edge shell.
- All established release metadata reports 2.2.2.
- `npm test` passes with fresh evidence.
- `npm run package:windows` passes with fresh evidence.
- Windows upgrade smoke test passes.
- `terra_reviewer` has no unresolved actionable findings.
- `sol_reviewer` has no unresolved deletion/data-integrity findings.
