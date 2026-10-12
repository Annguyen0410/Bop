param([string]$ProcessName = "Bop")

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinList {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$rows = New-Object System.Collections.ArrayList
$callback = [WinList+EnumWindowsProc]{
  param($hWnd, $lParam)
  $ownerPid = 0
  [void][WinList]::GetWindowThreadProcessId($hWnd, [ref]$ownerPid)
  $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -like "$script:ProcessName*") {
    $title = New-Object System.Text.StringBuilder 256
    [void][WinList]::GetWindowTextW($hWnd, $title, 256)
    $class = New-Object System.Text.StringBuilder 256
    [void][WinList]::GetClassNameW($hWnd, $class, 256)
    $rect = New-Object WinList+RECT
    [void][WinList]::GetWindowRect($hWnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -ge 40 -and $height -ge 40) {
      $line = "pid=$ownerPid hwnd=$hWnd visible=$([WinList]::IsWindowVisible($hWnd)) minimized=$([WinList]::IsIconic($hWnd)) class=$($class.ToString()) title='$($title.ToString())' rect=$($rect.Left),$($rect.Top) ${width}x${height}"
      [void]$script:rows.Add($line)
    }
  }
  return $true
}
[void][WinList]::EnumWindows($callback, [IntPtr]::Zero)
$rows | ForEach-Object { Write-Output $_ }
Write-Output "total windows listed: $($rows.Count)"
