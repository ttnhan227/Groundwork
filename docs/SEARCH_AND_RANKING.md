# Search and ranking

Quick Find has file, project, and Git commit tabs. The file tab searches indexed content, filenames, paths, and code symbols, with project, file-category, and recent-modification filters. An empty query shows recently modified indexed files. Notes have a separate searchable view. Recent queries are stored locally.

Lexical retrieval uses SQLite FTS5 and BM25, with lower SQLite ranks treated as better matches. Filename/path matching supplies a separate signal. Python symbols come from AST parsing; other supported languages use limited patterns rather than full parsers.

Packaged builds include the trained all-MiniLM-L6-v2 ONNX model and tokenizer, producing 384-dimensional embeddings entirely offline. Model identity is included in content hashes so switching models rebuilds incompatible vectors. Development checkouts without model files use deterministic token/subword hashing; this fallback is not trained semantic retrieval. The preparation script downloads model files only at build time and records their checksums and license.

Hybrid weights in the implementation are lexical 0.35, vector 0.30, filename 0.20, project 0.10, and recency 0.05. Scores are ranking signals, not confidence percentages. Recency decays with file age.

Vector search streams all eligible chunks, including older files, rather than limiting the scan to the newest 1,000. This exact scan can become slow on large workspaces; no latency guarantee is claimed. Lexical snippets start on a matching line. Citations cover the actual returned excerpt instead of an invented twenty-line range.

Ignore rules apply to scans and incremental watcher updates. Content hashes detect changes even when size and modification time are preserved. Empty, oversized, deleted, and newly excluded files are removed from the index. Credentials and links are excluded. Nested Git ignore rules use Git-style matching with negations and anchors.
