"""Typed AI tool execution with strict read-only / mutating security boundaries."""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path
from typing import Any

from app.core.security import (
    command_argv,
    consume_confirmation_token,
    generate_confirmation_token,
    git_environment,
    is_safe_command,
    validate_workspace_path,
)
from app.models.types import NoteCreate
from app.services.activity_service import ActivityService
from app.services.context_service import ContextService
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
        definitions = [
            {"name": "get_context_session", "description": "Read a saved local investigation and unfinished work.", "parameters": {"session_id": "string"}, "is_mutating": False},
            {
                "name": "search_files",
                "description": "Hybrid search across all workspace files, code symbols, and content.",
                "parameters": {"query": "string", "project_id": "string (optional)", "workspace_id": "string (optional)", "limit": "integer"},
                "is_mutating": False,
            },
            {
                "name": "read_file",
                "description": "Reads lines from a specific workspace file.",
                "parameters": {"path": "string", "start_line": "integer (optional)", "end_line": "integer (optional)", "query": "string (optional)"},
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
                    "status": "confirmation_required",
            },
        ]

        for tool in definitions:
            properties = {}
            required = []
            for name, description in tool["parameters"].items():
                kind = "integer" if description.startswith("integer") else "string"
                properties[name] = {"type": kind}
                if "optional" not in description and name not in {"limit", "days"}:
                    required.append(name)
            tool["parameters"] = {"type": "object", "properties": properties, "required": required, "additionalProperties": False}
            if tool["name"] in MUTATING_TOOLS:
                tool["requires_confirmation"] = True
        return definitions

    def execute_tool(self, tool_name: str, args: dict[str, Any], confirmation_token: str | None = None) -> dict[str, Any]:
        """Dispatches tool execution with permission checks."""
        definition = next((d for d in self.get_tool_definitions() if d["name"] == tool_name), None)
        if definition is None or not isinstance(args, dict):
            return {"status": "blocked", "error": "Unknown tool or invalid arguments"}
        schema = definition["parameters"]
        if set(args) - set(schema["properties"]) or set(schema["required"]) - set(args):
            return {"status": "blocked", "error": "Unexpected or missing tool arguments"}
        for name, value in args.items():
            expected = schema["properties"][name]["type"]
            if value is None and name not in schema["required"]:
                continue
            if (expected == "integer" and (type(value) is not int or not 1 <= value <= (200 if name in {"limit", "days"} else 10000000))) or (expected == "string" and (not isinstance(value, str) or len(value) > 20000)):
                return {"status": "blocked", "error": f"Invalid argument: {name}"}
        # 1. Mutating command execution check
        if tool_name in MUTATING_TOOLS:
            command = args.get("command", "")
            is_safe, reason = is_safe_command(command) if tool_name == "run_command" else (True, "Allowed")
            if not is_safe:
                return {"error": f"Command rejected: {reason}", "status": "blocked"}

            # If token is not provided, generate confirmation request
            if not confirmation_token:
                token = generate_confirmation_token(tool_name, args)
                return {
                    "requires_confirmation": True,
                    "status": "confirmation_required",
                    "confirmation_token": token,
                    "action": f"Groundwork wants to run: `{command}`",
                    "details": args,
                }

            # Validate token
            token_data = consume_confirmation_token(confirmation_token)
            if not token_data or token_data.get("action_type") != tool_name or token_data.get("details") != args:
                return {"error": "Invalid or expired confirmation token.", "status": "denied"}

            if tool_name == "run_command":
                return self._run_command(command, args.get("cwd"))

        # 2. Read-only and safe tools
        if tool_name == "get_context_session":
            session = ContextService().get_session(args["session_id"])
            return session.model_dump() if session else {"error": "Session not found"}
        if tool_name == "search_files":
            res = self.search_engine.search(
                query=args["query"],
                project_id=args.get("project_id"),
                workspace_id=args.get("workspace_id"),
                limit=args.get("limit", 10),
            )
            return {"results": [r.model_dump() for r in res.results], "total": res.total_matches}

        elif tool_name == "read_file":
            return self._read_file(args["path"], args.get("start_line"), args.get("end_line"), args.get("query"))

        elif tool_name == "search_git":
            return {"commits": self.git_service.search_commits(args["query"], args.get("project_id"))}

        elif tool_name == "get_recent_commits":
            return {"commits": self.git_service.search_commits("", args.get("project_id"), args.get("limit", 10))}

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

    def _read_file(self, path_str: str, start_line: int | None = None, end_line: int | None = None, query: str | None = None) -> dict[str, Any]:
        allowed_roots = self.workspace_service.get_allowed_roots()
        try:
            valid_path = validate_workspace_path(path_str, allowed_roots)
            from app.services.indexer_service import IndexerService
            workspace = next((ws for ws in self.workspace_service.list_workspaces() if ws.is_active and valid_path.is_relative_to(Path(ws.path).resolve())), None)
            if not workspace or IndexerService.get_instance()._is_ignored(valid_path, workspace.ignore_patterns, [], Path(workspace.path).resolve(), passive_preview=True):
                return {"error": "File is excluded by workspace privacy rules"}
            from app.services.file_parser import FileParser, IMAGE_EXTENSIONS
            from app.services.file_evidence import metadata, folder_evidence
            from app.services.collection_service import CollectionService
            kind, coverage = 'text', 'Extracted text'
            if valid_path.is_dir():
                content = folder_evidence(valid_path, CollectionService().allowed)
                kind, coverage = 'folder', 'Folder listing only; file contents not read.'
            elif not valid_path.is_file():
                return {'error': 'This file is missing or unavailable.'}
            elif valid_path.stat().st_size > (32 if valid_path.suffix.lower() in IMAGE_EXTENSIONS | {'.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.epub'} else 5) * 1024 * 1024:
                content = metadata(valid_path, 'File exceeds the content-reading limit (5 MB for plain text; 32 MB for documents and images).')
                kind, coverage = 'metadata', 'Metadata only; file is too large to read.'
            elif not FileParser.is_supported(valid_path) and valid_path.suffix.lower() not in IMAGE_EXTENSIONS:
                content = metadata(valid_path, 'This format has no content reader. Use its associated app to inspect contents.')
                kind, coverage = 'metadata', 'Metadata only; format contents are unsupported.'
            else:
                parsed = FileParser.parse_file(valid_path, max_size_bytes=32 * 1024 * 1024, allow_ocr=True)
                if parsed.is_binary or not parsed.content:
                    content = metadata(valid_path, parsed.coverage if parsed.coverage != 'Extracted text' else 'No readable text could be extracted; the file may be damaged, binary, or unreadable.')
                    kind, coverage = 'metadata', 'Metadata only; contents could not be extracted.'
                else:
                    content, coverage = parsed.content, parsed.coverage
                    kind = 'ocr' if parsed.file_type == 'image' else 'text'
            lines = content.splitlines()
            s = max(1, start_line or 1)
            e = min(len(lines), end_line or s + 199, s + 199)
            if query and len(lines) > 40:
                terms = set(re.findall(r"\w{3,}", query.lower()))
                # Retrieve a bounded contiguous section, preserving real line
                # numbers. Ties keep the earliest section; no semantic claim.
                windows = [(offset, lines[offset:offset + 40]) for offset in range(0, len(lines), 40)]
                offset, _ = max(windows, key=lambda window: sum(
                    len(terms.intersection(re.findall(r"\w{3,}", line.lower()))) for line in window[1]
                ))
                s, e = offset + 1, min(len(lines), offset + 40)

            slice_lines = lines[s - 1:e]
            numbered = [f"{i}: {line}" for i, line in enumerate(slice_lines, start=s)]
            return {
                "path": str(valid_path),
                "total_lines": len(lines),
                "start_line": s,
                "end_line": e,
                "content": "\n".join(numbered),
                "evidence_kind": kind,
                "coverage": coverage,
                "file_details": {"name": valid_path.name, "location": str(valid_path.parent), "extension": valid_path.suffix.lower(), "size_bytes": valid_path.stat().st_size if valid_path.is_file() else None, "modified_timestamp": valid_path.stat().st_mtime},
            }
        except Exception as exc:
            return {"error": str(exc)}

    def _run_command(self, command: str, cwd_str: str | None = None) -> dict[str, Any]:
        allowed_roots = self.workspace_service.get_allowed_roots()
        cwd = Path(cwd_str).resolve() if cwd_str else (allowed_roots[0] if allowed_roots else Path.cwd())

        try:
            validate_workspace_path(str(cwd), allowed_roots)
            res = subprocess.run(
                command_argv(command),
                cwd=str(cwd),
                shell=False,
                env=git_environment(),
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
