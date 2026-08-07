# Med Check-in 2.1 Native Tray Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace NeutralinoJS with a Windows Forms tray host and Edge app-mode UI without changing the user's SQLite data.

**Architecture:** Node serves the UI and owns the authenticated API. A compiled C# `NotifyIcon` process polls the backend for commands and reminders, launches Edge with a dedicated profile, and is supervised by Node. The installer compiles the host before replacing an existing installation.

**Tech Stack:** Node.js 22 built-in HTTP and SQLite, browser HTML/CSS/JavaScript, .NET Framework Windows Forms, Windows Task Scheduler, Microsoft Edge app mode.

## Global Constraints

- Preserve `%LOCALAPPDATA%\MedCheckin2` and the existing SQLite schema.
- Bind HTTP only to `127.0.0.1` and require a random bearer token for UI/API access.
- Keep Windows bootstrap `.ps1`, `.bat`, and `.vbs` files ASCII-only with CRLF line endings.
- Do not ship or download NeutralinoJS.
- Compile the tray host before stopping or replacing a working installation.
- Keep startup and watchdog task names compatible with existing 2.0.x installations.

---

### Task 1: Browser-hosted frontend and static HTTP delivery

**Files:**
- Modify: `backend/http-server.mjs`
- Modify: `resources/index.html`
- Modify: `resources/app.js`
- Replace: `resources/startup-runtime.js`
- Modify: `test/frontend-smoke.test.mjs`
- Modify: `test/http-server.test.mjs`

**Interfaces:**
- Produces: `createHttpServer({ resourcesDir, ... })` serving `/app/` and `/app/<asset>`.
- Produces: `MedCheckinStartup.readBrowserRuntime(location, sessionStorage)` returning `{ token, port, view, localDate, slot }`.
- Produces: browser UI control calls `POST /api/v1/control/close-window`.

- [x] Write failing tests proving `/app/` requires the token, serves HTML/assets, the frontend contains no Neutralino calls, and browser startup removes the token from the URL.
- [x] Run the focused tests and confirm they fail for the missing browser-host behavior.
- [x] Implement static resource delivery with safe path resolution and security headers.
- [x] Replace Neutralino startup, export, hide/show, notification, and filesystem calls with browser equivalents.
- [x] Run the focused tests and full suite.
- [x] Commit with `feat: serve browser-hosted local UI`.

### Task 2: Host command queue and watchdog semantics

**Files:**
- Create: `backend/host-actions.mjs`
- Modify: `backend/http-server.mjs`
- Modify: `backend/main.mjs`
- Modify: `test/http-server.test.mjs`
- Create: `test/host-actions.test.mjs`
- Modify: `test/frontend-smoke.test.mjs`

**Interfaces:**
- Produces: `createHostActionQueue()` with `enqueue(action)`, `drain()`, and `size`.
- Produces: `GET /api/v1/host/poll` returning `{ actions, due }` and recording host heartbeat through `POST /api/v1/control/heartbeat`.
- Produces: controls `show`, `close-window`, `restart-host`, and `quit`.

- [x] Write failing queue and API tests for FIFO draining, open/close commands, reminder polling, and host heartbeat.
- [x] Run focused tests and confirm failure.
- [x] Implement the queue and backend control mapping.
- [x] Change watchdog health to host heartbeat rather than browser heartbeat.
- [x] Run focused and full tests.
- [x] Commit with `feat: add native host command channel`.

### Task 3: Windows Forms tray host

**Files:**
- Create: `native/TrayHost.cs`
- Create: `test/native-host.test.mjs`
- Create: `resources/icons/app.ico`

**Interfaces:**
- Consumes: `%LOCALAPPDATA%\MedCheckin2\runtime.json` containing `port` and `token`.
- Consumes: `GET /api/v1/host/poll`, reminder endpoints, settings endpoint, and control endpoints.
- Produces: `MedCheckinTray.exe --app-root <path> [--show]` after installer compilation.

- [x] Write failing source-contract tests for single-instance mutex, `NotifyIcon`, three-second timer, authenticated poll, Edge `--app`, dedicated `--user-data-dir`, fallback browser, and tray actions.
- [x] Run the test and confirm failure because the host source is absent.
- [x] Implement C# 5-compatible Windows Forms host using only .NET Framework assemblies.
- [x] Add custom ICO asset and source-contract checks for closing only the dedicated Edge profile.
- [x] Run focused and full tests.
- [x] Commit with `feat: add native Windows tray host`.

### Task 4: Backend supervision of native host

**Files:**
- Modify: `backend/supervisor.mjs`
- Modify: `backend/main.mjs`
- Modify: `test/frontend-smoke.test.mjs`
- Modify: `test/process-safety.test.mjs`

**Interfaces:**
- Consumes: `MedCheckinTray.exe --app-root APP_ROOT`.
- Produces: runtime fields `hostPid` and `hostHeartbeatAt`.
- Produces: supervisor logs using generic `Host` wording rather than Neutralino wording.

- [x] Write failing tests proving backend launches `MedCheckinTray.exe`, passes `--show`, stores `hostPid`, and no longer references Neutralino.
- [x] Run focused tests and confirm failure.
- [x] Generalize supervisor labels and wire native host launch/restart.
- [x] Remove browser-heartbeat assumptions and Neutralino runtime fields.
- [x] Run focused and full tests.
- [x] Commit with `refactor: supervise native tray host`.

### Task 5: Windows installer, updater, shortcuts, and uninstaller

**Files:**
- Modify: `windows/install.ps1`
- Modify: `windows/uninstall.ps1`
- Modify: `test/package-layout.test.mjs`
- Remove: `neutralino.config.json`
- Remove generated dependency: `resources/js/neutralino.js`
- Modify: `THIRD_PARTY_NOTICES.txt`
- Modify: `README.txt`

**Interfaces:**
- Produces: staged `MedCheckinTray.exe` compiled with `csc.exe /target:winexe`.
- Produces: shortcuts whose target is `wscript.exe` and arguments are `launch-hidden.vbs --show`.
- Preserves: task names `Med Check-in 2.0` and `Med Check-in 2.0 Watchdog` for in-place upgrades.

- [x] Write failing package tests proving Neutralino download/config is absent, C# host compilation precedes `Stop-OldInstance`, and shortcuts invoke the launcher.
- [x] Run focused tests and confirm failure.
- [x] Replace runtime preparation with Node download plus staged C# compilation.
- [x] Update process cleanup for `MedCheckinTray.exe`, legacy `MedCheckin.exe`, and bundled Node.
- [x] Update shortcuts, uninstall behavior, notices, and README.
- [x] Run bootstrap encoding tests and full suite.
- [x] Commit with `feat: install native-host edition`.

### Task 6: Package and release verification

**Files:**
- Modify: `package.json`
- Modify: `scripts/package-windows.mjs`
- Create: `scripts/verify-release.mjs`
- Modify: `test/package-layout.test.mjs`

**Interfaces:**
- Produces: `dist/med-checkin-2.1.0-windows-installer.zip`.
- Produces: release verification checking archive entries, absence of Neutralino, ASCII/CRLF bootstrap files, and source version.

- [x] Write failing tests for version `2.1.0`, native source inclusion, Neutralino exclusion, and release verifier invocation.
- [x] Run focused tests and confirm failure.
- [x] Update package metadata and archive builder.
- [x] Implement release verification and build the ZIP.
- [x] Run `npm test`, syntax checks, packaging, archive verification, and a backend HTTP smoke test.
- [x] Commit with `chore: package Med Check-in 2.1`.
