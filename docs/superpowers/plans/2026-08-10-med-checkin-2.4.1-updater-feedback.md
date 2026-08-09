# Med Check-in 2.4.1 Updater Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make updater progress and “already current” results explicit, and require tray-host acknowledgement before the backend claims the installer launched.

**Architecture:** Keep the existing GitHub metadata/download/SHA-256/extraction pipeline and the existing in-memory host-action queue. Extend the update service with a short-lived `pendingLaunch` record and opaque `actionId`; the PowerShell tray reports launch success/failure through one fixed authenticated HTTP endpoint. Make browser rendering phase-driven so `availableVersion` is data, not the state machine.

**Tech Stack:** Node.js 22.23.1 ESM, built-in `fetch`/`node:crypto`/`node:fs`, local HTTP server, Windows PowerShell 5.1 tray host, static HTML/JavaScript UI, Node test runner, existing Windows packaging scripts.

## Global Constraints

- Release version is exactly `2.4.1`.
- No new dependencies.
- Update discovery/download remains fixed to the official GitHub repository.
- Existing SHA-256 verification must remain before extraction/installer launch.
- `%LOCALAPPDATA%\MedCheckin2` remains preserved by update/install behavior.
- Scheduled-task identities remain `Med Check-in 2.0` and `Med Check-in 2.0 Watchdog`.
- Shortcut/tray family naming may remain `Med Check-in 2.4`.
- No database/schema/portable-format changes.
- Do not persist updater jobs or add a helper service/process.
- `phase` is authoritative for browser presentation.
- A queued host action is not proof of installer launch.
- A failed or unconfirmed installer launch must leave the candidate retryable.
- Run focused tests, then the cheap full `npm test` gate before expensive review.
- Do not test destructive updater behavior against the user’s real data automatically.

---

## Repository map for this change

**Updater state and staging**
- `backend/updates.mjs`: release discovery, candidate lifecycle, verified download/extraction, install mutual exclusion, status publication.
- `test/updates.test.mjs`: updater state/concurrency regression coverage.

**Tray acknowledgement transport**
- `backend/http-server.mjs`: fixed authenticated acknowledgement route.
- `test/http-server.test.mjs`: route validation and delegation coverage.
- `windows/tray-host.ps1`: existing `install-update` action consumer and `Start-Process` call.
- `test/package-layout.test.mjs`: appropriate static contract checks for shipped PowerShell where a live process test is not practical.

**Browser presentation**
- `resources/app.js`: `renderUpdates()`, `checkUpdates()`, `installUpdate()`, SSE handling.
- `resources/index.html`: update card and exact document version.
- `test/frontend-smoke.test.mjs`: static shipped UI contract; add a small focused updater-rendering test hook/test if needed rather than a framework.

**Patch release integration**
- `package.json`
- `package-lock.json`
- `README.txt`
- `windows/install.ps1`
- `scripts/package-windows.mjs`
- `scripts/verify-release.mjs`
- version-sensitive tests discovered from the suite.

The map is current as of the approved 2.4.1 design. Skip a broad explorer pass unless these ownership seams have materially drifted.

---

### Task 1: Make installer launch an acknowledged updater state transition

**Ownership boundary:** integration-heavy updater/process coordination. If delegated, prefer `terra_workhorse`. After focused + full tests, use `sol_reviewer` narrowly on candidate lifetime, acknowledgement identity, timeout/retry, and check/install mutual exclusion.

**Files:**
- Modify: `backend/updates.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `windows/tray-host.ps1`
- Test: `test/updates.test.mjs`
- Test: `test/http-server.test.mjs`
- Test: `test/package-layout.test.mjs`

**Interfaces:**
- Existing `createUpdateService({...})` continues to produce `getStatus()`, `check()`, `installAvailable()`.
- Extend it with `reportInstallLaunch({ actionId, ok })`.
- Add optional construction input `launchAckTimeoutMs = 15000` for deterministic timeout tests; production callers rely on the default.
- Queued host action shape becomes `{ type: 'install-update', actionId, stagingDir }`.
- Add authenticated fixed endpoint `POST /api/v1/updates/install-launch-result` with `{ actionId: string, ok: boolean }`.

- [ ] **Step 1: Change the updater tests first to express the new state contract**

In `test/updates.test.mjs`, update the successful staging test so it no longer expects staging alone to mean installation started. The assertions should have this shape:

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

Also change the no-newer-release expectations from `idle` to `current` after a successful check:

```js
const status = await f.service.check({ force: true });
assert.equal(status.phase, 'current');
assert.equal(status.availableVersion, null);
assert.equal(status.error, null);
```

- [ ] **Step 2: Add focused failing tests for negative acknowledgement, timeout, stale IDs, and pending-launch exclusion**

Add tests equivalent to:

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
    assert.match(failed.error, /launch|installer|запуст/i);

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
    assert.equal(f.requested.length, requestsBefore, 'pending launch must not refetch metadata');
    await assert.rejects(f.service.installAvailable(), /already|launch|install/i);
  } finally { f.close(); }
});
```

```js
test('stale installer launch acknowledgement cannot mutate the current candidate', async () => {
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

For timeout, build the fixture with a tiny injected timeout and wait only enough for that test:

```js
const f = fixture({ launchAckTimeoutMs: 10 });
await f.service.check({ force: true });
await f.service.installAvailable();
await new Promise((resolve) => setTimeout(resolve, 25));
const status = f.service.getStatus();
assert.equal(status.phase, 'available');
assert.equal(status.availableVersion, '2.3.1');
assert.match(status.error, /confirm|launch|запуск/i);
```

Update the fixture so `launchAckTimeoutMs` is passed through to `createUpdateService()`.

- [ ] **Step 3: Run the updater tests and confirm the new expectations fail for the intended reasons**

Run:

```text
node --test --test-concurrency=1 test/updates.test.mjs
```

Expected before implementation: failures around `current`, `launching`, missing `actionId`, missing `reportInstallLaunch`, and pending-launch/timeout behavior. Do not weaken old interleaving assertions.

- [ ] **Step 4: Implement the minimal pending-launch state in `backend/updates.mjs`**

Use native `randomUUID` in the existing crypto import:

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

Add state owned entirely by the service:

```js
let pendingLaunch = null;
```

A pending record should contain only what this lifecycle needs:

```js
{
  actionId,
  release,
  stagingDir,
  timer
}
```

After a successful check with no newer compatible release, publish `phase: 'current'` instead of `idle`:

```js
return publish({
  phase: 'current',
  lastCheckedAt: checkedAt,
  availableVersion: null,
  releaseNotes: null,
  error: null
});
```

When verified staging succeeds, **do not clear `candidate`**. Create an opaque action ID, enqueue it, arm the acknowledgement timer, and publish `launching`:

```js
const actionId = randomUUID();
hostActions.enqueue({ type: 'install-update', actionId, stagingDir });

const timer = setTimeout(() => {
  // Only expire the still-current pending action.
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

Do not rely on exact English copy above if existing backend errors use a different language; keep backend error meaning stable and let browser copy remain user-friendly. The important contract is retryable `available` + non-null error.

Guard both conflicting operations beyond the staging promise:

```js
if (pendingLaunch || status.phase === 'installing') {
  // check(): return current status without fetching
}
```

and:

```js
if (pendingLaunch || status.phase === 'installing') {
  throw new Error('Update installation is already being launched.');
}
```

Implement acknowledgement with exact action identity:

```js
function reportInstallLaunch({ actionId, ok }) {
  if (!pendingLaunch || typeof actionId !== 'string' || actionId !== pendingLaunch.actionId || typeof ok !== 'boolean') {
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

Return it from the service:

```js
return { getStatus, check, installAvailable, reportInstallLaunch };
```

Do **not** add persistence for candidate or pending launch. Do **not** remove SHA-256 verification or move installer launch into Node.

- [ ] **Step 5: Run updater tests until the state/concurrency contract passes**

Run:

```text
node --test --test-concurrency=1 test/updates.test.mjs
```

Expected: all updater tests pass, including both existing check/install interleavings and the new pending-launch tests.

- [ ] **Step 6: Write failing HTTP tests for the fixed acknowledgement endpoint**

In `test/http-server.test.mjs`, construct a lightweight `updateService` spy/stub for the route test. Cover successful delegation and malformed/stale service rejection. The core successful assertion should be equivalent to:

```js
const acknowledgements = [];
const updateService = {
  getStatus: () => ({ installedVersion: '2.4.0', phase: 'launching' }),
  reportInstallLaunch: (value) => {
    acknowledgements.push(value);
    return { installedVersion: '2.4.0', phase: 'installing' };
  }
};

const response = await api(base, '/api/v1/updates/install-launch-result', {
  method: 'POST',
  body: JSON.stringify({ actionId: 'action-1', ok: true })
});
assert.equal(response.status, 200);
assert.deepEqual(acknowledgements, [{ actionId: 'action-1', ok: true }]);
assert.equal((await response.json()).phase, 'installing');
```

Also assert invalid body shapes return 400 through the existing TypeError mapping. Existing global auth handling already protects `/api/v1/*`; do not create a separate token mechanism.

- [ ] **Step 7: Add the HTTP endpoint with strict body shaping**

In `backend/http-server.mjs`, place the route with the existing updater endpoints:

```js
if (url.pathname === '/api/v1/updates/install-launch-result' && req.method === 'POST') {
  if (!updateService) return json(res, 503, { error: 'updates_unavailable' });
  const body = await readBody(req);
  if (typeof body.actionId !== 'string' || !body.actionId || typeof body.ok !== 'boolean'
      || Object.keys(body).some((key) => !['actionId', 'ok'].includes(key))) {
    throw new TypeError('Invalid update launch acknowledgement');
  }
  return json(res, 200, updateService.reportInstallLaunch({ actionId: body.actionId, ok: body.ok }));
}
```

Do not accept a staging path, command, executable, or error string from the client.

- [ ] **Step 8: Run the focused HTTP tests**

Run:

```text
node --test --test-concurrency=1 test/http-server.test.mjs
```

Expected: updater acknowledgement route tests and existing host/update routes pass.

- [ ] **Step 9: Update the tray handoff to acknowledge `Start-Process` success/failure**

In `windows/tray-host.ps1`, keep `Start-UpdateInstaller` path containment and installer existence checks unchanged. In the `install-update` branch of `Handle-Poll`, require the queued `actionId` and report only `{ actionId, ok }`.

The intended branch is structurally:

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

Keep detailed system/path errors local to `tray.log`; do not send raw exception text to the browser/backend acknowledgement body.

- [ ] **Step 10: Add a shipped-script contract test for acknowledgement**

In `test/package-layout.test.mjs`, add a focused static test that verifies `windows/tray-host.ps1` contains:

```text
/api/v1/updates/install-launch-result
actionId
ok = $true
ok = $false
Start-UpdateInstaller
```

and that the acknowledgement branch does not put `stagingDir` into the POST body. This is not a substitute for the update-service tests; it prevents packaging a tray script that forgets the return edge.

- [ ] **Step 11: Run the complete Task 1 focused set**

Run:

```text
node --test --test-concurrency=1 test/updates.test.mjs test/http-server.test.mjs test/package-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 12: Run the cheap full suite before exceptional-risk review**

Run:

```text
npm test
```

Expected: PASS. Fix any shared-contract regression before asking a reviewer to rediscover it.

- [ ] **Step 13: Review the updater/process boundary**

If using the repository’s delegated workflow:

- use `sol_reviewer` narrowly for `backend/updates.mjs`, the acknowledgement HTTP route, tray handoff, timeout/retry, candidate lifetime, and check/install mutual exclusion;
- use `terra_reviewer` for ordinary integration/test review if useful;
- apply only actionable findings within this approved 2.4.1 scope;
- rerun the focused set and `npm test` after fixes.

- [ ] **Step 14: Commit Task 1 after fresh validation**

Suggested commit:

```text
git add backend/updates.mjs backend/http-server.mjs windows/tray-host.ps1 test/updates.test.mjs test/http-server.test.mjs test/package-layout.test.mjs
git commit -m "fix: acknowledge updater installer launch"
```

---

### Task 2: Render explicit updater feedback and prepare the 2.4.1 patch release

**Ownership boundary:** bounded browser/release integration. If delegated after Task 1’s status contract is stable, `luna_implementer` at high reasoning is suitable. Use ordinary `terra_reviewer`; a second Sol review is unnecessary unless this task changes process/updater semantics beyond presentation.

**Files:**
- Modify: `resources/app.js`
- Modify: `resources/index.html`
- Modify: `test/frontend-smoke.test.mjs`
- Optionally create/modify: a focused frontend updater renderer test using the project’s existing VM/test-hook style if static assertions are insufficient
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.txt`
- Modify: `windows/install.ps1`
- Modify: `scripts/package-windows.mjs`
- Modify: `scripts/verify-release.mjs`
- Modify: version-sensitive tests only where exact patch version is intentionally asserted

**Interfaces:**
- Consume updater status phases from Task 1: `idle`, `checking`, `current`, `available`, `downloading`, `launching`, `installing` plus `error` and `availableVersion`.
- Keep existing DOM IDs: `update-status`, `update-notes`, `check-updates`, `install-update`, `installed-version`, `update-available`.
- Do not add a frontend dependency or browser automation stack.

- [ ] **Step 1: Add failing frontend expectations for the user-visible updater phases**

Prefer to extract a tiny pure updater-view helper from `renderUpdates()` and expose it under the existing `__MED_CHECKIN_TEST__` hook, or add a narrowly-scoped VM harness. The helper should return presentation data, not mutate global state itself, for example:

```js
function updatePresentation(update) {
  // returns { statusText, showInstall, installDisabled, checkDisabled, showNotes, installLabel }
}
```

Tests must assert at least:

```js
assert.match(updatePresentation({
  installedVersion: '2.4.1', phase: 'current', lastCheckedAt: '2026-08-10T03:51:00.000Z',
  availableVersion: null, releaseNotes: null, error: null
}).statusText, /последняя версия/i);
```

```js
assert.match(updatePresentation({
  installedVersion: '2.4.0', phase: 'downloading', availableVersion: '2.4.1', error: null
}).statusText, /скачиваем|проверяем/i);
```

```js
assert.match(updatePresentation({
  installedVersion: '2.4.0', phase: 'launching', availableVersion: '2.4.1', error: null
}).statusText, /запускаем установщик/i);
```

```js
assert.match(updatePresentation({
  installedVersion: '2.4.0', phase: 'installing', availableVersion: '2.4.1', error: null
}).statusText, /перезапуст/i);
```

For a recoverable launch error represented as `phase: 'available'`, assert the update button remains shown/enabled and the error is visible.

- [ ] **Step 2: Run the focused frontend test and verify it fails before implementation**

Run the exact new/modified frontend test, plus:

```text
node --test --test-concurrency=1 test/frontend-smoke.test.mjs
```

Expected before implementation: failure because `renderUpdates()` does not understand `phase === 'current'`, `launching`, or explicit progress copy.

- [ ] **Step 3: Make updater presentation phase-driven in `resources/app.js`**

Implement a small pure presentation helper with behavior equivalent to:

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

Exact punctuation may differ, but preserve the approved Russian meaning and phase behavior.

Then make `renderUpdates()` consume that helper:

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

Keep `installed-version` driven by `installedVersion` as today.

- [ ] **Step 4: Remove misleading post-download toast timing**

`installUpdate()` currently awaits download/checksum/extraction and only then shows `Подготовка обновления…`, which is temporally backwards. Let SSE/rendered state communicate progress. Keep only failure toast if useful:

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

`checkUpdates()` likewise relies on the returned/SSE state; `current` provides the persistent positive confirmation.

- [ ] **Step 5: Run the focused frontend tests**

Run:

```text
node --test --test-concurrency=1 test/frontend-smoke.test.mjs
```

and the focused updater-renderer test if separate.

Expected: PASS.

- [ ] **Step 6: Bump release metadata to exactly 2.4.1 without changing stable Windows identities**

Update:

`package.json`:

```json
"version": "2.4.1"
```

`package-lock.json` root and package entry:

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

`windows/install.ps1` exact patch strings:

```powershell
$AppName = 'Med Check-in 2.4.1'
```

and diagnostics heading `Med Check-in 2.4.1 installation diagnostics`. Keep task names and `Med Check-in 2.4.lnk` shortcut family unchanged.

`scripts/package-windows.mjs`:

```js
const VERSION = '2.4.1';
const archiveName = 'med-checkin-2.4.1-windows-installer.zip';
```

`scripts/verify-release.mjs`:

```js
const VERSION = '2.4.1';
```

Keep its visible heading check on `<span>2.4</span>`.

Update exact-version test assertions only when they intentionally describe the patch release.

- [ ] **Step 7: Update `README.txt` narrowly**

Change the heading to `MED CHECK-IN 2.4.1` and revise only the updater section to document observable behavior:

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

Do not turn README into a changelog or add unrelated 2.4 feature prose.

- [ ] **Step 8: Run version/package-sensitive tests before packaging**

Run at minimum:

```text
node --test --test-concurrency=1 test/frontend-smoke.test.mjs test/package-layout.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Run the full repository gate**

Run:

```text
npm test
```

Expected: PASS with the new updater/frontend regressions included.

- [ ] **Step 10: Build and verify the Windows 2.4.1 archive**

Run:

```text
npm run package:windows
```

Expected:

```text
med-checkin-2.4.1-windows-installer.zip
med-checkin-2.4.1-windows-installer.zip.sha256
```

and successful release verification. Do not commit `dist/` artifacts unless existing repository policy explicitly says to.

- [ ] **Step 11: Run whitespace/integration sanity**

Run:

```text
git diff --check
```

Then inspect:

```text
git status --short
```

Expected: only intended source/test/docs/version files, no private data or generated package artifacts staged/tracked accidentally.

- [ ] **Step 12: Ordinary review and final coherent review**

Use `terra_reviewer` for the browser/release boundary. If Tasks 1 and 2 were implemented by separate workers, do one final coherent whole-branch Terra review focused on cross-boundary status names, endpoint/action identity, UI rendering, and version/package consistency.

Do not add another Sol pass unless Task 2 changed the updater/process semantics from Task 1.

After any fixes, rerun:

```text
npm test
npm run package:windows
git diff --check
```

- [ ] **Step 13: Commit Task 2 after fresh validation**

Suggested commit:

```text
git add resources/app.js resources/index.html test/frontend-smoke.test.mjs package.json package-lock.json README.txt windows/install.ps1 scripts/package-windows.mjs scripts/verify-release.mjs
git add <any focused updater-renderer test actually created>
git commit -m "chore: prepare Med Check-in 2.4.1"
```

Do not stage generated `dist/` output.

---

## Final validation and release-owned smoke

- [ ] **Step 1: Confirm clean branch and fresh gates after the final source change**

Run:

```text
npm test
npm run package:windows
git diff --check
git status --short
```

Report exact counts/results. Do not rely on earlier task-local output after a later source edit.

- [ ] **Step 2: Push/open a PR only if the user has authorized those external mutations for the implementation run**

Follow `AGENTS.md` and `.codex/PROJECT.md`. A local implementation request does not itself authorize push/PR/release unless the user’s Codex task explicitly grants it.

- [ ] **Step 3: Require Windows CI on the implementation head**

Canonical CI evidence:

```text
npm ci --ignore-scripts
npm test
npm run package:windows
```

Do not claim Windows CI from local packaging.

- [ ] **Step 4: Before publishing 2.4.1, perform the manual updater smoke from installed 2.4.0**

Use a safe real-Windows installation with a backup/data copy as appropriate. Observe, rather than infer:

```text
Check for updates
-> explicit current/no-update message when no newer release is present

When 2.4.1 is the newer published/testable release:
available 2.4.1
-> click Обновить
-> visible downloading/verifying state
-> visible launching-installer state
-> visible installer-started/restart state (even if brief)
-> old window closes as installer takes over
-> application relaunches as 2.4.1
-> existing records/settings/drafts remain present
```

Do not intentionally sabotage the user’s live installer to test the failure path. Automated acknowledgement-failure/timeout coverage owns that case.

## Expected implementation commits

Keep this proportional to the change rather than creating a commit per checkbox:

1. `fix: acknowledge updater installer launch`
2. `chore: prepare Med Check-in 2.4.1`

If implementation naturally lands as one coherent validated commit, that is also acceptable. Do not split merely for ceremony.
