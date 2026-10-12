# Bop dev tool: drive the machine's own pointer.
#
# A synthetic DOM event cannot prove that a window drag works: the bubble is moved by the operating
# system, so the input has to be the real thing. This presses, moves and releases the actual pointer,
# which is the same path a hand takes. Dev-only.

param(
  [switch]$Query,
  [switch]$Return,
  [int]$X1 = 0,
  [int]$Y1 = 0,
  [int]$X2 = 0,
  [int]$Y2 = 0,
  [int]$Steps = 24,
  [int]$HoldMs = 30
)

Add-Type -Namespace BopTools -Name Pointer -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extra);
public struct POINT { public int X; public int Y; }
'@

$LEFTDOWN = 0x0002
$LEFTUP = 0x0004

function Get-Cursor {
  $point = New-Object BopTools.Pointer+POINT
  [BopTools.Pointer]::GetCursorPos([ref]$point) | Out-Null
  return @($point.X, $point.Y)
}

if ($Query) {
  $at = Get-Cursor
  Write-Output "$($at[0]),$($at[1])"
  exit 0
}

$origin = Get-Cursor
[BopTools.Pointer]::SetCursorPos($X1, $Y1) | Out-Null
Start-Sleep -Milliseconds 150
[BopTools.Pointer]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
for ($i = 1; $i -le $Steps; $i++) {
  $x = [int]($X1 + ($X2 - $X1) * $i / $Steps)
  $y = [int]($Y1 + ($Y2 - $Y1) * $i / $Steps)
  [BopTools.Pointer]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds $HoldMs
}
Start-Sleep -Milliseconds 80
[BopTools.Pointer]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
if ($Return) { [BopTools.Pointer]::SetCursorPos($origin[0], $origin[1]) | Out-Null }
Write-Output "dragged"
