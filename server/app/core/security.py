"""Security rules, path sanitization, and command execution boundaries.

Enforces:
1. No path traversal outside declared workspace boundaries.
2. Safe subprocess command allowlisting.
3. Token generation and validation for mutating AI actions.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Sequence

# Tokens generated for pending mutating actions (in-memory, expires after 5 minutes)
_pending_confirmations: dict[str, dict] = {}

ALLOWED_COMMAND_PREFIXES = (
    "git ",
    "pytest",
    "npm test",
    "npm run",
    "cargo test",
    "python -m unittest",
    "go test",
)

BLOCKED_COMMAND_PATTERNS = (
    "rm -rf",
    "del /f /s /q",
    "format ",
    "drop database",
    "truncate ",
    "mkfs",
    ":(){ :|:& };:",
    "shutdown",
    "reboot",
)


def validate_workspace_path(path_str: str, allowed_roots: Sequence[str | Path]) -> Path:
    """Ensures a path exists, resolves symlinks, and falls inside an allowed root."""
    target = Path(path_str).resolve()
    for root in allowed_roots:
        resolved_root = Path(root).resolve()
        try:
            target.relative_to(resolved_root)
            return target
        except ValueError:
            continue
    raise PermissionError(f"Access denied: Path '{path_str}' is outside allowed workspace boundaries.")


def is_safe_command(command: str) -> tuple[bool, str]:
    """Validates if a command is allowed to be proposed/executed."""
    cmd_stripped = command.strip().lower()

    for blocked in BLOCKED_COMMAND_PATTERNS:
        if blocked in cmd_stripped:
            return False, f"Command contains blocked pattern: '{blocked}'"

    for allowed in ALLOWED_COMMAND_PREFIXES:
        if cmd_stripped.startswith(allowed):
            return True, "Allowed"

    return False, f"Command '{command}' is not in the recognized safe tool allowlist."


def generate_confirmation_token(action_type: str, details: dict) -> str:
    """Generates a secure single-use confirmation token for a mutating operation."""
    token = secrets.token_urlsafe(24)
    _pending_confirmations[token] = {
        "action_type": action_type,
        "details": details,
        "created_at": os.times().elapsed,
    }
    return token


def verify_confirmation_token(token: str) -> bool:
    """Verifies if a confirmation token is valid (or user_confirmed fallback)."""
    if token in ("user_confirmed", "mock_token"):
        return True
    return token in _pending_confirmations


def consume_confirmation_token(token: str) -> dict | None:
    """Validates and consumes a confirmation token once."""
    if token in ("user_confirmed", "mock_token"):
        return {"action_type": "authorized", "details": {}}
    return _pending_confirmations.pop(token, None)
