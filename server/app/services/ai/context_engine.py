"""AI Context Engine.

Implements the bounded context architecture:
1. Groundwork determines relevant local evidence via hybrid search.
2. Only bounded, relevant snippets are presented to the LLM.
3. Responses include clickable citations to exact files and lines.
4. The user's entire filesystem is never exposed.
"""

from __future__ import annotations

import logging

from app.models.types import AIQueryRequest, AIQueryResponse, CitationItem
from app.services.ai.providers import get_llm_provider
from app.services.git_service import GitService
from app.services.project_service import ProjectService
from app.services.search_engine import SearchEngine

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
        self.search_engine = SearchEngine()
        self.project_service = ProjectService()
        self.git_service = GitService()

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
        search_res = self.search_engine.search(
            query=req.question,
            project_id=req.project_id,
            workspace_id=req.workspace_id,
            search_mode="hybrid",
            limit=6,
        )

        citations: list[CitationItem] = []
        evidence_blocks = []

        for item in search_res.results:
            citations.append(CitationItem(
                path=item.path,
                filename=item.filename,
                line_start=item.line_number,
                line_end=(item.line_number or 1) + 20,
                snippet=item.snippet,
            ))
            evidence_blocks.append(
                f"File [{item.filename}:{item.line_number or 1}] (Project: {item.project_name or 'Root'}):\n"
                f"Path: {item.path}\n"
                f"```\n{item.snippet}\n```"
            )

        # 2. Add recent Git commits if requested
        git_context = ""
        if req.include_git and req.project_id:
            commits = self.git_service.search_commits(req.question, project_id=req.project_id, limit=3)
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
            })

        return AIQueryResponse(
            answer=answer,
            citations=citations,
            evidence_count=len(citations),
            provider_used=provider_name,
            suggested_actions=suggested_actions,
            session_id=None,
        )
