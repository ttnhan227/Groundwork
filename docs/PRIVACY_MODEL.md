# Privacy Model & Security Architecture

> **"The user's workspace belongs to the user's machine."**

Groundwork is intentionally engineered to avoid the privacy compromises common in cloud AI developer tools. This document outlines the security controls, filesystem isolation, and data boundaries implemented across Groundwork.

---

## 1. Local vs. Cloud Responsibility Boundary

Groundwork enforces a strict boundary between what stays local and what may optionally synchronize:

| Domain | Local Machine (100% Offline) | Groundwork Sync (Optional Cloud) |
| :--- | :--- | :--- |
| **Filesystem Indexing** | Fully local on disk | ❌ **NEVER uploaded** |
| **Source Repositories & Diffs** | Read only via local Git CLI | ❌ **NEVER uploaded** |
| **Extracted AST Chunks & Text** | SQLite WAL on disk | ❌ **NEVER uploaded** |
| **Vector Embeddings** | Stored in local SQLite | ❌ **NEVER uploaded** |
| **PDFs, Documents & Spreadsheets**| Local memory cache only | ❌ **NEVER uploaded** |
| **Account & Device Pairing** | Optional | ✅ Managed via Cloud Run |
| **Application UI Preferences** | Stored locally | ✅ Synchronized if opt-in |
| **Saved Searches & Queries** | Stored in local DB | ✅ Synchronized if opt-in |
| **Markdown Notes & Tags** | Stored in local DB | ✅ Synchronized if opt-in |

---

## 2. Path Traversal & Filesystem Hardening

Groundwork implements path sanitization in `server/app/core/security.py`:

* **Canonical Path Resolution:** All requested file paths are resolved to their absolute canonical form using `Path.resolve()`.
* **Workspace Boundary Enforcement:** File operations (`/api/system/open-file`, `/api/system/open-folder`, `/api/system/reveal-file`) verify that the target path is strictly contained within an authorized workspace root.
* **Denial of Relative Sequences:** Relative traversal strings (`../`, `..\\`), null bytes, and unauthorized drives are rejected with a 403 `SecurityError`.

---

## 3. Tool Execution Authorization & Single-Use Tokens

Groundwork's AI Context Engine does not have arbitrary code execution privileges:

* **Strict Command Allowlist:** Only benign developer inspection commands are permitted:
  * `git status`, `git log`, `git diff`, `git branch`
  * `pytest`, `cargo test`, `npm test`
* **Single-Use Confirmation Tokens:** Any mutating tool execution requires the desktop UI to request authorization. The user is prompted with an explicit confirmation dialog. The generated token is valid for one execution only and expires after 60 seconds.
* **No Outbound Network Sockets in Tools:** Tools cannot spawn arbitrary network requests or open listening ports.
