[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$AppRoot,
  [switch]$Show
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:DataDir = Join-Path $env:LOCALAPPDATA 'MedCheckin2'
$script:RuntimeFile = Join-Path $script:DataDir 'runtime.json'
$script:LogDir = Join-Path $script:DataDir 'logs'
$script:LogFile = Join-Path $script:LogDir 'tray.log'
$script:EdgeProfile = Join-Path $script:DataDir 'edge-profile'
$script:Runtime = $null
$script:CurrentDue = $null
$script:LastNotificationKey = $null
$script:LastNotificationAt = [datetime]::MinValue
$script:LastPollErrorAt = [datetime]::MinValue
$script:InitialShowPending = [bool]$Show
$script:Polling = $false
$script:ShuttingDown = $false
$script:NotifyIcon = $null
$script:Timer = $null
$script:Mutex = $null
$script:Icon = $null
$script:SnoozeItem = $null
$script:DismissItem = $null

function Write-TrayLog([string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path $script:LogDir | Out-Null
    $line = ([datetime]::UtcNow.ToString('o') + ' ' + $Message)
    Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
  } catch {}
}

function Load-Runtime {
  if (-not (Test-Path -LiteralPath $script:RuntimeFile)) { return $false }
  try {
    $value = Get-Content -LiteralPath $script:RuntimeFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $value -or -not $value.port -or [string]::IsNullOrWhiteSpace([string]$value.token)) { return $false }
    if ($value.hostPid -and [int]$value.hostPid -ne [int]$PID) {
      Write-TrayLog ('Runtime ownership moved to PID ' + [int]$value.hostPid + '; exiting orphaned tray PID ' + $PID)
      Exit-Tray $false
      return $false
    }
    $script:Runtime = $value
    return $true
  } catch {
    return $false
  }
}

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null
  )

  if (-not $script:Runtime -and -not (Load-Runtime)) { throw 'Runtime is unavailable.' }
  $headers = @{ Authorization = ('Bearer ' + [string]$script:Runtime.token) }
  $uri = 'http://127.0.0.1:' + [int]$script:Runtime.port + $Path
  $parameters = @{
    Uri = $uri
    Method = $Method
    Headers = $headers
    TimeoutSec = 2
  }
  if ($null -ne $Body -and $Method -ne 'GET') {
    $parameters.ContentType = 'application/json; charset=utf-8'
    $parameters.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }
  return Invoke-RestMethod @parameters
}

function Find-Edge {
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  foreach ($root in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$root)) {
      $candidates.Add((Join-Path $root 'Microsoft\Edge\Application\msedge.exe'))
    }
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Build-AppUrl {
  param(
    [string]$View = 'checkin',
    [string]$LocalDate = $null,
    [string]$Slot = $null
  )

  if (-not $script:Runtime -and -not (Load-Runtime)) { throw 'Runtime is unavailable.' }
  if ([string]::IsNullOrWhiteSpace($View)) { $View = 'checkin' }
  $url = 'http://127.0.0.1:' + [int]$script:Runtime.port + '/app/?token=' + [uri]::EscapeDataString([string]$script:Runtime.token)
  $url += '&view=' + [uri]::EscapeDataString($View)
  if (-not [string]::IsNullOrWhiteSpace($LocalDate)) { $url += '&date=' + [uri]::EscapeDataString($LocalDate) }
  if (-not [string]::IsNullOrWhiteSpace($Slot)) { $url += '&slot=' + [uri]::EscapeDataString($Slot) }
  return $url
}

function Open-App {
  param(
    [string]$View = 'checkin',
    [string]$LocalDate = $null,
    [string]$Slot = $null
  )

  try {
    if (-not (Load-Runtime)) { return }
    New-Item -ItemType Directory -Force -Path $script:EdgeProfile | Out-Null
    $url = Build-AppUrl -View $View -LocalDate $LocalDate -Slot $Slot
    $edge = Find-Edge
    if ($edge) {
      $arguments = @(
        ('--app=' + $url),
        ('--user-data-dir="' + $script:EdgeProfile + '"'),
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-background-mode',
        '--disable-background-networking',
        '--disable-component-update',
        '--window-size=1040,900'
      )
      Start-Process -FilePath $edge -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $edge) | Out-Null
    } else {
      Start-Process $url | Out-Null
    }
  } catch {
    Write-TrayLog ('Could not open app: ' + $_.Exception.Message)
  }
}

function Close-AppWindows {
  try {
    Get-CimInstance -ClassName Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($script:EdgeProfile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
      ForEach-Object {
        Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$_.ProcessId, '/T', '/F') -WindowStyle Hidden -Wait | Out-Null
      }
  } catch {
    Write-TrayLog ('Could not close app window: ' + $_.Exception.Message)
  }
}

function Set-DueActions([bool]$Enabled) {
  if ($script:SnoozeItem) { $script:SnoozeItem.Enabled = $Enabled }
  if ($script:DismissItem) { $script:DismissItem.Enabled = $Enabled }
}

function Set-SnoozeLabel([object]$Due = $null) {
  if (-not $script:SnoozeItem) { return }
  if ($Due -and $null -ne $Due.repeatMinutes) {
    $script:SnoozeItem.Text = 'Напомнить через ' + [string]$Due.repeatMinutes + ' минут'
  } else {
    $script:SnoozeItem.Text = 'Напомнить позже'
  }
}

function Open-CurrentDue {
  if ($script:CurrentDue) {
    Open-App -View 'checkin' -LocalDate ([string]$script:CurrentDue.localDate) -Slot ([string]$script:CurrentDue.slot)
  } else {
    Open-App -View 'checkin'
  }
}

function Show-Reminder([object]$Due) {
  $script:NotifyIcon.BalloonTipTitle = 'Med Check-in'
  if ([string]$Due.slot -eq '13:00') {
    $script:NotifyIcon.BalloonTipText = 'Пора отметить дневное состояние'
  } else {
    $script:NotifyIcon.BalloonTipText = 'Пора отметить вечернее состояние'
  }
  $script:NotifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $script:NotifyIcon.ShowBalloonTip(12000)
}

function Start-UpdateInstaller([string]$StagingDir) {
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\')
  $resolvedStaging = [IO.Path]::GetFullPath($StagingDir).TrimEnd('\\')
  if (-not $resolvedStaging.StartsWith($temporaryRoot + '\\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Update staging directory is outside the current user temporary directory.'
  }
  if (-not ([IO.Path]::GetFileName($resolvedStaging).StartsWith('MedCheckin2-update-', [System.StringComparison]::OrdinalIgnoreCase))) {
    throw 'Update staging directory has an unexpected name.'
  }
  $installer = Join-Path $resolvedStaging 'MedCheckin2\INSTALL.bat'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw 'Update staging directory does not contain MedCheckin2\INSTALL.bat.'
  }
  Start-Process -FilePath $installer -WorkingDirectory (Split-Path -Parent $installer) | Out-Null
}

function Handle-Poll([object]$Response) {
  if ($script:InitialShowPending) {
    $script:InitialShowPending = $false
    Open-App -View 'checkin'
  }

  foreach ($action in @($Response.actions)) {
    if (-not $action) { continue }
    if ([string]$action.type -eq 'open') {
      $view = if ([string]::IsNullOrWhiteSpace([string]$action.view)) { 'checkin' } else { [string]$action.view }
      Open-App -View $view -LocalDate ([string]$action.localDate) -Slot ([string]$action.slot)
    } elseif ([string]$action.type -eq 'close-window') {
      Close-AppWindows
    } elseif ([string]$action.type -eq 'open-data-folder') {
      Start-Process -FilePath 'explorer.exe' -ArgumentList @([string]$action.path) | Out-Null
    } elseif ([string]$action.type -eq 'install-update') {
      try { Start-UpdateInstaller ([string]$action.stagingDir) }
      catch { Write-TrayLog ('Could not start verified update installer: ' + $_.Exception.Message) }
    }
  }

  if ($Response.due) {
    $script:CurrentDue = $Response.due
    Set-SnoozeLabel $Response.due
    Set-DueActions $true
    $key = [string]$Response.due.localDate + '|' + [string]$Response.due.slot
    $now = [datetime]::UtcNow
    if ($key -ne $script:LastNotificationKey -or ($now - $script:LastNotificationAt).TotalMinutes -gt 1) {
      $script:LastNotificationKey = $key
      $script:LastNotificationAt = $now
      try {
        Invoke-Api -Method 'POST' -Path '/api/v1/reminders/notified' -Body @{
          localDate = [string]$Response.due.localDate
          period = [string]$Response.due.period
        } | Out-Null
      } catch {}
      Show-Reminder $Response.due
    }
  } else {
    $script:CurrentDue = $null
    Set-SnoozeLabel
    Set-DueActions $false
  }
}

function Poll-Backend {
  if ($script:Polling -or $script:ShuttingDown) { return }
  $script:Polling = $true
  try {
    if (-not (Load-Runtime)) { return }
    $response = Invoke-Api -Method 'GET' -Path '/api/v1/host/poll'
    Invoke-Api -Method 'POST' -Path '/api/v1/control/heartbeat' -Body @{} | Out-Null
    Handle-Poll $response
  } catch {
    $now = [datetime]::UtcNow
    if (($now - $script:LastPollErrorAt).TotalSeconds -ge 60) {
      $script:LastPollErrorAt = $now
      Write-TrayLog ('Tray poll failed: ' + $_.Exception.Message)
    }
  } finally {
    $script:Polling = $false
  }
}

function Snooze-Current {
  if (-not $script:CurrentDue) { return }
  try {
    Invoke-Api -Method 'POST' -Path '/api/v1/reminders/snooze' -Body @{
      localDate = [string]$script:CurrentDue.localDate
      period = [string]$script:CurrentDue.period
      minutes = [int]$script:CurrentDue.repeatMinutes
    } | Out-Null
    $script:CurrentDue = $null
    Set-DueActions $false
    Close-AppWindows
  } catch {
    Write-TrayLog ('Snooze failed: ' + $_.Exception.Message)
  }
}

function Dismiss-Current {
  if (-not $script:CurrentDue) { return }
  try {
    Invoke-Api -Method 'POST' -Path '/api/v1/reminders/dismiss' -Body @{
      localDate = [string]$script:CurrentDue.localDate
      period = [string]$script:CurrentDue.period
    } | Out-Null
    $script:CurrentDue = $null
    Set-DueActions $false
    Close-AppWindows
  } catch {
    Write-TrayLog ('Dismiss failed: ' + $_.Exception.Message)
  }
}

function Pause-Reminders {
  try {
    Invoke-Api -Method 'PUT' -Path '/api/v1/settings' -Body @{
      remindersPausedUntil = [datetime]::UtcNow.AddHours(2).ToString('o')
    } | Out-Null
  } catch {
    Write-TrayLog ('Pause failed: ' + $_.Exception.Message)
  }
}

function Resume-Reminders {
  try {
    Invoke-Api -Method 'PUT' -Path '/api/v1/settings' -Body @{ remindersPausedUntil = $null } | Out-Null
  } catch {
    Write-TrayLog ('Resume failed: ' + $_.Exception.Message)
  }
}

function Exit-Tray([bool]$CloseWindows = $true) {
  if ($script:ShuttingDown) { return }
  $script:ShuttingDown = $true
  if ($script:Timer) { $script:Timer.Stop() }
  if ($script:NotifyIcon) { $script:NotifyIcon.Visible = $false }
  if ($CloseWindows) { Close-AppWindows }
  [System.Windows.Forms.Application]::ExitThread()
}

function Quit-UntilLogon {
  try { Invoke-Api -Method 'POST' -Path '/api/v1/control/quit' -Body @{} | Out-Null } catch {}
  Exit-Tray
}

function New-MenuItem([string]$Text, [scriptblock]$Click) {
  $item = New-Object -TypeName System.Windows.Forms.ToolStripMenuItem
  $item.Text = $Text
  $item.add_Click($Click)
  return $item
}

try {
  New-Item -ItemType Directory -Force -Path $script:DataDir, $script:LogDir | Out-Null
  $createdNew = $false
  $script:Mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList @($true, 'Local\MedCheckin2PowerShellTrayHost', ([ref]$createdNew))
  if (-not $createdNew) { exit 0 }

  $menu = New-Object -TypeName System.Windows.Forms.ContextMenuStrip
  [void]$menu.Items.Add((New-MenuItem 'Отметить состояние' { Open-App -View 'checkin' }))
  [void]$menu.Items.Add((New-MenuItem 'История' { Open-App -View 'history' }))
  [void]$menu.Items.Add((New-MenuItem 'Графики' { Open-App -View 'analytics' }))
  [void]$menu.Items.Add((New-MenuItem 'Настройки' { Open-App -View 'settings' }))
  [void]$menu.Items.Add((New-Object -TypeName System.Windows.Forms.ToolStripSeparator))

  $script:SnoozeItem = New-MenuItem 'Напомнить позже' { Snooze-Current }
  $script:DismissItem = New-MenuItem 'Сегодня пропустить' { Dismiss-Current }
  $script:SnoozeItem.Enabled = $false
  $script:DismissItem.Enabled = $false
  [void]$menu.Items.Add($script:SnoozeItem)
  [void]$menu.Items.Add($script:DismissItem)
  [void]$menu.Items.Add((New-Object -TypeName System.Windows.Forms.ToolStripSeparator))
  [void]$menu.Items.Add((New-MenuItem 'Пауза на 2 часа' { Pause-Reminders }))
  [void]$menu.Items.Add((New-MenuItem 'Возобновить' { Resume-Reminders }))
  [void]$menu.Items.Add((New-Object -TypeName System.Windows.Forms.ToolStripSeparator))
  [void]$menu.Items.Add((New-MenuItem 'Выйти до следующего входа' { Quit-UntilLogon }))

  $script:NotifyIcon = New-Object -TypeName System.Windows.Forms.NotifyIcon
  $script:NotifyIcon.Text = 'Med Check-in 2.4'
  $iconPath = Join-Path $AppRoot 'resources\icons\app.ico'
  if (Test-Path -LiteralPath $iconPath) {
    $script:Icon = New-Object -TypeName System.Drawing.Icon -ArgumentList $iconPath
    $script:NotifyIcon.Icon = $script:Icon
  } else {
    $script:NotifyIcon.Icon = [System.Drawing.SystemIcons]::Information
  }
  $script:NotifyIcon.ContextMenuStrip = $menu
  $script:NotifyIcon.Visible = $true
  $script:NotifyIcon.add_DoubleClick({ Open-App -View 'checkin' })
  $script:NotifyIcon.add_BalloonTipClicked({ Open-CurrentDue })

  $script:Timer = New-Object -TypeName System.Windows.Forms.Timer
  $script:Timer.Interval = 3000
  $script:Timer.add_Tick({ Poll-Backend })
  $script:Timer.Start()

  Write-TrayLog ('PowerShell tray host started (pid ' + $PID + ')')
  Poll-Backend
  [System.Windows.Forms.Application]::Run()
} catch {
  Write-TrayLog ('Fatal tray host error: ' + $_.Exception.ToString())
  exit 1
} finally {
  try { if ($script:Timer) { $script:Timer.Stop(); $script:Timer.Dispose() } } catch {}
  try { if ($script:NotifyIcon) { $script:NotifyIcon.Visible = $false; $script:NotifyIcon.Dispose() } } catch {}
  try { if ($script:Icon) { $script:Icon.Dispose() } } catch {}
  try { if ($script:Mutex) { $script:Mutex.ReleaseMutex(); $script:Mutex.Dispose() } } catch {}
}
