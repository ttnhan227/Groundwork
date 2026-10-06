$ErrorActionPreference = 'Stop'
$hasCertificate = ![string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_BASE64)
if (!$hasCertificate) {
    Write-Host 'Building an unsigned installer; signing is optional by project policy.'
    npm run tauri -- build --bundles nsis
    if ($LASTEXITCODE) { throw 'Installer build failed' }
    exit
}
$temporaryDirectory = Join-Path $env:RUNNER_TEMP ('groundwork-signing-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
$certificate = $null
try {
    $pfx = Join-Path $temporaryDirectory 'certificate.pfx'
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64))
    $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
    $signingCertificates = @(Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $password | Where-Object HasPrivateKey)
    if ($signingCertificates.Count -ne 1) { throw 'Expected one certificate with a private key' }
    $certificate = $signingCertificates[0]
    $config = Join-Path $temporaryDirectory 'tauri-signing.json'
    @{bundle=@{windows=@{certificateThumbprint=$certificate.Thumbprint;digestAlgorithm='sha256';timestampUrl='http://timestamp.digicert.com'}}} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $config -Encoding utf8
    npm run tauri -- build --bundles nsis --config $config
    if ($LASTEXITCODE) { throw 'Signed installer build failed' }
    $installer = Get-ChildItem -LiteralPath src-tauri/target/release/bundle/nsis -Filter '*-setup.exe'
    if (@($installer).Count -ne 1) { throw 'Expected one signed installer' }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) { throw 'Installer signature verification failed' }
    if (!$signature.TimeStamperCertificate) { throw 'Installer signature is missing its trusted timestamp' }
} finally {
    if ($certificate) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $certificate.Thumbprint) -DeleteKey }
    # This uniquely created directory is confined to RUNNER_TEMP.
    $resolvedTemporaryDirectory = [IO.Path]::GetFullPath($temporaryDirectory)
    $runnerRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
    if (!$resolvedTemporaryDirectory.StartsWith($runnerRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Signing cleanup escaped RUNNER_TEMP' }
    Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
}
