# Bop dev tool: where does a launch spend its time?
#
# The portable EXE is a self-extracting launcher: it unpacks the whole app into a fresh %TEMP% directory and
# then starts it, so a click on the file is two waits, not one. This measures both, from the moment the
# process is started, against the same profile the live check builds.
#
#   powershell -File tools/startup-check.ps1                          # the built portable EXE
#   powershell -File tools/startup-check.ps1 -Unpacked                # dist/win-unpacked/Bop.exe,
#                                                                    # which is what an installed copy runs
#   powershell -File tools/startup-check.ps1 -Exe C:\path\Bop-....exe
#
# Local only: it uses an isolated profile and never writes to the machine's own Bop settings.
param(
  [string]$Exe = '',
  [switch]$Unpacked,
  [string]$UserData = '',
  [string]$Profile = '',
  [int]$TimeoutSeconds = 180
)

$root = Split-Path -Parent $PSScriptRoot
$desktopVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$exe = if ($Exe) { $Exe }
  elseif ($Unpacked) { Join-Path $root 'dist\win-unpacked\Bop.exe' }
  else { Join-Path $root "dist\Bop-$desktopVersion-portable.exe" }
if (-not (Test-Path $exe)) { throw "not found: $exe" }

$userData = if ($UserData) { $UserData } else { Join-Path $root 'tmp\startup-check-userdata' }
New-Item -ItemType Directory -Force -Path $userData | Out-Null

# Reuse the newest fixture profile an acceptance run left behind, so the same four remembered spaces are in
# play; without one the app simply starts with its defaults.
if (-not $Profile) {
  $candidate = Get-ChildItem (Join-Path $root 'tmp') -Directory -Filter 'live-*' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName 'userdata\bop-settings.bin' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($candidate) { $Profile = $candidate }
}
if ($Profile) { Copy-Item $Profile (Join-Path $userData 'bop-settings.bin') -Force }

$port = 9557
$out = Join-Path $root 'tmp\startup-check'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $exe -PassThru -ArgumentList @(
  "--user-data-dir=$userData", "--remote-debugging-port=$port", '--bop-live-check', '--bop-out', $out
)

$appAt = $null      # the launcher has finished unpacking and the app itself is running
$hubAt = $null      # the hub window exists as a live page target
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds -and -not $hubAt) {
  if (-not $appAt) {
    # The launcher extracts the app to a fresh %TEMP% directory and starts it from there, so the child is
    # found by its own path, not by the file the user clicked.
    $child = Get-CimInstance Win32_Process -Filter "Name='Bop.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -like "$env:TEMP*" } | Select-Object -First 1
    if ($child) { $appAt = [int]$sw.Elapsed.TotalMilliseconds }
  }
  try {
    $list = Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 1
    if ($list | Where-Object { $_.url -like '*renderer/index.html' }) { $hubAt = [int]$sw.Elapsed.TotalMilliseconds }
  } catch { }
  Start-Sleep -Milliseconds 50
}

if ($appAt) { 'app unpacked and running: {0} ms' -f $appAt } else { 'app process never appeared (the launcher may still be unpacking)' }
'hub window is a live page: {0} ms' -f $hubAt
'profile: {0}' -f ($(if ($Profile) { $Profile } else { 'app defaults (no fixture profile found)' }))

Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='Bop.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$userData*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
