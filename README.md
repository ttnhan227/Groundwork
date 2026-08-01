<p align="center">
  <img src="client/public/logo.png" alt="InsightPDF" width="220" />
</p>

# InsightPDF

InsightPDF is an AI workspace for turning briefs and source files into verified, export-ready documents.

It provides:

- PDF, Office document, image, and text ingestion with OCR
- Source-grounded research with page citations
- AI-generated reports, proposals, technical documents, and presentations
- Editable deliverables with requirements, evidence, comments, and version history
- Whole-document verification for missing requirements and unsupported claims
- PDF, Word, Markdown, and PowerPoint exports
- PDF merge, split, rotate, compress, watermark, conversion, and page organization

## Stack

- React and TypeScript
- FastAPI and Python
- PostgreSQL with pgvector
- Redis and Celery
- MinIO object storage
- Nginx

## Run locally

Requirements: Docker Desktop with Docker Compose.

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

Configure at least these values in `.env`:

```dotenv
JWT_SECRET=replace-with-a-strong-secret
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.mistral.ai/v1
LLM_MODEL=mistral-small-latest
```

Open:

- Application: http://localhost:8080
- API documentation: http://localhost:8000/docs
- MinIO console: http://localhost:9001

Database migrations run automatically when the API starts.

## Verify

Backend:

```powershell
docker compose exec -T api python -m pytest -q
```

Frontend:

```powershell
Set-Location client
npm ci
npm test
npm run lint
npm run build
```

Running stack:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8080/health
docker compose ps
```

## Deployment

Production deployments require strong secrets, HTTPS, private backing services, and coordinated PostgreSQL and object-storage backups. See [DEPLOYMENT.md](DEPLOYMENT.md).
