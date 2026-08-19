# Groundwork

> **Verification-Gated Document Studio for High-Stakes Deliverables.**  
> Create proposals, specifications, and client reports with AI — deterministically audited and grounded against source evidence before export.

---

```
Sources (PDF/Docx) ──► Agentic Drafting ──► Requirements Matrix ──► Verification Engine ──► Export Gate
 (Indexed in pgvector)  (Section Structure)   (Traceability)        (Claim Auditing)      (Blocked / Ready)
```

---

## ⚡ Quick Start (3 Steps)

### 1. Clone & Set Environment
```bash
git clone https://github.com/ttnhan227/Groundwork.git
cd Groundwork
cp .env.example .env
```

### 2. Add Your AI API Key in `.env`
```dotenv
LLM_API_KEY=your-gemini-or-openai-api-key
LLM_MODEL=gemini-flash-latest
```

### 3. Launch Services
```bash
docker compose up -d --build
```

Access the app at **http://localhost:8080** (API docs at **http://localhost:8000/docs**).

---

## 🎯 Core Capabilities

* **📑 Source-Grounded Drafting**: Upload RFP briefs, technical specs, and whitepapers. Groundwork extracts acceptance requirements and drafts structured sections with exact page citations.
* **🛡️ Whole-Document Claim Auditing**: The verification engine scans every numeric metric, SLA claim, and statement against physical source pages.
* **🚫 Policy-Enforced Export Gate**: Deliverable exports (PDF, DOCX, Markdown) remain strictly blocked until all unverified claims are resolved.
* **⚡ 1-Click Evidence Alignment**: Resolve audit findings in one click to bring the readiness meter to 100% and unlock exports with an attached provenance ledger.
* **🌐 9-Language Localization**: Full native interface and generation support for English, Vietnamese, Spanish, Japanese, German, French, Chinese, Korean, and Portuguese.

---

## 📚 Detailed Documentation

For comprehensive guides and technical specifications, see the [`docs/`](docs/) directory:

* 🏛️ **[System Architecture & Constraints](docs/ARCHITECTURE.md)**: Component topology, multi-tenant data access guards, and code-level citation contracts.
* 🚀 **[Deployment Guide](docs/DEPLOYMENT.md)**: Production deployment, Docker orchestration, and security operational guidance.
* 🔍 **[Verification Workflow](docs/VERIFICATION_WORKFLOW.md)**: In-depth guide on evidence grounding, claim auditing, and the export gate lifecycle.

---

## 🧪 Testing

Run backend tests:
```bash
cd server
python -m pytest
```

Run frontend build:
```bash
cd client
npm run build
```

---

## 📄 License
MIT License.
