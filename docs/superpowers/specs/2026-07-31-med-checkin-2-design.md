# Med Check-in 2.0 Design

## Goal

Build a lightweight, local-only Windows companion that starts automatically, remains in the system tray, prompts for check-ins at 13:00 and 22:00, survives UI crashes and computer restarts, stores observations reliably, and provides useful history, analytics, backups, and exports.

## Architecture

A hidden Node.js supervisor is launched by Windows Task Scheduler at user logon. It owns the SQLite database, reminder schedule, local HTTP API, backups, and the lifecycle of the NeutralinoJS window/tray process. NeutralinoJS supplies the lightweight native window, tray menu, and operating-system notifications; the frontend is plain HTML, CSS, and JavaScript served from the packaged Neutralino resources.

The supervisor listens only on `127.0.0.1` and enforces a per-install API token. It acquires the listening port as the single-instance lock. If the Neutralino process exits unexpectedly, the supervisor restarts it with bounded backoff. If the supervisor exits, Task Scheduler restarts it.

## User Experience

- On normal startup, no window opens; only the tray icon appears.
- At 13:00 and 22:00 local time, a native notification appears and the tray status changes.
- Opening a scheduled check-in loads the record for that date and slot. Saving again updates the same record, preventing duplicates.
- A missed reminder remains available for four hours. After sleep or reboot, the app offers the still-relevant slot.
- Closing the main window hides it. Explicit Exit from the tray stops the supervisor until the next logon or manual launch.
- The main navigation contains Check-in, History, Analytics, and Settings.

## Check-in Data

### Core 0–10 scales

- mood
- anxiety
- irritability
- energy
- focus
- functioning
- sleep quality
- appetite

### Sleep

- nighttime sleep duration
- daytime sleep duration
- sleep start time, optional
- final wake time, optional

### Context flags

- caffeine
- notable stress
- conflict
- illness or pain
- physical activity
- unusually productive or pleasant day

### Side-effect flags

- dizziness
- headache
- nausea or abdominal discomfort
- sweating
- palpitations
- brain zaps
- unusual dreams
- crying

### Activation flags

- reduced need for sleep
- racing thoughts
- unusual talkativeness
- inner motor or restlessness
- impulsivity
- unusually elevated or agitated state

### Free text

- notes
- red flags

## Storage

- SQLite database in `%LOCALAPPDATA%\MedCheckin2\med-checkin.sqlite`.
- One row per `(local_date, slot)` with a unique constraint.
- Settings stored in SQLite.
- Daily rotating database backups retained for 30 days.
- CSV and JSON export to a user-selected folder.

## Analytics

- Daily averages and 3-day rolling trends.
- Day-versus-evening comparison for paired days.
- Symptom and context frequency.
- First seven days versus later period comparison from a configurable treatment-change date.
- Analytics are descriptive and always display the limitation that they do not establish medical causality.

## Reliability and Resource Constraints

- Windows 10/11 x64.
- NeutralinoJS 6.7.0.
- A pinned Node.js 22 LTS runtime with built-in `node:sqlite`, downloaded during first installation and then kept locally beside the app.
- No Electron, React, database ORM, telemetry, account, cloud sync, or network access beyond loopback.
- No polling faster than 15 seconds; idle UI reminder polling defaults to 30 seconds.
- Target idle CPU below 0.2% and total working set below 100 MB on the target machine; final values must be measured rather than assumed.
- Task Scheduler launch at logon with restart-on-failure and start-when-available.

## Security and Privacy

- The HTTP server binds only to `127.0.0.1`.
- Every API request requires a random token supplied to the frontend at launch.
- The API rejects oversized request bodies and validates all fields.
- No third-party analytics or remote requests.

## Testing

- Node built-in test runner for domain validation, slot selection, reminder timing, analytics, CSV serialization, and repository behavior.
- HTTP API integration tests use a temporary SQLite database and ephemeral port.
- Frontend smoke tests verify required form controls and navigation are present.
- Packaging validation checks expected runtime and installer files.
