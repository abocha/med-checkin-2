# Med Check-in 2.4.1 Updater Feedback and Launch Acknowledgement Design

## Problem

Med Check-in 2.4.0 can discover a newer release, show its release notes, download the ZIP and checksum, verify SHA-256, extract the package, and enqueue an `install-update` action for the PowerShell tray host. The user-facing contract breaks at that boundary.

After the backend queues the action, it currently publishes `phase = "installing"` while clearing the in-memory candidate. The browser renders update availability almost entirely from `availableVersion`, so the update card immediately falls back to the ordinary “last checked” state. The user cannot tell whether the package is still downloading, has been verified, is waiting for the tray host, or actually launched an installer.

The tray host then drains the queued action and calls `Start-Process` for `INSTALL.bat`. If that launch fails, the failure is written only to `tray.log`; the backend has already forgotten the candidate and the browser receives no failure. A successful launch and a failed launch therefore look the same from the UI.

There is a second, smaller feedback gap: a successful manual check that finds no newer version produces no positive confirmation beyond a changed “last checked” timestamp.

## Outcome

2.4.1 makes updater state explicit and trustworthy without redesigning the updater:

- a successful check with no newer compatible release clearly says that the installed version is current;
- checking, downloading/verifying, launching, and installer-started states are visible in the update card;
- the backend does not treat a queued tray action as proof that the installer started;
- the tray host acknowledges installer-launch success or failure back to the backend;
- a launch failure or missing acknowledgement restores the available update and a usable retry path;
- the existing GitHub-only discovery, SHA-256 verification, package extraction, installer, data preservation, and updater mutual-exclusion contracts remain unchanged.

This is a patch release: **2.4.1**.

## Scope

### In scope

1. Explicit updater UI states for:
   - never checked;
   - checking;
   - current/no update;
   - update available;
   - downloading and verifying;
   - launching installer;
   - installer launch acknowledged;
   - check/preparation/launch failure.
2. Positive user-facing result after a successful check with no newer compatible version.
3. A narrow acknowledgement protocol between the PowerShell tray host and the backend for the existing `install-update` host action.
4. A bounded acknowledgement timeout so a drained/lost host action does not leave the updater permanently stuck.
5. Retry after installer-launch failure or acknowledgement timeout.
6. 2.4.1 version/release metadata and updater documentation.
7. Automated regression coverage plus one real-Windows updater smoke before release.

### Non-goals

- no new updater framework, service, helper process, or dependency;
- no resumable download or progress percentage;
- no background/automatic installation;
- no rollback system beyond the installer’s existing preparation and data-preservation behavior;
- no GitHub API redesign;
- no changes to medical-data storage, schema, backups, import/export, reminders, scales, or treatment data;
- no attempt to confirm the *entire installation completed* from the old process. 2.4.1 only distinguishes “installer process launch acknowledged” from “not launched / not confirmed.” The freshly started application remains the proof of completed upgrade.

## Existing architecture retained

The existing path remains:

```text
browser
  -> POST /api/v1/updates/install
backend update service
  -> download ZIP + checksum
  -> verify SHA-256
  -> extract verified package to user temp
  -> enqueue install-update host action
PowerShell tray host
  -> poll /api/v1/host/poll
  -> launch verified INSTALL.bat
installer
  -> replace installed application files
  -> preserve %LOCALAPPDATA%\MedCheckin2
  -> relaunch and health-check the application
```

2.4.1 adds only one return edge:

```text
PowerShell tray host
  -> POST installer-launch result
  -> backend update service advances to installing or returns to available
```

The host action remains an in-memory queue. We do not replace it with persistent job machinery.

## Update state model

`phase` becomes the authoritative presentation state. `availableVersion` is not used as a proxy for whether something is happening.

The intended phases are:

| Phase | Meaning | Primary UI copy |
|---|---|---|
| `idle` | no successful check has established a result yet | `Проверка обновлений ещё не выполнялась.` |
| `checking` | GitHub release metadata request in flight | `Проверяем обновления…` |
| `current` | successful check found no newer compatible release | `У вас установлена последняя версия.` plus checked time |
| `available` | a newer compatible verified-shape release candidate is known | `Доступна версия X.` |
| `downloading` | ZIP/checksum download, checksum verification, or extraction in progress | `Скачиваем и проверяем обновление X…` |
| `launching` | verified package is staged and an installer-launch host action is awaiting acknowledgement | `Запускаем установщик X…` |
| `installing` | tray host successfully started the installer process | `Установщик запущен. Приложение перезапустится автоматически.` |

Errors remain explicit via `status.error` and take precedence in the rendered status copy. An error during checking may leave no candidate. An error during installer launch/acknowledgement returns to `available` and keeps the candidate retryable.

A periodic automatic check may also leave the durable `current` state. This is acceptable and simpler than inventing separate manual-vs-automatic result types; the message is still true when the user later opens Settings.

## Candidate lifetime and mutual exclusion

The release candidate must survive until installer launch is positively acknowledged.

Current behavior clears it immediately after `hostActions.enqueue()`. 2.4.1 changes that rule:

- staging in progress continues to use the existing `installation` promise guard;
- after staging, a `pendingLaunch` record owns `{ actionId, release, stagingDir }` until acknowledgement or timeout;
- while `installation`, `pendingLaunch`, or acknowledged `installing` state is active, another install must not start and a forced check must not fetch or replace candidate metadata;
- on positive launch acknowledgement, the service enters `installing`; the old process is expected to be replaced shortly, so no further updater operation is accepted from that process;
- on negative acknowledgement or timeout, staged files are removed, `pendingLaunch` is cleared, the candidate remains available, and the user may retry. A retry may download/stage again rather than introducing staging reuse logic.

Use a native opaque action identifier such as `crypto.randomUUID()`; it is not user-visible and has no persistence requirement.

## Tray-host acknowledgement

The queued action becomes:

```json
{
  "type": "install-update",
  "actionId": "<opaque id>",
  "stagingDir": "<verified temp directory>"
}
```

After validating the staging path, the tray host attempts the existing installer launch.

- If `Start-Process` succeeds, the tray immediately POSTs `{ actionId, ok: true }` to a fixed authenticated local updater endpoint.
- If launch throws, the tray logs the detailed PowerShell error as today and POSTs `{ actionId, ok: false }`. The browser receives a generic user-safe retry message rather than raw system/path details.
- If the action is drained but no acknowledgement reaches the backend within a short bounded period (recommended default: 15 seconds), the backend treats launch as unconfirmed and returns to `available` with a retry message.

The acknowledgement proves only that Windows accepted the installer process launch. The installer may then close the old backend/window as part of the normal upgrade.

A stale or unknown `actionId` is rejected rather than mutating current updater state.

## HTTP contract

Keep the existing updater endpoints:

```text
GET  /api/v1/updates
POST /api/v1/updates/check
POST /api/v1/updates/install
```

Add one fixed local authenticated endpoint for the tray host:

```text
POST /api/v1/updates/install-launch-result
```

Body:

```json
{ "actionId": "<opaque id>", "ok": true }
```

or:

```json
{ "actionId": "<opaque id>", "ok": false }
```

The endpoint delegates to the update service. Invalid shape, unknown IDs, duplicate/stale acknowledgements, or acknowledgements when no launch is pending are rejected with a client error and do not mutate the candidate.

No path supplied by the tray is accepted by this endpoint.

## Browser behavior

`resources/app.js` renders `phase` directly.

### Check button

- disabled while `checking`, `downloading`, `launching`, or `installing`;
- enabled for `idle`, `current`, `available`, and recoverable error states.

### Update button

- shown and enabled only when `phase === "available"` and a candidate exists;
- may use `Повторить обновление` when `status.error` represents a failed/unconfirmed launch;
- while downloading/launching, keep a stable visible status instead of making the update card visually collapse;
- hidden/disabled after positive installer-launch acknowledgement.

### Release notes

Release notes remain visible while the candidate is `available`, `downloading`, or `launching`. They may remain visible in `installing` until the old UI closes. A no-update/current result hides old candidate notes.

### No-update success

After a successful check with no newer compatible release, the card must visibly say:

> У вас установлена последняя версия.

The existing checked timestamp may follow it, but must not be the only evidence that the button did anything.

## Failure behavior

- GitHub/network/metadata failure: visible error, no false “current” claim, check may be retried.
- Missing expected ZIP/checksum asset: visible error, no install button.
- download/checksum/extraction failure: candidate remains retryable and the failure is visible.
- tray `Start-Process` failure: candidate remains retryable; detailed failure stays in `tray.log`; browser gets a generic launch-failed message.
- acknowledgement timeout: candidate remains retryable; browser says launch could not be confirmed.
- stale/duplicate acknowledgement: reject and preserve current state.

No failure path may silently clear the only retryable candidate merely because an action was enqueued.

## Testing

### `test/updates.test.mjs`

Add/adjust tests for:

- successful no-update check publishes `phase === "current"`;
- install staging publishes `launching`, retains the candidate, and queues exactly one action containing an `actionId`;
- positive acknowledgement advances to `installing`;
- negative acknowledgement returns to `available`, preserves candidate, and permits retry;
- acknowledgement timeout returns to `available` and permits retry;
- stale/wrong `actionId` is rejected without changing status;
- check and second-install attempts remain blocked while launch acknowledgement is pending;
- existing install→check and check→install interleaving coverage remains green.

The service may accept an injectable `launchAckTimeoutMs` solely to keep timeout tests fast and deterministic; production default remains 15 seconds.

### `test/http-server.test.mjs`

Cover the fixed launch-result endpoint with success and invalid/stale acknowledgement shapes. Confirm it is bearer-token protected by the existing server authentication path.

### Frontend tests

Extend focused frontend coverage so the updater status renderer has regression checks for at least:

- `current` -> visible `У вас установлена последняя версия`;
- `downloading` -> visible preparation text and disabled conflicting actions;
- `launching` -> visible installer-launch text;
- `installing` -> visible restart message;
- recoverable launch failure -> update retry remains available.

Prefer a small test hook or focused pure renderer helper over browser automation if that follows the current static-UI test style. Do not introduce a frontend test framework.

### Windows/package validation

Run:

```text
npm test
npm run package:windows
git diff --check
```

CI must pass on `windows-latest` / Node 22.23.1.

Before releasing 2.4.1, perform one real-Windows updater smoke from 2.4.0:

1. open Settings and click Check;
2. verify a known current/no-update state shows positive confirmation where applicable;
3. with 2.4.1 published as the newer release, verify `available -> downloading -> launching -> installing` is visibly understandable;
4. verify the old app closes as the installer takes over;
5. verify Med Check-in relaunches as 2.4.1 with existing local data intact.

A synthetic tray-launch failure can remain automated/static where practical; do not deliberately break the user’s real installation to exercise it.

## Release integration

Update the patch version consistently to `2.4.1` in the existing release metadata locations, including:

- `package.json` / `package-lock.json`;
- `resources/index.html` exact document title while keeping the visible major/minor heading `2.4`;
- `README.txt` release heading and updater explanation;
- `windows/install.ps1` exact application/diagnostics version strings;
- `scripts/package-windows.mjs` archive/version constants;
- `scripts/verify-release.mjs` expected version;
- any existing tests that intentionally assert the exact patch version.

Keep stable Windows identities stable:

- scheduled task names remain `Med Check-in 2.0` / `Med Check-in 2.0 Watchdog`;
- shortcut family remains `Med Check-in 2.4`;
- tray display may remain `Med Check-in 2.4`.

No database or portable-data version changes are involved.

## Orchestration

The repo map is fresh and this change is localized. Do not start with a broad explorer pass unless implementation reveals material drift.

The updater backend + HTTP + tray acknowledgement is one coherent integration-heavy/process-coordination boundary. `terra_workhorse` is the natural delegated implementer if the primary delegates it. Because the actual diff changes updater handoff, retry/idempotency, and process coordination, use a narrow `sol_reviewer` pass on that concrete boundary after focused tests and the cheap full `npm test` gate.

The browser copy/state rendering and patch-version integration are bounded, pattern-following work suitable for `luna_implementer` at high reasoning if delegated after the backend status contract is stable. Ordinary review belongs to `terra_reviewer`.

Keep one final coherent Terra whole-branch review only if both boundaries are delegated separately; otherwise a single coherent review plus the narrow Sol updater review is enough. Do not create an agent per checklist item.

## Acceptance criteria

2.4.1 is ready for release when all of the following are true:

- pressing Check and finding no newer release produces an explicit positive “latest version” message;
- pressing Update never makes the card silently revert to an idle-looking timestamp while work is in progress;
- the UI visibly distinguishes checking, downloading/verifying, launching, and installer-started states;
- backend state does not claim installer launch merely because an action was queued;
- tray launch success/failure is acknowledged to the backend with an opaque action ID;
- failed/unconfirmed launch restores a retryable candidate and visible error;
- pending launch blocks conflicting check/install operations;
- SHA-256 verification and existing installer/data-preservation behavior remain unchanged;
- focused tests, full `npm test`, Windows packaging, `git diff --check`, Windows CI, and the real 2.4.0 -> 2.4.1 updater smoke pass;
- no unrelated product or persistence behavior changes.
