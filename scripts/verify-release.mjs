import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '2.2.1';
const ROOT_DIR = 'MedCheckin2';
const REQUIRED_ENTRIES = [
  'INSTALL.bat',
  'README.txt',
  'THIRD_PARTY_NOTICES.txt',
  'VERSION.txt',
  'backend/analytics.mjs',
  'backend/backups.mjs',
  'backend/data-maintenance.mjs',
  'backend/domain.mjs',
  'backend/host-actions.mjs',
  'backend/http-server.mjs',
  'backend/main.mjs',
  'backend/migrations.mjs',
  'backend/process-safety.mjs',
  'backend/reminders.mjs',
  'backend/repository.mjs',
  'backend/schema.mjs',
  'backend/supervisor.mjs',
  'backend/treatment.mjs',
  'resources/app.js',
  'resources/draft-store.js',
  'resources/index.html',
  'resources/startup-runtime.js',
  'resources/styles.css',
  'resources/vendor/chart-lite.js',
  'resources/icons/app.ico',
  'resources/icons/app.png',
  'resources/icons/tray.png',
  'windows/install.bat',
  'windows/install.ps1',
  'windows/launch-hidden.vbs',
  'windows/tray-host.ps1',
  'windows/uninstall.bat',
  'windows/uninstall.ps1',
];
const BOOTSTRAP_FILES = [
  'INSTALL.bat',
  'windows/install.bat',
  'windows/uninstall.bat',
  'windows/install.ps1',
  'windows/uninstall.ps1',
  'windows/launch-hidden.vbs'
];

function listFiles(root, current = root) {
  const files = [];
  for (const name of readdirSync(current)) {
    const absolute = join(current, name);
    if (statSync(absolute).isDirectory()) files.push(...listFiles(root, absolute));
    else files.push(relative(root, absolute).replaceAll('\\', '/'));
  }
  return files.sort();
}

function extractArchive(archive, destination) {
  let result;
  if (process.platform === 'win32') {
    const escapedArchive = archive.replaceAll("'", "''");
    const escapedDestination = destination.replaceAll("'", "''");
    result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`],
      { encoding: 'utf8' }
    );
  } else {
    result = spawnSync('unzip', ['-q', archive, '-d', destination], { encoding: 'utf8' });
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Could not extract release archive${detail ? `: ${detail}` : ''}`);
  }
}

function assertBootstrapSafe(filePath, relativePath) {
  const bytes = readFileSync(filePath);
  const firstNonAscii = bytes.findIndex((byte) => byte > 0x7f);
  if (firstNonAscii !== -1) {
    throw new Error(`${relativePath} contains a non-ASCII byte at offset ${firstNonAscii}`);
  }
  const text = bytes.toString('ascii');
  if (/(^|[^\r])\n/.test(text)) {
    throw new Error(`${relativePath} contains LF-only line endings`);
  }
}

export function verifyRelease(archivePath) {
  const archive = resolve(archivePath);
  if (!existsSync(archive)) throw new Error(`Release archive not found: ${archive}`);
  if (basename(archive) !== `med-checkin-${VERSION}-windows-installer.zip`) {
    throw new Error(`Unexpected archive name: ${basename(archive)}`);
  }

  const extractDir = mkdtempSync(join(tmpdir(), 'med-checkin-release-'));
  try {
    extractArchive(archive, extractDir);
    const packageRoot = join(extractDir, ROOT_DIR);
    if (!existsSync(packageRoot)) throw new Error(`Archive is missing ${ROOT_DIR}/ root directory`);

    const files = listFiles(packageRoot);
    for (const required of REQUIRED_ENTRIES) {
      if (!files.includes(required)) throw new Error(`Archive is missing required entry: ${required}`);
    }

    const forbidden = files.filter((file) => {
      const lower = file.toLowerCase();
      return lower.includes('neutralino') ||
        lower === 'native/trayhost.cs' ||
        lower.endsWith('/medcheckintray.exe') ||
        lower === 'medcheckintray.exe' ||
        /(^|\/)(?:test|tests|fixtures)(?:\/|$)/.test(lower) ||
        /(^|\/)(?:\.dev-data|node_modules|dist|\.codex)(?:\/|$)/.test(lower) ||
        /(^|\/)(?:runtime\.json|edge-profile)(?:\/|$)/.test(lower) ||
        /\.(?:sqlite(?:-(?:wal|shm))?|db|log)$/.test(lower);
    });
    if (forbidden.length > 0) throw new Error(`Archive contains forbidden entries: ${forbidden.join(', ')}`);

    const version = readFileSync(join(packageRoot, 'VERSION.txt'), 'utf8').trim();
    if (version !== VERSION) throw new Error(`VERSION.txt contains ${version}, expected ${VERSION}`);

    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== VERSION) {
      throw new Error(`package.json contains ${packageJson.version}, expected ${VERSION}`);
    }

    const ui = readFileSync(join(packageRoot, 'resources/index.html'), 'utf8');
    if (!ui.includes(`<title>Med Check-in ${VERSION}</title>`) || !ui.includes('<h1>Med Check-in <span>2.2</span></h1>')) {
      throw new Error(`resources/index.html does not identify Med Check-in ${VERSION}`);
    }

    for (const relativePath of BOOTSTRAP_FILES) {
      assertBootstrapSafe(join(packageRoot, relativePath), relativePath);
    }

    const trayBytes = readFileSync(join(packageRoot, 'windows/tray-host.ps1'));
    if (trayBytes.length < 4 || trayBytes[0] !== 0xef || trayBytes[1] !== 0xbb || trayBytes[2] !== 0xbf) {
      throw new Error('windows/tray-host.ps1 must be UTF-8 with BOM');
    }

    return { archive, files: files.length, version };
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const archive = process.argv[2];
  if (!archive) {
    console.error('Usage: node scripts/verify-release.mjs <release.zip>');
    process.exitCode = 2;
  } else {
    try {
      const result = verifyRelease(archive);
      console.log(`Verified ${result.archive} (${result.files} files, version ${result.version})`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
