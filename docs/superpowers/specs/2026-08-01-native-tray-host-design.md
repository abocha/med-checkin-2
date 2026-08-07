# Med Check-in 2.1 Native Tray Host Design

## Goal

Replace NeutralinoJS with a reliable Windows-native tray process while preserving the existing Node.js backend, SQLite database, check-in UI, reminders, analytics, exports, backups, autostart, and watchdog behavior.

## Architecture

The installed application has three independent pieces:

1. `backend/main.mjs` owns SQLite, the authenticated loopback HTTP API, static UI delivery, reminders, backups, and process supervision.
2. `native/TrayHost.cs` is compiled during installation into `MedCheckinTray.exe`. It owns the Windows notification-area icon, reminder balloons, tray menu, and launching/closing the UI.
3. Microsoft Edge opens the local UI in app mode with a dedicated Med Check-in profile. If Edge is unavailable, the host opens the local URL in the default browser.

The tray host is a child of the backend. If it exits, the backend restarts it with bounded backoff. The scheduled watchdog only checks backend health and tray-host heartbeat; it does not depend on a browser window remaining open.

## Local UI and authentication

The backend serves `resources/index.html` and assets below `/app/`. The tray host opens a URL containing the current random API token. Browser startup stores the token in `sessionStorage`, removes it from the visible URL, and sends it only in the `Authorization` header.

The frontend no longer imports or calls Neutralino. Saving, snoozing, dismissing, or pressing Close asks the backend to enqueue a close-window command. The tray host receives commands through a short local poll and closes only Edge processes using the dedicated Med Check-in profile. Browser download APIs replace Neutralino save dialogs.

## Native tray behavior

`MedCheckinTray.exe` uses Windows Forms `NotifyIcon`. Its menu contains:

- Open check-in
- History
- Analytics
- Settings
- Snooze current reminder for 30 minutes
- Skip current reminder
- Pause reminders for 2 hours
- Resume reminders
- Exit until next Windows sign-in

The host polls the loopback API every three seconds. A poll returns queued actions and the currently due reminder. The host posts a heartbeat on every successful poll. A balloon click opens the due check-in.

## Windows installation

The installer downloads and verifies only the pinned official Node.js runtime. Before replacing a working installation it:

- stages application files and Node.js;
- compiles `native/TrayHost.cs` with the installed .NET Framework `csc.exe` as a GUI executable;
- verifies `MedCheckinTray.exe` exists;
- stops old Neutralino, tray-host, and bundled Node processes;
- replaces the program directory while preserving `%LOCALAPPDATA%\MedCheckin2`;
- registers the existing logon and watchdog tasks;
- creates Start-menu and desktop shortcuts that invoke `launch-hidden.vbs --show`, never a UI executable directly.

The bootstrap PowerShell, batch, and VBScript files remain ASCII-only with CRLF endings for Windows PowerShell 5.1 compatibility.

## Resource targets

When no UI is open, only the Node backend and small .NET Framework tray process remain. Neither performs busy loops. The tray host performs one loopback request every three seconds and all analytics remain on-demand.

## Compatibility and migration

The SQLite schema and data directory do not change. Updating from 2.0.x preserves existing records and settings. Neutralino files are removed from the installed program directory during replacement.

## Failure behavior

- If the tray host crashes, backend supervision restarts it.
- If the backend crashes, Task Scheduler restart settings and the five-minute watchdog recover it.
- If Edge cannot start, the host uses the default browser.
- If the browser is closed, reminders continue because the tray host, not the UI, owns notifications.
- If native-host compilation is unavailable, installation stops before altering the existing installation and reports the missing compiler.
