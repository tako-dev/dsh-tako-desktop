# Tako's Windows bootstrap. The NSIS artifact already contains the signed DSH
# + Tako runtime package set, so this never runs pnpm or mutates a profile.
[CmdletBinding()]
param(
  [string]$ManifestUrl = $env:TAKO_RELEASE_MANIFEST_URL,
  [string]$InstallRoot = "$env:LOCALAPPDATA\Programs\DeepSeek Harness",
  [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ManifestUrl) -or $ManifestUrl -notmatch '^https://') {
  throw 'ManifestUrl must be an HTTPS URL (or set TAKO_RELEASE_MANIFEST_URL).'
}
$manifest = Invoke-RestMethod -Uri $ManifestUrl -Method Get -UseBasicParsing
if ($manifest.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace($manifest.dshVersion) -or [string]::IsNullOrWhiteSpace($manifest.bundleVersion)) {
  throw 'Invalid Tako release manifest.'
}
if ($manifest.bundle.packageName -ne '@deepseek-ai/dsh-tako' -or $manifest.bundle.version -ne $manifest.bundleVersion) {
  throw 'Release manifest is not a matching Tako bundle.'
}

$artifact = $null
$temp = Join-Path ([IO.Path]::GetTempPath()) ("tako-install-{0}" -f ([guid]::NewGuid()))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $platformArtifacts = $manifest.artifacts.'windows-x64'
  foreach ($channel in @('domestic', 'overseas')) {
    $candidate = $platformArtifacts.$channel
    if ($null -eq $candidate -or $candidate.url -notmatch '^https://' -or $candidate.sha256 -notmatch '^[a-fA-F0-9]{64}$') { continue }
    $path = Join-Path $temp "desktop-$channel.exe"
    try {
      Write-Host "[tako] trying $channel CDN"
      Invoke-WebRequest -Uri $candidate.url -OutFile $path -UseBasicParsing
      $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
      if ($actual -ne $candidate.sha256.ToLowerInvariant()) { throw 'SHA-256 mismatch' }
      $artifact = $path
      break
    } catch {
      Remove-Item -Force -ErrorAction SilentlyContinue $path
    }
  }
  if ($null -eq $artifact) { throw 'No CDN artifact passed download and SHA-256 verification.' }
  Write-Host '[tako] installing verified Desktop'
  $process = Start-Process -FilePath $artifact -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Desktop installer failed with exit code $($process.ExitCode)." }
  if (-not $NoLaunch) {
    $executable = Join-Path $InstallRoot 'DeepSeek Harness.exe'
    if (-not (Test-Path -LiteralPath $executable)) { throw "Installed Desktop executable was not found at $executable." }
    Write-Host '[tako] starting Tako Desktop'
    Start-Process -FilePath $executable
  }
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $temp
}
