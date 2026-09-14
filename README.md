# Groundwork

Groundwork is an AI-powered research and note-taking platform that answers questions, extracts key insights, and creates summaries based only on the specific documents you upload (inspired by Google NotebookLM).

It acts as a personal research assistant by grounding its answers directly in your files. This source-grounded design prevents the AI from making up facts or hallucinating, ensuring every assertion can be verified against the exact source page.

### Key Features
- **Source-Grounded Answers**: The AI limits its responses to your provided files and includes clickable citations pointing back to the original text and page numbers.
- **Multi-Format Document Support**: Upload PDF documents, Word/DOCX files, Markdown, plain text, and images with automatic text extraction, chunking, and semantic indexing.
- **Interactive Studio Chat & Study Guides**: Query your sources to generate comprehensive study guides, FAQs, extract core concepts, find connections across multiple documents, and organize complex topics.
- **3-Column Research Environment**:
  - **Left (Sources)**: Manage reference documents and selectively toggle which files are active in the AI's context window.
  - **Center (Notes & Synthesis Canvas)**: Draft structured notes, technical reports, or proposals with inline citations and version tracking.
  - **Right (Studio & Assistant)**: Real-time streaming assistant with automated verification audits to detect unsupported statements.
- **Interactive PDF Viewer with Auto-Fit**: Click any citation chip to open the integrated PDF viewer, automatically fit the page to your screen, and view highlighted source passages.

### How It Works
1. **Create a Workspace**: Set up a new project notebook for your specific research topic, study material, or report.
2. **Add Sources**: Upload files or notes into the workspace so the AI can index them.
3. **Ask and Explore**: Use the Studio chat panel to ask questions, request summaries, generate study guides, and synthesize notes with page-level citations.

## Data, privacy, and AI behavior

- API queries enforce signed-in user and workspace access. The test suite includes static and runtime checks for tenant scoping.
- Metadata and extracted text are stored in PostgreSQL. Original uploads are stored in the configured S3-compatible object store (MinIO in local Docker). Redis and Celery handle background jobs.
- When a user starts a Groundwork AI action, the selected source context, relevant draft content, requirements, findings, recent conversation messages, and workspace notes may be sent to the configured external AI endpoint.
- AI actions are explicit; navigation and rendering do not automatically generate a new AI response.
- Identical concurrent AI requests are deduplicated per API process for ten minutes. Completed and failed request keys are released. Results are not reused as cross-user page caches.
- If the external AI service is unavailable, Groundwork returns a clear fallback status and does not silently modify records. Manual editing and deterministic workflow controls remain available.
- Applying a suggested revision, waiving a finding, deleting data, and exporting are explicit user actions.

For a production deployment, review the retention settings, object-store policy, external AI provider terms, CORS origins, secrets, and database backups for your environment.

## Run with Docker

Requirements: Docker Desktop or Docker Engine with Compose.

```bash
cp .env.example .env
docker compose up -d --build
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Default local endpoints:

| Service | URL |
|---|---|
| Groundwork | http://localhost:8080 |
| API and OpenAPI docs | http://localhost:8000/docs |
| MinIO console | http://localhost:9001 |

Check the stack:

```bash
docker compose ps
curl http://localhost:8080/health
curl http://localhost:8000/health
```

The development Compose file mounts the backend source and runs Uvicorn with reload. Change development credentials and secrets before exposing the stack beyond a trusted local machine.

## Configuration

Copy `.env.example` and adjust at least the production secrets and any AI settings you plan to use.

| Variable | Purpose |
|---|---|
| `ENVIRONMENT` | `development` or `production` runtime validation |
| `JWT_SECRET` | Signing secret; production requires a non-default value |
| `DATABASE_URL` | PostgreSQL connection |
| `REDIS_URL` | Celery broker and job state |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | S3-compatible original-file storage |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | OpenAI-compatible external AI endpoint |
| `EMBEDDING_MODEL` | Embedding model used for semantic source retrieval |
| `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` | Optional Google sign-in |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Optional local admin seed account |
| `CORS_ORIGINS` | Allowed browser origins |

AI credentials are optional for manual workspace and editing features, but AI drafting, semantic retrieval, and AI-assisted review require a working compatible endpoint.

## Local development without Docker

Backend (Python 3.12):

```bash
cd server
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Run the worker in another shell:

```bash
cd server
celery -A app.tasks.celery_app:celery_app worker --loglevel=INFO --pool=solo --concurrency=1
```

Frontend (Node 22):

```bash
cd client
npm ci
npm run dev
```

## Tests and verification

Backend:

```bash
cd server
ruff check app tests
python -m pytest -q
```

Frontend:

```bash
cd client
npm run lint
npm test
npm run test:e2e
```

Full-stack verification:

```bash
docker compose up -d --build
docker compose ps
```

Playwright uses the running Docker app at `http://127.0.0.1:8080` by default. The E2E suite covers the public page, authentication, workspace entry, review controls, responsive layouts, and account settings.

## Known limitations

- The browser application currently uses query parameters (`?app=1` and `?ws=<id>`) rather than a multi-page URL router.
- Concurrent Groundwork AI deduplication is process-local. A multi-replica deployment needs a shared lock, for example in Redis.
- The UI language preference changes AI suggestion language and document defaults, but the whole interface is not fully translated.
- OCR and Office conversion depend on Tesseract and LibreOffice in the backend image.
- A clear automated review does not replace subject-matter, legal, financial, security, or compliance review.

## License

MIT
