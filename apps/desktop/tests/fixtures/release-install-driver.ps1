<# Exercises installer registration, shortcut checks, and protocol cleanup with private state, without installing anything. #>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Smoke)
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Smoke, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ($parseErrors | Out-String) }
foreach ($name in @('Require', 'Find-Shortcut', 'Remove-OwnedProtocolRegistration', 'Invoke-OwnedProcess')) {
  $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $function) { throw "Missing cleanup function: $name" }
  . ([scriptblock]::Create($function.Extent.Text))
}
$root = Join-Path 'HKCU:\Software\Classes' ('dsh-tako-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -Path $root | Out-Null
try {
  $productName = 'DSH Tako'
  $discovery = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Find-UninstallEntry'
  }, $true)
  Require ($null -ne $discovery) 'Missing uninstall-entry discovery function'
  $predicate = $discovery.Find({ param($node)
    $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text.Contains('$entry.DisplayName')
  }, $true)
  Require ($null -ne $predicate) 'Missing uninstall-entry product filter'
  $filter = [scriptblock]::Create($predicate.Extent.Text)
  $registry = Join-Path $root 'uninstall-entries'
  foreach ($fixture in @(
    @{ Key = 'unversioned'; DisplayName = $productName; DisplayVersion = '0.1.49' },
    @{ Key = 'current'; DisplayName = "$productName 0.1.50"; DisplayVersion = '0.1.50' },
    @{ Key = 'older'; DisplayName = "$productName 0.1.49"; DisplayVersion = '0.1.49' },
    @{ Key = 'foreign'; DisplayName = 'DSH Takoyaki 0.1.50'; DisplayVersion = '0.1.50' }
  )) {
    $key = Join-Path $registry $fixture.Key
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name DisplayName -Value $fixture.DisplayName | Out-Null
    New-ItemProperty -Path $key -Name DisplayVersion -Value $fixture.DisplayVersion | Out-Null
  }
  $entries = @(Get-ChildItem -LiteralPath $registry | ForEach-Object {
    $entry = Get-ItemProperty -LiteralPath $_.PSPath
    & $filter
  })
  Require ($entries.Count -eq 3) 'Uninstall-entry discovery must detect unversioned, current, and older product registrations only'
  Require (@($entries | Where-Object { $_.DisplayName -eq "$productName 0.1.50" }).Count -eq 1) 'Versioned product registration was not discovered'
  Require (@($entries | Where-Object { $_.DisplayName -eq "$productName 0.1.49" }).Count -eq 1) 'Older product registration was not discovered'
  Write-Output 'uninstall-entries: versioned and older product names detected; foreign prefix excluded'

  $files = [IO.Directory]::CreateTempSubdirectory('dsh-tako-shortcuts-').FullName
  try {
    $output = Join-Path $files 'Process Evidence'
    $homePath = Join-Path $files 'Process Home'
    New-Item -ItemType Directory -Path $output, $homePath | Out-Null
    $privateRoot = $root
    try {
      $root = $files
      $nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
      $exitCode = Invoke-OwnedProcess $nodeExecutable @('-e', 'process.stdout.write("captured stdout\n"); process.stderr.write("captured stderr\n"); process.exitCode = 7') 30 'capture'
      Require ($exitCode -eq 7) 'Captured process exit status was lost'
      Require ([IO.File]::ReadAllText((Join-Path $output 'capture-stdout.log')) -eq "captured stdout`n") 'Process stdout was not retained'
      Require ([IO.File]::ReadAllText((Join-Path $output 'capture-stderr.log')) -eq "captured stderr`n") 'Process stderr was not retained'
      $exitCode = Invoke-OwnedProcess $nodeExecutable @('-e', 'process.stdout.write("o".repeat(262144)); process.stderr.write("e".repeat(262144))') 30 'large'
      Require ($exitCode -eq 0) 'Concurrent stdout/stderr capture blocked the process'
      Require ((Get-Item -LiteralPath (Join-Path $output 'large-stdout.log')).Length -eq 262144) 'Large stdout was truncated'
      Require ((Get-Item -LiteralPath (Join-Path $output 'large-stderr.log')).Length -eq 262144) 'Large stderr was truncated'
      $timedOut = $false
      try {
        Invoke-OwnedProcess $nodeExecutable @('-e', 'process.stderr.write("before deadline\n"); setInterval(() => {}, 1000)') 2 'deadline' | Out-Null
      } catch {
        Require ($_.Exception.Message -like '*exceeded its 2 s deadline*') 'Unexpected timeout failure'
        $timedOut = $true
      }
      Require $timedOut 'Long-running child did not exceed its deadline'
      Require ([IO.File]::ReadAllText((Join-Path $output 'deadline-stderr.log')) -eq "before deadline`n") 'Output preceding forced teardown was not retained'
    } finally { $root = $privateRoot }
    Write-Output 'process-capture: stdout, stderr, nonzero exit, pipe pressure, and deadline teardown retained'

    $selection = $ast.Find({ param($node)
      $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$node'
    }, $true)
    Require ($null -ne $selection) 'Missing Node executable selection'
    $selectNode = [scriptblock]::Create($selection.Extent.Text)
    $first = Join-Path $files 'First Node'
    $second = Join-Path $files 'Second Node'
    New-Item -ItemType Directory -Path $first, $second | Out-Null
    foreach ($directory in @($first, $second)) { New-Item -ItemType File -Path (Join-Path $directory 'node.exe') | Out-Null }
    $originalPath = $env:PATH
    try {
      $env:PATH = $first + [IO.Path]::PathSeparator + $second + [IO.Path]::PathSeparator + $originalPath
      . $selectNode
      Require ($node -is [string] -and $node -eq (Join-Path $first 'node.exe')) 'Node selection must return only the first executable on PATH'
    } finally { $env:PATH = $originalPath }
    Write-Output 'node-selection: first executable selected from multiple PATH entries'

    $appPath = Join-Path $files 'Installed App\DSH Tako.exe'
    $startMenu = Join-Path $files 'Start Menu'
    $desktop = Join-Path $files 'Desktop'
    New-Item -ItemType Directory -Path $startMenu, $desktop | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    try {
      foreach ($link in @(
        @{ Path = Join-Path $startMenu 'DSH Tako.lnk'; Target = Join-Path $files 'Wrong App\DSH Tako.exe' },
        @{ Path = Join-Path $startMenu 'Renamed.lnk'; Target = $appPath }
      )) {
        $shortcut = $shell.CreateShortcut($link.Path)
        try { $shortcut.TargetPath = $link.Target; $shortcut.Save() }
        finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) }
      }
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
    $shortcuts = @(Find-Shortcut)
    Require ($shortcuts.Count -eq 2) 'Preflight did not detect both product shortcuts'
    $validation = $ast.Find({ param($node)
      $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Require' -and
      $node.Extent.Text.Contains('No Start Menu shortcut targets the installed application')
    }, $true)
    Require ($null -ne $validation) 'Missing Start Menu shortcut validation'
    $validate = [scriptblock]::Create($validation.Extent.Text)
    & $validate
    $shortcuts = @($shortcuts | Where-Object { $_.TargetPath -ne $appPath })
    $refused = $false
    try { & $validate } catch { $refused = $true }
    Require $refused 'A same-name shortcut targeting another executable passed validation'
    Write-Output 'shortcut-checks: target verified; same-name foreign target rejected'
  } finally { Remove-Item -LiteralPath $files -Recurse -Force }

  $executable = 'C:\private smoke\Installed App\DSH Tako.exe'
  $command = '"' + $executable + '" "%1"'
  $owned = Join-Path $root 'owned'
  if ((Remove-OwnedProtocolRegistration $owned $executable) -ne 'absent-after-uninstall') { throw 'Absent registration was not reported' }
  $commandKey = Join-Path $owned 'shell\open\command'
  New-Item -Path $commandKey -Force | Out-Null
  Set-Item -LiteralPath $commandKey -Value $command
  if ((Remove-OwnedProtocolRegistration $owned $executable.ToUpperInvariant()) -ne 'removed-smoke-owned-registration') { throw 'Owned registration was not removed' }
  if (Test-Path -LiteralPath $owned) { throw 'Owned registration remains' }

  $foreign = Join-Path $root 'foreign'
  $foreignCommand = '"C:\someone else\DSH Tako.exe" "%1"'
  $foreignCommandKey = Join-Path $foreign 'shell\open\command'
  New-Item -Path $foreignCommandKey -Force | Out-Null
  Set-Item -LiteralPath $foreignCommandKey -Value $foreignCommand
  $refused = $false
  try { Remove-OwnedProtocolRegistration $foreign $executable | Out-Null }
  catch {
    if ($_.Exception.Message -notlike '*registration retained*') { throw }
    $refused = $true
  }
  if (-not $refused -or -not (Test-Path -LiteralPath $foreignCommandKey)) { throw 'Foreign registration was not retained' }
  if ((Get-Item -LiteralPath $foreignCommandKey).GetValue('') -ne $foreignCommand) { throw 'Foreign registration was modified' }
  Write-Output 'protocol-cleanup: absent, owned, and foreign registrations verified'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force
}
if (Test-Path -LiteralPath $root) { throw 'Private test registry keys remain' }
