# PowerShell Tray Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Med Check-in 2.1.1 without a compiled tray executable, using Windows PowerShell and WinForms for the notification-area host.

**Architecture:** Node supervises `powershell.exe -STA -File windows\tray-host.ps1`; the script polls the existing authenticated host API and opens the existing browser UI. The installer performs a clean application-file replacement while preserving the separate data directory.

**Tech Stack:** Node.js 22.23.1, `node:sqlite`, Windows PowerShell 5.1, WinForms, Windows Task Scheduler, Microsoft Edge app mode.

## Global Constraints

- Do not compile, package, or reference a new tray executable.
- Preserve `%LOCALAPPDATA%\MedCheckin2` during installation.
- Keep bootstrap `.bat`, `.vbs`, and installer/uninstaller `.ps1` files ASCII with CRLF.
- Store `windows\tray-host.ps1` as UTF-8 with BOM and CRLF.
- Keep all runtime HTTP traffic on authenticated `127.0.0.1` endpoints.

---

### Task 1: Replace native source with PowerShell tray host

**Files:**
- Create: `windows/tray-host.ps1`
- Delete: `native/TrayHost.cs`
- Test: `test/native-host.test.mjs`

- [x] Add failing tests for WinForms tray behavior, host polling, Edge app mode, Russian menu labels, BOM encoding, and orphan ownership release.
- [x] Implement the PowerShell tray script.
- [x] Run the focused tray tests.

### Task 2: Supervise system PowerShell instead of an application executable

**Files:**
- Modify: `backend/main.mjs`
- Test: `test/frontend-smoke.test.mjs`

- [x] Add failing source tests for `WindowsPowerShell`, `-STA`, and `tray-host.ps1`.
- [x] Launch the script through hidden Windows PowerShell and preserve host PID/heartbeat handling.
- [x] Keep a no-op host only on non-Windows development platforms.

### Task 3: Replace compilation and rollback installer flow

**Files:**
- Modify: `windows/install.ps1`
- Modify: `windows/uninstall.ps1`
- Modify: `README.txt`
- Modify: `THIRD_PARTY_NOTICES.txt`
- Test: `test/package-layout.test.mjs`

- [x] Remove C# compiler and executable validation.
- [x] Validate the tray script BOM before replacement.
- [x] Stop owned PowerShell hosts by exact command-line identity.
- [x] Preserve data while replacing application files.
- [x] Validate fresh backend health and PowerShell-host heartbeat.
- [x] Write durable installation diagnostics instead of restoring 2.0.2.

### Task 4: Package and verify 2.1.1

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/package-windows.mjs`
- Modify: `scripts/verify-release.mjs`

- [x] Update release metadata to 2.1.1.
- [x] Exclude the native source directory.
- [x] Require the PowerShell tray script and reject legacy host files.
- [x] Run all tests, JS syntax checks, encoding checks, ZIP verification, and live backend/UI smoke test.
