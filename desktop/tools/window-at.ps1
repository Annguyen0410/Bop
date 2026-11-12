# Bop dev tool: which window owns a point on the desktop, and what the desktop looked like.
#
# The acceptance run drives the machine's own pointer (tools/os-drag.ps1). When a gesture does not reach the
# app under test, the honest question is "who received it instead?" — and the answer is this: the top-level
# window at that point, with its class, title, rectangle, owning process and a full-desktop PNG. Measured on
# 0.2.1: a leftover copy of Bop from an interrupted run sat on the same 64px spot, took the whole drag, and
# the run under test read it as "the bubble did not follow the pointer at all". Dev-only.

param(
  [int]$X = 0,
  [int]$Y = 0,
  [string]$Shot = ''
)

Add-Type -Namespace BopProbe -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
public struct POINT { public int X; public int Y; }
public struct RECT { public int L, T, R, B; }
'@

$p = New-Object BopProbe.W+POINT
$p.X = $X; $p.Y = $Y
$h = [BopProbe.W]::WindowFromPoint($p)
$pid0 = 0
[BopProbe.W]::GetWindowThreadProcessId($h, [ref]$pid0) | Out-Null
$title = New-Object System.Text.StringBuilder 512
$class = New-Object System.Text.StringBuilder 512
[BopProbe.W]::GetWindowText($h, $title, 512) | Out-Null
[BopProbe.W]::GetClassName($h, $class, 512) | Out-Null
$rect = New-Object BopProbe.W+RECT
[BopProbe.W]::GetWindowRect($h, [ref]$rect) | Out-Null
$process = 'unknown'
try { $process = (Get-Process -Id $pid0 -ErrorAction Stop).ProcessName } catch { }

# The picture is taken only when asked for: a failed drag is the case where "what was on the screen?"
# cannot be reconstructed from the app's own state, and a screenshot answers it.
if ($Shot) {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bmp.Size)
  $bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

[pscustomobject]@{
  point = "$X,$Y"; class = $class.ToString(); title = $title.ToString()
  rect = "$($rect.L),$($rect.T),$($rect.R),$($rect.B)"; visible = [BopProbe.W]::IsWindowVisible($h)
  pid = $pid0; process = $process
} | ConvertTo-Json -Compress
