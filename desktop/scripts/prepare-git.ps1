$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$gitCommand = (Get-Command git -ErrorAction Stop).Source
$gitRoot = Split-Path (Split-Path $gitCommand)
$gitBin = Join-Path $gitRoot "mingw64/bin"
if (!(Test-Path "$gitBin/git.exe")) { throw "Packaging requires Git for Windows" }
$destination = Join-Path $repoPath "server/git"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath "$gitBin/git.exe" -Destination $destination -Force
Get-ChildItem -LiteralPath $gitBin -Filter '*.dll' | Copy-Item -Destination $destination -Force
Copy-Item -LiteralPath "$gitRoot/LICENSE.txt" -Destination "$destination/LICENSE.txt" -Force
Copy-Item -LiteralPath "$PSScriptRoot/gitconfig" -Destination "$destination/gitconfig" -Force
# Preserve the distributor's bundled dependency notices and source offer.
if (Test-Path "$gitRoot/mingw64/share/licenses") { Copy-Item -LiteralPath "$gitRoot/mingw64/share/licenses" -Destination $destination -Recurse -Force }
