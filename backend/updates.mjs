import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const RELEASES_URL = 'https://api.github.com/repos/abocha/med-checkin-2/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = 'update-state.json';

function parseStableVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value ?? ''));
  return match ? { raw: `${match[1]}.${match[2]}.${match[3]}`, parts: match.slice(1).map(Number) } : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] - right.parts[index];
  }
  return 0;
}

function readLastCheckedAt(dataDir) {
  try {
    const value = JSON.parse(readFileSync(join(dataDir, STATE_FILE), 'utf8'));
    const parsed = new Date(value.lastCheckedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch { return null; }
}

function writeLastCheckedAt(dataDir, lastCheckedAt) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, STATE_FILE), JSON.stringify({ lastCheckedAt }), 'utf8');
}

function parseChecksum(value) {
  const match = /\b([a-fA-F0-9]{64})\b/.exec(String(value ?? ''));
  return match?.[1].toLowerCase() ?? null;
}

export function defaultExtractArchive(archivePath, destination) {
  if (process.platform !== 'win32') throw new Error('Update archive extraction is available only on Windows');
  const escapedArchive = archivePath.replaceAll("'", "''");
  const escapedDestination = destination.replaceAll("'", "''");
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not extract verified update archive');
}

export function createUpdateService({
  installedVersion, dataDir, hostActions, fetchImpl = fetch, now = () => new Date(),
  extractArchive = defaultExtractArchive, onStatus = () => {}
}) {
  const installed = parseStableVersion(installedVersion);
  if (!installed) throw new Error('Installed version must be a stable semantic version');
  if (!dataDir || !hostActions?.enqueue) throw new Error('Update service requires dataDir and hostActions');

  let candidate = null;
  let installation = null;
  let checking = null;
  let status = { installedVersion: installed.raw, phase: 'idle', lastCheckedAt: readLastCheckedAt(dataDir), availableVersion: null, releaseNotes: null, error: null };

  function publish(next) {
    status = { ...status, ...next };
    onStatus(status);
    return status;
  }

  function isDue() {
    if (!status.lastCheckedAt) return true;
    return now().getTime() - new Date(status.lastCheckedAt).getTime() >= CHECK_INTERVAL_MS;
  }

  function check({ force = false } = {}) {
    if (installation) return Promise.resolve(getStatus());
    if (checking) return checking;
    if (!force && !isDue()) return Promise.resolve(getStatus());
    const run = (async () => {
      publish({ phase: 'checking', error: null });
      try {
        const response = await fetchImpl(RELEASES_URL);
        if (!response?.ok) throw new Error(`Update check failed (${response?.status ?? 'network error'})`);
        const release = await response.json();
        const version = parseStableVersion(release?.tag_name);
        const checkedAt = now().toISOString();
        writeLastCheckedAt(dataDir, checkedAt);
        candidate = null;

        if (!version || version.parts[0] !== installed.parts[0] || compareVersions(version, installed) <= 0) {
          return publish({ phase: 'idle', lastCheckedAt: checkedAt, availableVersion: null, releaseNotes: null, error: null });
        }

        const zipName = `med-checkin-${version.raw}-windows-installer.zip`;
        const assets = Array.isArray(release.assets) ? release.assets : [];
        const zip = assets.find((asset) => asset?.name === zipName);
        const checksum = assets.find((asset) => asset?.name === `${zipName}.sha256`);
        if (!zip?.browser_download_url || !checksum?.browser_download_url) {
          return publish({ phase: 'idle', lastCheckedAt: checkedAt, availableVersion: null, releaseNotes: null, error: 'The release is missing its expected installer files.' });
        }

        candidate = { version: version.raw, zipUrl: zip.browser_download_url, checksumUrl: checksum.browser_download_url, releaseNotes: String(release.body ?? '') };
        return publish({ phase: 'available', lastCheckedAt: checkedAt, availableVersion: version.raw, releaseNotes: candidate.releaseNotes, error: null });
      } catch (error) {
        candidate = null;
        return publish({ phase: 'idle', availableVersion: null, releaseNotes: null, error: error instanceof Error ? error.message : 'Update check failed' });
      }
    })();
    checking = run.finally(() => { checking = null; });
    return checking;
  }

  async function installAvailable() {
    if (installation) throw new Error('Update installation is already being prepared.');
    if (checking) throw new Error('Update check is already in progress.');
    if (!candidate) throw new Error('No update is available. Check for updates first.');
    const release = candidate;
    installation = (async () => {
      let stagingDir = null;
      try {
        publish({ phase: 'downloading', error: null });
        const [zipResponse, checksumResponse] = await Promise.all([fetchImpl(release.zipUrl), fetchImpl(release.checksumUrl)]);
        if (!zipResponse?.ok || !checksumResponse?.ok) throw new Error('Could not download the verified update files.');
        const [archive, checksumText] = await Promise.all([
          zipResponse.arrayBuffer().then((value) => Buffer.from(value)),
          checksumResponse.text()
        ]);
        const expected = parseChecksum(checksumText);
        const actual = createHash('sha256').update(archive).digest('hex');
        if (!expected || expected !== actual) throw new Error('Update checksum verification failed.');

        stagingDir = mkdtempSync(join(tmpdir(), 'MedCheckin2-update-'));
        const archivePath = join(stagingDir, `med-checkin-${release.version}-windows-installer.zip`);
        writeFileSync(archivePath, archive);
        extractArchive(archivePath, stagingDir);
        if (!existsSync(join(stagingDir, 'MedCheckin2', 'INSTALL.bat'))) throw new Error('Verified update archive is missing its installer.');
        hostActions.enqueue({ type: 'install-update', stagingDir });
        if (candidate === release) candidate = null;
        return publish({ phase: 'installing', availableVersion: candidate?.version ?? null, releaseNotes: candidate?.releaseNotes ?? null, error: null });
      } catch (error) {
        if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
        publish({ phase: 'available', error: error instanceof Error ? error.message : 'Update preparation failed' });
        throw error;
      }
    })();
    try { return await installation; }
    finally { installation = null; }
  }

  function getStatus() { return { ...status }; }
  return { getStatus, check, installAvailable };
}

export const UPDATE_CHECK_INTERVAL_MS = CHECK_INTERVAL_MS;
