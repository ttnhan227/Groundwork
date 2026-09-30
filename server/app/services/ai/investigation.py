"""Investigation workflow service for deep codebase debugging and problem analysis."""

from __future__ import annotations

import logging
from typing import Any

from app.models.types import ContextSessionCreate, InvestigationRequest
from app.services.ai.context_engine import AIContextEngine
from app.services.ai.providers import get_llm_provider
from app.services.context_service import ContextService
from app.services.git_service import GitService
from app.services.search_engine import SearchEngine

logger = logging.getLogger("groundwork.investigation")


class InvestigationService:
    """Orchestrates multi-source investigations and stores context sessions."""

    def __init__(self) -> None:
        self.search_engine = SearchEngine()
        self.git_service = GitService()
        self.context_service = ContextService()
        self.context_engine = AIContextEngine()

    def run_investigation(self, req: InvestigationRequest) -> dict[str, Any]:
        """Executes an investigation and creates a persistent Context Session."""
        # 1. Search relevant code
        code_results = self.search_engine.search(
            query=req.problem_statement,
            project_id=req.project_id,
            limit=8,
        )

        inspected_files = list({r.path for r in code_results.results})

        # 2. Search relevant Git commits
        git_commits = self.git_service.search_commits(
            query=req.problem_statement,
            project_id=req.project_id,
            limit=5,
        )
        commit_hashes = [c["short_hash"] for c in git_commits]

        # 3. Assemble evidence for AI reasoning
        evidence_blocks = []
        for r in code_results.results:
            evidence_blocks.append(f"File: {r.filename}:{r.line_number}\nSnippet:\n{r.snippet}")

        commit_blocks = [f"Commit {c['short_hash']}: {c['message']} ({c['author']})" for c in git_commits]

        prompt = (
            f"Technical Investigation: {req.problem_statement}\n\n"
            f"Observed Errors:\n{chr(10).join(req.recent_errors) if req.recent_errors else 'None specified'}\n\n"
            f"Code Evidence:\n{chr(10).join(evidence_blocks)}\n\n"
            f"Git History:\n{chr(10).join(commit_blocks)}\n\n"
            f"Please provide:\n"
            f"1. Root cause hypothesis\n"
            f"2. Supporting evidence from code/commits\n"
            f"3. Concrete next steps to resolve\n"
        )

        provider = get_llm_provider()
        analysis = provider.generate(
            prompt=prompt,
            system_prompt="You are a senior systems engineer conducting a thorough code investigation. Be precise and ground every point.",
        )

        # 4. Create persistent context session so user can resume anytime!
        title = f"Investigation: {req.problem_statement[:50]}"
        session = self.context_service.create_session(ContextSessionCreate(
            title=title,
            project_id=req.project_id,
            summary=analysis[:500],
            files_inspected=inspected_files,
            git_commits=commit_hashes,
            notes=[f"Initial findings: {analysis[:200]}..."],
            todos=["Verify hypothesis against tests", "Apply code fix"],
        ))

        return {
            "session_id": session.id,
            "title": title,
            "analysis": analysis,
            "inspected_files": inspected_files,
            "related_commits": git_commits,
            "evidence_count": len(code_results.results),
        }
