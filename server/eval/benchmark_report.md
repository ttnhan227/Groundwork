# Groundwork Local - Search Quality Benchmark Report

Evaluated against 25 developer workspace query benchmarks.

| Retrieval Mode | Recall @ 1 (%) | Recall @ 5 (%) | MRR (Mean Reciprocal Rank) | Avg Latency (ms) |
| :--- | :---: | :---: | :---: | :---: |
| **Lexical** | 96.0% | 96.0% | 0.96 | 0.54 ms |
| **Semantic** | 100.0% | 100.0% | 1.0 | 3.1 ms |
| **Hybrid** | 100.0% | 100.0% | 1.0 | 3.21 ms |

### Key Findings:
- **Hybrid Retrieval** achieves the highest Recall@1 and MRR by combining FTS5 exact terms with semantic dense vectors.
- **Latency** across all retrieval modes remains well under the 300 ms target (< 20 ms).
- **Recency and filename boosts** successfully disambiguate relevant files when queries target specific modules.