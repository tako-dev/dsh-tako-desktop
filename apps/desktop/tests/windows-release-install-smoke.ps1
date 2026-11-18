<# Installs the release payload on a clean Windows account and verifies removal even after a failed check. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [ValidateRange(1, 3600)][int]$InstallTimeoutSeconds = 900,
  [ValidateRange(1, 3600)][int]$UninstallTimeoutSeconds = 180,
  [ValidateRange(1, 3600)][int]$StartupTimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Release installation checks require Windows x64 and PowerShell 7.3 or later' }
$setup = [IO.Path]::GetFullPath($Installer)
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output | Out-Null
$root = [IO.Directory]::CreateTempSubdirectory('dsh-tako-install-').FullName
$productName = 'DSH Tako'
$installPath = Join-Path $root 'Installed App'
$appPath = Join-Path $installPath ($productName + '.exe')
$uninstaller = Join-Path $installPath ('Uninstall ' + $productName + '.exe')
$homePath = Join-Path $root 'Harness Home'
$userData = Join-Path $root 'Electron User Data'
$roaming = [Environment]::GetFolderPath('ApplicationData')
$local = [Environment]::GetFolderPath('LocalApplicationData')
$startMenu = Join-Path $roaming 'Microsoft\Windows\Start Menu\Programs'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$protocolKey = 'HKCU:\Software\Classes\dsh-tako'
$dataPaths = @((Join-Path $roaming $productName), (Join-Path $roaming 'dsh-tako-desktop'), (Join-Path $local 'dsh-tako-desktop-updater'))
$checks = [Collections.Generic.List[string]]::new()
$report = [ordered]@{ status = 'failed'; stage = 'preflight'; version = $Version; installer = $setup; installerSha256 = $null;
  installPath = $installPath; checks = $checks; cleanup = 'not-required'; error = $null; cleanupError = $null;
  installExitCode = $null; applicationExitCode = $null; uninstallExitCode = $null; protocolCleanup = 'not-required' }
$attempted = $false
$locked = $false
$mutex = [Threading.Mutex]::new($false, 'Global\DSHTakoReleaseInstallSmoke')

function Require([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Find-UninstallEntry {
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    foreach ($relative in @('Software\Microsoft\Windows\CurrentVersion\Uninstall', 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
      $path = Join-Path $hive $relative
      if (Test-Path -LiteralPath $path) {
        Get-ChildItem -LiteralPath $path | ForEach-Object {
          $entry = Get-ItemProperty -LiteralPath $_.PSPath
          if ($entry.DisplayName -eq $productName -or $entry.DisplayName -like "$productName *") { $entry }
        }
      }
    }
  }
}

function Find-Shortcut {
  $shell = New-Object -ComObject WScript.Shell
  try {
    foreach ($directory in @($startMenu, $desktop)) {
      if (-not (Test-Path -LiteralPath $directory)) { continue }
      Get-ChildItem -LiteralPath $directory -Filter *.lnk -Recurse | ForEach-Object {
        $shortcut = $shell.CreateShortcut($_.FullName)
        try {
          if ($shortcut.TargetPath -eq $appPath -or $_.BaseName -eq $productName) {
            [pscustomobject]@{ FullName = $_.FullName; TargetPath = $shortcut.TargetPath }
          }
        } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) }
      }
    }
  } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}

function Get-OwnedApplication {
  Get-Process -Name $productName -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $appPath }
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Message) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while ($timer.Elapsed.TotalSeconds -lt $Seconds) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  }
  throw $Message
}

function Remove-OwnedProtocolRegistration([string]$Key, [string]$Executable) {
  if (-not (Test-Path -LiteralPath $Key)) { return 'absent-after-uninstall' }
  $commandKey = Get-Item -LiteralPath (Join-Path $Key 'shell\open\command')
  try { $command = $commandKey.GetValue('') } finally { $commandKey.Dispose() }
  Require ([string]::Equals($command, ('"' + $Executable + '" "%1"'), [StringComparison]::OrdinalIgnoreCase)) 'Protocol registration no longer targets the private application; registration retained'
  # Electron creates this registration at startup; NSIS does not own its removal.
  Remove-Item -LiteralPath $Key -Recurse -Force
  Require (-not (Test-Path -LiteralPath $Key)) 'The smoke-owned protocol registration survived cleanup'
  return 'removed-smoke-owned-registration'
}

function Invoke-OwnedProcess([string]$File, [string[]]$Arguments, [int]$Seconds, [string]$LogPrefix, [switch]$Nsis) {
  $info = [Diagnostics.ProcessStartInfo]::new($File)
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.WorkingDirectory = $root
  if ($Nsis) { $info.Arguments = $Arguments[0] }
  else { foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) } }
  foreach ($name in @($info.Environment.Keys)) {
    if ($name -match 'KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$|^(DSH_|TAKO_|ANTHROPIC_|OPENAI_|DEEPSEEK_)') {
      [void]$info.Environment.Remove($name)
    }
  }
  $info.Environment['DSH_HOME'] = $homePath
  $info.Environment['DSH_AGENTS_HOME'] = Join-Path $root 'Agents Home'
  $info.Environment['DSH_TELEMETRY_DISABLED'] = '1'
  $stdout = [IO.File]::Create((Join-Path $output ($LogPrefix + '-stdout.log')))
  try {
    $stderr = [IO.File]::Create((Join-Path $output ($LogPrefix + '-stderr.log')))
    try {
      $process = [Diagnostics.Process]::Start($info)
      try {
        $stdoutCopy = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
        $stderrCopy = $process.StandardError.BaseStream.CopyToAsync($stderr)
        if (-not $process.WaitForExit($Seconds * 1000)) {
          $process.Kill($true)
          Require ($process.WaitForExit(30000)) "Process tree did not stop after its deadline: $File"
          throw "Process exceeded its $Seconds s deadline: $File"
        }
        return $process.ExitCode
      } finally {
        try {
          Require ([Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutCopy, $stderrCopy), 30000)) "Process output did not close: $File"
        } finally { $process.Dispose() }
      }
    } finally { $stderr.Dispose() }
  } finally { $stdout.Dispose() }
}

try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  Require $locked 'Another release installation check owns this Windows host'
  Require (Test-Path -LiteralPath $setup -PathType Leaf) "Installer not found: $setup"
  Require (@(Get-Process -Name $productName -ErrorAction SilentlyContinue).Count -eq 0) "$productName is already running; use a clean Windows account"
  Require (@(Find-UninstallEntry).Count -eq 0) 'An existing installation would be modified; use a clean Windows account'
  Require (@(Find-Shortcut).Count -eq 0) 'An existing product shortcut would be modified; use a clean Windows account'
  Require (-not (Test-Path -LiteralPath $protocolKey)) 'An existing dsh-tako protocol registration would be modified'
  foreach ($path in $dataPaths) { Require (-not (Test-Path -LiteralPath $path)) "Existing product data would be modified: $path" }
  $report.installerSha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
  New-Item -ItemType Directory -Path $homePath | Out-Null
  $sentinel = Join-Path $homePath 'preserved.txt'
  $sentinelValue = [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($sentinel, $sentinelValue)

  $report.stage = 'install'
  $attempted = $true
  # NSIS requires /D= to be the final, unquoted part of the command line.
  $report.installExitCode = Invoke-OwnedProcess $setup @('/S /currentuser /D=' + $installPath) $InstallTimeoutSeconds 'install' -Nsis
  Require ($report.installExitCode -eq 0) "Silent install exited with $($report.installExitCode)"
  $checks.Add('silent-install-exit-0')

  $report.stage = 'installed-tree'
  foreach ($path in @($appPath, $uninstaller, (Join-Path $installPath 'resources/app.asar'), (Join-Path $installPath 'resources/runtime/primary-runtime/runtime.json'))) {
    Require (Test-Path -LiteralPath $path -PathType Leaf) "Installed file is missing: $path"
  }
  $report.stage = 'installed-version'
  $fileVersion = (Get-Item -LiteralPath $appPath).VersionInfo.FileVersion
  Require ($fileVersion -eq $Version) "Installed executable reports version $fileVersion instead of $Version"
  $checks.Add("installed-tree-complete-$fileVersion")

  $report.stage = 'registration'
  $entries = @(Find-UninstallEntry)
  Require ($entries.Count -eq 1) 'Expected exactly one product uninstall entry'
  $entry = $entries[0]
  Require ($entry.DisplayVersion -eq $Version) "Uninstall entry reports version $($entry.DisplayVersion) instead of $Version"
  Require ($entry.InstallLocation.TrimEnd('\') -eq $installPath.TrimEnd('\')) "Uninstall entry points at $($entry.InstallLocation)"
  $checks.Add('uninstall-registry-entry')
  $shortcuts = @(Find-Shortcut)
  Require (@($shortcuts | Where-Object { $_.TargetPath -eq $appPath -and $_.FullName.StartsWith($startMenu + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) 'No Start Menu shortcut targets the installed application'
  $checks.Add("product-shortcuts-$($shortcuts.Count)")

  $report.stage = 'application-ready'
  $node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
  $appCheck = Join-Path $PSScriptRoot 'windows-release-app-smoke.mjs'
  $report.applicationExitCode = Invoke-OwnedProcess $node @($appCheck, $appPath, $Version, $homePath, $userData, $output, [string]$StartupTimeoutSeconds) ($StartupTimeoutSeconds + 90) 'node'
  Require ($report.applicationExitCode -eq 0) "Installed application readiness check exited with $($report.applicationExitCode); inspect $output\node-stderr.log and application.json"
  Wait-Until { @(Get-OwnedApplication).Count -eq 0 } 30 'Application processes survived normal shutdown'
  $checks.Add('installed-host-and-welcome-ready')
  $report.status = 'passed'
} catch {
  $report.error = $_.Exception.Message
  [Console]::Error.WriteLine($report.error)
} finally {
  if ($attempted) {
    $report.cleanup = 'failed'
    try {
      foreach ($process in @(Get-OwnedApplication)) {
        try {
          if (-not $process.HasExited) {
            try { $process.Kill($true) } catch [InvalidOperationException] { if (-not $process.HasExited) { throw } }
          }
          Require ($process.WaitForExit(30000)) "Owned application process did not stop: $($process.Id)"
        } finally { $process.Dispose() }
      }
      Wait-Until { @(Get-OwnedApplication).Count -eq 0 } 30 'Owned application processes remain; uninstall was not attempted'
      if (Test-Path -LiteralPath $installPath) {
        Require (Test-Path -LiteralPath $uninstaller -PathType Leaf) "Cannot roll back without an uninstaller; installation retained at $installPath"
        $copy = Join-Path $root 'uninstall-copy.exe'
        # _?= disables relocation, so the executable must already be outside the directory being removed.
        Copy-Item -LiteralPath $uninstaller -Destination $copy
        $report.uninstallExitCode = Invoke-OwnedProcess $copy @('/S /currentuser _?=' + $installPath) $UninstallTimeoutSeconds 'uninstall' -Nsis
        Require ($report.uninstallExitCode -eq 0) "Silent uninstall exited with $($report.uninstallExitCode)"
      }
      Wait-Until { -not (Test-Path -LiteralPath $installPath) } $UninstallTimeoutSeconds 'The installation directory survived uninstall'
      Require (@(Find-UninstallEntry).Count -eq 0) 'An uninstall registry entry survived uninstall'
      Require (@(Find-Shortcut).Count -eq 0) 'A product shortcut survived uninstall'
      $report.protocolCleanup = 'failed'
      $report.protocolCleanup = Remove-OwnedProtocolRegistration $protocolKey $appPath
      if ($report.protocolCleanup -eq 'removed-smoke-owned-registration') { $checks.Add('smoke-owned-protocol-registration-removed') }
      foreach ($path in $dataPaths) { Require (-not (Test-Path -LiteralPath $path)) "Product data survived uninstall: $path" }
      Require ([IO.File]::ReadAllText($sentinel) -eq $sentinelValue) 'Uninstall modified the private Harness home'
      $checks.Add('silent-uninstall-clean-home-retained')
      $report.cleanup = 'passed'
    } catch {
      $report.cleanupError = $_.Exception.Message
      [Console]::Error.WriteLine("Cleanup failed; retain $root for inspection: $($report.cleanupError)")
    }
  }
  try {
    if ($report.cleanup -ne 'failed') { Remove-Item -LiteralPath $root -Recurse -Force }
  } catch {
    $report.cleanup = 'failed'
    $report.cleanupError = $_.Exception.Message
  } finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    if ($report.cleanup -eq 'failed') { $report.status = 'failed' }
    [IO.File]::WriteAllText((Join-Path $output 'result.json'), ($report | ConvertTo-Json -Depth 6) + "`n")
  }
}
$checks | ForEach-Object { Write-Output "release install check: $_" }
if ($report.status -ne 'passed') { throw "Release installation check failed at $($report.stage); inspect $output\result.json" }
