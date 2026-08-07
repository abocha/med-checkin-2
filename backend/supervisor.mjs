import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export function createProcessSupervisor({ executable, args = [], cwd, env = {}, label = 'Host', log = () => {}, onSpawn = () => {} }) {
  let child = null;
  let stopping = false;
  let failures = 0;
  let restartTimer = null;

  function start() {
    if (stopping || child) return child;
    if (!existsSync(executable)) {
      log('error', `${label} executable not found: ${executable}`);
      return null;
    }
    child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: 'ignore'
    });
    onSpawn(child.pid);
    log('info', `${label} started (pid ${child.pid})`);
    child.once('exit', (code, signal) => {
      log(code === 0 || stopping ? 'info' : 'error', `${label} exited (code=${code}, signal=${signal})`);
      child = null;
      onSpawn(null);
      if (stopping) return;
      failures += 1;
      const delay = Math.min(30000, [1000, 2000, 5000, 10000, 30000][Math.min(failures - 1, 4)]);
      restartTimer = setTimeout(start, delay);
      restartTimer.unref?.();
    });
    child.once('error', (error) => log('error', `${label} spawn failed: ${error.message}`));
    return child;
  }

  function restart() {
    failures = 0;
    if (restartTimer) clearTimeout(restartTimer);
    if (child) {
      const old = child;
      child = null;
      old.kill();
      setTimeout(start, 500).unref?.();
    } else start();
  }

  function stop() {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (child) child.kill();
  }

  return {
    start,
    restart,
    stop,
    get pid() { return child?.pid ?? null; },
    get running() { return Boolean(child); }
  };
}
