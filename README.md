# Med Check-in 2

A local-first Windows desktop check-in app built around a deliberately small reliability boundary: a Node.js backend owns data and domain logic, a PowerShell tray host owns native Windows integration, and the browser UI stays a local client.

The application stores its data in SQLite, runs only on localhost, keeps daily backups, supports versioned portable export/import, and can update itself from verified GitHub release artifacts without sending check-in data to a cloud service.

> The end-user installation and usage guide is available in [README.txt](README.txt) (Russian).

## Why this project is interesting

The visible product is simple: two scheduled daily check-ins plus optional extra observations.

The engineering problem is less simple. A useful local desktop tracker has to survive ordinary desktop failure modes:

- the browser window is closed but reminders still need to work;
- the tray host or backend process may crash independently;
- database migrations and restores must not silently destroy existing records;
- imports need schema validation before replacing local state;
- updates must preserve the data directory;
- a downloaded installer should not run before its checksum is verified;
- uninstalling or upgrading the app should not casually delete user data.

Most of the code in this repository exists to make those boring cases boring in production too.

## Architecture

```text
Windows Task Scheduler / installer
          |
          v
Node.js backend (localhost only)
  |       |        |
  |       |        +--> updater / GitHub Releases
  |       +----------> SQLite + backups
  +------------------> local HTTP API
          ^
          |
PowerShell tray host
  |       |
  |       +--> reminders / native actions
  +----------> Edge app-mode window
                  |
                  v
              local UI
```

The backend and tray host supervise each other rather than assuming a single long-lived process. Runtime state contains a random local bearer token used by the local client/host boundary.

## Reliability model

### Process supervision

- the backend starts and supervises the PowerShell tray host;
- a watchdog checks backend health and tray-host heartbeat;
- stale or failed native-host processes can be restarted independently;
- an intentional **Quit** is persisted so the watchdog does not immediately resurrect the app.

### Data safety

The database lives under:

```text
%LOCALAPPDATA%\MedCheckin2
```

The app:

- checkpoints SQLite before backup/maintenance operations;
- creates automatic and manual backups;
- validates candidate backup files before restore;
- creates a pre-restore backup before replacing the active database;
- rolls back to that backup if restore/reopen fails;
- creates a pre-import backup before replacing portable data.

### Portable data

Portable JSON is explicitly versioned. The current format is v3, while older supported formats are normalized during import.

Before an import can replace local state, the payload is validated for:

- format/version;
- observation shape;
- duplicate scheduled identities;
- scale definitions and values;
- tracked-item definitions;
- treatment-history identities;
- reminder settings and timestamps.

The UI can preview an import before the explicit replace operation.

## Update integrity

Updates are checked against this repository's GitHub Releases.

The update path expects a versioned Windows installer archive and a matching `.sha256` asset. The app:

1. downloads both;
2. parses the expected SHA-256;
3. hashes the downloaded archive locally;
4. refuses installation when the checksum does not match;
5. extracts only after verification;
6. queues installer launch through the native host;
7. waits for an explicit launch acknowledgement and handles stale/failed launch attempts.

The data directory is outside the installed application directory, so normal application replacement does not replace the SQLite database or backups.

## Privacy boundary

Med Check-in is local-first by design:

- the backend binds to `127.0.0.1`;
- check-ins and treatment history are stored in local SQLite;
- there is no account system, cloud sync, or telemetry;
- network access is used for explicit GitHub release checks/downloads;
- the browser UI runs in a dedicated Edge app profile.

This is an observation/journaling tool, not a diagnostic system or a substitute for medical advice.

## Stack

| Area | Technology |
| --- | --- |
| Backend/runtime | Node.js 22 |
| Database | built-in `node:sqlite` / SQLite |
| Native Windows integration | Windows PowerShell |
| Desktop shell | Microsoft Edge app mode |
| Packaging | PowerShell installer + ZIP release artifacts |
| Tests | Node.js built-in test runner |
| CI | GitHub Actions on `windows-latest` |

The installer pins Node.js `22.23.1` so packaged behavior does not depend on whatever Node version happens to be installed globally.

## Repository layout

```text
backend/
  main.mjs              # process lifecycle and runtime composition
  http-server.mjs       # localhost API
  repository.mjs        # SQLite persistence
  migrations.mjs        # schema preparation/migrations
  data-maintenance.mjs  # backup/restore + portable import/export
  reminders.mjs         # scheduled reminder decisions
  supervisor.mjs        # native-host process supervision
  updates.mjs           # verified GitHub release update flow

windows/
  install.ps1           # installer/update installation
  uninstall.ps1
  tray-host.ps1         # tray icon, notifications, native actions

resources/               # local frontend/static resources
test/                    # unit, integration, frontend, packaging and smoke tests
scripts/                 # Windows release packaging
```

## Development

The project intentionally has very few npm dependencies; most backend functionality uses Node's standard library.

Install the package metadata and run the test suite:

```powershell
npm ci --ignore-scripts
npm test
```

Build the Windows package layout:

```powershell
npm run package:windows
```

The GitHub Actions workflow runs the same test and packaging path on `windows-latest` using Node 22.23.1.

## Testing focus

The test suite covers substantially more than domain happy paths. It includes regression coverage for:

- SQLite repository behavior and migrations;
- backup validation and restore;
- portable import/export validation;
- reminder semantics;
- process safety and supervision;
- update-state and verified installer flow;
- startup/runtime behavior;
- native-host actions;
- frontend smoke behavior and draft recovery;
- packaged Windows layout.

That focus reflects the core design goal: local state should remain understandable and recoverable when installation, process, or maintenance operations fail.
