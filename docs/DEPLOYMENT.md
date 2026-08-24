# Production Deployment Guide

This guide covers deploying Groundwork to **Google Cloud Run** with managed PostgreSQL (Supabase), Redis, and MinIO/S3 object storage.

---

## Architecture Overview

```
GitHub
   │
   ▼
GitHub Actions (CI/CD)
   │
   ├── backend tests (pytest)          ─┐
   ├── frontend tests (vitest)          ├── ci.yml (all branches)
   ├── docker build smoke-test         ─┘
   │
   └── deploy (main branch only)       ── deploy.yml
          │
          ├── Build & push images → Artifact Registry
          │
          ├── Deploy API → Cloud Run (groundwork-api)
          │         │
          │         └── Health check: GET /health
          │
          └── Deploy Worker → Cloud Run Jobs (groundwork-worker)
                    │
                    └── Celery worker processing async tasks


Cloud Run (API)          Cloud Run Jobs (Worker)
      │                          │
      └──────────┬───────────────┘
                 │
      ┌──────────▼──────────┐
      │   Cloud Memorystore  │   (Redis — Celery broker + rate-limit cache)
      └─────────────────────┘
      ┌──────────▼──────────┐
      │  Supabase PostgreSQL │   (pgvector — relational data + embeddings)
      └─────────────────────┘
      ┌──────────▼──────────┐
      │  MinIO / Supabase S3 │   (object storage — uploaded PDFs)
      └─────────────────────┘
```

---

## Prerequisites

| Service | Purpose | Notes |
|---|---|---|
| Google Cloud project | Hosts Cloud Run, Artifact Registry | Billing must be enabled |
| Supabase project | PostgreSQL 15 + pgvector + S3-compatible storage | Free tier sufficient for staging |
| Cloud Memorystore (Redis) | Celery broker + API rate-limiting | Or use Upstash Redis (serverless) |
| Google Artifact Registry | Container image storage | One-time setup |
| GitHub Secrets | CD credentials | Listed below |

---

## 1. One-Time Infrastructure Setup

### 1.1 Create Artifact Registry

```bash
gcloud artifacts repositories create groundwork \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="Groundwork container images"
```

### 1.2 Create Service Account & Workload Identity Federation

> **Why WIF?** Workload Identity Federation lets GitHub Actions authenticate to GCP without storing long-lived JSON key files as secrets. The OIDC token from GitHub is exchanged for a short-lived GCP access token at runtime.

```bash
# Create service account for CI/CD
gcloud iam service-accounts create groundwork-ci \
  --display-name="Groundwork CI/CD"

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:groundwork-ci@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:groundwork-ci@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:groundwork-ci@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Create WIF pool and provider
gcloud iam workload-identity-pools create github-actions \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github-actions \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Bind the WIF provider to the service account
WIF_POOL_ID=$(gcloud iam workload-identity-pools describe github-actions \
  --location=global --format="value(name)")

gcloud iam service-accounts add-iam-policy-binding \
  groundwork-ci@$PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/$WIF_POOL_ID/attribute.repository/ttnhan227/Groundwork"
```

### 1.3 Store Secrets in Secret Manager

```bash
# JWT signing key (generate with: openssl rand -base64 32)
echo -n "your-jwt-secret" | gcloud secrets create groundwork-jwt-secret --data-file=-

# LLM API key
echo -n "your-gemini-api-key" | gcloud secrets create groundwork-llm-api-key --data-file=-

# Database URL (from Supabase → Settings → Database)
echo -n "postgresql+asyncpg://..." | gcloud secrets create groundwork-db-url --data-file=-

# Redis URL
echo -n "redis://..." | gcloud secrets create groundwork-redis-url --data-file=-

# MinIO / Supabase S3 credentials
echo -n "your-access-key" | gcloud secrets create groundwork-minio-access-key --data-file=-
echo -n "your-secret-key" | gcloud secrets create groundwork-minio-secret-key --data-file=-
```

### 1.4 Set GitHub Actions Variables and Secrets

In **GitHub → Settings → Secrets and Variables → Actions**, add:

**Repository Variables** (not sensitive — visible in logs):

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | Your GCP project ID |

**Repository Secrets** (sensitive — redacted from logs):

| Secret | Value |
|---|---|
| `WIF_PROVIDER` | Output of: `gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github-actions --format="value(name)"` |
| `WIF_SERVICE_ACCOUNT` | `groundwork-ci@YOUR_PROJECT.iam.gserviceaccount.com` |
| `DATABASE_URL` | Supabase PostgreSQL URL (`postgresql+asyncpg://...`) |
| `REDIS_URL` | Redis connection URL |
| `MINIO_ENDPOINT` | Supabase S3 endpoint or MinIO host |
| `CORS_ORIGINS` | Your production frontend URL |

---

## 2. Deploying

### Automatic (recommended)

Push to `main`. The `deploy.yml` workflow will:

1. Build and push Docker images with layer caching via Artifact Registry
2. Deploy `groundwork-api` to Cloud Run
3. Run a `/health` check against the live service URL
4. Deploy `groundwork-worker` to Cloud Run Jobs

### Manual

```bash
# Build and push
docker build -t asia-southeast1-docker.pkg.dev/$PROJECT_ID/groundwork/api:manual ./server
docker push asia-southeast1-docker.pkg.dev/$PROJECT_ID/groundwork/api:manual

# Deploy
gcloud run deploy groundwork-api \
  --image=asia-southeast1-docker.pkg.dev/$PROJECT_ID/groundwork/api:manual \
  --region=asia-southeast1 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --port=8000
```

---

## 3. Run Database Migrations

Migrations must be run separately before the first deploy (Cloud Run has no persistent init containers):

```bash
# Option A: Run from local machine against production DB
cd server
DATABASE_URL="postgresql+asyncpg://..." alembic upgrade head

# Option B: Execute in a Cloud Run Job (one-off)
gcloud run jobs create groundwork-migrate \
  --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/$PROJECT_ID/groundwork/api:latest \
  --command=alembic \
  --args="upgrade,head" \
  --set-secrets="DATABASE_URL=groundwork-db-url:latest" \
  --max-retries=0 \
  --task-timeout=120

gcloud run jobs execute groundwork-migrate --region=asia-southeast1 --wait
```

---

## 4. Scaling & Cost Considerations

| Setting | Value | Rationale |
|---|---|---|
| `--min-instances=0` | Cold-start on first request | Zero cost when idle |
| `--max-instances=5` | Hard cap on concurrency | Protects DB connection limits |
| `--memory=1Gi` | API needs headroom for async I/O | Celery worker uses 2Gi for OCR |
| `--concurrency=80` | FastAPI handles async workloads well | Cloud Run default is 80 |

---

## 5. Post-Deploy Verification

```bash
# Fetch the live service URL
API_URL=$(gcloud run services describe groundwork-api \
  --region=asia-southeast1 --format='value(status.url)')

# Health check
curl -sf "$API_URL/health" | jq .

# Smoke test: unauthenticated endpoints
curl -sf "$API_URL/api/v1/version"
```

Expected response from `/health`:

```json
{ "status": "ok" }
```

---

## 6. Rollback

```bash
# List recent revisions
gcloud run revisions list --service=groundwork-api --region=asia-southeast1

# Roll back to a specific revision
gcloud run services update-traffic groundwork-api \
  --region=asia-southeast1 \
  --to-revisions=groundwork-api-XXXXXXXX=100
```
