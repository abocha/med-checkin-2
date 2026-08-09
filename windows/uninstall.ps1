[CmdletBinding()]
param(
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
$TaskNames = @('Med Check-in 2.0', 'Med Check-in 2.0 Watchdog', 'Med Check-in 2.1', 'Med Check-in 2.1 Watchdog', 'Med Check-in 2.2', 'Med Check-in 2.2 Watchdog')
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\MedCheckin2'
$DataDir = Join-Path $env:LOCALAPPDATA 'MedCheckin2'
$TrayScript = Join-Path $InstallDir 'windows\tray-host.ps1'

function Test-OwnedProcess([object]$Process) {
  if (-not $Process) { return $false }
  $installRoot = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  try {
    if ($Process.ExecutablePath) {
      $candidatePath = [IO.Path]::GetFullPath([string]$Process.ExecutablePath)
      if ($candidatePath.StartsWith($installRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    if (($Process.Name -ieq 'powershell.exe' -or $Process.Name -ieq 'pwsh.exe') -and $Process.CommandLine) {
      if ($Process.CommandLine.IndexOf($TrayScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
  } catch {}
  return $false
}

foreach ($taskName in $TaskNames) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}

  Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
    ForEach-Object {
      if (Test-OwnedProcess $_) { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue }
    }

$profilePath = Join-Path $DataDir 'edge-profile'
Get-CimInstance -ClassName Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
  ForEach-Object { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue }

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($name in @('Med Check-in 2.0.lnk', 'Med Check-in 2.1.lnk', 'Med Check-in 2.2.lnk', 'Med Check-in 2.3.lnk', 'Med Check-in 2.4.lnk')) {
  Remove-Item (Join-Path $startMenu $name) -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $desktop $name) -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 700

if ($RemoveData -and (Test-Path $DataDir)) {
  Remove-Item $DataDir -Recurse -Force
  Write-Host 'The application and all local data have been removed.' -ForegroundColor Green
} else {
  Write-Host "The application has been removed. Data was kept in: $DataDir" -ForegroundColor Green
}

if (Test-Path $InstallDir) {
  $cleanup = 'timeout /t 2 /nobreak >nul & rmdir /s /q "' + $InstallDir + '"'
  Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', $cleanup -WindowStyle Hidden
}
