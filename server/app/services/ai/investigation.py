"""Investigation workflow service for deep codebase debugging and problem analysis."""

from __future__ import annotations

import logging
from typing import Any

from app.models.types import AIQueryRequest, ContextSessionCreate, InvestigationRequest
from app.services.ai.context_engine import AIContextEngine
from app.services.context_service import ContextService

logger = logging.getLogger("groundwork.investigation")


class InvestigationService:
    """Orchestrates multi-source investigations and stores context sessions."""

    def __init__(self) -> None:
        self.context_service = ContextService()
        self.context_engine = AIContextEngine()

    def run_investigation(self, req: InvestigationRequest) -> dict[str, Any]:
        """Executes an investigation and creates a persistent Context Session."""
        question = req.problem_statement
        if req.recent_errors:
            question += "\nObserved errors:\n" + "\n".join(req.recent_errors)
        response = self.context_engine.query(AIQueryRequest(
            question=question[:12000], project_id=req.project_id, provider=req.provider,
            file_paths=req.files, focused_line=req.focused_line, session_id=req.session_id,
        ))
        inspected_files = list(dict.fromkeys(source.path for source in response.citations))
        git_commits = []
        commit_hashes = []
        analysis = response.answer

        # 4. Create persistent context session so user can resume anytime!
        title = f"Investigation: {req.problem_statement[:50]}"
        session = self.context_service.create_session(ContextSessionCreate(
            title=title,
            project_id=req.project_id,
            summary=analysis,
            files_inspected=inspected_files,
            git_commits=commit_hashes,
            notes=[],
            todos=[],
        ))

        return {
            "session_id": session.id,
            "title": title,
            "analysis": analysis,
            "provider_used": response.provider_used,
            "citations": [source.model_dump() for source in response.citations],
            "inspected_files": inspected_files,
            "related_commits": git_commits,
            "evidence_count": response.evidence_count,
        }
