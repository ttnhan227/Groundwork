# Groundwork Local - Search Quality Benchmark Report

Evaluated against 15 curated developer queries on current Groundwork core source files. This small, repository-specific set is not representative of arbitrary workspaces.

| Retrieval Mode | Recall @ 1 (%) | Recall @ 5 (%) | MRR (Mean Reciprocal Rank) | Avg Latency (ms) |
| :--- | :---: | :---: | :---: | :---: |
| **Lexical** | 100.0% | 100.0% | 1.0 | 3.81 ms |
| **Semantic** | 86.7% | 100.0% | 0.913 | 79.77 ms |
| **Hybrid** | 100.0% | 100.0% | 1.0 | 78.48 ms |

### Key Findings:
- **Hybrid Retrieval** achieves balanced retrieval by combining FTS5 lexical matching with vector and recency signals.
- Latencies are measurements from this run, not guarantees. Exact vector scans scale with indexed chunks; no universal latency or recall target is claimed.
- **Real-world Grounding**: Evaluated against live codebase files rather than synthetic text mocks.