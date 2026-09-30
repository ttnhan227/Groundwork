"""Typed AI tool execution with strict read-only / mutating security boundaries."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any

from app.core.security import (
    consume_confirmation_token,
    generate_confirmation_token,
    is_safe_command,
    validate_workspace_path,
)
from app.database.local_db import get_db
from app.models.types import NoteCreate
from app.services.activity_service import ActivityService
from app.services.git_service import GitService
from app.services.notes_service import NotesService
from app.services.project_service import ProjectService
from app.services.search_engine import SearchEngine
from app.services.system_service import SystemService
from app.services.workspace_service import WorkspaceService

logger = logging.getLogger("groundwork.ai.tools")

MUTATING_TOOLS = {"run_command", "create_note", "open_file"}


class AIToolManager:
    """Manages and executes typed tools on local workspace evidence."""

    def __init__(self) -> None:
        self.search_engine = SearchEngine()
        self.workspace_service = WorkspaceService()
        self.project_service = ProjectService()
        self.git_service = GitService()
        self.activity_service = ActivityService()
        self.notes_service = NotesService()
        self.system_service = SystemService()

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Returns schemas for the exposed tools."""
        return [
            {
                "name": "search_files",
                "description": "Hybrid search across all workspace files, code symbols, and content.",
                "parameters": {"query": "string", "project_id": "string (optional)", "limit": "integer"},
                "is_mutating": False,
            },
            {
                "name": "read_file",
                "description": "Reads lines from a specific workspace file.",
                "parameters": {"path": "string", "start_line": "integer (optional)", "end_line": "integer (optional)"},
                "is_mutating": False,
            },
            {
                "name": "search_git",
                "description": "Searches Git commit messages across workspace repositories.",
                "parameters": {"query": "string", "project_id": "string (optional)"},
                "is_mutating": False,
            },
            {
                "name": "get_recent_commits",
                "description": "Gets recent Git commits for a project.",
                "parameters": {"project_id": "string (optional)", "limit": "integer"},
                "is_mutating": False,
            },
            {
                "name": "get_project_structure",
                "description": "Gets structure, language, frameworks, and key entry points for a project.",
                "parameters": {"project_id": "string"},
                "is_mutating": False,
            },
            {
                "name": "get_activity",
                "description": "Retrieves recent workspace activity feed.",
                "parameters": {"days": "integer"},
                "is_mutating": False,
            },
            {
                "name": "create_note",
                "description": "Creates a new developer note linked to project or file.",
                "parameters": {"title": "string", "content": "string", "project_id": "string (optional)", "file_path": "string (optional)"},
                "is_mutating": True,
            },
            {
                "name": "open_file",
                "description": "Opens a file in the user's default editor.",
                "parameters": {"path": "string"},
                "is_mutating": True,
            },
            {
                "name": "run_command",
                "description": "Executes an allowlisted terminal command (requires user confirmation).",
                "parameters": {"command": "string", "cwd": "string (optional)"},
                "is_mutating": True,
                "requires_confirmation": True,
            },
        ]

    def execute_tool(self, tool_name: str, args: dict[str, Any], confirmation_token: str | None = None) -> dict[str, Any]:
        """Dispatches tool execution with permission checks."""
        # 1. Mutating command execution check
        if tool_name == "run_command":
            command = args.get("command", "")
            is_safe, reason = is_safe_command(command)
            if not is_safe:
                return {"error": f"Command rejected: {reason}", "status": "blocked"}

            # If token is not provided, generate confirmation request
            if not confirmation_token:
                token = generate_confirmation_token("run_command", {"command": command, "cwd": args.get("cwd")})
                return {
                    "requires_confirmation": True,
                    "confirmation_token": token,
                    "action": f"Groundwork wants to run: `{command}`",
                    "details": args,
                }

            # Validate token
            token_data = consume_confirmation_token(confirmation_token)
            if not token_data or token_data.get("action_type") != "run_command":
                return {"error": "Invalid or expired confirmation token.", "status": "denied"}

            return self._run_command(command, args.get("cwd"))

        # 2. Read-only and safe tools
        if tool_name == "search_files":
            res = self.search_engine.search(
                query=args["query"],
                project_id=args.get("project_id"),
                limit=args.get("limit", 10),
            )
            return {"results": [r.model_dump() for r in res.results], "total": res.total_matches}

        elif tool_name == "read_file":
            return self._read_file(args["path"], args.get("start_line"), args.get("end_line"))

        elif tool_name == "search_git":
            return {"commits": self.git_service.search_commits(args["query"], args.get("project_id"))}

        elif tool_name == "get_recent_commits":
            conn = get_db().get_connection()
            rows = conn.execute("SELECT * FROM git_commits ORDER BY date DESC LIMIT ?;", (args.get("limit", 10),)).fetchall()
            return {"commits": [dict(r) for r in rows]}

        elif tool_name == "get_project_structure":
            overview = self.project_service.get_project_overview(args["project_id"])
            return overview.model_dump() if overview else {"error": "Project not found"}

        elif tool_name == "get_activity":
            activities = self.activity_service.list_activities(days=args.get("days", 2))
            return {"activities": [a.model_dump() for a in activities]}

        elif tool_name == "create_note":
            note = self.notes_service.create_note(NoteCreate(
                title=args["title"],
                content=args["content"],
                project_id=args.get("project_id"),
                file_path=args.get("file_path"),
            ))
            return {"note": note.model_dump(), "status": "created"}

        elif tool_name == "open_file":
            ok = self.system_service.open_file(args["path"])
            return {"success": ok}

        return {"error": f"Unknown tool: '{tool_name}'"}

    def _read_file(self, path_str: str, start_line: int | None = None, end_line: int | None = None) -> dict[str, Any]:
        allowed_roots = self.workspace_service.get_allowed_roots()
        try:
            valid_path = validate_workspace_path(path_str, allowed_roots)
            if not valid_path.is_file():
                return {"error": f"Not a file: {path_str}"}

            lines = valid_path.read_text(encoding="utf-8", errors="replace").splitlines()
            s = max(1, start_line or 1)
            e = min(len(lines), end_line or len(lines))

            slice_lines = lines[s - 1:e]
            numbered = [f"{i}: {line}" for i, line in enumerate(slice_lines, start=s)]
            return {
                "path": str(valid_path),
                "total_lines": len(lines),
                "start_line": s,
                "end_line": e,
                "content": "\n".join(numbered),
            }
        except Exception as exc:
            return {"error": str(exc)}

    def _run_command(self, command: str, cwd_str: str | None = None) -> dict[str, Any]:
        allowed_roots = self.workspace_service.get_allowed_roots()
        cwd = Path(cwd_str).resolve() if cwd_str else (allowed_roots[0] if allowed_roots else Path.cwd())

        try:
            validate_workspace_path(str(cwd), allowed_roots)
            res = subprocess.run(
                command,
                cwd=str(cwd),
                shell=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                "command": command,
                "returncode": res.returncode,
                "stdout": res.stdout[:5000],
                "stderr": res.stderr[:5000],
            }
        except Exception as exc:
            return {"error": f"Command execution failed: {exc}"}
