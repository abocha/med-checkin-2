import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const VERSION = '2.2.2';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const stage = join(dist, 'package-stage');
const packageRoot = join(stage, 'MedCheckin2');
const archiveName = 'med-checkin-2.2.2-windows-installer.zip';
const archive = join(dist, archiveName);

rmSync(stage, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(packageRoot, { recursive: true });

const entries = [
  'backend',
  'resources',
  'windows',
  'package.json',
  'README.txt',
  'INSTALL.bat',
  'THIRD_PARTY_NOTICES.txt'
];

for (const entry of entries) {
  const source = join(root, entry);
  if (!existsSync(source)) throw new Error(`Missing release entry: ${entry}`);
  cpSync(source, join(packageRoot, entry), { recursive: true });
}

writeFileSync(join(packageRoot, 'VERSION.txt'), `${VERSION}\n`, 'utf8');
mkdirSync(dist, { recursive: true });

let result;
if (process.platform === 'win32') {
  const command = `Compress-Archive -Path '${packageRoot.replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}' -CompressionLevel Optimal -Force`;
  result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'inherit' });
} else {
  result = spawnSync('zip', ['-qr', archive, 'MedCheckin2'], { cwd: stage, stdio: 'inherit' });
}
if (result.status !== 0 || !existsSync(archive)) throw new Error('Could not create Windows release archive');

const verifier = spawnSync(process.execPath, [join(root, 'scripts', 'verify-release.mjs'), archive], { stdio: 'inherit' });
if (verifier.status !== 0) throw new Error('Release archive verification failed');

console.log(archive);
