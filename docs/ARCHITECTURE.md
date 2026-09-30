# Groundwork Architecture Specification

This document details the architectural foundation of Groundwork, a local-first workspace search, project intelligence, and AI context system for developers.

---

## 1. System Philosophy

Groundwork is built around three inviolable principles:

1. **The user's workspace belongs to the user's machine.** File indexing, AST extraction, embedding generation, vector search, and Git analysis must run locally and operate completely offline.
2. **Deterministic, low-latency search beats generic generation.** When searching for a function, file, or commit, developers require sub-10 millisecond exact and conceptual retrieval with structured line snippets, not hallucinated conversational prose.
3. **Bounded and grounded AI context.** AI assistance must be strictly constrained by real file citations with line ranges and user-authorized execution tokens.

---

## 2. Monorepo Surface Topography

```text
Groundwork Monorepo
│
├── desktop/               # Tauri 2 Desktop Frontend Application
│   ├── src-tauri/         # Rust native layer (window management, shortcuts)
│   └── src/               # React 19 + TypeScript + Vite UI
│
├── server/                # Local FastAPI Core Service (Runs on 127.0.0.1:8000)
│   ├── app/core/          # Security (path traversal prevention, single-use tokens)
│   ├── app/database/      # SQLite in WAL mode with FTS5 virtual tables
│   ├── app/services/      # Parser (AST), Indexer, Watcher, Git, Search, AI
│   └── eval/              # Quantitative search benchmark suite
│
├── cloud/                 # Optional Groundwork Sync Service (Google Cloud Run)
│   ├── app/core/          # PostgreSQL engine, JWT authentication
│   ├── app/routers/       # Devices, Auth, Settings/Notes synchronization
│   └── tests/             # Isolation and synchronization test suite
│
├── client/                # Marketing, Download & Documentation Website
│   └── src/               # Static site: Landing, Download, Docs, Changelog, Privacy
│
└── docs/                  # Architecture & System Design Specifications
```

---

## 3. Local Process & Communication Topology

```text
+-------------------------------------------------------+
|                   Tauri 2 Desktop                     |
|  +-------------------------------------------------+  |
|  |           React 19 / TypeScript UI              |  |
|  |   - Spotlight Search Modal (Ctrl+Space)         |  |
|  |   - Project Explorer & AST Key Files            |  |
|  |   - Activity Timeline ("What was I doing?")     |  |
|  |   - Context Sessions ("Resume work")            |  |
|  |   - Grounded AI Investigation & Citations       |  |
|  |   - Local Notes & Settings                      |  |
|  +------------------------+------------------------+  |
|                           | HTTP / JSON               |
+---------------------------|---------------------------+
                            v
+-------------------------------------------------------+
|             Local FastAPI Service (127.0.0.1)         |
|  +-------------------------------------------------+  |
|  | REST Endpoints (/api/search, /api/activity, etc)|  |
|  +------------------------+------------------------+  |
|                           |                           |
|       +-------------------+-------------------+       |
|       v                                       v       |
|  +-----------------------+       +------------------+ |
|  |    Search Engine      |       | Indexer & Watcher| |
|  |  - FTS5 BM25          |       | - SHA-256 Hashing| |
|  |  - 384-d Cosine Sim   |       | - AST Extraction | |
|  |  - Recency Decay      |       | - watchfiles     | |
|  +-----------+-----------+       +--------+---------+ |
|              |                            |           |
|              +-------------+--------------+           |
|                            v                          |
|  +-------------------------------------------------+  |
|  |          SQLite WAL Database File               |  |
|  |   - workspaces, projects, files, chunks         |  |
|  |   - fts_files, fts_chunks (FTS5)                |  |
|  |   - activities, context_sessions, notes         |  |
|  +-------------------------------------------------+  |
+-------------------------------------------------------+
```

---

## 4. Concurrency and SQLite Database Design

To ensure fast concurrent reads while background indexing is actively writing:
* **WAL Mode (Write-Ahead Logging):** Configured via `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`. Readers never block writers, and writers never block readers.
* **Connection Registry & Thread-Safe RLock:** Connection handles are allocated per-thread with `threading.RLock()` guarding schema migration to avoid SQLite file lock contention on Windows.
* **Cancellation & Graceful Shutdown:** The background `IndexerService` supports cooperative task cancellation and state checkpointing so an interrupted scan resumes without re-parsing unmodified files.
