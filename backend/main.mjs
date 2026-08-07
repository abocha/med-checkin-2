import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRepository } from './repository.mjs';
import { createHttpServer } from './http-server.mjs';
import { getDueReminder } from './reminders.mjs';
import { localDateString } from './domain.mjs';
import { createProcessSupervisor } from './supervisor.mjs';
import { backupDatabase } from './backups.mjs';
import { terminateOwnedProcess } from './process-safety.mjs';
import { createHostActionQueue } from './host-actions.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const DATA_DIR = process.env.MED_CHECKIN_DATA_DIR || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || process.env.APPDATA || APP_ROOT, 'MedCheckin2')
  : join(APP_ROOT, '.dev-data'));
const RUNTIME_FILE = join(DATA_DIR, 'runtime.json');
const QUIT_FILE = join(DATA_DIR, 'quit.flag');
const DB_PATH = join(DATA_DIR, 'med-checkin.sqlite');
const BACKUP_DIR = join(DATA_DIR, 'backups');
const PORT = Number(process.env.MED_CHECKIN_PORT || 27841);

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, 'logs'), { recursive: true });
mkdirSync(join(DATA_DIR, 'backups'), { recursive: true });

function log(level, message, details = null) {
  const line = JSON.stringify({ at: new Date().toISOString(), level, message, ...(details ? { details } : {}) }) + '\n';
  const path = join(DATA_DIR, 'logs', 'app.log');
  try {
    if (existsSync(path) && statSync(path).size > 2 * 1024 * 1024) renameSync(path, path + '.1');
    appendFileSync(path, line, 'utf8');
  } catch {}
}

function readRuntime() {
  try { return JSON.parse(readFileSync(RUNTIME_FILE, 'utf8')); } catch { return null; }
}

async function postRunning(command) {
  const runtime = readRuntime();
  if (!runtime?.port || !runtime?.token) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/v1/control/${command}`, {
      method: 'POST', headers: { authorization: `Bearer ${runtime.token}` }
    });
    return response.ok;
  } catch { return false; }
}

function spawnDetached(extraArgs = []) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...extraArgs], {
    cwd: APP_ROOT,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: process.env
  });
  child.unref();
}

async function runWatchdog() {
  if (existsSync(QUIT_FILE)) return;
  const runtime = readRuntime();
  let healthy = false;
  if (runtime?.port) {
    try {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/health`, { signal: AbortSignal.timeout(3000) });
      healthy = response.ok;
    } catch {}
  }
  if (!healthy) {
    if (runtime?.pid) terminateOwnedProcess(runtime.pid, { appRoot: APP_ROOT });
    spawnDetached([]);
    return;
  }
  const heartbeatAge = runtime?.hostHeartbeatAt ? Date.now() - new Date(runtime.hostHeartbeatAt).getTime() : Infinity;
  if (heartbeatAge > 180000) await postRunning('restart-host');
}

if (args.has('--watchdog')) {
  await runWatchdog();
  process.exit(0);
}

if (args.has('--logon') || args.has('--show')) {
  try { unlinkSync(QUIT_FILE); } catch {}
}

if (args.has('--show') && await postRunning('show')) process.exit(0);
if (existsSync(QUIT_FILE)) process.exit(0);

const repo = createRepository(DB_PATH);
const persistBackup = () => backupDatabase({ repo, dbPath: DB_PATH, backupDir: BACKUP_DIR });
persistBackup();
const token = randomBytes(32).toString('hex');
let hostHeartbeatAt = null;
let shuttingDown = false;
let hostPid = null;

function writeRuntime() {
  const value = {
    pid: process.pid,
    port: api.port,
    token,
    startedAt: startedAt.toISOString(),
    hostHeartbeatAt,
    hostPid,
    appRoot: APP_ROOT
  };
  const temp = RUNTIME_FILE + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(temp, RUNTIME_FILE);
}

const hostScript = join(APP_ROOT, 'windows', 'tray-host.ps1');
const defaultPowerShell = process.platform === 'win32'
  ? join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : null;
const hostExecutable = process.env.MED_CHECKIN_HOST_BIN || defaultPowerShell;
const startedAt = new Date();
const hostActions = createHostActionQueue();
const hostArgs = process.env.MED_CHECKIN_HOST_ARGS_JSON
  ? JSON.parse(process.env.MED_CHECKIN_HOST_ARGS_JSON)
  : [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-STA',
      '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', hostScript, '-AppRoot', APP_ROOT
    ];
if (args.has('--show')) hostArgs.push('-Show');
let api;
const supervisor = hostExecutable
  ? createProcessSupervisor({
      executable: hostExecutable,
      args: hostArgs,
      cwd: APP_ROOT,
      label: 'PowerShell tray host',
      log,
      onSpawn(pid) { hostPid = pid; if (api?.port) writeRuntime(); }
    })
  : {
      start() { log('info', 'PowerShell tray host disabled on this platform'); return null; },
      restart() {},
      stop() {},
      get pid() { return null; },
      get running() { return false; }
    };

async function shutdown({ intentional = false } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'Backend shutting down', { intentional });
  clearInterval(reminderTimer);
  supervisor.stop();
  try { repo.checkpoint(); } catch {}
  try { await api.close(); } catch {}
  try { repo.close(); } catch {}
  process.exit(intentional ? 0 : 1);
}

api = createHttpServer({
  repo, token, dataDir: DATA_DIR, resourcesDir: join(APP_ROOT, 'resources'), hostActions,
  onPersisted: persistBackup,
  onControl: async (command) => {
    if (command === 'restart-host') supervisor.restart();
    if (command === 'heartbeat') { hostHeartbeatAt = new Date().toISOString(); writeRuntime(); }
    if (command === 'quit') {
      writeFileSync(QUIT_FILE, new Date().toISOString(), 'utf8');
      api.eventHub.broadcast('quit', {});
      setTimeout(() => shutdown({ intentional: true }), 400).unref?.();
    }
  }
});

try {
  await api.listen(PORT);
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    if (args.has('--show')) await postRunning('show');
    process.exit(0);
  }
  throw error;
}

writeRuntime();
supervisor.start();

function reminderTick() {
  const now = new Date();
  const date = localDateString(now);
  const completed = new Set(repo.listCheckins({ from: date, to: date, limit: 10 }).map((row) => `${row.localDate}|${row.slot}`));
  const due = getDueReminder(now, repo.getSettings(), completed, repo.getReminderStates(date));
  if (due && api.eventHub.size > 0) api.eventHub.broadcast('reminder', due);
}
const reminderTimer = setInterval(reminderTick, 30000);
reminderTimer.unref?.();
setTimeout(reminderTick, 2000).unref?.();

process.on('SIGTERM', () => shutdown({ intentional: false }));
process.on('SIGINT', () => shutdown({ intentional: true }));
process.on('uncaughtException', (error) => { log('fatal', error.stack || error.message); shutdown({ intentional: false }); });
process.on('unhandledRejection', (error) => { log('fatal', String(error)); shutdown({ intentional: false }); });

log('info', 'Backend started', { pid: process.pid, port: api.port, appRoot: APP_ROOT });
