$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$buildEnv = Join-Path $repoPath "server/.packaging-venv"
if (!(Test-Path "$buildEnv/Scripts/python.exe")) { python -m venv $buildEnv; if ($LASTEXITCODE) { throw "Cannot create packaging environment" } }
$pythonPath = "$buildEnv/Scripts/python.exe"
& $pythonPath -m pip install -r "$repoPath/server/requirements.txt" "pyinstaller>=6,<7"
if ($LASTEXITCODE) { throw "Core dependency installation failed" }
& $pythonPath "$PSScriptRoot/prepare-model.py"
if ($LASTEXITCODE) { throw "Local model preparation failed" }
& "$PSScriptRoot/prepare-git.ps1"
if ($LASTEXITCODE) { throw "Bundled Git preparation failed" }
& $pythonPath -m compileall -q "$repoPath/server/app"
if ($LASTEXITCODE) { throw "Core source compilation failed" }
& $pythonPath -m PyInstaller --noconfirm --onedir --name groundwork-core --paths "$repoPath/server" --collect-submodules app --collect-all watchfiles --collect-all fastembed --collect-all onnxruntime --collect-all tokenizers --add-data "$repoPath/server/models;models" --add-data "$repoPath/server/git;git" --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.protocols.websockets.auto --distpath "$repoPath/desktop/src-tauri/resources" --workpath "$repoPath/server/.packaging-build" --specpath "$repoPath/server/.packaging-build" "$repoPath/server/core_entry.py"
if ($LASTEXITCODE) { throw "Core packaging failed" }
