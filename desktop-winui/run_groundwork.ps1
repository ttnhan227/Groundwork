Add-Type -AssemblyName System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue

$csharp = @"
using System;
using System.Runtime.InteropServices;
public class FocusHelper {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);
}
"@
Add-Type -TypeDefinition $csharp -ErrorAction SilentlyContinue

$exePath = "D:\projects\Groundwork\desktop-winui\src\Groundwork.Desktop\bin\Release\net10.0-windows10.0.19041.0\win-x64\Groundwork.Desktop.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "Building Groundwork Desktop..."
    dotnet build "D:\projects\Groundwork\desktop-winui\Groundwork.slnx" -c Release
}

Write-Host "Starting Groundwork Desktop..."
$proc = Start-Process -FilePath $exePath -PassThru

$retry = 0
while ($proc.MainWindowHandle -eq 0 -and $retry -lt 25) {
    Start-Sleep -Milliseconds 250
    $proc.Refresh()
    $retry++
}

if ($proc.MainWindowHandle -ne 0) {
    [FocusHelper]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
    [FocusHelper]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    [FocusHelper]::SwitchToThisWindow($proc.MainWindowHandle, $true)
    Write-Host "Groundwork window activated and brought to front (PID: $($proc.Id), HWND: $($proc.MainWindowHandle))."
} else {
    Write-Host "Groundwork Desktop running with PID: $($proc.Id)."
}

Wait-Process -Id $proc.Id
Write-Host "Groundwork Desktop exited."
