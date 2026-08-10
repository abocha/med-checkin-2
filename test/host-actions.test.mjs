import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostActionQueue } from '../backend/host-actions.mjs';

test('host action queue drains actions in FIFO order', () => {
  const queue = createHostActionQueue();
  queue.enqueue({ type: 'open', view: 'history' });
  queue.enqueue({ type: 'close-window' });
  assert.equal(queue.size, 2);
  assert.deepEqual(queue.drain(), [
    { type: 'open', view: 'history' },
    { type: 'close-window' }
  ]);
  assert.equal(queue.size, 0);
  assert.deepEqual(queue.drain(), []);
});

test('host action queue bounds retained actions and clones values', () => {
  const queue = createHostActionQueue({ maxSize: 2 });
  const mutable = { type: 'open', view: 'checkin' };
  queue.enqueue({ type: 'open', view: 'history' });
  queue.enqueue(mutable);
  mutable.view = 'settings';
  queue.enqueue({ type: 'close-window' });
  assert.deepEqual(queue.drain(), [
    { type: 'open', view: 'checkin' },
    { type: 'close-window' }
  ]);
});

test('host action queue removes only the queued action with an exact action id', () => {
  const queue = createHostActionQueue();
  queue.enqueue({ type: 'open', view: 'history' });
  queue.enqueue({ type: 'install-update', actionId: 'launch-1', stagingDir: 'C:\\temp\\one' });
  queue.enqueue({ type: 'install-update', actionId: 'launch-2', stagingDir: 'C:\\temp\\two' });
  assert.equal(queue.removeByActionId('launch-1'), true);
  assert.equal(queue.removeByActionId('launch-1'), false);
  assert.deepEqual(queue.drain(), [
    { type: 'open', view: 'history' },
    { type: 'install-update', actionId: 'launch-2', stagingDir: 'C:\\temp\\two' }
  ]);
});
