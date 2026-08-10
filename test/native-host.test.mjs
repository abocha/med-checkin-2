import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const sourceUrl = new URL('../windows/tray-host.ps1', import.meta.url);

test('PowerShell tray host source and icon are included without a compiled executable source', () => {
  assert.equal(existsSync(sourceUrl), true);
  assert.equal(existsSync(new URL('../resources/icons/app.ico', import.meta.url)), true);
  assert.equal(existsSync(new URL('../native/TrayHost.cs', import.meta.url)), false);
});

test('tray host is single-instance and uses Windows Forms NotifyIcon', () => {
  const source = readFileSync(sourceUrl, 'utf8');
  assert.match(source, /Local\\MedCheckin2PowerShellTrayHost/);
  assert.match(source, /System\.Windows\.Forms\.NotifyIcon/);
  assert.match(source, /System\.Windows\.Forms\.Application\]::Run/);
  assert.match(source, /System\.Windows\.Forms\.Timer/);
  assert.match(source, /Interval\s*=\s*3000/);
});

test('tray host polls authenticated backend and handles open and close actions', () => {
  const source = readFileSync(sourceUrl, 'utf8');
  assert.match(source, /api\/v1\/host\/poll/);
  assert.match(source, /Authorization/);
  assert.match(source, /Bearer/);
  assert.match(source, /close-window/);
  assert.match(source, /Open-App/);
  assert.match(source, /ShowBalloonTip/);
  assert.match(source, /BalloonTipClicked/);
});

test('tray host handles a received poll response before heartbeat failure can abort it', () => {
  const source = readFileSync(sourceUrl, 'utf8');
  const start = source.indexOf('function Poll-Backend');
  const end = source.indexOf('\r\nfunction Snooze-Current', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const pollBackend = source.slice(start, end);
  const poll = pollBackend.indexOf("Invoke-Api -Method 'GET' -Path '/api/v1/host/poll'");
  const handle = pollBackend.indexOf('Handle-Poll $response');
  const heartbeat = pollBackend.indexOf("Invoke-Api -Method 'POST' -Path '/api/v1/control/heartbeat'");
  assert.ok(poll > -1 && handle > poll && heartbeat > handle);
});

test('tray host launches Edge app mode with a dedicated profile and browser fallback', () => {
  const source = readFileSync(sourceUrl, 'utf8');
  assert.match(source, /--app=/);
  assert.match(source, /--user-data-dir=/);
  assert.match(source, /edge-profile/);
  assert.match(source, /Microsoft\\Edge\\Application\\msedge\.exe/);
  assert.match(source, /Start-Process/);
  assert.match(source, /Win32_Process/);
  assert.match(source, /CommandLine/);
});

test('tray menu exposes daily actions without requiring the browser to remain open', () => {
  const source = readFileSync(sourceUrl, 'utf8');
  for (const label of ['Отметить состояние', 'История', 'Графики', 'Настройки', 'Пауза на 2 часа', 'Возобновить', 'Выйти до следующего входа']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /reminders\/snooze/);
  assert.match(source, /reminders\/dismiss/);
  assert.match(source, /control\/quit/);
});

test('tray host uses configured snooze minutes and opens only the queued data folder', () => {
  const source = readFileSync(sourceUrl, 'utf8');
  assert.match(source, /repeatMinutes/);
  assert.doesNotMatch(source, /Напомнить через 30 минут/);
  assert.match(source, /minutes = \[int\]\$script:CurrentDue\.repeatMinutes/);
  assert.match(source, /period = \[string\]\$script:CurrentDue\.period/);
  assert.match(source, /open-data-folder/);
  assert.match(source, /Start-Process -FilePath 'explorer\.exe'/);
  assert.match(source, /-ArgumentList @\(\[string\]\$action\.path\)/);
});


test('tray host relinquishes an orphaned instance when runtime ownership moves to another PID', () => {
  const source = readFileSync(sourceUrl, 'utf8');
  assert.match(source, /hostPid/);
  assert.match(source, /\$PID/);
  assert.match(source, /Runtime ownership moved/);
  assert.match(source, /Exit-Tray/);
});

test('tray host script is UTF-8 with BOM for Windows PowerShell 5.1', () => {
  const bytes = readFileSync(sourceUrl);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
