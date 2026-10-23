$exe = Join-Path $PSScriptRoot "dist\Groundwork\Groundwork.Desktop.exe"
$dir = Join-Path $PSScriptRoot "dist\Groundwork"
if (!(Test-Path $exe)) {
    Write-Host "Executable not found. Building release bundle first..." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot "scripts\build-windows-release.ps1") -SkipTests
}
Start-Process $exe -WorkingDirectory $dir
