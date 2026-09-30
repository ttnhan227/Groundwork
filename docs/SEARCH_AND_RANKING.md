# Search Engine & Hybrid Ranking Architecture

Groundwork delivers sub-10 millisecond code and workspace retrieval by fusing lexical full-text search, dense semantic embeddings, AST symbol recognition, filename matching, recency decay, and active project prioritization.

---

## 1. Hybrid Scoring Formula

Every candidate file or chunk retrieved from the workspace is evaluated using the following normalized hybrid scoring function:

$$\text{FinalScore} = w_{\text{lex}} \cdot S_{\text{lex}} + w_{\text{sem}} \cdot S_{\text{sem}} + w_{\text{file}} \cdot S_{\text{file}} + w_{\text{rec}} \cdot S_{\text{rec}} + w_{\text{proj}} \cdot S_{\text{proj}}$$

### Default Weight Configuration:
* $w_{\text{lex}} = 0.40$ — Lexical full-text match (SQLite FTS5 BM25)
* $w_{\text{sem}} = 0.35$ — Dense semantic cosine similarity
* $w_{\text{file}} = 0.15$ — Exact or fuzzy filename match
* $w_{\text{rec}} = 0.05$ — Recency decay based on file modification timestamp
* $w_{\text{proj}} = 0.05$ — Boost for files residing in the currently selected project context

---

## 2. Component Retrieval Signals

### A. Lexical Search (SQLite FTS5 BM25)
* SQLite FTS5 virtual tables (`fts_files` and `fts_chunks`) index the file paths, extracted AST symbols, and chunk content.
* Queries are cleaned to handle symbol punctuation (`_`, `.`, `-`), and BM25 scores are normalized using an inverted hyperbolic tangent mapping.

### B. Dense Semantic Search (384-dimensional Embeddings)
* Chunks are transformed into 384-dimensional dense vectors using a fast, deterministic local hashing vectorizer (0.1ms per chunk) with zero external network dependencies.
* Semantic similarity is evaluated via dot-product cosine distance against normalized chunk vectors.
* Pluggable adapters allow upgrading to local Ollama embeddings (`nomic-embed-text`) or remote embedding models when configured.

### C. AST Symbol Extraction
During file parsing:
* **Python:** Uses the native `ast` module to extract exact function definitions, class names, docstrings, and decorator metadata.
* **TypeScript / JavaScript:** Extracts `function`, `class`, `interface`, `type`, and `export` symbols.
* **Rust:** Extracts `fn`, `struct`, `enum`, `trait`, and `impl` blocks.
* **Go:** Extracts `func`, `type`, and `struct` definitions.

### D. Recency Decay
A recency score $S_{\text{rec}} \in [0.1, 1.0]$ is applied based on the file modification timestamp ($t_{\text{mtime}}$):

$$S_{\text{rec}} = \max\left(0.1, \exp\left(-\frac{\Delta t_{\text{days}}}{30}\right)\right)$$

Files edited within the last 24–48 hours receive an intentional ranking boost, reflecting active developer focus.

---

## 3. Empirical Benchmark Results

Groundwork includes an automated, reproducible search evaluation harness in `server/eval/search_eval.py`.

### Benchmark Metrics (Curated Workspace Corpus)
* **Recall@1:** 100.0%
* **Recall@5:** 100.0%
* **Mean Reciprocal Rank (MRR):** 1.000
* **Average Hybrid Query Latency:** **9.4 milliseconds**
* **Average Lexical-Only Latency:** **3.2 milliseconds**

Detailed test case logs and category breakdowns are recorded in `server/eval/benchmark_report.md`.
