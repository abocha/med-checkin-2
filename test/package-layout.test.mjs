import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function readPowerShellFunction(script, name) {
  const start = script.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `windows/install.ps1 is missing function ${name}`);
  const next = script.indexOf('\nfunction ', start + 1);
  return script.slice(start, next === -1 ? script.length : next);
}

for (const relative of [
  'windows/install.ps1',
  'windows/install.bat',
  'windows/uninstall.ps1',
  'windows/uninstall.bat',
  'windows/launch-hidden.vbs',
  'scripts/package-windows.mjs',
  'windows/tray-host.ps1',
  'README.txt',
  'INSTALL.bat'
]) {
  test(`release contains ${relative}`, () => {
    assert.equal(existsSync(join(root, relative)), true);
  });
}

test('installer pins official Node, installs the PowerShell tray host, and creates both scheduled tasks', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.match(script, /node-v22\.23\.1-win-x64\.zip/);
  assert.doesNotMatch(script, /Neutralino/i);
  assert.doesNotMatch(script, /csc\.exe/i);
  assert.doesNotMatch(script, /TrayHost\.cs/);
  assert.doesNotMatch(script, /target:winexe/i);
  assert.match(script, /tray-host\.ps1/);
  assert.doesNotMatch(script, /MedCheckinTray\.exe/);
  assert.match(script, /Med Check-in 2\.0/);
  assert.match(script, /Med Check-in 2\.0 Watchdog/);
  assert.match(script, /RestartCount/);
  assert.match(script, /StartWhenAvailable/);
});

test('launcher invokes bundled node runtime without a visible console', () => {
  const launcher = readFileSync(join(root, 'windows/launch-hidden.vbs'), 'utf8');
  assert.match(launcher, /runtime\\node\\node\.exe/i);
  assert.match(launcher, /backend\\main\.mjs/i);
  assert.match(launcher, /shell\.Run.+,\s*0\s*,/i);
});

test('dedicated Edge launch suppresses background networking and component provisioning', () => {
  const script = readFileSync(join(root, 'windows/tray-host.ps1'), 'utf8');
  for (const required of [
    '--app=',
    '--user-data-dir=',
    '--no-first-run',
    '--disable-sync',
    '--disable-background-mode',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-default-browser-check'
  ]) {
    assert.match(script, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const excluded of [
    '--disable-default-apps',
    '--disable-extensions',
    '--disk-cache-size',
    '--disable-features'
  ]) {
    assert.doesNotMatch(script, new RegExp(excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('package script excludes private runtime data and includes application resources', () => {
  const script = readFileSync(join(root, 'scripts/package-windows.mjs'), 'utf8');
  assert.match(script, /backend/);
  assert.match(script, /resources/);
  assert.match(script, /windows/);
  assert.doesNotMatch(script, /native/);
  assert.doesNotMatch(script, /neutralino\.config/i);
  assert.doesNotMatch(script, /\.dev-data['"]/);
});

test('installer stages and validates runtimes before replacing a working installation', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const prepare = script.lastIndexOf('Prepare-Application');
  const stop = script.lastIndexOf('Stop-OldInstance');
  assert.ok(prepare > -1 && stop > -1 && prepare < stop);
  assert.match(script, /7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29/);
  assert.match(script, /tray-host\.ps1/);
});

test('installer Edge cleanup has the exact approved relative allowlist', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const array = script.match(/\$EdgeCleanupRelativePaths\s*=\s*@\(\s*([\s\S]*?)\r?\n\)/);
  assert.ok(array, 'installer must define the Edge cleanup allowlist');
  const actual = Array.from(array[1].matchAll(/'([^']+)'/g), (match) => match[1]);
  const residue = array[1].replace(/'[^']*'/g, '').replace(/[\s,]/g, '');
  assert.equal(residue, '', 'installer Edge cleanup allowlist must contain only single-quoted literal paths');
  assert.deepEqual(actual, [
    'component_crx_cache',
    'ProvenanceData',
    'ProvenanceDataTensors',
    'BrowserMetrics',
    'GrShaderCache',
    'ShaderCache',
    'GPUPersistentCache',
    'Default\\Cache',
    'Default\\Code Cache',
    'Default\\GPUCache',
    'Default\\DawnWebGPUCache',
    'Default\\DawnGraphiteCache'
  ]);
});

test('installer constrains Edge cleanup beneath its dedicated profile and treats deletion failures as non-fatal', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const containment = readPowerShellFunction(script, 'Test-EdgeCleanupTarget');
  assert.match(containment, /\[IO\.Path\]::GetFullPath/);
  assert.match(containment, /StringComparison\]::OrdinalIgnoreCase/);
  const cleanup = readPowerShellFunction(script, 'Clear-DisposableEdgeProfile');
  assert.match(cleanup, /foreach \(\$relativePath in \$EdgeCleanupRelativePaths\)/);
  assert.match(cleanup, /Remove-Item.+-Recurse.+-Force.+-ErrorAction Stop/);
  assert.ok(cleanup.indexOf('Test-EdgeCleanupTarget') < cleanup.indexOf('Remove-Item'));
  assert.match(cleanup.slice(cleanup.indexOf('Remove-Item')), /\r?\n\s*\} catch \{/);
});

test('installer skips cleanup while dedicated Edge processes remain', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const query = readPowerShellFunction(script, 'Get-DedicatedEdgeProcesses');
  assert.match(query, /Get-CimInstance -ClassName Win32_Process/);
  assert.match(query, /msedge\.exe/);
  assert.match(query, /\$EdgeProfileDir/);
  const stop = readPowerShellFunction(script, 'Stop-DedicatedEdge');
  assert.match(stop, /Get-DedicatedEdgeProcesses/);
  const cleanup = readPowerShellFunction(script, 'Clear-DisposableEdgeProfile');
  const recheck = cleanup.indexOf('$dedicatedEdgeProcesses = @(Get-DedicatedEdgeProcesses)');
  const remove = cleanup.indexOf('Remove-Item');
  assert.ok(recheck > -1 && remove > recheck, 'cleanup must recheck Edge before removing any path');
  const liveEdgeGuard = cleanup.slice(recheck, remove);
  assert.match(liveEdgeGuard, /if \(\$dedicatedEdgeProcesses\.Count -gt 0\)/);
  assert.match(liveEdgeGuard, /Write-Warning/);
  assert.match(liveEdgeGuard, /return/);
});

test('installer cleans Edge profile only after stopping the old instance and before installing the prepared app', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const stop = script.lastIndexOf('Stop-OldInstance');
  const clean = script.lastIndexOf('Clear-DisposableEdgeProfile');
  const install = script.lastIndexOf('Install-PreparedApplication');
  assert.ok(stop > -1 && clean > stop && install > clean);
});

test('installer and uninstaller identify the owned PowerShell host by its command line before terminating it', () => {
  for (const name of ['install.ps1', 'uninstall.ps1']) {
    const script = readFileSync(join(root, 'windows', name), 'utf8');
    assert.match(script, /ExecutablePath/);
    assert.match(script, /CommandLine/);
    assert.match(script, /tray-host\.ps1/);
  }
});

test('scheduled tasks launch through the hidden VBScript wrapper', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.match(script, /System32\\wscript\.exe/i);
  assert.match(script, /launch-hidden\.vbs/i);
  assert.match(script, /--logon/);
  assert.match(script, /--watchdog/);
  assert.doesNotMatch(script, /New-ScheduledTaskAction -Execute \$nodeExe/);
});


test('Windows bootstrap scripts are ASCII-safe for Windows PowerShell 5.1 and cmd.exe', () => {
  for (const relative of [
    'INSTALL.bat',
    'windows/install.bat',
    'windows/uninstall.bat',
    'windows/install.ps1',
    'windows/uninstall.ps1',
    'windows/launch-hidden.vbs'
  ]) {
    const bytes = readFileSync(join(root, relative));
    const firstNonAscii = bytes.findIndex((byte) => byte > 0x7f);
    assert.equal(
      firstNonAscii,
      -1,
      `${relative} contains a non-ASCII byte at offset ${firstNonAscii}; Windows PowerShell 5.1 may decode UTF-8 without BOM as ANSI`
    );
    const text = bytes.toString('ascii');
    assert.equal(
      /(^|[^\r])\n/.test(text),
      false,
      `${relative} contains LF-only line endings; Windows bootstrap scripts must use CRLF`
    );
  }
});


test('installer stops orphaned app processes even when runtime.json is stale', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.match(script, /Get-CimInstance -ClassName Win32_Process/);
  assert.match(script, /powershell\.exe/);
  assert.match(script, /tray-host\.ps1/);
  assert.match(script, /runtime\\node/i);
});


test('shortcuts invoke the hidden launcher rather than a UI executable', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.match(script, /TargetPath = Join-Path \$env:WINDIR 'System32\\wscript\.exe'/);
  assert.match(script, /launch-hidden\.vbs/);
  assert.match(script, /--show/);
  assert.match(script, /resources\\icons\\app\.ico/);
  assert.match(script, /IconLocation = \$iconPath/);
  assert.doesNotMatch(script, /MedCheckinTray\.exe/);
});

test('release-visible Windows labels track 2.3 without renaming stable scheduled tasks', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const tray = readFileSync(join(root, 'windows/tray-host.ps1'), 'utf8');
  const uninstall = readFileSync(join(root, 'windows/uninstall.ps1'), 'utf8');
  const readme = readFileSync(join(root, 'README.txt'), 'utf8');
  assert.match(script, /\$AppName = 'Med Check-in 2\.3\.0'/);
  assert.match(script, /Med Check-in 2\.3\.0 installation diagnostics/);
  assert.match(script, /\$shortcut\.Description = 'Med Check-in 2\.3'/);
  assert.match(script, /'Med Check-in 2\.3\.lnk'/);
  assert.match(readme, /«Med Check-in 2\.3»/);
  for (const legacy of ['2.0', '2.1', '2.2']) assert.match(script, new RegExp(`'Med Check-in ${legacy.replace('.', '\\.')}\\.lnk'`));
  assert.match(script, /\$MainTaskName = 'Med Check-in 2\.0'/);
  assert.match(script, /\$WatchdogTaskName = 'Med Check-in 2\.0 Watchdog'/);
  assert.match(tray, /NotifyIcon\.Text = 'Med Check-in 2\.3'/);
  for (const version of ['2.0', '2.1', '2.2', '2.3']) {
    assert.match(uninstall, new RegExp(`'Med Check-in ${version.replace('.', '\\.')}\\.lnk'`));
  }
  assert.match(uninstall, /Med Check-in 2\.0/);
  assert.match(uninstall, /Med Check-in 2\.0 Watchdog/);
});

test('installer prepares and validates the PowerShell host before stopping the old version', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  const prepare = script.lastIndexOf('Prepare-Application');
  const stop = script.lastIndexOf('Stop-OldInstance');
  assert.ok(prepare > -1 && stop > -1 && prepare < stop);
  assert.match(script, /PreparedTrayScript/);
  assert.match(script, /tray-host\.ps1/);
  assert.doesNotMatch(script, /PreviousInstallDir/);
});

test('installer performs a clean replacement, preserves data, and writes diagnostics instead of restoring 2.0.2', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.match(script, /Remove-Item \$InstallDir -Recurse -Force/);
  assert.match(script, /Write-InstallDiagnostics/);
  assert.match(script, /install-diagnostics\.txt/);
  assert.doesNotMatch(script, /Restore-PreviousInstallation/);
  assert.doesNotMatch(script, /PreviousInstallDir/);
  assert.doesNotMatch(script, /Remove-Item \$DataDir -Recurse/);
});

test('installer health check avoids culture-dependent runtime timestamp string round-trips', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.doesNotMatch(script, /\[datetime\]::Parse\(\[string\]\$runtime\.(?:startedAt|hostHeartbeatAt)\)/);
  assert.match(script, /\(\[datetime\]\$runtime\.startedAt\)\.ToUniversalTime\(\)/);
  assert.match(script, /\(\[datetime\]\$runtime\.hostHeartbeatAt\)\.ToUniversalTime\(\)/);
});

test('release metadata and verifier target Med Check-in 2.3.0 without a personal static regimen', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const packageScript = readFileSync(join(root, 'scripts/package-windows.mjs'), 'utf8');
  const verifierScript = readFileSync(join(root, 'scripts/verify-release.mjs'), 'utf8');
  const ui = readFileSync(join(root, 'resources/index.html'), 'utf8');
  assert.equal(packageJson.version, '2.3.0');
  assert.equal(packageLock.version, '2.3.0');
  assert.equal(packageLock.packages[''].version, '2.3.0');
  assert.match(packageJson.scripts['package:windows'], /package-windows\.mjs/);
  assert.match(packageScript, /med-checkin-2\.3\.0-windows-installer\.zip/);
  assert.match(packageScript, /VERSION\.txt/);
  assert.match(packageScript, /2\.3\.0/);
  assert.match(packageScript, /verify-release\.mjs/);
  assert.match(verifierScript, /2\.3\.0/);
  assert.match(ui, /<title>Med Check-in 2\.3\.0<\/title>/);
  assert.match(ui, /<h1>Med Check-in <span>2\.3<\/span><\/h1>/);
  assert.match(ui, /id="medication-label"[^>]*>Лечение не указано<\/p>/);
  assert.doesNotMatch(ui, /Эсциталопрам/);
  assert.doesNotMatch(ui, /Атомоксетин/);
  assert.equal(existsSync(join(root, 'scripts/verify-release.mjs')), true);
});

test('package allowlist includes all runtime modules and excludes private test data', () => {
  const script = readFileSync(join(root, 'scripts/package-windows.mjs'), 'utf8');
  const entries = script.slice(script.indexOf('const entries = ['), script.indexOf('];', script.indexOf('const entries = [')) + 2);
  for (const entry of ['backend', 'resources', 'windows', 'package.json', 'README.txt', 'INSTALL.bat', 'THIRD_PARTY_NOTICES.txt']) {
    assert.match(entries, new RegExp(`['"]${entry}['"]`));
  }
  for (const excluded of ['test', 'fixtures', '.dev-data', 'node_modules', 'scripts']) {
    assert.doesNotMatch(entries, new RegExp(`['"]${excluded}['"]`));
  }
  for (const runtime of [
    'backend/backups.mjs',
    'backend/data-maintenance.mjs',
    'backend/migrations.mjs',
    'backend/treatment.mjs',
    'resources/draft-store.js',
    'resources/startup-runtime.js'
  ]) {
    assert.equal(existsSync(join(root, runtime)), true, `${runtime} must be present in the packaged runtime tree`);
  }
});

test('release source no longer contains Neutralino configuration', () => {
  assert.equal(existsSync(join(root, 'neutralino.config.json')), false);
  const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.doesNotMatch(notices, /Neutralino/i);
});


test('release source contains no compiled tray-host artifacts', () => {
  assert.equal(existsSync(join(root, 'native')), false);
  assert.equal(existsSync(join(root, 'MedCheckinTray.exe')), false);
});

test('updater handoff constructs an installer only inside the validated temporary staging directory', () => {
  const script = readFileSync(join(root, 'windows/tray-host.ps1'), 'utf8');
  assert.match(script, /install-update/);
  assert.match(script, /\[IO\.Path\]::GetFullPath/);
  assert.match(script, /MedCheckin2-update-/);
  assert.match(script, /MedCheckin2\\INSTALL\.bat/);
  assert.doesNotMatch(script, /action\.installerPath|action\.url|action\.command/i);
});

test('installer reuses only the exact app-owned Node runtime and otherwise retains verified download fallback', () => {
  const script = readFileSync(join(root, 'windows/install.ps1'), 'utf8');
  assert.match(script, /\$InstallDir 'runtime\\node'/);
  assert.match(script, /--version/);
  assert.match(script, /v22\.23\.1/);
  assert.match(script, /Assert-Sha256/);
  assert.doesNotMatch(script, /Get-Command\s+node|where\.exe\s+node/i);
});
