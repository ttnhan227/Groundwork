"""High-performance cached exclusion rule engine for Groundwork.

Caches compiled pathspec patterns and per-directory .gitignore rules to eliminate
redundant regex compilation and disk I/O during filesystem traversal.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Optional, Set

import pathspec

logger = logging.getLogger("groundwork.exclusion_cache")

# Common high-volume, non-user directories that should be skipped immediately
FAST_IGNORE_DIR_NAMES: Set[str] = {
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    "target",
    "build",
    "dist",
    ".gradle",
    ".cargo",
    "bin",
    "obj",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
}

# Sensitive credential files that must never be read or indexed
SENSITIVE_FILE_NAMES: Set[str] = {
    ".env",
    "id_rsa",
    "id_ed25519",
    "credentials",
    "credentials.json",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "preferences.dat",
    "service-account.json",
    "secrets.json",
    "secrets.yaml",
    "secrets.yml",
    "application_default_credentials.json",
    "kubeconfig.yaml",
}

SENSITIVE_EXTENSIONS: Set[str] = {".pem", ".key", ".p12", ".pfx"}
SENSITIVE_FOLDER_PARTS: Set[str] = {".ssh", ".aws", ".azure", ".gnupg", ".kube"}


class ExclusionRuleCache:
    """Thread-safe, high-speed cache for pattern matching and gitignore rules."""

    def __init__(
        self,
        default_patterns: list[str] | None = None,
        workspace_patterns: list[str] | None = None,
        root: Path | None = None,
    ) -> None:
        self.root = root.resolve() if root else None

        combined_patterns = []
        if default_patterns:
            combined_patterns.extend(default_patterns)
        if workspace_patterns:
            combined_patterns.extend(workspace_patterns)

        self.base_spec: Optional[pathspec.GitIgnoreSpec] = None
        if combined_patterns:
            try:
                self.base_spec = pathspec.GitIgnoreSpec.from_lines(combined_patterns)
            except Exception as exc:
                logger.warning("Failed to compile base ignore patterns: %s", exc)

        # Cache: dir_path -> (GitIgnoreSpec or None if no .gitignore in this directory)
        self._gitignore_cache: Dict[Path, Optional[pathspec.GitIgnoreSpec]] = {}

    def is_fast_ignorable_dir(self, name: str) -> bool:
        """O(1) check for standard developer/build directories."""
        return name in FAST_IGNORE_DIR_NAMES

    def is_sensitive(self, path: Path) -> bool:
        """Checks if a file or path is a sensitive credential."""
        name_lower = path.name.lower()
        if name_lower in SENSITIVE_FILE_NAMES:
            return True
        if path.suffix.lower() in SENSITIVE_EXTENSIONS:
            return True
        if name_lower.startswith(".env.") and name_lower != ".env.example":
            return True
        if name_lower.startswith(("client_secret", "service_account", "service-account")) and path.suffix.lower() == ".json":
            return True
        if self.root:
            try:
                parts_lower = {p.lower() for p in path.relative_to(self.root).parts}
                if SENSITIVE_FOLDER_PARTS.intersection(parts_lower):
                    return True
            except ValueError:
                pass
        return False

    def is_ignored(self, path: Path, is_dir: bool = False) -> bool:
        """Determines if a path is ignored using cached base patterns and gitignore hierarchy."""
        name = path.name
        if is_dir and name in FAST_IGNORE_DIR_NAMES:
            return True

        if self.is_sensitive(path):
            return True

        if not self.root:
            return False

        try:
            rel = path.resolve().relative_to(self.root).as_posix()
        except (ValueError, OSError):
            return True

        suffix = "/" if is_dir else ""
        rel_with_suffix = rel + suffix

        # Check pre-compiled workspace & default spec
        if self.base_spec and self.base_spec.match_file(rel_with_suffix):
            return True

        # Check ancestor gitignores using cached specs
        current = path.parent if not is_dir else path
        parents: List[Path] = []
        while current and current != self.root:
            try:
                if current.is_relative_to(self.root):
                    parents.append(current)
                    current = current.parent
                else:
                    break
            except (ValueError, AttributeError):
                break
        parents.append(self.root)
        parents.reverse()  # Root first, down to nearest parent

        ignored = False
        for p in parents:
            spec = self._get_or_load_gitignore_spec(p)
            if spec:
                try:
                    rel_to_p = path.relative_to(p).as_posix() + suffix
                    res = spec.check_file(rel_to_p)
                    if res.include is not None:
                        ignored = res.include
                except (ValueError, Exception):
                    pass

        return ignored

    def _get_or_load_gitignore_spec(self, directory: Path) -> Optional[pathspec.GitIgnoreSpec]:
        """Loads and compiles .gitignore for a directory once, then caches the result."""
        if directory in self._gitignore_cache:
            return self._gitignore_cache[directory]

        gi_file = directory / ".gitignore"
        spec = None
        if gi_file.is_file():
            try:
                lines = gi_file.read_text(encoding="utf-8", errors="replace").splitlines()
                valid_lines = [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]
                if valid_lines:
                    spec = pathspec.GitIgnoreSpec.from_lines(valid_lines)
            except Exception as exc:
                logger.debug("Could not read %s: %s", gi_file, exc)

        self._gitignore_cache[directory] = spec
        return spec
