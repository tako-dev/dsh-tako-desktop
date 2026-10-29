<# Exercise the installer a release actually publishes: silent install, launch, silent uninstall, no leftovers. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][string]$Version,
  [string]$ProductName = 'DSH Tako',
  [int]$InstallTimeoutSeconds = 900,
  [int]$UninstallTimeoutSeconds = 180,
  [int]$LaunchSeconds = 25
)
$ErrorActionPreference = 'Stop'
$setup = [IO.Path]::GetFullPath($Installer)
$root = Join-Path ([IO.Path]::GetTempPath()) ('dsh-tako-install-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$installPath = Join-Path $root 'Installed App'
$appPath = Join-Path $installPath ($ProductName + '.exe')
$uninstaller = Join-Path $installPath ('Uninstall ' + $ProductName + '.exe')
$startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$results = [Collections.Generic.List[string]]::new()

function Require([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Find-UninstallEntry {
  Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue | ForEach-Object {
    $entry = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($entry.DisplayName -eq $ProductName) { $entry }
  } | Select-Object -First 1
}

function Find-Shortcut {
  if (-not (Test-Path -LiteralPath $startMenu)) { return @() }
  Get-ChildItem -LiteralPath $startMenu -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | Where-Object {
    $shell = New-Object -ComObject WScript.Shell
    try { $shell.CreateShortcut($_.FullName).TargetPath -eq $appPath } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
  }
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Message) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while ($timer.Elapsed.TotalSeconds -lt $Seconds) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  }
  throw $Message
}

if (-not (Test-Path -LiteralPath $setup)) { throw "Installer not found: $setup" }
Require (-not (Test-Path -LiteralPath $installPath)) 'The private install directory must not exist before the check'
# A packaged build already installed for the current user would own the same registry entry and shortcuts.
$running = @(Get-Process -Name $ProductName -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { throw "$ProductName is already running; the install check needs a clean session" }
$existing = Find-UninstallEntry
Require ($existing -eq $null) "An existing $ProductName installation would be modified: $($existing.InstallLocation)"

try {
  # NSIS takes /D last and unquoted; the installer is unsigned, so no SmartScreen prompt can block it.
  $process = Start-Process -FilePath $setup -ArgumentList ('/S /D=' + $installPath) -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit($InstallTimeoutSeconds * 1000)) {
    $process.Kill(); $process.WaitForExit()
    throw "Silent install did not finish within $InstallTimeoutSeconds s"
  }
  Require ($process.ExitCode -eq 0) "Silent install exited with $($process.ExitCode)"
  $results.Add('silent-install-exit-0')

  Require (Test-Path -LiteralPath $appPath) "Installed application is missing: $appPath"
  Require (Test-Path -LiteralPath (Join-Path $installPath 'resources/app.asar')) 'resources/app.asar is missing from the installed tree'
  Require (Test-Path -LiteralPath (Join-Path $installPath 'resources/runtime/primary-runtime/runtime.json')) 'The primary runtime is missing from the installed tree'
  Require (Test-Path -LiteralPath $uninstaller) 'The uninstaller is missing from the installed tree'
  $fileVersion = (Get-Item -LiteralPath $appPath).VersionInfo.FileVersion
  Require ($fileVersion -eq $Version) "Installed executable reports version $fileVersion instead of $Version"
  $results.Add("installed-tree-complete-$fileVersion")

  $entry = Find-UninstallEntry
  Require ($entry -ne $null) "No $uninstallRoot entry names $ProductName"
  Require ($entry.DisplayVersion -eq $Version) "Uninstall entry reports $($entry.DisplayVersion) instead of $Version"
  Require ($entry.InstallLocation.TrimEnd('\') -eq $installPath.TrimEnd('\')) "Uninstall entry points at $($entry.InstallLocation)"
  $results.Add('uninstall-registry-entry')

  $shortcuts = @(Find-Shortcut)
  Require ($shortcuts.Count -gt 0) "No Start Menu shortcut targets $appPath"
  $results.Add("start-menu-shortcut-$($shortcuts.Count)")

  $launched = Start-Process -FilePath $appPath -PassThru
  Start-Sleep -Seconds $LaunchSeconds
  Require (-not $launched.HasExited) "The installed application exited within $LaunchSeconds s"
  $windowed = @(Get-Process -Name $ProductName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  $results.Add("application-running-after-$($LaunchSeconds)s-windows=$($windowed.Count)")
  Get-Process -Name $ProductName -ErrorAction SilentlyContinue | Stop-Process -Force
  Wait-Until { @(Get-Process -Name $ProductName -ErrorAction SilentlyContinue).Count -eq 0 } 60 "The application did not stop"

  # electron-builder's uninstaller locates its directory through _?= once NSIS copied it to %TEMP%.
  $removal = Start-Process -FilePath $uninstaller -ArgumentList ('/S _?=' + $installPath) -PassThru -WindowStyle Hidden
  if (-not $removal.WaitForExit($UninstallTimeoutSeconds * 1000)) {
    $removal.Kill(); $removal.WaitForExit()
    throw "Silent uninstall did not finish within $UninstallTimeoutSeconds s"
  }
  # The uninstaller hands removal to a temporary copy and exits before the directory disappears.
  Wait-Until { -not (Test-Path -LiteralPath $installPath) } $UninstallTimeoutSeconds 'The installation directory survived the uninstall'
  Wait-Until { (Find-UninstallEntry) -eq $null } 60 'The uninstall registry entry survived the uninstall'
  Require (@(Find-Shortcut).Count -eq 0) 'A Start Menu shortcut survived the uninstall'
  $results.Add('silent-uninstall-clean')

  $results | ForEach-Object { Write-Output "release install check: $_" }
} finally {
  Get-Process -Name $ProductName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}
