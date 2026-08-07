import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../backend/main.mjs', import.meta.url), 'utf8');

test('startup opens the repository before creating the first durable snapshot', () => {
  assert.match(main, /import \{ backupDatabase \} from ['"]\.\/backups\.mjs['"]/);
  const repository = main.indexOf('const repo = createRepository(DB_PATH)');
  const backup = main.indexOf('persistBackup();');
  assert.ok(repository > -1 && backup > repository);
});

test('meaningful API writes refresh the durable snapshot', () => {
  assert.match(main, /onPersisted:\s*persistBackup/);
});
