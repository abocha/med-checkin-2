# PowerShell Tray Host Design

## Goal

Replace the quarantined, freshly compiled `MedCheckinTray.exe` with a notification-area host that runs under the trusted system `powershell.exe`, while preserving the Node.js backend, SQLite data, reminders, browser-hosted UI, analytics, exports, backups, autostart, and watchdog.

## Architecture

1. The bundled Node.js backend remains the authoritative process. It writes `runtime.json`, serves the authenticated loopback UI/API, owns scheduling and storage, and supervises the tray host.
2. `windows/tray-host.ps1` runs under Windows PowerShell 5.1 with `-STA`, `-WindowStyle Hidden`, and WinForms `NotifyIcon`. It polls the authenticated host API every three seconds, sends heartbeat updates, shows reminders, exposes tray actions, and opens Edge in app mode.
3. The backend records the spawned PowerShell PID in `runtime.json`. A tray instance exits if runtime ownership moves to another PID, preventing orphaned hosts after backend recovery.
4. No C# compiler, generated executable, Neutralino binary, or custom tray executable is included or created.

## Installation

The installer prepares and verifies the official pinned Node.js runtime and the UTF-8-BOM PowerShell tray script before stopping the old application. It then removes the previous application files, installs 2.1.1 cleanly, preserves `%LOCALAPPDATA%\MedCheckin2`, registers startup/watchdog tasks, and waits for backend health plus a fresh tray heartbeat.

A failed startup does not restore the non-working 2.0.2 application. It leaves 2.1.1 installed and writes `%LOCALAPPDATA%\MedCheckin2\install-diagnostics.txt` with runtime, process, and log evidence.

## Resource and privacy constraints

- The tray host is idle except for a three-second local poll and UI message pump.
- The browser is opened only on user action or a reminder.
- API binding remains loopback-only and bearer-token protected.
- No network access occurs after installation.
