param(
  [string]$Source = "$env:APPDATA\Bop",
  [string]$Destination = "$env:TEMP\bop-real"
)

$skip = @('Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
          'Shared Dictionary', 'blob_storage', 'lockfile', 'DevToolsActivePort', 'smoke')

if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Get-ChildItem -Path $Source -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $Destination -Recurse -Force -ErrorAction SilentlyContinue
}

$names = (Get-ChildItem $Destination -Force | Select-Object -ExpandProperty Name) -join ', '
Write-Output "copied to $Destination : $names"
$settings = Join-Path $Destination 'bop-settings.bin'
if (Test-Path $settings) { Write-Output "settings bytes: $((Get-Item $settings).Length)" }
