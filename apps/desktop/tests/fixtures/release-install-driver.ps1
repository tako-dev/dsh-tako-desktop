<# Exercises installer registration, shortcut checks, and protocol cleanup with private state, without installing anything. #>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Smoke)
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Smoke, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ($parseErrors | Out-String) }
foreach ($name in @('Require', 'Find-Shortcut', 'Remove-OwnedProtocolRegistration')) {
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
