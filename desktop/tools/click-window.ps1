param(
  [string]$Title = "Bop",
  [int]$ClientX = 0,
  [int]$ClientY = 0,
  [string]$Action = "click",   # click | move | restore
  [int]$ProcessId = 0
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Input {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@

$target = [IntPtr]::Zero
$ownerPid = 0
$callback = [Win32Input+EnumWindowsProc]{
  param($h, $p)
  if ([Win32Input]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][Win32Input]::GetWindowTextW($h, $sb, 256)
    if ($sb.ToString() -eq $script:Title) { $script:target = $h; return $false }
  }
  return $true
}
[void][Win32Input]::EnumWindows($callback, [IntPtr]::Zero)
if ($target -eq [IntPtr]::Zero) { Write-Error "no visible window titled '$Title'"; exit 1 }
[void][Win32Input]::GetWindowThreadProcessId($target, [ref]$ownerPid)

$point = New-Object Win32Input+POINT
$point.X = $ClientX; $point.Y = $ClientY
[void][Win32Input]::ClientToScreen($target, [ref]$point)

$before = New-Object Win32Input+POINT
[void][Win32Input]::GetCursorPos([ref]$before)

if ($Action -eq "restore") {
  [void][Win32Input]::SetCursorPos($before.X, $before.Y)
  Write-Output "cursor=$($before.X),$($before.Y)"
  exit 0
}

[void][Win32Input]::SetCursorPos($point.X, $point.Y)
Start-Sleep -Milliseconds 120
if ($Action -eq "click") {
  [Win32Input]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # left down
  Start-Sleep -Milliseconds 60
  [Win32Input]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # left up
}

$hit = New-Object Win32Input+POINT
$hit.X = $point.X; $hit.Y = $point.Y
$hwndUnder = [Win32Input]::WindowFromPoint($hit)
$underPid = 0
[void][Win32Input]::GetWindowThreadProcessId($hwndUnder, [ref]$underPid)
[void][Win32Input]::SetCursorPos($before.X, $before.Y)
Write-Output "window=$($target) pid=$ownerPid screen=$($point.X),$($point.Y) underPid=$underPid sameProcess=$([bool]($underPid -eq $ownerPid))"
