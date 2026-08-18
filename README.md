# Groundwork

**Verification-Gated Agentic Document Workspace**

Groundwork is an agentic workspace engineered for creating professional deliverables (RFP proposals, technical specifications, compliance reports) and deterministically auditing them against source evidence before allowing them to be exported.

---

## The Problem: Unchecked AI Drafting in High-Stakes Work

Generic AI chatbots and LLM wrappers can generate persuasive text, but in high-stakes consulting, engineering, and legal workflows:
- **Hallucinated metrics** create contractual liability.
- **Unverified claims** lack audit trails and provenance.
- **Client RFP requirements** are missed or only partially addressed.
- **Generic tools** treat chat as the product instead of the deliverable itself.

Groundwork solves this by placing **Drafting + Verification + Audit Gating** at the core of the document lifecycle.

```
Sources ──► Agentic Drafting ──► Requirements Matrix ──► Verification Engine ──► Export Gate
 (PDF/Docx)   (Structure & Spec)     (Traceability)        (Claim Auditing)      (Blocked / Ready)
```

---

## Core Workflow & System Highlights

1. **Evidence Ingestion & RAG**: Extracts text, page geometry, and structure across PDFs, Word docs, and presentations. Chunk embeddings are indexed in PostgreSQL via `pgvector` for semantic search and exact-page citation grounding.
2. **Agentic Drafting**: The workspace agent extracts acceptance criteria, structures the deliverable into sections, and drafts evidence-backed paragraphs with inline citations `[Source: Spec.pdf, p. 4]`.
3. **Automated Verification Engine**: Scans every claim for empirical support, extracts numeric tokens, detects unsupported statements or contradictions against source documents, and surfaces itemized **Review Findings** (High / Medium / Low severity).
4. **Policy-Enforced Export Gate**: Exporting (PDF, DOCX, Markdown) is strictly **blocked** while unresolved verification findings or unmet mandatory requirements remain.
5. **Human-in-the-Loop Resolution**: One-click evidence alignment replaces unverified claims with supported facts, updates document revision history, recalculates readiness to 100%, and unlocks the export gate with an attached cryptographic audit appendix.

---

## End-to-End Walkthrough Scenario

**Scenario**: Enterprise Cloud Modernization Proposal & RFP Verification

1. **Open Workspace**: Enter the starter workspace `Apex Horizon Cloud Modernization Proposal`.
2. **Inspect Grounded Context**: 
   - 3 Indexed source documents (`Apex Horizon RFP Brief.pdf`, `Cloud Security Spec.pdf`, `Benchmark Report.pdf`).
   - 6 Tracked requirements (`RFP-01` to `RFP-06`) in the Traceability Matrix.
   - Deliverable draft paper sheet with exact inline citations.
3. **Inspect the Blocker**:
   - Section 2 contains an ungrounded claim: *"The platform guarantees 99.999% uptime with 10-second automated failover."*
   - Verification Engine flags a **High-Severity Unsupported Claim** (the spec only establishes 99.99% availability).
   - Readiness meter registers **83%** and the Export Gate is **Blocked**.
4. **Resolve Finding**:
   - Click **"Apply Verified Revision (99.99%)"** on the finding card (or ask the agent).
   - The paragraph updates to 99.99% SLA, citation to `Cloud Security Spec p. 4` is attached, the finding is resolved, and requirement `RFP-02` is marked covered.
5. **Export Deliverable**:
   - Readiness score reaches **100% (Verified)**.
   - Export Gate unlocks to **"Export Verified Deliverable ✓"**.
   - Download the executive deliverable (PDF / DOCX / Markdown) with the attached cryptographic evidence provenance ledger.

---

## System Architecture

```
Groundwork/
├── client/                     # React 19 + TypeScript + Vite SPA
│   └── src/
│       ├── api/                # SSE agent streaming, auth, REST client
│       ├── components/         # BrandMark, modals, common controls
│       ├── features/           # Feature modules:
│       │   ├── workspace/      # 3-column workspace, Draft Canvas, Audit Suite, Agent Dock
│       │   ├── landing/        # Interactive verification gate demo simulator
│       │   └── account/        # Usage metrics, notifications, preferences
│       └── types/              # Domain models (Deliverable, Requirement, ReviewFinding, Readiness)
├── server/                     # FastAPI backend (Python 3.11+)
│   └── app/
│       ├── controllers/        # REST route handlers (Deliverables, Documents, Auth, Workspaces)
│       ├── database/           # SQLAlchemy 2.0 async sessions & Alembic migrations
│       ├── dtos/               # Pydantic v2 validation schemas
│       ├── models/             # ORM models (NativeDocument, DeliverableRequirement, ReviewFinding)
│       ├── services/           # Deliverable review engine, RAG pipeline, LLM orchestration
│       └── tasks/              # Celery background workers (OCR, vector embedding generation)
└── docker-compose.yml          # Container orchestration (API, Celery, Postgres/pgvector, Redis, MinIO, Nginx)
```

---

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Vanilla CSS Design System (High-trust editorial audit theme).
- **Backend**: FastAPI, Python 3.11, SQLAlchemy 2.0 Async, Pydantic v2.
- **Database & Search**: PostgreSQL 16 with `pgvector` for cosine similarity embeddings.
- **Asynchronous Pipeline**: Celery, Redis.
- **Storage & Ingestion**: MinIO (S3-compatible object storage), PyMuPDF text extraction.
- **Reverse Proxy**: Nginx.

---

## Getting Started

### Prerequisites

- Docker Desktop with Docker Compose

### 1. Environment Setup

```powershell
Copy-Item .env.example .env
```

Configure your LLM credentials in `.env`:
```dotenv
JWT_SECRET=your-secure-jwt-secret
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.mistral.ai/v1
LLM_MODEL=mistral-small-latest
```

### 2. Run with Docker Compose

```powershell
docker compose up -d --build
docker compose ps
```

Access services:
- **Application**: http://localhost:8080
- **API Documentation**: http://localhost:8000/docs
- **MinIO Storage Console**: http://localhost:9001

### 3. Verification & Tests

Run client build and tests:
```powershell
cd client
npm ci
npm test
npm run build
```

Run backend unit tests:
```powershell
docker compose exec -T api python -m pytest -q
```

---

## Portfolio & Engineering Signal

Groundwork demonstrates:
- **Verification Engine Design**: Deterministic claim parsing, numeric token validation, and rule-based evidence checking against semantic retrieval.
- **Policy Enforcement**: Guardrails that block downstream actions (export) until audit criteria are met.
- **Full-Stack Orchestration**: Asynchronous Celery workers, SSE streaming agent execution, and reactive React state synchronization.
- **Evidence Provenance**: Complete traceability connecting reader-facing text to exact source document pages.
