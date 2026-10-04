# WebView2 honors machine policy on elevated hosted Windows runners.
# The smoke test scopes and restores that policy around its disposable app.
param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$env:GROUNDWORK_CI_WEBVIEW_POLICY = '1'
try {
    node (Join-Path $PSScriptRoot 'smoke-installed.cjs') (Resolve-Path $Installer).Path
    if ($LASTEXITCODE -ne 0) { throw 'Installed application checks failed' }
} finally {
    Remove-Item Env:GROUNDWORK_CI_WEBVIEW_POLICY -ErrorAction SilentlyContinue
}
