import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { localDateString } from './domain.mjs';

export function backupDatabase({ repo, dbPath, backupDir, now = new Date(), keep = 30 }) {
  if (!existsSync(dbPath)) return null;
  mkdirSync(backupDir, { recursive: true });
  repo.checkpoint();

  const target = join(backupDir, `med-checkin-${localDateString(now)}.sqlite`);
  copyFileSync(dbPath, target);

  const backups = readdirSync(backupDir)
    .filter((name) => /^med-checkin-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
    .sort()
    .reverse();
  for (const old of backups.slice(Math.max(1, keep))) {
    try { unlinkSync(join(backupDir, old)); } catch {}
  }
  return target;
}

export function backupTimestamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function createTimestampedBackup({ dbPath, backupDir, prefix, now = new Date() }) {
  if (!existsSync(dbPath)) throw new Error('Database does not exist');
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `${prefix}-${backupTimestamp(now)}.sqlite`);
  copyFileSync(dbPath, target);
  if (!existsSync(target) || statSync(target).size === 0) throw new Error(`Backup was not created: ${target}`);
  return target;
}
