import { execFileSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';

function pathApi(platform) { return platform === 'win32' ? win32 : posix; }

export function isPathInside(candidate, root, platform = process.platform) {
  if (!candidate || !root) return false;
  const path = pathApi(platform);
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function getProcessExecutable(pid, {
  platform = process.platform,
  execFile = execFileSync,
  readlink = readlinkSync
} = {}) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  try {
    if (platform === 'win32') {
      const command = `(Get-CimInstance -ClassName Win32_Process -Filter \"ProcessId = ${Number(pid)}\" -ErrorAction SilentlyContinue).ExecutablePath`;
      const output = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', windowsHide: true, timeout: 5000
      });
      return String(output || '').trim() || null;
    }
    return readlink(`/proc/${Number(pid)}/exe`);
  } catch { return null; }
}

export function terminateOwnedProcess(pid, {
  appRoot,
  platform = process.platform,
  resolveExecutable = (value) => getProcessExecutable(value, { platform }),
  kill = process.kill
} = {}) {
  const executable = resolveExecutable(Number(pid));
  const runtimeRoot = join(appRoot, 'runtime', 'node');
  if (!isPathInside(executable, runtimeRoot, platform)) return false;
  try { kill(Number(pid)); return true; }
  catch { return false; }
}
