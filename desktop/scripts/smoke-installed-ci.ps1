# Hosted Windows runners are elevated. WebView2 ignores debugging overrides
# from elevated hosts, so exercise the installed app as the same, limited user.
param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskOutput = Join-Path $taskRoot 'desktop/test-results'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskName = 'GroundworkInstalledCheck-' + [guid]::NewGuid().ToString('N')
$taskScript = Join-Path $taskOutput "$taskName.ps1"
$taskInput = Join-Path $taskOutput "$taskName.json"
$taskExit = Join-Path $taskOutput "$taskName.exit"
$taskLog = Join-Path $taskOutput 'installed-ci.log'
@{root=$taskRoot; node=(Get-Command node).Source; installer=(Resolve-Path $Installer).Path; path=$env:PATH; log=$taskLog; exit=$taskExit} | ConvertTo-Json | Set-Content -LiteralPath $taskInput
@'
param([string]$InputPath)
$ErrorActionPreference = 'Stop'
try {
    $settings = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
    Set-Location -LiteralPath $settings.root
    $env:PATH = $settings.path
    & $settings.node 'desktop/scripts/smoke-installed.cjs' $settings.installer *> $settings.log
    $code = $LASTEXITCODE
} catch {
    $_ | Out-String | Add-Content -LiteralPath $settings.log
    $code = 1
} finally {
    Set-Content -LiteralPath $settings.exit -Value $code
}
'@ | Set-Content -LiteralPath $taskScript
$taskAction = New-ScheduledTaskAction -Execute (Get-Command pwsh).Source -Argument "-NoProfile -File `"$taskScript`" -InputPath `"$taskInput`"" -WorkingDirectory $taskRoot
$taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
try {
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $taskPrincipal -Settings $taskSettings | Out-Null
    Start-ScheduledTask -TaskName $taskName
    $taskDeadline = [DateTime]::UtcNow.AddMinutes(10)
    while (!(Test-Path -LiteralPath $taskExit) -and [DateTime]::UtcNow -lt $taskDeadline) { Start-Sleep -Seconds 2 }
    if (Test-Path -LiteralPath $taskLog) { Get-Content -LiteralPath $taskLog }
    if (!(Test-Path -LiteralPath $taskExit)) { throw 'Limited-user installed application check timed out' }
    if ([int](Get-Content -LiteralPath $taskExit) -ne 0) { throw 'Installed application checks failed' }
} finally {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}
