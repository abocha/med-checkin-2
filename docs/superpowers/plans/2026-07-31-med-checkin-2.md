# Med Check-in 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a lightweight Windows tray companion for twice-daily local medication check-ins.

**Architecture:** A bundled Node.js supervisor owns SQLite, reminders, backups, a loopback API, and NeutralinoJS lifecycle. NeutralinoJS supplies the window, tray, and notifications; the frontend uses plain HTML/CSS/JavaScript.

**Tech Stack:** Node.js 22 LTS, `node:test`, `node:sqlite`, NeutralinoJS 6.7.0, Windows Task Scheduler.

## Global Constraints

- Windows 10/11 x64.
- API on `127.0.0.1` only with a random token.
- Data in `%LOCALAPPDATA%\MedCheckin2`.
- No Electron, telemetry, cloud sync, or non-loopback requests.
- Unique record for `(local_date, slot)`.
- Test-first domain and API implementation.

## Tasks

1. Domain validation and slot selection.
2. SQLite repository and settings/reminder persistence.
3. Reminder scheduling and descriptive analytics.
4. Authenticated loopback API and process supervisor.
5. Neutralino window, tray, notifications, form, history, analytics, settings.
6. Windows network installer, autostart, restart-on-failure, watchdog, and pinned local runtimes.
7. Full verification and release archives.
