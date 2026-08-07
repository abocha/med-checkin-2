# Med Check-in 2.2 Reliability Design

**Status:** Approved, scope-trimmed design  
**Date:** 2026-08-07  
**Scope:** Personal-use Windows application, one user, one local data store

## Goal

Med Check-in 2.2 is a modest reliability upgrade. It should make observations truthful, recoverable, and easier to evolve without turning the app into a generalized health-data platform.

The release focuses on things that should already feel native to a personal longitudinal tracker:

1. Day and Evening are semantic scheduled observations, not literal clock-time identities.
2. Extra observations can be recorded at any time without distorting the standardized twice-daily series.
3. Missing measurements stay missing instead of being replaced with plausible defaults.
4. Original record time, edit time, and observation time are distinct where the data genuinely supports that distinction.
5. Treatment changes are stored as simple structured snapshots.
6. Schema upgrades, backup restore, and JSON replacement import have straightforward recovery safeguards.
7. The Windows app gets basic CI coverage.

The application remains local-only, account-free, offline after installation, and optimized for one person's use.

## Scope discipline

2.2 should prefer the smallest implementation that satisfies the behavior below.

- Do not add abstractions for hypothetical multi-user, cloud, synchronization, or distributed-data needs.
- Do not build a general conflict-resolution or synchronization engine.
- Do not add dependencies unless the existing platform cannot reasonably implement a required behavior.
- Do not redesign the tray host, installer, frontend architecture, or repository layout unless a required 2.2 behavior cannot be implemented safely otherwise.
- Reviewer suggestions that concern extremely rare hypothetical failures should not trigger architectural rewrites unless they expose a concrete, plausible data-loss/security path in this personal local app.

---

## 1. Database migrations

Use `PRAGMA user_version` for explicit schema versioning.

The existing 2.1.1 database is legacy version `0`; the 2.2 schema is version `1`.

Before migrating an existing database:

1. checkpoint WAL state;
2. create a timestamped pre-migration SQLite backup;
3. verify the backup exists;
4. run the schema/data migration transactionally where SQLite permits;
5. set `user_version = 1` only after success.

If migration fails, startup stops and the recovery-backup path is logged. A clean 2.2 install creates the latest schema directly.

Migration must preserve existing IDs, timestamps, measurements, sleep fields, flags, notes, red flags, settings that remain relevant, and reminder state.

---

## 2. Observation model

### 2.1 Entry kinds

Every check-in is either:

- `scheduled`
- `extra`

Scheduled observations have `period = day | evening`. Extras have `period = null`.

There may be at most one scheduled Day and one scheduled Evening observation per `local_date`. Extras are unlimited.

Keep the existing integer `id` primary key. 2.2 does **not** add UUID/stable synchronization keys.

### 2.2 Core fields

The existing check-in table keeps its measurement/sleep/flag/note fields and gains or changes these concepts:

```text
id             integer primary key
kind           scheduled | extra
local_date     target scheduled date, or observed local date for Extra
period         day | evening | null
scheduled_for  timestamp | null
observed_at    timestamp | null for migrated legacy rows
recorded_at    timestamp
updated_at     timestamp
```

All eight scale columns are nullable in storage because Extras may contain partial measurements. Validation is stricter for scheduled observations.

### 2.3 Timestamp semantics

- `scheduled_for`: when a new scheduled observation was intended to occur. Snapshot the configured Day/Evening time when the scheduled record is created. Migrated legacy rows may remain null.
- `observed_at`: when the described state was observed. New records require it. Extras default to now. Retrospective entries may use an earlier timestamp. Migrated 2.1.1 rows remain null because no distinct observation timestamp existed.
- `recorded_at`: when the database first accepted the entry. Backend-generated and immutable during ordinary edits.
- `updated_at`: timestamp of the latest successful ordinary edit.

For a scheduled entry completed after midnight, `local_date` remains the target scheduled date even if `observed_at` falls on the following calendar date.

### 2.4 Legacy mapping

```text
slot 13:00 -> scheduled/day
slot 22:00 -> scheduled/evening
```

Reminder state uses the same mapping. Do not invent historical `scheduled_for` or `observed_at` values from current settings or legacy slot labels.

---

## 3. Measurement capture and validation

All eight core scales remain simple numeric **0-10** scales:

- mood
- anxiety
- irritability
- energy
- focus
- functioning
- sleep quality
- appetite

A new scheduled Day/Evening form starts with all eight genuinely unset. No frontend midpoint/default values and no backend fallback such as `5`.

A scheduled entry requires all eight valid scale values before save. Other fields remain optional.

An Extra may contain any subset of scales, flags, symptoms, activation flags, red flags, and note text. It must contain at least one meaningful value.

Provide explicit **Use previous values** for scheduled entries. It copies only the eight scale values from the previous saved scheduled observation; nothing is copied automatically.

Each scale shows concise stable endpoint guidance, while storage remains 0-10.

---

## 4. Drafts and unsaved changes

Persist unfinished forms in browser `localStorage`.

Draft identity:

- scheduled: `local_date + period`;
- new Extra: generated local draft key;
- existing saved entry: integer check-in `id`.

Any unsaved edit marks the form dirty. App-controlled navigation that would discard it should offer Save / Discard / Cancel where possible. Native window closure may use the browser unload warning as best effort; the local draft is the actual crash/forced-close recovery mechanism.

When a draft is found later, show explicit Restore / Discard rather than silently restoring it. Successful save or explicit discard removes the draft.

---

## 5. Entry flows

The capture UI exposes:

```text
Day
Evening
Extra
```

Day/Evening show the configured reminder clock time beside the semantic label, but the time is not record identity.

History provides **Add missed check-in**. It asks for target date, Day/Evening, observation datetime, and scheduled datetime (defaulted from current corresponding schedule but editable). Duplicate scheduled identity opens/offers the existing entry instead of overwriting it.

Extra defaults `observed_at` to now and allows retrospective editing.

---

## 6. Treatment history

Replace the single `treatmentChangeDate` and `medicationLabel` settings with one simple treatment-events table.

```text
treatment_events
  id
  effective_date   nullable only for baseline
  regimen_json     JSON array of medication snapshots
  note
  created_at
  updated_at
```

Each `regimen_json` item contains:

```text
name
amount
unit
timing?   optional free text
```

No separate medication-items table is required in 2.2. The app does not need SQL queries by medication identity, and JSON keeps this personal-use model much smaller.

A full regimen snapshot is stored at each treatment event. An empty regimen array is allowed to represent no active medication.

Allow at most one undated baseline and at most one dated snapshot per `effective_date`.

Known-history seed:

**Undated baseline before the dated change**
- Escitalopram 20 mg
- Atomoxetine 80 mg

**From 2026-07-07**
- Escitalopram 10 mg
- Atomoxetine 80 mg

Settings gains a Treatment section with current regimen, chronological events, Add/Edit/Delete. Adding a new dated event pre-fills the regimen effective immediately before that date. The header label derives from today's effective regimen.

---

## 7. History

History must no longer stop at the latest 200 rows.

Provide:

- 7 days / 30 days / 90 days / All;
- custom from/to dates;
- Day / Evening / Extra filter;
- pagination or incremental loading;
- Add missed check-in;
- Extra.

Do not add additional note/symptom/red-flag filter systems in 2.2 unless they fall out nearly for free from existing code.

Display real timing without inventing missing legacy values. Example:

```text
Aug 7
Evening · scheduled 22:00
Recorded 22:17 · edited 22:24
```

Show `observed_at` separately when useful and known. Extras show their observation time. Treatment changes may appear as visually distinct timeline separators/cards, but they remain separate records from check-ins.

---

## 8. Reminders

Keep existing reminder settings:

```text
dayTime
eveningTime
catchupHours
repeatMinutes
remindersPausedUntil
```

Saving Day clears only Day reminder state. Saving Evening clears only Evening. Saving Extra clears neither.

Visible snooze/repeat wording and behavior must use configured `repeatMinutes`, not a hardcoded 30 minutes.

While reminders are paused, show persistent visible status with Resume until the pause expires or is cleared.

---

## 9. Lean analytics changes

2.2 keeps analytics deliberately modest.

Required changes:

- scheduled observations only contribute to existing averages/trends/comparisons;
- Extras do not affect scheduled analytics or completion;
- replace centered three-day smoothing with a trailing three-calendar-day mean;
- missing measurements remain missing;
- add simple scheduled completion statistics;
- draw dated treatment-change markers on the existing trend chart.

For each metric, the daily value is the average of available Day/Evening scheduled values for that local date. A trailing point uses that date plus the previous two calendar dates, ignoring missing daily values inside the window but never reaching farther back.

Completion denominator includes past Day/Evening opportunities. On the current date, a period counts once its configured time has passed or if it was completed early. Extras never count.

### Explicit analytics deferrals

2.2 does **not** need:

- all-eight-metric chart toggles;
- a generic treatment-event comparison engine;
- selectable "first seven days vs later" comparisons;
- Extra-value overlays inside normal trend calculations;
- new statistical or causal-analysis features.

Remove or simplify the existing single-treatment `first 7 vs later` UI rather than generalizing it.

---

## 10. Backup, restore, and JSON replacement import

### 10.1 SQLite backups

Keep automatic daily SQLite backups and existing retention.

Add **Create backup now** and **Open data folder**.

Add **Restore backup...** for recognized app-created SQLite backups.

Restore safety invariants:

1. validate the selected file as readable SQLite and a recognized Med Check-in schema;
2. create a pre-restore backup of the current database;
3. close/checkpoint the live repository before replacement;
4. replace and restart/reopen cleanly;
5. if replacement/migration fails, leave the pre-restore copy available and do not silently continue with ambiguous state.

Use the simplest restart-safe implementation that satisfies these invariants. 2.2 does not require a generalized recovery-state machine, elaborate retry protocol, or quarantine subsystem.

### 10.2 JSON export/import

The existing JSON export becomes a small versioned portability format containing:

- format version;
- exported timestamp;
- observations;
- treatment events;
- portable reminder/settings values.

Runtime tokens, paths, and transient reminder notification state are not exported.

**Import JSON...** supports only this app's 2.2+ format and only **Replace** semantics.

Before replacement:

1. fully validate the file;
2. show a preview with observation count, Extra count, treatment-event count, date range, and format version;
3. create a pre-import SQLite backup;
4. require explicit Replace confirmation.

Replace transactionally clears/recreates portable observations, treatment history, and portable settings. Valid source IDs/timestamps may be preserved because the destination portable dataset is being replaced wholesale.

There is **no JSON Merge mode, conflict resolution, UUID identity layer, or synchronization behavior in 2.2**.

Med Check-in v1 import remains out of scope.

---

## 11. Failure behavior

Reject questionable writes rather than silently repairing them.

Examples:

- missing scheduled scales;
- invalid scale ranges;
- malformed dates/timestamps;
- invalid kind/period combinations;
- duplicate scheduled identities;
- empty Extras;
- malformed treatment snapshots;
- duplicate treatment dates/baselines;
- incompatible restore files;
- invalid JSON replacement imports;
- failed migrations.

Persistent multi-step operations should be transactional where practical and otherwise protected by an explicit pre-operation backup.

---

## 12. Windows CI

Add a small GitHub Actions workflow on `windows-latest`.

It should run the repository's normal tests and Windows packaging/release verification. No deployment/release pipeline is needed.

---

## 13. Test priorities

Extend the existing suite with focused tests for:

- real 2.1.1 -> 2.2 migration using a synthetic fixture;
- Day/Evening mapping and reminder-state preservation;
- preservation of existing IDs/timestamps/data;
- null legacy `observed_at`/`scheduled_for`;
- strict scheduled scale validation;
- multiple Extras and empty-Extra rejection;
- immutable `recorded_at` / changing `updated_at`;
- drafts and cleanup;
- treatment baseline/dates/effective-regimen resolution;
- Extras excluded from reminders and scheduled analytics;
- trailing smoothing and completion denominator;
- backup validation and pre-restore backup;
- JSON export versioning, preview, Replace, and invalid-input rejection;
- Windows package/layout verification.

Do not build large combinatorial test matrices for highly theoretical states unless a real implementation path makes them plausible.

---

## 14. Non-goals

2.2 does not include:

- v1 import;
- JSON Merge/synchronization/conflict resolution;
- UUID record identity;
- cloud sync;
- accounts/multi-user/sharing;
- mobile/remote hosting;
- AI summaries or medical recommendations;
- drug databases or interaction checking;
- full edit audit history;
- normalized tables for every flag or medication item;
- generalized treatment-comparison analytics;
- causal/significance statistics;
- tray-host rewrite;
- installer redesign except where strictly required by safe restore/restart behavior.

---

## 15. Acceptance criteria

2.2 is ready when:

1. a 2.1.1 database upgrades with a verified pre-migration backup and preserved observation/reminder data;
2. scheduled identity is Day/Evening rather than literal clock times;
3. scheduled entries cannot be saved with fabricated/missing scales;
4. unlimited Extras work without affecting scheduled reminders/analytics;
5. new records distinguish observation, first-record, and latest-edit time while legacy history is not fabricated;
6. dirty forms have local draft recovery;
7. simple structured treatment history contains the known baseline and 2026-07-07 regimen and supports later dose changes;
8. History can reach the full dataset and display Day/Evening/Extra timing honestly;
9. SQLite restore and 2.2+ JSON **Replace** import validate before mutation and create safety backups;
10. analytics exclude Extras, use trailing smoothing, show treatment markers, and report sensible completion;
11. reminder UI uses configured repeat/pause values;
12. Windows CI runs the core test/package gate;
13. deferred features listed above remain absent.