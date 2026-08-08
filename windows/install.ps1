[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppName = 'Med Check-in 2.2.2'
$MainTaskName = 'Med Check-in 2.0'
$WatchdogTaskName = 'Med Check-in 2.0 Watchdog'
$NodeVersion = '22.23.1'
$NodeSha256 = '7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29'
$SourceDir = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\MedCheckin2'
$DataDir = Join-Path $env:LOCALAPPDATA 'MedCheckin2'
$EdgeProfileDir = Join-Path $DataDir 'edge-profile'
$EdgeCleanupRelativePaths = @(
  'component_crx_cache',
  'ProvenanceData',
  'ProvenanceDataTensors',
  'BrowserMetrics',
  'GrShaderCache',
  'ShaderCache',
  'GPUPersistentCache',
  'Default\Cache',
  'Default\Code Cache',
  'Default\GPUCache',
  'Default\DawnWebGPUCache',
  'Default\DawnGraphiteCache'
)
$TempDir = Join-Path $env:TEMP ('MedCheckin2-install-' + [guid]::NewGuid().ToString('N'))
$PreparedAppDir = Join-Path $TempDir 'prepared\app'
$PreparedTrayScript = Join-Path $PreparedAppDir 'windows\tray-host.ps1'
$NodeArchive = 'node-v22.23.1-win-x64.zip'
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchive"
$DiagnosticsFile = Join-Path $DataDir 'install-diagnostics.txt'

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Download-File([string]$Url, [string]$Destination) {
  Write-Host "    $Url"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
  if (-not (Test-Path $Destination) -or (Get-Item $Destination).Length -lt 1024) {
    throw "Downloaded file appears to be incomplete or corrupted: $Url"
  }
}

function Assert-Sha256([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "SHA-256 mismatch for $Path. Expected $Expected, got $actual."
  }
}

function Copy-ReleaseFiles([string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $entries = @('backend', 'resources', 'windows', 'package.json', 'README.txt', 'THIRD_PARTY_NOTICES.txt', 'VERSION.txt')
  foreach ($entry in $entries) {
    $source = Join-Path $SourceDir $entry
    if (-not (Test-Path $source)) { throw "Installation package is missing: $entry" }
    Copy-Item $source (Join-Path $Destination $entry) -Recurse -Force
  }
}

function Assert-TrayScript([string]$Path) {
  if (-not (Test-Path $Path)) { throw 'Prepared application does not contain windows\tray-host.ps1.' }
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 4 -or $bytes[0] -ne 0xef -or $bytes[1] -ne 0xbb -or $bytes[2] -ne 0xbf) {
    throw 'windows\tray-host.ps1 must be UTF-8 with BOM for Windows PowerShell 5.1.'
  }
}

function Prepare-Application {
  New-Item -ItemType Directory -Force -Path $PreparedAppDir | Out-Null
  Copy-ReleaseFiles $PreparedAppDir

  $nodeArchivePath = Join-Path $TempDir $NodeArchive
  Download-File $NodeUrl $nodeArchivePath
  Assert-Sha256 $nodeArchivePath $NodeSha256
  $nodeExtractDir = Join-Path $TempDir 'node-extracted'
  Expand-Archive -Path $nodeArchivePath -DestinationPath $nodeExtractDir -Force
  $expandedNode = Get-ChildItem $nodeExtractDir -Directory | Select-Object -First 1
  if (-not $expandedNode -or -not (Test-Path (Join-Path $expandedNode.FullName 'node.exe'))) {
    throw 'Could not find node.exe in the official Node.js archive.'
  }
  $nodeTarget = Join-Path $PreparedAppDir 'runtime\node'
  New-Item -ItemType Directory -Force -Path $nodeTarget | Out-Null
  Copy-Item (Join-Path $expandedNode.FullName '*') $nodeTarget -Recurse -Force

  Assert-TrayScript $PreparedTrayScript
  if (-not (Test-Path (Join-Path $PreparedAppDir 'runtime\node\node.exe'))) {
    throw 'Prepared application does not contain node.exe.'
  }
}

function Test-OwnedProcess([object]$Process) {
  if (-not $Process) { return $false }
  $installRoot = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  $trayScript = Join-Path $InstallDir 'windows\tray-host.ps1'
  try {
    if ($Process.ExecutablePath) {
      $candidatePath = [IO.Path]::GetFullPath([string]$Process.ExecutablePath)
      if ($candidatePath.StartsWith($installRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    if (($Process.Name -ieq 'powershell.exe' -or $Process.Name -ieq 'pwsh.exe') -and $Process.CommandLine) {
      if ($Process.CommandLine.IndexOf($trayScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
  } catch {}
  return $false
}

function Stop-AppProcess([object]$ProcessId) {
  if (-not $ProcessId) { return }
  $process = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + [int]$ProcessId) -ErrorAction SilentlyContinue
  if (Test-OwnedProcess $process) {
    Stop-Process -Id ([int]$ProcessId) -Force -ErrorAction SilentlyContinue
  }
}

function Stop-DedicatedEdge {
  Get-CimInstance -ClassName Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($EdgeProfileDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    ForEach-Object { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue }
}

function Test-EdgeCleanupTarget([string]$Path) {
  try {
    $root = [IO.Path]::GetFullPath($EdgeProfileDir).TrimEnd('\')
    $candidate = [IO.Path]::GetFullPath($Path)
    return $candidate.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Clear-DisposableEdgeProfile {
  if (-not (Test-Path -LiteralPath $EdgeProfileDir)) { return }

  foreach ($relativePath in $EdgeCleanupRelativePaths) {
    $target = Join-Path $EdgeProfileDir $relativePath
    try {
      if (-not (Test-EdgeCleanupTarget $target)) {
        Write-Warning ('Skipping Edge cleanup target outside the dedicated profile: ' + $relativePath)
        continue
      }
      if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
      }
    } catch {
      Write-Warning ('Could not clean Edge profile path ' + $relativePath + ': ' + $_.Exception.Message)
    }
  }
}

function Stop-OldInstance {
  foreach ($taskName in @($MainTaskName, $WatchdogTaskName, 'Med Check-in 2.1', 'Med Check-in 2.1 Watchdog')) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
  }

  $runtimeFile = Join-Path $DataDir 'runtime.json'
  if (Test-Path $runtimeFile) {
    try {
      $runtime = Get-Content $runtimeFile -Raw | ConvertFrom-Json
      foreach ($processId in @($runtime.hostPid, $runtime.pid)) { Stop-AppProcess $processId }
    } catch {}
  }

  Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
    ForEach-Object {
      if (Test-OwnedProcess $_) { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue }
    }

  Stop-DedicatedEdge
  Start-Sleep -Milliseconds 800
}

function Install-PreparedApplication {
  $parent = Split-Path -Parent $InstallDir
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item (Join-Path $PreparedAppDir '*') $InstallDir -Recurse -Force

  if (-not (Test-Path (Join-Path $InstallDir 'runtime\node\node.exe'))) { throw 'Installed Node.js verification failed.' }
  Assert-TrayScript (Join-Path $InstallDir 'windows\tray-host.ps1')
}

function Test-InstalledTrayProcess([object]$Process) {
  if (-not $Process -or -not $Process.CommandLine) { return $false }
  if ($Process.Name -ine 'powershell.exe' -and $Process.Name -ine 'pwsh.exe') { return $false }
  $trayScript = Join-Path $InstallDir 'windows\tray-host.ps1'
  return $Process.CommandLine.IndexOf($trayScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Write-InstallDiagnostics([string]$Reason) {
  try {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add('Med Check-in 2.2.2 installation diagnostics')
    $lines.Add('Generated: ' + [datetime]::UtcNow.ToString('o'))
    $lines.Add('Reason: ' + $Reason)
    $lines.Add('')
    $lines.Add('=== runtime.json ===')
    $runtimeFile = Join-Path $DataDir 'runtime.json'
    if (Test-Path $runtimeFile) { $lines.Add((Get-Content $runtimeFile -Raw)) } else { $lines.Add('not found') }
    $lines.Add('')
    $lines.Add('=== processes ===')
    foreach ($process in (Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -ieq 'node.exe' -or $_.Name -ieq 'powershell.exe' -or $_.Name -ieq 'pwsh.exe'
    })) {
      if ((Test-OwnedProcess $process) -or (Test-InstalledTrayProcess $process)) {
        $lines.Add(('PID={0} Name={1} ExecutablePath={2} CommandLine={3}' -f $process.ProcessId, $process.Name, $process.ExecutablePath, $process.CommandLine))
      }
    }
    foreach ($logName in @('app.log', 'tray.log')) {
      $lines.Add('')
      $lines.Add('=== ' + $logName + ' ===')
      $logPath = Join-Path $DataDir ('logs\' + $logName)
      if (Test-Path $logPath) {
        foreach ($line in (Get-Content $logPath -Tail 120)) { $lines.Add([string]$line) }
      } else { $lines.Add('not found') }
    }
    [IO.File]::WriteAllLines($DiagnosticsFile, $lines, (New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $true))
  } catch {}
}

function Wait-ForApplication([datetime]$NotBefore) {
  $deadline = (Get-Date).AddSeconds(45)
  $runtimeFile = Join-Path $DataDir 'runtime.json'
  $lastState = 'No runtime state observed.'
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    try {
      $lastError = $null

      if (-not (Test-Path $runtimeFile)) {
        $lastState = 'runtime.json not found'
        Start-Sleep -Milliseconds 750
        continue
      }

      $runtime = Get-Content $runtimeFile -Raw | ConvertFrom-Json
      $startedAt = ([datetime]$runtime.startedAt).ToUniversalTime()
      $notBeforeUtc = $NotBefore.ToUniversalTime()

      $startedFresh = $startedAt -ge $notBeforeUtc.AddSeconds(-2)
      $hasPid = [bool]$runtime.pid
      $hasHostPid = [bool]$runtime.hostPid
      $hasHeartbeat = [bool]$runtime.hostHeartbeatAt

      $healthOk = $false
      $pidMatches = $false
      $trayMatches = $false
      $heartbeatAge = $null

      if ($startedFresh -and $hasPid -and $hasHostPid -and $hasHeartbeat) {
        $health = Invoke-RestMethod `
          -Uri ('http://127.0.0.1:' + [int]$runtime.port + '/health') `
          -TimeoutSec 2

        $healthOk = [bool]$health.ok
        $pidMatches = [int]$health.pid -eq [int]$runtime.pid

        $hostProcess = Get-CimInstance `
          -ClassName Win32_Process `
          -Filter ('ProcessId = ' + [int]$runtime.hostPid) `
          -ErrorAction SilentlyContinue

        $trayMatches = Test-InstalledTrayProcess $hostProcess

        $heartbeatAt = ([datetime]$runtime.hostHeartbeatAt).ToUniversalTime()
        $heartbeatAge = ([datetime]::UtcNow - $heartbeatAt).TotalSeconds
      }

      $lastState = (
        'startedAt={0:o}; notBefore={1:o}; startedFresh={2}; ' +
        'pid={3}; hostPid={4}; hasHeartbeat={5}; ' +
        'healthOk={6}; pidMatches={7}; trayMatches={8}; heartbeatAgeSec={9}'
      ) -f `
        $startedAt,
        $notBeforeUtc,
        $startedFresh,
        $runtime.pid,
        $runtime.hostPid,
        $hasHeartbeat,
        $healthOk,
        $pidMatches,
        $trayMatches,
        $heartbeatAge

      if (
        $startedFresh -and
        $hasPid -and
        $hasHostPid -and
        $hasHeartbeat -and
        $healthOk -and
        $pidMatches -and
        $trayMatches -and
        $heartbeatAge -lt 12
      ) {
        return
      }
    } catch {
      $lastError = $_.Exception.ToString()
    }

    Start-Sleep -Milliseconds 750
  }

  $reason = 'The new backend or PowerShell tray host did not become healthy within 45 seconds.'
  $reason += ' Last state: ' + $lastState
  if ($lastError) {
    $reason += ' Last error: ' + $lastError
  }

  Write-InstallDiagnostics $reason
  throw ($reason + ' Diagnostics: ' + $DiagnosticsFile)
}

function Register-AppTasks {
  $wscriptExe = Join-Path $env:WINDIR 'System32\wscript.exe'
  $launcher = Join-Path $InstallDir 'windows\launch-hidden.vbs'
  $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

  $mainAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument ('"' + $launcher + '" --logon') -WorkingDirectory $InstallDir
  $mainTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $mainTrigger.Delay = 'PT20S'
  $mainSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -RestartCount 12 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName $MainTaskName -Action $mainAction -Trigger $mainTrigger -Principal $principal -Settings $mainSettings -Description 'Med Check-in local backend and PowerShell notification-area host.' -Force | Out-Null

  $watchdogAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument ('"' + $launcher + '" --watchdog') -WorkingDirectory $InstallDir
  $watchdogTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At ((Get-Date).AddMinutes(2)) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  $watchdogSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  Register-ScheduledTask -TaskName $WatchdogTaskName -Action $watchdogAction -Trigger $watchdogTrigger -Principal $principal -Settings $watchdogSettings -Description 'Checks Med Check-in every five minutes and recovers failed processes.' -Force | Out-Null
}

function Save-Shortcut([string]$ShortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = '"' + (Join-Path $InstallDir 'windows\launch-hidden.vbs') + '" --show'
  $shortcut.WorkingDirectory = $InstallDir
  $iconPath = Join-Path $InstallDir 'resources\icons\app.ico'
  $shortcut.IconLocation = $iconPath + ',0'
  $shortcut.Description = 'Open Med Check-in 2.2'
  $shortcut.Save()
}

function Create-Shortcuts {
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $desktop = [Environment]::GetFolderPath('Desktop')
  foreach ($name in @('Med Check-in 2.0.lnk', 'Med Check-in 2.1.lnk', 'Med Check-in 2.2.lnk')) {
    Remove-Item (Join-Path $startMenu $name) -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $desktop $name) -Force -ErrorAction SilentlyContinue
  }
  Save-Shortcut (Join-Path $startMenu 'Med Check-in 2.2.lnk')
  Save-Shortcut (Join-Path $desktop 'Med Check-in 2.2.lnk')
}

try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows 10 or 11 is required.' }
  New-Item -ItemType Directory -Force -Path $TempDir, $DataDir | Out-Null

  Write-Step "Preparing Node.js $NodeVersion and the PowerShell tray host"
  Prepare-Application
  Write-Step 'Removing the previous application version'
  Stop-OldInstance
  Write-Step 'Cleaning disposable Edge profile data'
  Clear-DisposableEdgeProfile
  Write-Step 'Installing the prepared application'
  Install-PreparedApplication
  Write-Step 'Configuring startup and automatic recovery'
  Register-AppTasks
  Create-Shortcuts

  Remove-Item (Join-Path $DataDir 'quit.flag') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $DataDir 'runtime.json') -Force -ErrorAction SilentlyContinue
  Remove-Item $DiagnosticsFile -Force -ErrorAction SilentlyContinue
  $launchStartedAt = [datetime]::UtcNow
  Start-ScheduledTask -TaskName $MainTaskName
  Start-Sleep -Seconds 2
  & (Join-Path $env:WINDIR 'System32\wscript.exe') (Join-Path $InstallDir 'windows\launch-hidden.vbs') '--show'
  Wait-ForApplication $launchStartedAt

  Write-Host "`n$AppName has been installed." -ForegroundColor Green
  Write-Host 'It will start automatically when you sign in and remind you at 13:00 and 22:00.'
  Write-Host "Data directory: $DataDir"
} catch {
  Write-InstallDiagnostics $_.Exception.Message
  throw
} finally {
  if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
