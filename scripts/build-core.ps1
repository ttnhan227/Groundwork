# Groundwork 1.0 - Standalone Core Packaging Script
# Uses PyInstaller to build a standalone, zero-dependency Python sidecar executable.

[CmdletBinding()]
param(
    [string]$DistDir = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($DistDir)) {
    $DistDir = Join-Path $repoRoot "dist\Groundwork"
}

$buildEnv = Join-Path $repoRoot "server\.packaging-venv"
$pythonPath = Join-Path $buildEnv "Scripts\python.exe"

if (!(Test-Path $pythonPath)) {
    Write-Host "Creating packaging virtualenv at $buildEnv..." -ForegroundColor Cyan
    & python -m venv $buildEnv
    if ($LASTEXITCODE -ne 0) { throw "Failed to create packaging virtual environment" }
}

Write-Host "Verifying packaging dependencies..." -ForegroundColor Cyan
& $pythonPath -m pip install -r "$repoRoot/server/requirements.txt" "pyinstaller>=6,<7" --quiet
if ($LASTEXITCODE -ne 0) { throw "Core dependency installation failed" }

# Prepare desktop configuration if needed
$buildDir = Join-Path $repoRoot "server\.packaging-build"
if (!(Test-Path $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
}

$configPath = Join-Path $buildDir "desktop-config.json"
if (!(Test-Path $configPath)) {
    $defaultConfig = @{
        GROUNDWORK_ENV = "desktop"
        GROUNDWORK_OFFLINE = $true
        GROUNDWORK_HOST = "127.0.0.1"
    } | ConvertTo-Json
    Set-Content -Path $configPath -Value $defaultConfig -Encoding utf8
}

$buildWorkPath = Join-Path $buildDir ("run-" + [guid]::NewGuid().ToString("N"))
Write-Host "Packaging groundwork-core into $DistDir\groundwork-core..." -ForegroundColor Cyan

& $pythonPath -m PyInstaller `
    --clean `
    --noconfirm `
    --onedir `
    --name groundwork-core `
    --paths "$repoRoot/server" `
    --collect-submodules app `
    --exclude-module app.hosted `
    --collect-all watchfiles `
    --collect-all fastembed `
    --collect-all onnxruntime `
    --collect-all tokenizers `
    --add-data "$repoRoot\server\models;models" `
    --add-data "$repoRoot\server\git;git" `
    --add-data "$configPath;." `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --distpath "$DistDir" `
    --workpath "$buildWorkPath" `
    --specpath "$buildDir" `
    "$repoRoot\server\core_entry.py"

if ($LASTEXITCODE -ne 0) { throw "PyInstaller sidecar packaging failed." }

# Clean up temporary work directory safely
if (Test-Path $buildWorkPath) {
    Remove-Item -LiteralPath $buildWorkPath -Recurse -Force -ErrorAction SilentlyContinue
}

$finalExe = Join-Path $DistDir "groundwork-core\groundwork-core.exe"
if (!(Test-Path $finalExe)) {
    throw "PyInstaller completed, but expected binary not found: $finalExe"
}

Write-Host "Successfully packaged standalone sidecar: $finalExe" -ForegroundColor Green
