# AI Context Engine & Investigation Specification

The Groundwork AI Context Engine is an investigative assistant designed specifically for codebases and developer workspaces. It rejects open-ended chat paradigms in favor of bounded context retrieval with verifiable citations.

---

## 1. Context Assembly Pipeline

When a developer submits a question or initiates an investigation:

1. **Query Symbol & Intent Extraction:** The query is analyzed to extract potential file paths, function symbols, error codes, and technical keywords.
2. **Hybrid Candidate Retrieval:** The search engine retrieves top-ranked code chunks using lexical FTS5 and dense vectors.
3. **AST Context Expansion:** When a candidate chunk represents a function or class method, surrounding symbol definitions (parent class, imports, docstring) are retrieved to provide full syntactic context.
4. **Git Correlation:** Recent commits affecting the candidate files within the past 14 days are appended to the context bundle.
5. **Prompt Envelope Bounding:** The prompt enforces strict citation guidelines:
   - "Every statement regarding the implementation MUST cite the exact filename and line range."
   - "Do not hallucinate paths or symbols not present in the provided evidence."

---

## 2. Citations & Grounding Protocol

Responses from `/api/ai/query` and `/api/ai/investigate` return a structured payload:

```json
{
  "answer": "Path traversal defense is enforced in server/app/core/security.py...",
  "citations": [
    {
      "path": "server/app/core/security.py",
      "filename": "security.py",
      "line_start": 24,
      "line_end": 46,
      "snippet": "def sanitize_path(requested_path: str, allowed_roots: list[str]) -> Path:"
    }
  ],
  "evidence_count": 5,
  "provider_used": "local-ollama",
  "suggested_actions": [
    {
      "label": "Open server/app/core/security.py",
      "action": "open_file",
      "path": "server/app/core/security.py"
    }
  ]
}
```

The desktop UI renders these citations as interactive cards allowing one-click file opening or file revealing in the developer's default IDE/explorer.

---

## 3. Pluggable Provider Architecture

Groundwork supports multiple provider backends via a unified adapter interface:

* **Local Mock Provider:** Deterministic, offline synthesis useful for CI/CD and testing.
* **Ollama (Default for Local AI):** Connects to `http://localhost:11434` for local inference with models such as `llama3`, `mistral`, `deepseek-coder`, or `qwen2.5-coder`. Zero outbound internet traffic.
* **Google Gemini API:** Optional cloud provider utilizing `google-genai` SDK for high-speed multimodal understanding.
* **OpenAI API:** Optional cloud provider utilizing standard chat completions.
