# Groundwork

> **Groundwork is a local-first workspace search and AI context tool that helps developers find, understand, investigate, and resume work scattered across their computer.**

Groundwork feels like:
* **Spotlight / Search Everything** across your code, notes, commits, and documents.
* A **lightweight IDE / project explorer** detecting languages, dependencies, and READMEs.
* A **personal work-memory system** ("What was I doing?" and "Resume where I left off").
* An **AI investigation assistant** bounded strictly by real local citations and AST symbols.

```text
Your files. Your projects. Your Git history. Your notes. Your context.
One place to find them.
```

---

## Architecture Overview

Groundwork operates as a **hybrid local-first desktop application**. The user's workspace belongs entirely to the user's machine—zero files or source code are ever uploaded to the cloud.

```text
Groundwork Monorepo
│
├── desktop/               # Tauri 2 Desktop Application
│   ├── Tauri 2 (Rust)     # Native system window & global shortcuts (Ctrl+Space)
│   ├── React + TypeScript # Fast, responsive dark UI
│   └── Vite + Tailwind    # Modern desktop interface
│
├── server/                # Local FastAPI Core (100% Offline)
│   ├── SQLite (WAL mode)  # FTS5 virtual tables + BM25 full-text indexing
│   ├── Dense Vectors      # 384-dimensional local embeddings
│   ├── File Parser & AST  # Python AST + TS/JS/Rust/Go symbol extractors
│   ├── Indexer & Watcher  # Incremental SHA-256 scanner + watchfiles daemon
│   ├── Git Integration    # Local repository commit inspector & history
│   ├── Activity Timeline  # "What was I doing?" workspace synthesizer
│   ├── Context Sessions   # "Resume work" memory, checklists & inspected files
│   └── AI Context Engine  # Bounded investigation with grounded citations
│
├── cloud/                 # Optional Groundwork Sync (GCP Cloud Run)
│   ├── FastAPI + Pydantic # Lightweight synchronization endpoints
│   ├── PostgreSQL         # Managed multi-tenant storage
│   └── Strict Scope       # Syncs ONLY preferences, saved searches & notes
│
└── client/                # Marketing, Download & Documentation Website
    ├── React + Vite       # Lightweight static web portal
    └── Tailwind CSS       # Landing page, docs, changelog & privacy manifesto
```

---

## Core Capabilities

### 1. Universal Spotlight Search (`Ctrl+Space`)
Sub-10ms hybrid search combining five retrieval signals:
$$\text{Score} = 0.40 \cdot S_{\text{lexical}} + 0.35 \cdot S_{\text{semantic}} + 0.15 \cdot S_{\text{filename}} + 0.05 \cdot S_{\text{recency}} + 0.05 \cdot S_{\text{project}}$$

* **Lexical:** SQLite FTS5 BM25 matching variable names, functions, and keywords.
* **Semantic:** 384-d dense vectors matching conceptual developer intent.
* **Symbol Extraction:** Parses AST nodes for functions, classes, and types across Python, TypeScript, JavaScript, Rust, and Go.
* **Evaluation Benchmark:** Verified **100% Recall@1**, **100% Recall@5**, and **9.4ms average latency** across curated test queries.

### 2. Project Explorer & Intelligence
Automatically recognizes project boundaries by scanning for:
* `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, `go.mod`, `docker-compose.yml`, and `README.md`.
* Extracts project languages, frameworks, entry points, key files, and recent Git commits.

### 3. Activity Timeline ("What was I doing?")
Synthesizes workspace activity across the last 1–30 days:
* Chronological event feed (file edits, creations, Git commits, investigations, notes).
* AI synthesized executive brief summarizing your active focus and recent progress.
* Direct action buttons to open or reveal files in your system file explorer.

### 4. Context Sessions ("Resume where I left off")
A persistent representation of a piece of work:
* Saves investigated file paths, Git commits, active notes, and task checklists.
* Allows one-click pause and resumption of deep engineering tasks.

### 5. Grounded AI Context Engine
* **No Unbounded Chatbots:** Every answer is backed by real file citations with line numbers.
* **Offline Local LLMs:** Native support for local Ollama instances (`llama3`, `mistral`, `qwen`).
* **Safe Tool Execution:** Any mutating tool execution (e.g. running shell commands) requires an explicit, single-use confirmation token from the user.

---

## Local vs. Cloud Responsibility Boundary

| Domain | Local Machine (100% Offline) | Groundwork Sync (Optional Cloud) |
| :--- | :--- | :--- |
| **Source Repositories** | Scanned, parsed, and tokenized locally | ❌ **NEVER uploaded** |
| **Search Index & Embeddings** | SQLite WAL mode + FTS5 BM25 on disk | ❌ **NEVER uploaded** |
| **Git Commits & Diffs** | Read via local Git CLI | ❌ **NEVER uploaded** |
| **File Contents & PDFs** | Extracted and cached in local memory | ❌ **NEVER uploaded** |
| **User Preferences & Settings** | Stored locally | ✅ Synchronized if opted-in |
| **Saved Searches & Filters** | Stored locally | ✅ Synchronized if opted-in |
| **Notes & Tags Metadata** | Stored locally | ✅ Synchronized if opted-in |

---

## Quickstart & Local Development

### Prerequisites
* **Python 3.11+**
* **Node.js 20+** and **npm**
* **Rust & Cargo** (for building Tauri desktop client)

### 1. Run the Local FastAPI Core (`server/`)
```bash
cd server
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
API docs available at: `http://127.0.0.1:8000/docs`

### 2. Run the Desktop Application (`desktop/`)
```bash
cd desktop
npm install

# Run frontend in browser for rapid UI development:
npm run dev

# Or launch as native Tauri desktop app:
npm run tauri dev
```

### 3. Run Optional Cloud Sync Backend (`cloud/`)
```bash
cd cloud
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### 4. Run the Marketing & Documentation Website (`client/`)
```bash
cd client
npm install
npm run dev
```

---

## Running Verification & Tests

### Local Server Tests & Search Benchmark
```bash
cd server
pytest tests/ -v
python eval/search_eval.py
```

### Cloud Sync Service Tests
```bash
cd cloud
pytest tests/ -v
```

### Desktop & Web Builds
```bash
cd desktop && npm run build
cd ../client && npm run build
```

---

## License

Groundwork is released under the **Apache 2.0 License**.
