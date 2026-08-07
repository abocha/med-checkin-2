import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessSupervisor } from '../backend/supervisor.mjs';

test('process supervisor uses a caller-supplied component label', () => {
  const logs = [];
  const supervisor = createProcessSupervisor({
    executable: '/definitely/missing/MedCheckinTray.exe',
    label: 'Tray host',
    log(level, message) { logs.push({ level, message }); }
  });
  assert.equal(supervisor.start(), null);
  assert.deepEqual(logs, [{ level: 'error', message: 'Tray host executable not found: /definitely/missing/MedCheckinTray.exe' }]);
});
