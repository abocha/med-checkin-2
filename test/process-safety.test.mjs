import test from 'node:test';
import assert from 'node:assert/strict';
import { isPathInside, terminateOwnedProcess } from '../backend/process-safety.mjs';

test('isPathInside accepts bundled runtime files and rejects sibling paths', () => {
  assert.equal(isPathInside('C:\\Users\\a\\App\\runtime\\node\\node.exe', 'C:\\Users\\a\\App\\runtime\\node', 'win32'), true);
  assert.equal(isPathInside('C:\\Users\\a\\Other\\node.exe', 'C:\\Users\\a\\App\\runtime\\node', 'win32'), false);
});

test('terminateOwnedProcess kills only a process using the bundled node runtime', () => {
  const killed = [];
  const common = { appRoot: 'C:\\Users\\a\\App', platform: 'win32', kill: (pid) => killed.push(pid) };
  assert.equal(terminateOwnedProcess(41, { ...common, resolveExecutable: () => 'C:\\Users\\a\\App\\runtime\\node\\node.exe' }), true);
  assert.equal(terminateOwnedProcess(42, { ...common, resolveExecutable: () => 'C:\\Program Files\\nodejs\\node.exe' }), false);
  assert.deepEqual(killed, [41]);
});
