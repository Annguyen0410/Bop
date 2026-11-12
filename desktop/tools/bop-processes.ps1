# Bop dev tool: which Bop copies are running on this machine right now, and what one of them costs.
#
# Written because an acceptance run can be broken by a copy of Bop it did not start. Measured on 0.2.1: a
# leftover instance (an interrupted run whose launcher was killed while the app kept running) sat on the same
# 64px bubble spot, and a real drag then went to exactly one of the two copies — the other one read it as
# "the bubble did not follow the pointer at all", which is a product defect that was not one.
#
# Two modes:
#   default      one JSON object per line: { pid, name, port, userData, acceptance }
#   -MemoryMb    one object for the whole matching tree: { memoryMb, processes }
#
# `acceptance` marks a copy started by tools/live-check.js (it carries --bop-live-check). Dev-only.

param(
  # 0 lists every Bop copy; a port lists only the ones started with that DevTools port.
  [int]$Port = 0,
  # Only processes whose command line contains this text (a run's own --user-data-dir marks its whole tree).
  [string]$Containing = '',
  # Report the working set of the matching tree instead of listing it.
  [switch]$MemoryMb
)

# Chromium passes paths with either slash depending on which process is being asked, so the needle and the
# haystack are both flattened before they are compared.
$needle = $Containing -replace '/', '\'

function Test-Command([string]$line) {
  if (-not $line) { return $false }
  if ($needle) { return (($line -replace '/', '\') -like "*$needle*") }
  if ($Port -gt 0) { return ($line -match "remote-debugging-port=$Port\b") }
  return $true
}

$found = @(Get-CimInstance Win32_Process -Filter "Name='Bop.exe' or Name='electron.exe'" | Where-Object { Test-Command $_.CommandLine })

if ($MemoryMb) {
  $bytes = 0
  $count = 0
  foreach ($entry in $found) {
    try {
      $bytes += (Get-Process -Id $entry.ProcessId -ErrorAction Stop).WorkingSet64
      $count += 1
    } catch { }
  }
  [pscustomobject]@{ memoryMb = [math]::Round($bytes / 1MB); processes = $count } | ConvertTo-Json -Compress
  return
}

$found | ForEach-Object {
  $port = if ($_.CommandLine -match 'remote-debugging-port=(\d+)') { [int]$Matches[1] } else { 0 }
  $dir = ''
  if ($_.CommandLine -match '--user-data-dir="([^"]+)"') { $dir = $Matches[1] }
  elseif ($_.CommandLine -match '--user-data-dir=(\S+)') { $dir = $Matches[1] }
  [pscustomobject]@{
    pid = $_.ProcessId
    name = $_.Name
    port = $port
    userData = $dir
    acceptance = ($_.CommandLine -match 'bop-live-check')
  } | ConvertTo-Json -Compress
}
