# Groundwork

Groundwork is a desktop app for searching project folders, exploring Git history, and collecting notes and AI context. SQLite stores your local workspace data. An optional backend handles accounts and sync.

## Use the app

Download the Windows installer from [GitHub Releases](https://github.com/ttnhan227/Groundwork/releases/latest), run the `.exe`, then open Groundwork and add a workspace folder.

The installer includes the local engine, Python runtime, Git, and a search embedding model. You do not need Docker, Python, Node.js, or PostgreSQL installed separately. Local indexing and search work without an account or internet connection. Remote AI generation needs your own provider key and internet access; Ollama needs a separately installed local model.

## Quick developer setup: Docker

Install Git and Docker with Compose. On Windows, start Docker Desktop, then run:

```sh
git clone https://github.com/ttnhan227/Groundwork.git
cd Groundwork
docker compose up -d --build
```

Wait for startup, then open the **[app interface](http://localhost:5174)** or **[website](http://localhost:3000)**. No `.env` file or external database account is required. The first build downloads dependencies and can take several minutes.

### The five services

| Service | What it does | Local address |
| --- | --- | --- |
| `desktop` | App interface in your browser | `http://localhost:5174` |
| `website` | Landing page, downloads, and documentation | `http://localhost:3000` |
| `local-engine` | SQLite, indexing, search, Git inspection, and AI context | `http://localhost:8000/docs` |
| `backend` | Accounts, authentication, and metadata sync | `http://localhost:8080/docs` |
| `database` | PostgreSQL for backend account and sync data | `localhost:5433` |

SQLite stores local workspace data. PostgreSQL stores backend account and sync data. Both persist across ordinary container restarts.

The backend creates its PostgreSQL tables in the `groundwork` schema. Existing tables in `public` are kept separate. `GROUNDWORK_DATABASE_SCHEMA` can override this namespace when self-hosting.

Docker serves the app's browser interface, not a native desktop window. Native folder dialogs and service restart controls require the installed app or native development. The local engine sees the repository at `/workspace`. Mount other host folders into that container before indexing them, and use paths inside the container when adding workspaces.

### Everyday commands

Run these from the repository root:

```sh
# Check service health
docker compose ps

# Follow logs; replace backend with any service name
docker compose logs -f backend

# Rebuild after changing code
docker compose up -d --build

# Stop the stack while keeping database data
docker compose down
```

Adding `-v` to the shutdown command deletes the stack's database volumes. Use that option only when you want to reset development data.

If a port is occupied, stop the other process or change `APP_PORT` for the browser app and `DATABASE_PORT` for PostgreSQL. Their defaults are 5174 and 5433.

## Optional configuration

For a fresh checkout, copy `.env.example` to `.env` in the repository root only if you need custom settings. Keep an existing `.env` rather than overwriting it. The file is ignored by Git.

| Setting | Purpose |
| --- | --- |
| `BACKEND_DATABASE_URL` | Override the Docker backend's database connection |
| `BACKEND_JWT_SECRET` | Override its development token-signing secret |
| `BACKEND_CORS_ORIGINS` | Allow custom browser origins on the Docker backend |
| `DATABASE_URL` | Database connection for a backend started directly with Python |
| `GOOGLE_CLIENT_ID` | Enable optional backend Google sign-in |
| `APP_PORT` / `DATABASE_PORT` | Change the Docker app / PostgreSQL port |

Docker uses its included PostgreSQL database even if `.env` contains a different `DATABASE_URL`. Set `BACKEND_DATABASE_URL` to explicitly override Docker. The included credentials and signing secret are development defaults; use production credentials when hosting the backend.

From your computer, the default developer database URL is:

```text
postgresql+psycopg2://groundwork:groundwork_dev@localhost:5433/groundwork
```

Configure AI providers and your keys in the app's settings. The `local` provider displays retrieved excerpts; it does not generate language-model responses. OpenAI and Gemini receive your question, selected excerpts, and cited paths when used. Local indexing does not call those providers.

## Optional Google sign-in

In the installed desktop app, open Settings and select **Sign in with Google**. Complete sign-in in your normal browser, then return to Groundwork. To connect Google to an existing password account, sign in with your password first and select **Link Google account**.

For a self-hosted backend, set `GOOGLE_CLIENT_ID` and add that backend's origin to the client's authorized JavaScript origins in Google Console. The desktop handoff expires after five minutes. It uses only basic Google identity information; no Google client secret is stored in the app. Google sign-in is optional and does not affect offline features.

## Develop without Docker

Install Python 3.12, Node.js 22 or newer, and Git. Local app development uses SQLite and does not need PostgreSQL.

These commands use Windows PowerShell. Start each terminal in the repository root. Stop Docker services using the same ports first.

**Terminal 1: local engine**

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.local_main:app --host 127.0.0.1 --port 8000
```

**Terminal 2: app interface**

```powershell
cd desktop
npm ci
npm run dev
```

Open [http://localhost:1420](http://localhost:1420). This starts the browser app and local engine, not the hosted backend or website.

To develop the website separately, run `npm ci` and `npm run dev` from `client/`, then open the URL printed by Vite.

### Native desktop development

Install Rust and the Windows Tauri prerequisites: Microsoft C++ Build Tools and WebView2. Create the Python environment above, then run from the repository root:

```powershell
.\server\.venv\Scripts\Activate.ps1
cd desktop
npm ci
npm run tauri -- dev
```

Tauri starts the local engine for you. Stop any separately running local engine first.

## Build a Windows installer

With the native development prerequisites installed, run from the repository root:

```powershell
cd desktop
npm ci
npm run tauri -- build --bundles nsis
python scripts/smoke-core.py
```

The installer is written to `desktop/src-tauri/target/release/bundle/nsis/`. It bundles the local engine, Python, Git, and search model. Installed builds ignore development `.env` files. Startup diagnostics are written to `local-core.log` in the app's data directory.

## Publish a desktop release

1. Commit and push your changes.
2. Create and push a new stable version tag.
3. Check **Publish Windows desktop release** in GitHub Actions.

For example, using a version number that has not been published:

```sh
git tag v1.0.5
git push origin v1.0.5
```

A normal branch push runs CI. A version tag triggers the installer build, tests, and GitHub release publication. Failed checks prevent publication.

The website automatically reads the latest published stable release. No manual installer upload or download-link edit is needed. Installed users must download the newer installer; there is no in-app automatic updater yet. Backend deployment is a separate workflow.

See [release automation](docs/RELEASE_AUTOMATION.md) for details.

## Checks and project layout

After installing Python and npm dependencies, run from the repository root:

```powershell
.\server\.venv\Scripts\python.exe -m pytest server/tests
npm --prefix desktop run build
npm --prefix client run build
```

After building the installer, run packaged integration checks:

```powershell
python desktop/scripts/smoke-core.py
python desktop/scripts/smoke-scale.py
python desktop/scripts/smoke-sync.py
```

The sync check uses hosted API dependencies in `server/.venv`, or the Python selected through `GROUNDWORK_CLOUD_PYTHON`. See [repair verification](docs/REPAIR_VERIFICATION.md) for installed-app checks and measured limits.

| Directory | Contents |
| --- | --- |
| `desktop/` | React interface and Tauri native shell |
| `server/` | Local engine and hosted account/sync backend |
| `client/` | Landing page and download website |
| `docs/` | Architecture, privacy, search, AI, and releases |

Read more about [architecture](docs/ARCHITECTURE.md), [privacy](docs/PRIVACY_MODEL.md), [search behavior](docs/SEARCH_AND_RANKING.md), and [AI boundaries](docs/AI_CONTEXT_ENGINE.md).
