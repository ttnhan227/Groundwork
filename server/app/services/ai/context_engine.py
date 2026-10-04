"""AI Context Engine.

Implements the bounded context architecture:
1. Groundwork determines relevant local evidence via hybrid search.
2. Only bounded, relevant snippets are presented to the LLM.
3. Responses include clickable citations to exact files and lines.
4. The user's entire filesystem is never exposed.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from app.models.types import AIQueryRequest, AIQueryResponse, CitationItem
from app.services.ai.providers import get_llm_provider
from app.services.ai.tools import AIToolManager

logger = logging.getLogger("groundwork.ai.context")


SYSTEM_PROMPT = """You are Groundwork AI, a local-first workspace context assistant.
Your job is to help the developer understand code, find where work is located, investigate bugs, and resume tasks.

CRITICAL RULES:
1. Rely ONLY on the provided local evidence snippets below.
2. When referencing code or decisions, explicitly cite the source file and line numbers using `[source: filename:line]`.
3. If the provided evidence does not contain sufficient details to answer, clearly state what information is missing.
4. Do not invent files, symbols, or git history that are not in the context.
"""


class AIContextEngine:
    """Retrieves bounded workspace context and coordinates with LLM providers."""

    def __init__(self) -> None:
        self.tools = AIToolManager()

    def answer_with_context(
        self,
        question: str,
        workspace_id: str | None = None,
        project_id: str | None = None,
        include_git: bool = False,
    ) -> AIQueryResponse:
        """Convenience method to query bounded workspace context."""
        return self.query(AIQueryRequest(
            question=question,
            workspace_id=workspace_id,
            project_id=project_id,
            include_git=include_git,
        ))

    def query(self, req: AIQueryRequest) -> AIQueryResponse:
        """Executes a bounded context AI query."""
        # 1. Retrieve top relevant chunks via Hybrid Search
        search_res = self.tools.execute_tool("search_files", {
            "query": req.question, "project_id": req.project_id,
            "workspace_id": req.workspace_id, "limit": 6,
        })

        citations: list[CitationItem] = []
        evidence_blocks = []

        results = search_res.get("results", [])
        selected_paths = list(dict.fromkeys(([req.focused_path] if req.focused_path else []) + req.file_paths))[:6]
        if selected_paths:
            results = [*[{"path": path, "filename": Path(path).name, "line_number": req.focused_line if index == 0 else 1} for index, path in enumerate(selected_paths)], *[item for item in results if item["path"] not in selected_paths]][:6]
        for result in results:
            # Read current contents through the privacy-checked tool. Search
            # results alone may be stale while the watcher catches up.
            source = self.tools.execute_tool("read_file", {
                "path": result["path"], "start_line": result.get("line_number") or 1,
                "end_line": (result.get("line_number") or 1) + 39,
            })
            if "error" in source or source["end_line"] < source["start_line"]:
                continue
            excerpt = source["content"][:8000]
            excerpt_end = min(source["end_line"], source["start_line"] + max(0, len(excerpt.splitlines()) - 1))
            citations.append(CitationItem(
                path=source["path"], filename=result["filename"],
                line_start=source["start_line"], line_end=excerpt_end,
                snippet=excerpt,
            ))
            evidence_blocks.append(
                f"File [{result['filename']}:{source['start_line']}] (Project: {result.get('project_name') or 'Root'}):\n"
                f"Path: {source['path']}\n```\n{excerpt}\n```"
            )

        if req.project_id:
            overview = self.tools.execute_tool("get_project_structure", {"project_id": req.project_id})
            if "error" not in overview:
                facts = {key: overview.get(key) for key in ("name", "path", "detected_type", "language", "frameworks", "entry_points", "dependencies", "working_tree")}
                evidence_blocks.append("Project metadata from local tools:\n```\n" + json.dumps(facts, ensure_ascii=False)[:6000] + "\n```")
        if req.session_id:
            session = self.tools.execute_tool("get_context_session", {"session_id": req.session_id})
            if "error" not in session:
                evidence_blocks.append("Saved investigation context (previous findings may be outdated):\n```\n" + json.dumps(session, ensure_ascii=False)[:12000] + "\n```")

        # 2. Add recent Git commits if requested
        git_context = ""
        if req.include_git and req.project_id:
            commits = self.tools.execute_tool("search_git", {"query": req.question, "project_id": req.project_id}).get("commits", [])[:3]
            if not commits:
                commits = self.tools.execute_tool("get_recent_commits", {"project_id": req.project_id, "limit": 3}).get("commits", [])
            if commits:
                commit_lines = [f"- {c['short_hash']}: {c['message']} (by {c['author']} on {c['date']})" for c in commits]
                git_context = "\nRecent Related Git Commits:\n" + "\n".join(commit_lines)

        # 3. Assemble bounded prompt
        evidence_text = "\n\n".join(evidence_blocks) if evidence_blocks else "No matching files found in current index."
        user_prompt = (
            f"Developer Question: {req.question}\n\n"
            f"--- BOUNDED WORKSPACE EVIDENCE ---\n"
            f"{evidence_text}\n"
            f"{git_context}\n"
            f"----------------------------------\n\n"
            f"Please answer the question accurately based on the evidence above, including source citations."
        )

        # 4. Invoke LLM Provider
        provider = get_llm_provider(req.provider)
        answer = provider.generate(prompt=user_prompt, system_prompt=SYSTEM_PROMPT)

        provider_name = provider.__class__.__name__.replace("Provider", "").lower()

        # 5. Suggest helpful follow-up actions
        suggested_actions = []
        if citations:
            suggested_actions.append({
                "label": f"Open {citations[0].filename}",
                "action": "open_file",
                "path": citations[0].path,
            })
            suggested_actions.append({
                "label": "Save as Note",
                "action": "create_note",
                "title": f"Note: {req.question[:50]}",
                "content": answer,
                "project_id": req.project_id,
            })

        return AIQueryResponse(
            answer=answer,
            citations=citations,
            evidence_count=len(citations),
            provider_used=provider_name,
            suggested_actions=suggested_actions,
            session_id=None,
        )
