param(
  [string]$Out = "$env:TEMP\bop-window.png",
  [int]$ProcessId = 0,
  [string]$ProcessName = "Bop"
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$targets = @()
if ($ProcessId -ne 0) { $targets = @(Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) }
else { $targets = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) }

foreach ($proc in $targets) {
  $handles = New-Object System.Collections.ArrayList
  $callback = [Win32Cap+EnumWindowsProc]{
    param($hWnd, $lParam)
    $ownerPid = 0
    [void][Win32Cap]::GetWindowThreadProcessId($hWnd, [ref]$ownerPid)
    if ($ownerPid -eq $proc.Id -and [Win32Cap]::IsWindowVisible($hWnd)) {
      $sb = New-Object System.Text.StringBuilder 256
      [void][Win32Cap]::GetWindowTextW($hWnd, $sb, 256)
      [void]$handles.Add([pscustomobject]@{ Handle = $hWnd; Title = $sb.ToString() })
    }
    return $true
  }
  [void][Win32Cap]::EnumWindows($callback, [IntPtr]::Zero)
  foreach ($entry in $handles) {
    $rect = New-Object Win32Cap+RECT
    [void][Win32Cap]::GetWindowRect($entry.Handle, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 200 -or $height -lt 200) { continue }
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $hdc = $graphics.GetHdc()
    [void][Win32Cap]::PrintWindow($entry.Handle, $hdc, 2)
    $graphics.ReleaseHdc($hdc)
    $graphics.Dispose()
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($Out)
    $dir = [System.IO.Path]::GetDirectoryName($Out)
    $file = Join-Path $dir "$stem-$($proc.Id)-$($entry.Handle).png"
    $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    Write-Output "$file | pid=$($proc.Id) title='$($entry.Title)' rect=$($rect.Left),$($rect.Top) ${width}x${height}"
  }
}
