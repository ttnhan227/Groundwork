# Troubleshooting Guide

Operational runbook for diagnosing and resolving common issues in the Groundwork production environment.

---

## Quick Diagnostics

```bash
# Check service health
curl -sf https://YOUR_CLOUD_RUN_URL/health | jq .

# Tail live logs (API)
gcloud run services logs tail groundwork-api --region=asia-southeast1

# Tail live logs (Worker)
gcloud run jobs executions list --job=groundwork-worker --region=asia-southeast1
gcloud logging read 'resource.type="cloud_run_job"' --limit=50 --format=json | jq '.[].textPayload'

# Check Docker Compose services locally
docker compose ps
docker compose logs api worker --tail=50 --follow
```

---

## 1. Database Issues

### Problem: `asyncpg.exceptions.ConnectionDoesNotExistError` or connection pool exhausted

**Cause**: Cloud Run scales horizontally; each instance opens its own connection pool. With `max-instances=5` and SQLAlchemy `pool_size=5`, worst-case is 25 simultaneous DB connections.

**Fix**:
```bash
# Check current connections (run against Supabase/PostgreSQL)
SELECT count(*), state, wait_event_type
FROM pg_stat_activity
WHERE datname = 'groundwork'
GROUP BY state, wait_event_type;

# Reduce pool size per instance in production
# In server/app/database/session.py, ensure:
# pool_size=2, max_overflow=3 for Cloud Run deployments
```

**Workaround**: Use [PgBouncer](https://www.pgbouncer.org/) in transaction mode as a connection proxy, or enable Supabase's built-in connection pooler (Supavisor) and point `DATABASE_URL` at the pooler port (6543 instead of 5432).

---

### Problem: `alembic.util.exc.CommandError: Can't locate revision`

**Cause**: Migration history is out of sync between local and production.

**Fix**:
```bash
# Check current head on production DB
alembic -c server/alembic.ini current

# Show migration history
alembic -c server/alembic.ini history --verbose

# Force stamp to a specific revision (use with caution)
alembic -c server/alembic.ini stamp <revision_id>
```

---

### Problem: `pgvector` extension not found

**Cause**: PostgreSQL was provisioned without `pgvector`. This happens on plain PostgreSQL instances (not Supabase).

**Fix**:
```sql
-- Run as superuser
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';
```

---

## 2. Redis & Celery Issues

### Problem: Celery worker not picking up tasks

**Symptoms**: Tasks submitted but no processing; task stays in `PENDING` state indefinitely.

**Diagnosis**:
```bash
# Check Celery worker status locally
docker compose exec worker celery -A app.tasks.celery_app:celery_app inspect active

# Check Redis connectivity
docker compose exec worker redis-cli -u $REDIS_URL ping
# Expected: PONG

# Check queue depth
docker compose exec worker redis-cli -u $REDIS_URL llen celery
```

**Fix**:
1. Confirm `REDIS_URL` is set correctly in the worker environment
2. Ensure Redis allows connections from Cloud Run egress IPs (or use Serverless VPC Connector)
3. In Cloud Run Jobs, confirm the worker job is actively running:
   ```bash
   gcloud run jobs executions list --job=groundwork-worker --region=asia-southeast1
   ```

---

### Problem: `redis.exceptions.ConnectionError: Error connecting to Redis`

**Cause**: Network path between Cloud Run and Redis is not open. Cloud Run services are not in a VPC by default.

**Fix (Cloud Memorystore)**:
```bash
# Attach a Serverless VPC Connector to your Cloud Run service
gcloud compute networks vpc-access connectors create groundwork-connector \
  --region=asia-southeast1 \
  --subnet=default \
  --subnet-project=$PROJECT_ID \
  --min-instances=2 \
  --max-instances=3

# Add to your deploy command
gcloud run services update groundwork-api \
  --region=asia-southeast1 \
  --vpc-connector=groundwork-connector \
  --vpc-egress=private-ranges-only
```

**Fix (Upstash Redis)**: No VPC needed; uses TLS over public internet. Set `REDIS_URL=rediss://...` (note: `rediss://` not `redis://`).

---

### Problem: OCR tasks timeout or fail silently

**Cause**: LibreOffice or Tesseract is not installed in the worker image, or the task exceeds Cloud Run Jobs' task timeout.

**Diagnosis**:
```bash
# Test OCR availability in container
docker compose exec worker tesseract --version
docker compose exec worker libreoffice --version

# Check failed task results
docker compose exec worker celery -A app.tasks.celery_app:celery_app inspect reserved
```

**Fix**: The `server/Dockerfile` installs `libreoffice-writer` and `tesseract-ocr`. If the worker image diverges from the API image (different Dockerfile), ensure the same `RUN apt-get install` block is present.

---

## 3. CI/CD Pipeline Issues

### Problem: `ERROR: permission denied` in `deploy.yml` when pushing to Artifact Registry

**Cause**: WIF binding is missing or the service account lacks `roles/artifactregistry.writer`.

**Fix**:
```bash
# Verify IAM binding
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:groundwork-ci" \
  --format="table(bindings.role)"

# Re-add if missing
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:groundwork-ci@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
```

---

### Problem: GitHub Actions fails with `Error: google-github-actions/auth failed`

**Cause**: WIF provider subject attribute mismatch (repository name in binding doesn't match actual repo).

**Fix**: Verify the principalSet binding uses the exact `owner/repo` casing:
```bash
gcloud iam service-accounts get-iam-policy \
  groundwork-ci@$PROJECT_ID.iam.gserviceaccount.com \
  --format=json | jq '.bindings[] | select(.role=="roles/iam.workloadIdentityUser")'
```

Expected output should contain:
```
"principalSet://iam.googleapis.com/.../attribute.repository/ttnhan227/Groundwork"
```

---

### Problem: `deploy.yml` health check fails (`curl --fail` returns non-zero)

**Cause**: The Cloud Run service deployed but `/health` is returning non-200 (e.g., app crash on startup, missing env var, or DB connection refused).

**Diagnosis**:
```bash
# Check revision startup logs
gcloud run revisions logs read groundwork-api-XXXXXXXX --region=asia-southeast1 --limit=100

# Common culprits:
# - DATABASE_URL secret not injected (SecretManager access denied)
# - alembic migration fails (DB not yet provisioned)
# - Missing LLM_API_KEY
```

---

## 4. Application Issues

### Problem: Multi-tenant data leak guard test fails in CI

**File**: `server/tests/test_data_access_guard.py`

This test performs **AST-level static analysis** of all FastAPI route handlers to verify that every database query against workspace-scoped models passes through `workspace_access(workspace_id, user, session)`.

**Fix**:
```bash
# Run the guard test locally
cd server && python -m pytest tests/test_data_access_guard.py -v

# If a new route is flagged, ensure it uses:
workspace = await workspace_access(workspace_id, current_user, session)
# NOT a raw session.get() or session.execute() without tenant scoping
```

---

### Problem: AI responses contain `[CITATION_STRIPPED]` markers

**Cause**: The hallucination guard (`_validate_physical_citations`) detected that the LLM cited a document name or page number that does not exist in the database.

**This is correct behavior** — the system is working as designed. The unverified claim is logged as a `source_conflict` audit finding.

**To investigate**:
```sql
-- Check recent audit findings
SELECT w.name, f.finding_type, f.description, f.created_at
FROM deliverable_review_findings f
JOIN workspaces w ON f.workspace_id = w.id
WHERE f.finding_type IN ('source_conflict', 'unsupported_claim')
ORDER BY f.created_at DESC
LIMIT 20;
```

---

### Problem: File upload fails with `413 Request Entity Too Large`

**Cause**: Nginx `client_max_body_size` limit (set to 50MB in `nginx/nginx.conf`) is exceeded, or Cloud Run's request size limit (32MB) is hit for uploads routed directly to Cloud Run.

**Fix**: Route large file uploads through a signed URL upload directly to MinIO/S3, bypassing the API server entirely. Generate a presigned PUT URL server-side and have the client upload directly to storage.

---

## 5. Local Docker Compose Issues

### Services fail to start / dependency ordering errors

```bash
# Full reset — removes volumes (WARNING: deletes local data)
docker compose down -v
docker compose up --build -d

# Partial reset — restart only the API after a code change
docker compose restart api worker

# Check health status of all services
docker compose ps
```

### Port conflicts

| Port | Service | Fix |
|---|---|---|
| `8080` | Nginx | Change `ports: "8080:80"` in docker-compose.yml |
| `8000` | API | Change `ports: "8000:8000"` |
| `9001` | MinIO Console | Change `ports: "9001:9001"` |
| `5432` | PostgreSQL | Add `ports: "5432:5432"` if not exposed, or kill local postgres |

```bash
# Find what's using a port
netstat -ano | findstr :8080    # Windows
lsof -i :8080                   # macOS/Linux
```
