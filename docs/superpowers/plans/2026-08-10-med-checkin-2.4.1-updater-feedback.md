# Med Check-in 2.4.1 Updater Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make updater progress and “already current” results explicit, and require tray-host acknowledgement before the backend claims the installer launched.

**Architecture:** Keep the existing GitHub metadata/download/SHA-256/extraction pipeline and the existing in-memory host-action queue. Extend the update service with a short-lived `pendingLaunch` record and opaque `actionId`; the PowerShell tray reports launch success/failure through one fixed authenticated HTTP endpoint. Make browser rendering phase-driven so `availableVersion` is data, not the state machine.

**Tech Stack:** Node.js 22.23.1 ESM, built-in `fetch`/`node:crypto`/`node:fs`, local HTTP server, Windows PowerShell 5.1 tray host, static HTML/JavaScript UI, Node test runner, existing Windows packaging scripts.

## Global Constraints

- Release version is exactly `2.4.1`.
- No new dependencies.
- Update discovery/download remains fixed to the official GitHub repository.
- Existing SHA-256 verification remains before extraction/installer launch.
- `%LOCALAPPDATA%\MedCheckin2` remains preserved by update/install behavior.
- Scheduled-task identities remain `Med Check-in 2.0` and `Med Check-in 2.0 Watchdog`.
- Shortcut/tray family naming remains `Med Check-in 2.4` unless an existing exact patch string requires otherwise.
- No database/schema/portable-format changes.
- Do not persist updater jobs or add a helper service/process.
- `phase` is authoritative for browser presentation.
- A queued host action is not proof of installer launch.
- A failed or unconfirmed installer launch leaves the candidate retryable.
- Preserve Windows script encoding contracts: bootstrap scripts including `windows/install.ps1` stay ASCII-safe CRLF; `windows/tray-host.ps1` stays UTF-8 with BOM.
- Run focused tests, then the cheap full `npm test` gate before expensive review.
- Do not automatically exercise destructive updater behavior against the user’s real data.

---

## Repository Map

**Updater state and staging**
- `backend/updates.mjs`
- `test/updates.test.mjs`

**Tray acknowledgement transport**
- `backend/http-server.mjs`
- `windows/tray-host.ps1`
- `test/http-server.test.mjs`
- `test/package-layout.test.mjs`

**Browser presentation**
- `resources/app.js`
- `resources/index.html`
- `test/frontend-smoke.test.mjs`
- Create: `test/frontend-updates.test.mjs`

**Patch release integration**
- `package.json`
- `package-lock.json`
- `README.txt`
- `windows/install.ps1`
- `scripts/package-windows.mjs`
- `scripts/verify-release.mjs`

The map is fresh. Skip a broad explorer pass unless implementation reveals material drift.

---

### Task 1: Acknowledge installer launch instead of treating queueing as success

**Ownership boundary:** updater/process coordination. If delegated, prefer `terra_workhorse`. After focused tests and `npm test`, use `sol_reviewer` narrowly on candidate lifetime, action identity, timeout/retry, and check/install mutual exclusion.

**Files:**
- Modify: `backend/updates.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `windows/tray-host.ps1`
- Modify: `test/updates.test.mjs`
- Modify: `test/http-server.test.mjs`
- Modify: `test/package-layout.test.mjs`

**Interfaces:**
- `createUpdateService({...})` continues to expose `getStatus()`, `check()`, `installAvailable()`.
- Add `reportInstallLaunch({ actionId, ok })`.
- Add optional `launchAckTimeoutMs = 15000` construction input for deterministic timeout tests.
- Queued action becomes `{ type: 'install-update', actionId, stagingDir }`.
- Add `POST /api/v1/updates/install-launch-result` with exact body `{ actionId: string, ok: boolean }`.

- [ ] **Step 1: Change the updater tests to the new state contract**

In `test/updates.test.mjs`, change successful no-update checks to expect `current`:

```js
const status = await f.service.check({ force: true });
assert.equal(status.phase, 'current');
assert.equal(status.availableVersion, null);
assert.equal(status.error, null);
```

Change the successful staging test so staging means `launching`, not `installing`:

```js
await f.service.check({ force: true });
const status = await f.service.installAvailable();
assert.equal(status.phase, 'launching');
assert.equal(status.availableVersion, '2.3.1');

const [action] = f.actions.drain();
assert.equal(action.type, 'install-update');
assert.equal(typeof action.actionId, 'string');
assert.ok(action.actionId.length > 0);
assert.match(action.stagingDir, /MedCheckin2-update-/);

const installing = f.service.reportInstallLaunch({ actionId: action.actionId, ok: true });
assert.equal(installing.phase, 'installing');
assert.equal(installing.availableVersion, '2.3.1');
```

- [ ] **Step 2: Add failing tests for launch failure, timeout, stale IDs, and pending-launch exclusion**

Extend the existing fixture to accept `launchAckTimeoutMs` and pass it to `createUpdateService()`.

Add:

```js
test('failed installer launch restores the candidate and permits retry', async () => {
  const f = fixture();
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    const [action] = f.actions.drain();

    const failed = f.service.reportInstallLaunch({ actionId: action.actionId, ok: false });
    assert.equal(failed.phase, 'available');
    assert.equal(failed.availableVersion, '2.3.1');
    assert.ok(failed.error);

    const retry = await f.service.installAvailable();
    assert.equal(retry.phase, 'launching');
  } finally { f.close(); }
});
```

```js
test('pending installer launch blocks checks and duplicate install attempts', async () => {
  const f = fixture();
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    const requestsBefore = f.requested.length;

    await f.service.check({ force: true });
    assert.equal(f.requested.length, requestsBefore);
    await assert.rejects(f.service.installAvailable(), /already|launch|install/i);
  } finally { f.close(); }
});
```

```js
test('stale installer acknowledgement cannot mutate updater state', async () => {
  const f = fixture();
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    const before = f.service.getStatus();

    assert.throws(
      () => f.service.reportInstallLaunch({ actionId: 'stale-action', ok: true }),
      /action|launch/i
    );
    assert.deepEqual(f.service.getStatus(), before);
  } finally { f.close(); }
});
```

```js
test('unacknowledged installer launch times out to a retryable candidate', async () => {
  const f = fixture({ launchAckTimeoutMs: 10 });
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const status = f.service.getStatus();
    assert.equal(status.phase, 'available');
    assert.equal(status.availableVersion, '2.3.1');
    assert.ok(status.error);
  } finally { f.close(); }
});
```

Keep both existing install→check and check→install interleaving tests.

- [ ] **Step 3: Run updater tests and verify the new tests fail before implementation**

Run:

```text
node --test --test-concurrency=1 test/updates.test.mjs
```

Expected before implementation: failures around `current`, `launching`, missing `actionId`, missing `reportInstallLaunch`, and pending-launch behavior.

- [ ] **Step 4: Implement `pendingLaunch` in `backend/updates.mjs`**

Extend the crypto import:

```js
import { createHash, randomUUID } from 'node:crypto';
```

Extend construction:

```js
export function createUpdateService({
  installedVersion,
  dataDir,
  hostActions,
  fetchImpl = fetch,
  now = () => new Date(),
  extractArchive = defaultExtractArchive,
  onStatus = () => {},
  launchAckTimeoutMs = 15000
}) {
```

Add:

```js
let pendingLaunch = null;
```

For a successful check with no newer compatible release, publish:

```js
return publish({
  phase: 'current',
  lastCheckedAt: checkedAt,
  availableVersion: null,
  releaseNotes: null,
  error: null
});
```

After ZIP/checksum verification and extraction succeed, keep `candidate`, create the action ID, queue it, and arm the timeout:

```js
const actionId = randomUUID();
hostActions.enqueue({ type: 'install-update', actionId, stagingDir });

const timer = setTimeout(() => {
  if (pendingLaunch?.actionId !== actionId) return;
  rmSync(stagingDir, { recursive: true, force: true });
  pendingLaunch = null;
  publish({
    phase: 'available',
    availableVersion: release.version,
    releaseNotes: release.releaseNotes,
    error: 'Installer launch could not be confirmed. Try the update again.'
  });
}, launchAckTimeoutMs);
timer.unref?.();

pendingLaunch = { actionId, release, stagingDir, timer };
return publish({
  phase: 'launching',
  availableVersion: release.version,
  releaseNotes: release.releaseNotes,
  error: null
});
```

Do not clear `candidate` merely because the action was queued.

Block both operations while a launch is pending or already acknowledged:

```js
if (installation || pendingLaunch || status.phase === 'installing') {
  // check(): return current status without a metadata fetch
}
```

```js
if (installation || pendingLaunch || status.phase === 'installing') {
  throw new Error('Update installation is already being prepared or launched.');
}
```

Preserve the existing `checking` exclusion as well.

Implement exact acknowledgement identity:

```js
function reportInstallLaunch({ actionId, ok }) {
  if (!pendingLaunch
      || typeof actionId !== 'string'
      || actionId !== pendingLaunch.actionId
      || typeof ok !== 'boolean') {
    throw new TypeError('Invalid or stale update launch acknowledgement');
  }

  const { release, stagingDir, timer } = pendingLaunch;
  clearTimeout(timer);
  pendingLaunch = null;

  if (!ok) {
    rmSync(stagingDir, { recursive: true, force: true });
    return publish({
      phase: 'available',
      availableVersion: release.version,
      releaseNotes: release.releaseNotes,
      error: 'Could not start the update installer. Try again.'
    });
  }

  return publish({
    phase: 'installing',
    availableVersion: release.version,
    releaseNotes: release.releaseNotes,
    error: null
  });
}
```

Return it:

```js
return { getStatus, check, installAvailable, reportInstallLaunch };
```

Do not persist `candidate`/`pendingLaunch`, move installer launch into Node, or alter checksum verification.

- [ ] **Step 5: Run updater tests to green**

```text
node --test --test-concurrency=1 test/updates.test.mjs
```

Expected: PASS, including both existing interleaving tests.

- [ ] **Step 6: Add failing HTTP route tests**

In `test/http-server.test.mjs`, add a route test with a stub service:

```js
const acknowledgements = [];
const updateService = {
  getStatus: () => ({ installedVersion: '2.4.0', phase: 'launching' }),
  reportInstallLaunch(value) {
    acknowledgements.push(value);
    return { installedVersion: '2.4.0', phase: 'installing' };
  }
};
```

POST:

```js
const response = await api(base, '/api/v1/updates/install-launch-result', {
  method: 'POST',
  body: JSON.stringify({ actionId: 'action-1', ok: true })
});
assert.equal(response.status, 200);
assert.deepEqual(acknowledgements, [{ actionId: 'action-1', ok: true }]);
assert.equal((await response.json()).phase, 'installing');
```

Also assert missing/blank `actionId`, non-boolean `ok`, and extra body keys return 400. Existing global `/api/v1/*` authentication remains the only auth layer.

- [ ] **Step 7: Add the fixed acknowledgement route**

Place it with the existing updater routes in `backend/http-server.mjs`:

```js
if (url.pathname === '/api/v1/updates/install-launch-result' && req.method === 'POST') {
  if (!updateService) return json(res, 503, { error: 'updates_unavailable' });
  const body = await readBody(req);
  if (typeof body.actionId !== 'string'
      || !body.actionId
      || typeof body.ok !== 'boolean'
      || Object.keys(body).some((key) => !['actionId', 'ok'].includes(key))) {
    throw new TypeError('Invalid update launch acknowledgement');
  }
  return json(res, 200, updateService.reportInstallLaunch({ actionId: body.actionId, ok: body.ok }));
}
```

Do not accept paths, commands, executables, or raw PowerShell errors from this endpoint.

- [ ] **Step 8: Run HTTP tests**

```text
node --test --test-concurrency=1 test/http-server.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Make the tray host acknowledge `Start-Process`**

Keep `Start-UpdateInstaller` path-containment and installer-file checks unchanged.

Change only the `install-update` branch in `Handle-Poll` to require the queued `actionId`, call `Start-UpdateInstaller`, then report success/failure:

```powershell
} elseif ([string]$action.type -eq 'install-update') {
  $actionId = [string]$action.actionId
  try {
    if ([string]::IsNullOrWhiteSpace($actionId)) {
      throw 'Update launch action is missing its action id.'
    }

    Start-UpdateInstaller ([string]$action.stagingDir)

    try {
      Invoke-Api -Method 'POST' -Path '/api/v1/updates/install-launch-result' -Body @{
        actionId = $actionId
        ok = $true
      } | Out-Null
    } catch {
      Write-TrayLog ('Could not acknowledge verified update installer launch: ' + $_.Exception.Message)
    }
  } catch {
    Write-TrayLog ('Could not start verified update installer: ' + $_.Exception.Message)
    if (-not [string]::IsNullOrWhiteSpace($actionId)) {
      try {
        Invoke-Api -Method 'POST' -Path '/api/v1/updates/install-launch-result' -Body @{
          actionId = $actionId
          ok = $false
        } | Out-Null
      } catch {
        Write-TrayLog ('Could not report verified update installer launch failure: ' + $_.Exception.Message)
      }
    }
  }
}
```

Do not send `stagingDir` or exception text in the acknowledgement body. Preserve UTF-8 BOM in `windows/tray-host.ps1`.

- [ ] **Step 10: Add a shipped-tray contract test**

In `test/package-layout.test.mjs`, add a test that reads `windows/tray-host.ps1` and asserts it contains all of:

```text
/api/v1/updates/install-launch-result
actionId
ok = $true
ok = $false
Start-UpdateInstaller
```

Extract the `install-update` branch or a bounded substring and assert the POST body does not contain `stagingDir`.

- [ ] **Step 11: Run the complete Task 1 focused set**

```text
node --test --test-concurrency=1 test/updates.test.mjs test/http-server.test.mjs test/package-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 12: Run the cheap full suite before review**

```text
npm test
```

Expected: PASS.

- [ ] **Step 13: Review the exceptional-risk updater boundary**

If delegated, use `sol_reviewer` only for:

- pending candidate lifetime;
- action-ID acknowledgement correctness;
- timeout cleanup/retry;
- duplicate/stale acknowledgements;
- install/check mutual exclusion;
- tray/backend race behavior.

Use `terra_reviewer` for ordinary integration/test findings if useful. Apply only actionable findings inside this scope, then rerun the focused set and `npm test`.

- [ ] **Step 14: Commit the coherent updater boundary**

```text
git add backend/updates.mjs backend/http-server.mjs windows/tray-host.ps1 test/updates.test.mjs test/http-server.test.mjs test/package-layout.test.mjs
git commit -m "fix: acknowledge updater installer launch"
```

---

### Task 2: Render explicit updater feedback and prepare 2.4.1

**Ownership boundary:** bounded UI/release integration. If delegated after Task 1 is stable, `luna_implementer` at high reasoning is appropriate. Use ordinary `terra_reviewer`.

**Files:**
- Modify: `resources/app.js`
- Modify: `resources/index.html`
- Create: `test/frontend-updates.test.mjs`
- Modify: `test/frontend-smoke.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.txt`
- Modify: `windows/install.ps1`
- Modify: `scripts/package-windows.mjs`
- Modify: `scripts/verify-release.mjs`

**Interfaces:** Consume Task 1 phases `idle`, `checking`, `current`, `available`, `downloading`, `launching`, `installing`, plus `error` and `availableVersion`. Keep existing updater DOM IDs.

- [ ] **Step 1: Add a small pure updater-presentation helper and test it first**

Before changing `renderUpdates()`, add a `__MED_CHECKIN_TEST__` export for a new pure helper `updatePresentation` and create `test/frontend-updates.test.mjs` using the project’s existing VM-hook pattern.

The test must cover:

```js
assert.match(updatePresentation({
  installedVersion: '2.4.1',
  phase: 'current',
  lastCheckedAt: '2026-08-10T03:51:00.000Z',
  availableVersion: null,
  releaseNotes: null,
  error: null
}).statusText, /последняя версия/i);
```

```js
assert.match(updatePresentation({
  installedVersion: '2.4.0',
  phase: 'downloading',
  availableVersion: '2.4.1',
  releaseNotes: 'notes',
  error: null
}).statusText, /скачиваем|проверяем/i);
```

```js
assert.match(updatePresentation({
  installedVersion: '2.4.0',
  phase: 'launching',
  availableVersion: '2.4.1',
  releaseNotes: 'notes',
  error: null
}).statusText, /запускаем установщик/i);
```

```js
assert.match(updatePresentation({
  installedVersion: '2.4.0',
  phase: 'installing',
  availableVersion: '2.4.1',
  releaseNotes: 'notes',
  error: null
}).statusText, /перезапуст/i);
```

For `{ phase: 'available', availableVersion: '2.4.1', error: 'launch failed' }`, assert `showInstall === true`, `installDisabled === false`, and the error is the visible status.

- [ ] **Step 2: Run the focused frontend tests and verify the new behavior is initially red**

```text
node --test --test-concurrency=1 test/frontend-updates.test.mjs test/frontend-smoke.test.mjs
```

Expected before implementation: the new presentation test fails because `updatePresentation` does not exist.

- [ ] **Step 3: Implement `updatePresentation(update)` in `resources/app.js`**

Use phase-driven presentation equivalent to:

```js
function updatePresentation(update) {
  const checked = update.lastCheckedAt
    ? `Проверено: ${formatStoredTime(update.lastCheckedAt, { date: true })}.`
    : '';

  if (update.error) {
    return {
      statusText: update.error,
      checkDisabled: ['checking', 'downloading', 'launching', 'installing'].includes(update.phase),
      showInstall: update.phase === 'available' && Boolean(update.availableVersion),
      installDisabled: false,
      showNotes: Boolean(update.releaseNotes),
      installLabel: 'Повторить обновление'
    };
  }

  switch (update.phase) {
    case 'checking':
      return { statusText: 'Проверяем обновления…', checkDisabled: true, showInstall: false, installDisabled: true, showNotes: false, installLabel: 'Обновить' };
    case 'current':
      return { statusText: `У вас установлена последняя версия. ${checked}`.trim(), checkDisabled: false, showInstall: false, installDisabled: true, showNotes: false, installLabel: 'Обновить' };
    case 'available':
      return { statusText: `Доступна версия ${update.availableVersion}. ${checked}`.trim(), checkDisabled: false, showInstall: true, installDisabled: false, showNotes: true, installLabel: 'Обновить' };
    case 'downloading':
      return { statusText: `Скачиваем и проверяем обновление ${update.availableVersion}…`, checkDisabled: true, showInstall: true, installDisabled: true, showNotes: true, installLabel: 'Подготовка…' };
    case 'launching':
      return { statusText: `Запускаем установщик ${update.availableVersion}…`, checkDisabled: true, showInstall: true, installDisabled: true, showNotes: true, installLabel: 'Запускаем…' };
    case 'installing':
      return { statusText: 'Установщик запущен. Приложение перезапустится автоматически.', checkDisabled: true, showInstall: false, installDisabled: true, showNotes: true, installLabel: 'Обновить' };
    default:
      return { statusText: checked || 'Проверка обновлений ещё не выполнялась.', checkDisabled: false, showInstall: false, installDisabled: true, showNotes: false, installLabel: 'Обновить' };
  }
}
```

Exact punctuation may vary; preserve the approved Russian meaning.

Expose only this pure helper under the existing test hook:

```js
globalThis.__MED_CHECKIN_TEST__.updatePresentation = updatePresentation;
```

- [ ] **Step 4: Make `renderUpdates()` consume the helper**

Replace `availableVersion`-driven visibility with:

```js
const presentation = updatePresentation(update);
$('#update-status').textContent = presentation.statusText;
$('#check-updates').disabled = presentation.checkDisabled;
$('#install-update').hidden = !presentation.showInstall;
$('#install-update').disabled = presentation.installDisabled;
$('#install-update').textContent = presentation.installLabel;

const notes = $('#update-notes');
notes.textContent = update.releaseNotes || '';
notes.hidden = !presentation.showNotes || !update.releaseNotes;
```

Keep `installed-version` driven by `update.installedVersion` and keep the global update-available affordance based on the actual available state rather than transitional phases.

- [ ] **Step 5: Remove the temporally misleading success toast from `installUpdate()`**

The API call returns only after download/checksum/extraction, so the current post-await `Подготовка обновления…` toast is backwards. Rely on SSE + rendered phase state:

```js
async function installUpdate() {
  try {
    state.updates = await api('/api/v1/updates/install', { method: 'POST' });
    renderUpdates();
  } catch (error) {
    toast(`Не удалось подготовить обновление: ${error.message}`);
  }
}
```

Do not add artificial progress percentages.

- [ ] **Step 6: Run focused frontend tests**

```text
node --test --test-concurrency=1 test/frontend-updates.test.mjs test/frontend-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Bump exact patch metadata to 2.4.1**

`package.json`:

```json
"version": "2.4.1"
```

`package-lock.json`, both top-level and root package:

```json
"version": "2.4.1"
```

`resources/index.html`:

```html
<title>Med Check-in 2.4.1</title>
```

Keep:

```html
<h1>Med Check-in <span>2.4</span></h1>
```

`windows/install.ps1`:

```powershell
$AppName = 'Med Check-in 2.4.1'
```

and change the diagnostics heading to `Med Check-in 2.4.1 installation diagnostics`. Preserve ASCII-safe CRLF. Keep scheduled task names and `Med Check-in 2.4.lnk` shortcut family unchanged.

`scripts/package-windows.mjs`:

```js
const VERSION = '2.4.1';
const archiveName = 'med-checkin-2.4.1-windows-installer.zip';
```

`scripts/verify-release.mjs`:

```js
const VERSION = '2.4.1';
```

Keep its visible `<span>2.4</span>` assertion.

- [ ] **Step 8: Update `README.txt` narrowly**

Change the heading to `MED CHECK-IN 2.4.1` and replace only the updater section with behavior equivalent to:

```text
Обновления
----------
Приложение периодически и по кнопке в разделе «Настройки» проверяет обновления
только в официальном GitHub-репозитории Med Check-in. После успешной проверки без
новой версии приложение явно сообщает, что установлена последняя версия.

Установка запускается только после явного нажатия «Обновить». Во время подготовки
приложение показывает этапы загрузки/проверки и запуска установщика. ZIP-файл
сверяется с опубликованной SHA-256-суммой до запуска установщика. Если запуск
установщика не удаётся или не подтверждается, обновление остаётся доступным для
повторной попытки.

Обычное обновление сохраняет %LOCALAPPDATA%\MedCheckin2, включая базу, резервные
копии, настройки и черновики.
```

Do not broaden README into a changelog.

- [ ] **Step 9: Run version/package-sensitive focused tests**

```text
node --test --test-concurrency=1 test/frontend-updates.test.mjs test/frontend-smoke.test.mjs test/package-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Run the full repository gate**

```text
npm test
```

Expected: PASS.

- [ ] **Step 11: Build and verify the Windows archive**

```text
npm run package:windows
```

Expected archive/checksum names:

```text
med-checkin-2.4.1-windows-installer.zip
med-checkin-2.4.1-windows-installer.zip.sha256
```

Do not commit `dist/` artifacts unless repository policy explicitly changes.

- [ ] **Step 12: Run whitespace and worktree sanity**

```text
git diff --check
git status --short
```

Expected: only intended source/test/docs/version changes; no private data or generated package artifacts tracked.

- [ ] **Step 13: Review the UI/release boundary and the integrated branch**

Use `terra_reviewer` for ordinary browser/release review. If Tasks 1 and 2 were implemented by separate workers, do one final coherent whole-branch Terra review focused on:

- phase names matching backend and browser;
- acknowledgement endpoint/action identity;
- retry visibility;
- version/package consistency;
- no accidental task/shortcut identity churn.

A second Sol pass is unnecessary unless Task 2 changes updater/process semantics beyond Task 1.

After fixes, rerun:

```text
npm test
npm run package:windows
git diff --check
```

- [ ] **Step 14: Commit Task 2 after fresh validation**

```text
git add resources/app.js resources/index.html test/frontend-updates.test.mjs test/frontend-smoke.test.mjs package.json package-lock.json README.txt windows/install.ps1 scripts/package-windows.mjs scripts/verify-release.mjs
git commit -m "chore: prepare Med Check-in 2.4.1"
```

---

## Final Validation and Release Sequence

- [ ] **Step 1: Re-run fresh gates after the last source change**

```text
npm test
npm run package:windows
git diff --check
git status --short
```

Report exact test count, packaging verification, and worktree state. Do not rely on earlier task-local output after later edits.

- [ ] **Step 2: Push/open a PR only when the implementation task explicitly authorizes those mutations**

Follow `AGENTS.md` and `.codex/PROJECT.md`. No implicit push/PR/release authorization.

- [ ] **Step 3: Require Windows CI on the implementation head**

Canonical hosted gate:

```text
npm ci --ignore-scripts
npm test
npm run package:windows
```

Do not claim Windows CI from local packaging.

- [ ] **Step 4: Merge/tag/publish only with explicit release authorization**

The production updater only considers the official repository’s latest **public stable** release. A draft or prerelease cannot provide the true updater smoke. Therefore code review, tests, package verification, and Windows CI happen first; then 2.4.1 is published; then the real updater smoke happens immediately.

- [ ] **Step 5: Immediately smoke the public 2.4.1 update from installed 2.4.0**

Observe the full path:

```text
2.4.0 Settings
-> Проверить обновления
-> Доступна версия 2.4.1
-> Обновить
-> visible downloading/verifying state
-> visible launching-installer state
-> visible installer-started/restart state (even if brief)
-> old window closes as installer takes over
-> app relaunches as 2.4.1
-> existing records/settings/drafts remain present
```

After relaunch, press `Проверить обновления` again and verify the persistent positive result:

```text
У вас установлена последняя версия.
```

Do not intentionally break the live installer to test failure. Automated negative-acknowledgement and timeout tests own that path.

Only consider the patch release finalized after this post-publication smoke passes. If it fails, stop further rollout/announcement and fix forward rather than manually mutating the user’s data.

## Expected Implementation Commits

Keep commit structure proportional:

1. `fix: acknowledge updater installer launch`
2. `chore: prepare Med Check-in 2.4.1`

If the implementation naturally lands as one coherent validated commit, that is acceptable. Do not split merely for ceremony.
