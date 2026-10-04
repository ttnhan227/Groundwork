# Groundwork

Groundwork is a local-first workspace search and context desktop application. It indexes registered workspace folders, inspects real projects and Git history, and preserves notes and investigation sessions in a local SQLite database.

## Repository

- `desktop/`: React, Tailwind, and Tauri desktop shell, using Groundwork's paper palette and editorial typography.
- `server/`: local FastAPI core, SQLite/FTS5, file indexing, watcher, project and Git inspection, notes, sessions, and bounded AI context.
- `cloud/`: optional account and metadata synchronization service. SQLite works for development; synchronous PostgreSQL is optional for deployment.
- `client/`: static marketing, documentation, and download website.

Local indexing and search need no cloud service, PostgreSQL, Redis, Docker, or account. Windows installers bundle the Python runtime, Git, and a trained local MiniLM embedding model. Developer checkouts use installed Git and fall back to hashing when model files are absent. The `local` AI provider shows retrieved excerpts; it is not a language model. Ollama requires a separately installed model. OpenAI and Gemini queries send the question, retrieved excerpts, and cited paths to the selected provider. Indexing never uses those remote providers.

## Development

Use Python 3.12 and Node 22 or newer. Native development also requires Rust and the Windows Tauri prerequisites.

```powershell
cd server
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd desktop
npm ci
npm run dev
```

For native development, activate the server virtual environment in the same shell and run `npm run tauri -- dev` from `desktop/`. The shell starts a managed development core. Its release path launches the bundled executable, discovers readiness using an authenticated health request, and passes a private token and dynamic localhost port to the UI.

## Windows packaging

```powershell
cd desktop
npm ci
npm run tauri -- build --bundles nsis
python scripts/smoke-core.py
```

The build command creates an isolated Python packaging environment, prepares the local model and Git with their licenses, freezes the core with PyInstaller, builds the UI, and bundles the runtime as Tauri resources. The installer is written to `desktop/src-tauri/target/release/bundle/nsis/`. Installed users need no Python, Node, npm, or developer terminal. The native shell starts its backend from the application data directory; frozen builds ignore development `.env` files. A local `local-core.log` records startup diagnostics. See `docs/REPAIR_VERIFICATION.md` for measured verification results and release limits.

The website checks GitHub's latest stable release when the download page opens and displays the published installer, version, size, and available SHA-256 digest. No per-release website rebuild or URL update is required. Push a stable `vMAJOR.MINOR.PATCH` tag to run the tested Windows release workflow; see [release automation](docs/RELEASE_AUTOMATION.md). A missing release or GitHub outage is shown explicitly.

## Verification

```powershell
cd server
python -m pytest tests
cd ../cloud
python -m pytest tests
cd ../desktop
npm run build
cd ../client
npm run build
```

The curated search evaluation is a development check, not a guarantee of recall or latency on arbitrary workspaces. See [search behavior](docs/SEARCH_AND_RANKING.md), [privacy](docs/PRIVACY_MODEL.md), [AI boundaries](docs/AI_CONTEXT_ENGINE.md), and [architecture](docs/ARCHITECTURE.md).

Packaged integration checks run from the repository root:

```powershell
python desktop/scripts/smoke-core.py
python desktop/scripts/smoke-scale.py
python desktop/scripts/smoke-sync.py
node desktop/scripts/smoke-installed.cjs desktop/src-tauri/target/release/bundle/nsis/Groundwork_1.0.0_x64-setup.exe
```

The sync check requires the cloud dependencies in `server/.venv` or the Python selected through `GROUNDWORK_CLOUD_PYTHON`. The installed UI check uses Playwright from `client/node_modules` and attaches to the real WebView2 runtime. Both application tests isolate state and run the application with an empty PATH.
