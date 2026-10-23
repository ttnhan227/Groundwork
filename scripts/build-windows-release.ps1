# Groundwork 1.0 - Windows Native Release Build Script
# Builds the native WinUI 3 application, elevated MFT helper, packages the local sidecar, and verifies output.

[CmdletBinding()]
param(
    [switch]$SkipTests = $false,
    [switch]$RebuildSidecar = $false,
    [string]$Configuration = "Release",
    [string]$Platform = "x64"
)

$ErrorActionPreference = "Stop"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distDir = Join-Path $repoRoot "dist\Groundwork"
$winuiDir = Join-Path $repoRoot "desktop-winui"
$serverDir = Join-Path $repoRoot "server"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       GROUNDWORK 1.0 - WINDOWS RELEASE BUILD PIPELINE   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Repository Root: $repoRoot"
Write-Host "Output Directory: $distDir"
Write-Host "Configuration:    $Configuration ($Platform)"
Write-Host ""

# 1. Environment & Prerequisite Checks
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow
$dotnetVersion = & dotnet --version
if ($LASTEXITCODE -ne 0) { throw ".NET SDK not found on PATH" }
Write-Host "  .NET SDK: $dotnetVersion"

$pythonExe = Join-Path $serverDir ".venv\Scripts\python.exe"
if (!(Test-Path $pythonExe)) {
    $pythonExe = "python.exe"
}
$pyVersion = & $pythonExe --version 2>&1
Write-Host "  Python:   $pyVersion"

# 2. Automated Test Verification
if (-not $SkipTests) {
    Write-Host "`n[2/5] Running automated tests..." -ForegroundColor Yellow

    Write-Host "  Restoring and executing native C# engine unit & benchmark tests..."
    & dotnet restore "$winuiDir/Groundwork.slnx"
    if ($LASTEXITCODE -ne 0) { throw "Failed to restore .NET packages." }
    & dotnet test "$winuiDir/Groundwork.slnx" -c $Configuration --no-restore --verbosity normal
    if ($LASTEXITCODE -ne 0) { throw "Native engine tests failed." }

    Write-Host "  Executing Python core domain and safety test suites..."
    & $pythonExe -m pytest "$serverDir/tests" -q
    if ($LASTEXITCODE -ne 0) { throw "Python core test suite failed." }
    Write-Host "  All test suites passed cleanly." -ForegroundColor Green
} else {
    Write-Host "`n[2/5] Skipping test execution (-SkipTests specified)." -ForegroundColor DarkGray
}

# 3. Publish Native WinUI 3 Desktop App
Write-Host "`n[3/5] Publishing self-contained WinUI 3 Desktop App..." -ForegroundColor Yellow
if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

$desktopProj = Join-Path $winuiDir "src\Groundwork.Desktop\Groundwork.Desktop.csproj"
& dotnet publish $desktopProj -c $Configuration -p:Platform=$Platform -o $distDir
if ($LASTEXITCODE -ne 0) { throw "Failed to publish Groundwork.Desktop" }

# 4. Publish Native MFT Elevated Helper
Write-Host "`n[4/5] Publishing Native MFT Elevated Helper..." -ForegroundColor Yellow
$mftProj = Join-Path $winuiDir "src\Groundwork.MftHelper\Groundwork.MftHelper.csproj"
& dotnet publish $mftProj -c $Configuration -p:Platform=$Platform -o $distDir
if ($LASTEXITCODE -ne 0) { throw "Failed to publish Groundwork.MftHelper" }

# 5. Package Standalone Local Core Sidecar & Assets
Write-Host "`n[5/5] Staging standalone sidecar and verifying release bundle..." -ForegroundColor Yellow
$sidecarDir = Join-Path $distDir "groundwork-core"
$sidecarExe = Join-Path $sidecarDir "groundwork-core.exe"

if ($RebuildSidecar -or !(Test-Path $sidecarExe)) {
    Write-Host "  Building standalone Python sidecar via PyInstaller..."
    & "$PSScriptRoot\build-core.ps1" -DistDir $distDir
    if ($LASTEXITCODE -ne 0) { throw "Sidecar packaging failed." }
} else {
    Write-Host "  Using existing standalone sidecar: $sidecarExe" -ForegroundColor Green
}

# Copy model weights if present
$srcModels = Join-Path $serverDir "models"
$destModels = Join-Path $sidecarDir "models"
if ((Test-Path $srcModels) -and !(Test-Path $destModels)) {
    Copy-Item -Path $srcModels -Destination $sidecarDir -Recurse -Force
    Write-Host "  Embedded local ONNX embedding models."
}

# Copy PRI resource files to output if not already copied by dotnet publish
$priCandidate = Join-Path $winuiDir "src\Groundwork.Desktop\bin\$Platform\$Configuration\net10.0-windows10.0.19041.0\win-$Platform\Groundwork.Desktop.pri"
if (!(Test-Path $priCandidate)) {
    $priCandidate = Join-Path $winuiDir "src\Groundwork.Desktop\bin\$Configuration\net10.0-windows10.0.19041.0\win-$Platform\Groundwork.Desktop.pri"
}
if (Test-Path $priCandidate) {
    Copy-Item -Path $priCandidate -Destination (Join-Path $distDir "Groundwork.Desktop.pri") -Force
    Copy-Item -Path $priCandidate -Destination (Join-Path $distDir "resources.pri") -Force
    Write-Host "  Staged WinUI 3 XAML PRI resource indices."
}

# Verification Checks - Strictly verify genuine portability (self-contained CLR + standalone sidecar)
$requiredFiles = @(
    "Groundwork.Desktop.exe",
    "Groundwork.MftHelper.exe",
    "Microsoft.ui.xaml.dll",
    "coreclr.dll",
    "clrjit.dll",
    "groundwork-core\groundwork-core.exe"
)

$missing = @()
foreach ($file in $requiredFiles) {
    $filePath = Join-Path $distDir $file
    if (!(Test-Path $filePath)) {
        $missing += $file
    }
}

if ($missing.Count -gt 0) {
    throw "Release bundle verification failed. Missing files: $($missing -join ', ')"
}

# Generate SHA256 Checksums
$checksumFile = Join-Path $distDir "checksums.txt"
$hashes = @()
Get-ChildItem -Path $distDir -File | ForEach-Object {
    $hash = Get-FileHash -Path $_.FullName -Algorithm SHA256
    $hashes += "$($hash.Hash)  $($_.Name)"
}
$hashes | Out-File -FilePath $checksumFile -Encoding utf8

# Build Inno Setup installer if Inno Setup is available
$issPath = Join-Path $repoRoot "installer\Groundwork.iss"
$isccCandidates = @(
    "ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)
$isccExe = $null
foreach ($cand in $isccCandidates) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) { $isccExe = $cand; break }
    if (Test-Path $cand) { $isccExe = $cand; break }
}

if ($isccExe -and (Test-Path $issPath)) {
    Write-Host "  Compiling Windows setup installer via Inno Setup ($isccExe)..." -ForegroundColor Cyan
    & $isccExe $issPath
    if ($LASTEXITCODE -eq 0) {
        $setupExe = Join-Path $repoRoot "dist\Groundwork-windows-x64-setup.exe"
        if (Test-Path $setupExe) {
            $setupHash = (Get-FileHash -Path $setupExe -Algorithm SHA256).Hash.ToLower()
            $setupShaFile = Join-Path $repoRoot "dist\Groundwork-windows-x64-setup.exe.sha256"
            "$setupHash  Groundwork-windows-x64-setup.exe" | Out-File -FilePath $setupShaFile -Encoding ascii
            Write-Host "  Created setup installer: $setupExe" -ForegroundColor Green
        }
    } else {
        Write-Warning "Inno Setup compiler returned non-zero exit code ($LASTEXITCODE)."
    }
}

$sw.Stop()
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   GROUNDWORK 1.0 RELEASE PACKAGE CREATED SUCCESSFULLY!   " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Output Directory: $distDir"
Write-Host "Artifacts:"
Get-ChildItem -Path $distDir -Filter "*.exe" | ForEach-Object {
    $sizeMb = [math]::Round($_.Length / 1MB, 2)
    Write-Host "  - $($_.Name) ($sizeMb MB)" -ForegroundColor Cyan
}
Write-Host "Total Build Time: $([math]::Round($sw.Elapsed.TotalSeconds, 1))s"
Write-Host "Release Checksums written to: $checksumFile"
