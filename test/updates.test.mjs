import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHostActionQueue } from '../backend/host-actions.mjs';
import { createUpdateService } from '../backend/updates.mjs';

const RELEASES_URL = 'https://api.github.com/repos/abocha/med-checkin-2/releases/latest';
const archive = Buffer.from('verified Med Check-in release');
const checksum = createHash('sha256').update(archive).digest('hex');

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; }, async arrayBuffer() { return body; }, async text() { return body; } };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function release(version = '2.3.1', assets = true) {
  const zip = `med-checkin-${version}-windows-installer.zip`;
  return {
    tag_name: `v${version}`,
    name: `Med Check-in ${version}`,
    body: 'Safe release notes',
    assets: assets ? [{ name: zip, browser_download_url: 'https://release.test/app.zip' }, { name: `${zip}.sha256`, browser_download_url: 'https://release.test/app.zip.sha256' }] : []
  };
}

function fixture({ metadata = release(), zip = archive, sha = `${checksum}  med-checkin-2.3.1-windows-installer.zip\n`, extractor, now = new Date('2026-08-09T00:00:00Z'), launchAckTimeoutMs } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'med-checkin-updates-data-'));
  const actions = createHostActionQueue();
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url === RELEASES_URL) return response(metadata);
    if (url === 'https://release.test/app.zip') return response(zip);
    if (url === 'https://release.test/app.zip.sha256') return response(sha);
    throw new Error(`Unexpected URL ${url}`);
  };
  const service = createUpdateService({
    installedVersion: '2.3.0', dataDir, hostActions: actions, fetchImpl,
    now: () => now, launchAckTimeoutMs,
    extractArchive: extractor ?? ((source, destination) => {
      mkdirSync(join(destination, 'MedCheckin2'), { recursive: true });
      writeFileSync(join(destination, 'MedCheckin2', 'INSTALL.bat'), 'installer');
    })
  });
  return { dataDir, actions, requested, service, close() { rmSync(dataDir, { recursive: true, force: true }); } };
}

test('only exposes a newer stable release in the installed major version', async () => {
  for (const metadata of [release('2.3.0'), release('2.2.9'), release('3.0.0'), { ...release('2.3.1'), tag_name: 'v2.3.1-beta.1' }]) {
    const f = fixture({ metadata });
    try {
      const status = await f.service.check({ force: true });
      assert.equal(status.availableVersion, null);
      assert.equal(status.phase, 'current');
      assert.equal(status.error, null);
    } finally { f.close(); }
  }
});

test('records a compatible release candidate and only requests metadata once when recent', async () => {
  const f = fixture();
  try {
    const available = await f.service.check({ force: true });
    assert.equal(available.availableVersion, '2.3.1');
    await f.service.check();
    assert.deepEqual(f.requested, [RELEASES_URL]);
    await f.service.check({ force: true });
    assert.deepEqual(f.requested, [RELEASES_URL, RELEASES_URL]);
  } finally { f.close(); }
});

test('reports unavailable release metadata and network failures without host actions', async () => {
  for (const metadata of [release('2.3.1', false), null]) {
    const f = fixture({ metadata });
    if (metadata === null) f.service = createUpdateService({ installedVersion: '2.3.0', dataDir: f.dataDir, hostActions: f.actions, fetchImpl: async () => { throw new Error('offline'); } });
    try {
      const status = await f.service.check({ force: true });
      assert.equal(status.availableVersion, null);
      assert.equal(f.actions.size, 0);
    } finally { f.close(); }
  }
});

test('does not extract or launch when checksum verification fails', async () => {
  let extracted = false;
  const f = fixture({ sha: `0${checksum.slice(1)}  med-checkin-2.3.1-windows-installer.zip\n`, extractor: () => { extracted = true; } });
  try {
    await f.service.check({ force: true });
    await assert.rejects(f.service.installAvailable(), /checksum/i);
    assert.equal(extracted, false);
    assert.equal(f.actions.size, 0);
  } finally { f.close(); }
});

test('does not launch when extraction fails or staging lacks the constructed installer', async () => {
  for (const extractor of [() => { throw new Error('bad zip'); }, () => {}]) {
    const f = fixture({ extractor });
    try {
      await f.service.check({ force: true });
      await assert.rejects(f.service.installAvailable());
      assert.equal(f.actions.size, 0);
    } finally { f.close(); }
  }
});

test('queues exactly one verified staging directory and waits for launch acknowledgement without refetching metadata', async () => {
  const f = fixture();
  try {
    await f.service.check({ force: true });
    const launching = await f.service.installAvailable();
    assert.equal(launching.phase, 'launching');
    assert.equal(launching.availableVersion, '2.3.1');
    const actions = f.actions.drain();
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'install-update');
    assert.equal(typeof actions[0].actionId, 'string');
    assert.ok(actions[0].actionId.length > 0);
    assert.match(actions[0].stagingDir, /MedCheckin2-update-/);
    assert.equal(existsSync(join(actions[0].stagingDir, 'MedCheckin2', 'INSTALL.bat')), true);
    assert.deepEqual(f.requested, [RELEASES_URL, 'https://release.test/app.zip', 'https://release.test/app.zip.sha256']);
    const installing = f.service.reportInstallLaunch({ actionId: actions[0].actionId, ok: true });
    assert.equal(installing.phase, 'installing');
    assert.equal(installing.availableVersion, '2.3.1');
    rmSync(actions[0].stagingDir, { recursive: true, force: true });
  } finally { f.close(); }
});

test('failed installer launch restores the candidate and permits retry', async () => {
  const f = fixture();
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    const [action] = f.actions.drain();
    const failed = f.service.reportInstallLaunch({ actionId: action.actionId, ok: false });
    assert.equal(failed.phase, 'available');
    assert.equal(failed.availableVersion, '2.3.1');
    assert.ok(failed.error);
    const retry = await f.service.installAvailable();
    assert.equal(retry.phase, 'launching');
    const [retryAction] = f.actions.drain();
    f.service.reportInstallLaunch({ actionId: retryAction.actionId, ok: false });
  } finally { f.close(); }
});

test('pending installer launch blocks checks and duplicate install attempts', async () => {
  const f = fixture();
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    const requestsBefore = f.requested.length;
    await f.service.check({ force: true });
    assert.equal(f.requested.length, requestsBefore);
    await assert.rejects(f.service.installAvailable(), /already|launch|install/i);
    const [action] = f.actions.drain();
    f.service.reportInstallLaunch({ actionId: action.actionId, ok: false });
  } finally { f.close(); }
});

test('stale installer acknowledgement cannot mutate updater state', async () => {
  const f = fixture();
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    const before = f.service.getStatus();
    assert.throws(
      () => f.service.reportInstallLaunch({ actionId: 'stale-action', ok: true }),
      /action|launch/i
    );
    assert.deepEqual(f.service.getStatus(), before);
    const [action] = f.actions.drain();
    f.service.reportInstallLaunch({ actionId: action.actionId, ok: false });
  } finally { f.close(); }
});

test('unacknowledged installer launch times out to a retryable candidate', async () => {
  const f = fixture({ launchAckTimeoutMs: 10 });
  try {
    await f.service.check({ force: true });
    await f.service.installAvailable();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const status = f.service.getStatus();
    assert.equal(status.phase, 'available');
    assert.equal(status.availableVersion, '2.3.1');
    assert.ok(status.error);
  } finally { f.close(); }
});

test('refuses installation when no in-memory candidate has been checked', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.installAvailable(), /No update is available/i);
    assert.equal(f.actions.size, 0);
    assert.deepEqual(f.requested, []);
  } finally { f.close(); }
});

test('snapshots a candidate and serializes installation while a forced check interleaves', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'med-checkin-updates-interleave-'));
  const actions = createHostActionQueue();
  const zipDownload = deferred();
  const checksumDownload = deferred();
  const extractedArchives = [];
  let metadataCalls = 0;
  const first = release('2.3.1');
  const second = release('2.3.2');
  const fetchImpl = async (url) => {
    if (url === RELEASES_URL) return response(metadataCalls++ === 0 ? first : second);
    if (url === 'https://release.test/app.zip') return zipDownload.promise;
    if (url === 'https://release.test/app.zip.sha256') return checksumDownload.promise;
    throw new Error(`Unexpected URL ${url}`);
  };
  const service = createUpdateService({
    installedVersion: '2.3.0', dataDir, hostActions: actions, fetchImpl,
    extractArchive: (source, destination) => { extractedArchives.push(source); mkdirSync(join(destination, 'MedCheckin2'), { recursive: true }); writeFileSync(join(destination, 'MedCheckin2', 'INSTALL.bat'), 'installer'); }
  });
  try {
    await service.check({ force: true });
    const installation = service.installAvailable();
    const secondRejection = assert.rejects(service.installAvailable(), /already being prepared/i);
    await service.check({ force: true });
    zipDownload.resolve(response(archive));
    checksumDownload.resolve(response(`${checksum}  med-checkin-2.3.1-windows-installer.zip\n`));
    await installation;
    await secondRejection;
    const queued = actions.drain();
    assert.equal(metadataCalls, 1, 'checks must not fetch metadata while installation is in flight');
    assert.equal(queued.length, 1);
    assert.match(extractedArchives[0], /med-checkin-2\.3\.1-windows-installer\.zip$/);
    assert.match(queued[0].stagingDir, /2-update-/);
    rmSync(queued[0].stagingDir, { recursive: true, force: true });
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test('rejects installation during a check and installs only the newly checked candidate', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'med-checkin-updates-reverse-'));
  const actions = createHostActionQueue();
  const pendingMetadata = deferred();
  const extractedArchives = [];
  let metadataCalls = 0;
  const fetchImpl = async (url) => {
    if (url === RELEASES_URL) return metadataCalls++ === 0 ? response(release('2.3.1')) : pendingMetadata.promise;
    if (url === 'https://release.test/app.zip') return response(archive);
    if (url === 'https://release.test/app.zip.sha256') return response(`${checksum}  med-checkin-2.3.2-windows-installer.zip\n`);
    throw new Error(`Unexpected URL ${url}`);
  };
  const service = createUpdateService({
    installedVersion: '2.3.0', dataDir, hostActions: actions, fetchImpl,
    extractArchive: (source, destination) => { extractedArchives.push(source); mkdirSync(join(destination, 'MedCheckin2'), { recursive: true }); writeFileSync(join(destination, 'MedCheckin2', 'INSTALL.bat'), 'installer'); }
  });
  try {
    await service.check({ force: true });
    const check = service.check({ force: true });
    await assert.rejects(service.installAvailable(), /check is already in progress/i);
    pendingMetadata.resolve(response(release('2.3.2')));
    await check;
    await service.installAvailable();
    const queued = actions.drain();
    assert.equal(metadataCalls, 2);
    assert.equal(queued.length, 1);
    assert.match(extractedArchives[0], /med-checkin-2\.3\.2-windows-installer\.zip$/);
    rmSync(queued[0].stagingDir, { recursive: true, force: true });
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
