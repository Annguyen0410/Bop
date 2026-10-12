param(
  [int]$X = 320,
  [int]$Y = 106,
  [int]$Width = 1280,
  [int]$Height = 820,
  [string]$Out = "$env:TEMP\bop-screen.png"
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ScreenShotHelper {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@

$point = New-Object ScreenShotHelper+POINT
$point.X = $X + [int]($Width / 2)
$point.Y = $Y + 200
$top = [ScreenShotHelper]::WindowFromPoint($point)
$ownerPid = 0
[void][ScreenShotHelper]::GetWindowThreadProcessId($top, [ref]$ownerPid)
$title = New-Object System.Text.StringBuilder 256
[void][ScreenShotHelper]::GetWindowTextW($top, $title, 256)
$proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue

$bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($Width, $Height)))
$graphics.Dispose()
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Output "$Out | topmost-at-center: pid=$ownerPid process=$($proc.ProcessName) title='$($title.ToString())'"
