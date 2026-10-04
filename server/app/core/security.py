"""Security rules, path sanitization, and command execution boundaries.

Enforces:
1. No path traversal outside declared workspace boundaries.
2. Safe subprocess command allowlisting.
3. Token generation and validation for mutating AI actions.
"""

from __future__ import annotations

import os
import secrets
import shlex
import shutil
import sys
import threading
import time
from pathlib import Path
from typing import Sequence

# Tokens generated for pending mutating actions (in-memory, expires after 5 minutes)
_pending_confirmations: dict[str, dict] = {}

_confirmation_lock = threading.Lock()
CONFIRMATION_TTL_SECONDS = 300
MAX_PENDING_CONFIRMATIONS = 256


def git_executable() -> str:
    if not getattr(sys, "frozen", False) and shutil.which("git"):
        return "git"
    bundled = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2])) / "git" / "git.exe"
    return str(bundled) if bundled.is_file() else "git"


def git_environment() -> dict[str, str]:
    env = os.environ.copy()
    executable = Path(git_executable())
    if executable.is_absolute():
        env["GIT_CONFIG_SYSTEM"] = str(executable.parent / "gitconfig")
    return env


def command_argv(command: str) -> list[str]:
    """Parse a command without invoking a shell or accepting shell operators."""
    if not isinstance(command, str) or len(command) > 4096:
        raise ValueError("Invalid command")
    if any(c in command for c in "&|;<>`\n\r$"):
        raise ValueError("Shell operators are not permitted")
    argv = shlex.split(command, posix=True)
    if not argv:
        raise ValueError("Empty command")
    # Restrict Git to inspection. Tests execute project code and require confirmation.
    safe_git = {"status", "log", "diff", "show", "ls-files", "rev-parse"}
    if argv[0] == "git" and len(argv) > 1 and argv[1] in safe_git:
        if any(a.startswith(("--output", "--ext-diff", "--textconv", "--exec", "--config", "--no-index")) for a in argv[2:]):
            raise ValueError("Unsafe Git option")
        return [git_executable(), "-c", "core.pager=cat", "-c", "diff.external=", *argv[1:]]
    if argv[0] == "pytest" or argv[:2] in (["cargo", "test"], ["go", "test"], ["npm", "test"]) or argv[:3] == ["python", "-m", "unittest"]:
        return argv
    raise ValueError("Command is not allowlisted")


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
    try:
        command_argv(command)
        return True, "Allowed"
    except ValueError as exc:
        return False, str(exc)


def generate_confirmation_token(action_type: str, details: dict) -> str:
    """Generates a secure single-use confirmation token for a mutating operation."""
    import copy
    token = secrets.token_urlsafe(24)
    with _confirmation_lock:
        now = time.monotonic()
        for key, value in list(_pending_confirmations.items()):
            if now - value["created_at"] >= CONFIRMATION_TTL_SECONDS:
                _pending_confirmations.pop(key, None)
        if len(_pending_confirmations) >= MAX_PENDING_CONFIRMATIONS:
            raise RuntimeError("Too many pending confirmations")
        _pending_confirmations[token] = {"action_type": action_type, "details": copy.deepcopy(details), "created_at": now}
    return token


def verify_confirmation_token(token: str) -> bool:
    with _confirmation_lock:
        value = _pending_confirmations.get(token) if isinstance(token, str) else None
        return bool(value and time.monotonic() - value["created_at"] < CONFIRMATION_TTL_SECONDS)


def consume_confirmation_token(token: str) -> dict | None:
    with _confirmation_lock:
        value = _pending_confirmations.pop(token, None) if isinstance(token, str) else None
        if value and time.monotonic() - value["created_at"] < CONFIRMATION_TTL_SECONDS:
            return value
    return None
