"""Git integration service for extracting commit history, diff summaries, and branches.

Provides local-first Git awareness without requiring network access.
"""

from __future__ import annotations

import json
import logging
import subprocess
import uuid
from pathlib import Path
from typing import Any

from app.core.security import git_environment, git_executable
from app.database.local_db import LocalDatabase, get_db

logger = logging.getLogger("groundwork.git")


class GitService:
    """Inspects local Git repositories and indexes commits into SQLite."""

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    @staticmethod
    def is_git_repo(path: Path) -> bool:
        """Checks if a path is inside a Git repository."""
        return any((parent / ".git").exists() for parent in (path, *path.parents))

    def get_file_history(self, repo_path: Path, relative_path: str, limit: int = 20) -> dict[str, Any]:
        target = (repo_path / relative_path).resolve()
        if not target.is_relative_to(repo_path.resolve()):
            raise ValueError("File must be inside the project")
        path = str(target.relative_to(repo_path.resolve())).replace("\\", "/")
        history = self._run_git(repo_path, ["log", "--follow", f"-n{limit}", "--date=iso-strict", "--format=%H|%an|%ad|%s", "--", path]) or ""
        commits = []
        for line in history.splitlines():
            parts = line.split("|", 3)
            if len(parts) == 4:
                commits.append(dict(zip(("hash", "author", "date", "message"), parts, strict=True)))
        diff = self._run_git(repo_path, ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", path]) or ""
        return {"path": path, "commits": commits, "diff": diff[:20000]}

    def get_recent_commits(self, repo_path: str | Path, limit: int = 50) -> list[dict[str, Any]]:
        """Public method returning parsed commit history from a local git repository."""
        return self._fetch_recent_commits(Path(repo_path), limit=limit)

    def sync_project_commits(self, project_id: str, repo_path: Path, max_commits: int = 50) -> list[dict[str, Any]]:
        """Reads recent commits from git and synchronizes them to SQLite."""
        if not repo_path.exists():
            return []

        commits = self._fetch_recent_commits(repo_path, limit=max_commits)
        if not commits:
            return []

        conn = self.db.get_connection()
        with conn:
            for c in commits:
                commit_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{project_id}-{c['hash']}"))
                conn.execute("""
                INSERT INTO git_commits (id, project_id, commit_hash, author, date, message, changed_files_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    message = excluded.message,
                    changed_files_json = excluded.changed_files_json;
                """, (
                    commit_id,
                    project_id,
                    c["hash"],
                    c["author"],
                    c["date"],
                    c["message"],
                    json.dumps(c.get("changed_files", [])),
                ))

        return commits

    def search_commits(self, query: str, project_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        """Searches indexed Git commit messages in SQLite."""
        conn = self.db.get_connection()
        sql = "SELECT c.*, p.name as project_name FROM git_commits c JOIN projects p ON c.project_id = p.id WHERE c.message LIKE ?"
        params: list[Any] = [f"%{query}%"]
        if project_id:
            sql += " AND c.project_id = ?"
            params.append(project_id)
        sql += " ORDER BY c.date DESC LIMIT ?;"
        params.append(limit)

        rows = conn.execute(sql, params).fetchall()
        return [
            {
                "id": r["id"],
                "project_id": r["project_id"],
                "project_name": r["project_name"],
                "hash": r["commit_hash"],
                "short_hash": r["commit_hash"][:7],
                "author": r["author"],
                "date": r["date"],
                "message": r["message"],
                "changed_files": json.loads(r["changed_files_json"]) if r["changed_files_json"] else [],
            }
            for r in rows
        ]

    def get_working_tree_status(self, repo_path: Path) -> dict[str, Any]:
        """Returns the current branch and uncommitted changed files."""
        branch = (self._run_git(repo_path, ["branch", "--show-current"]) or "").strip() or "Detached HEAD"
        status_raw = self._run_git(repo_path, ["status", "--porcelain=v1", "-z"]) or ""
        changed_files = []
        records = iter(status_raw.split("\0"))
        for record in records:
            if len(record) < 4:
                continue
            code = record[:2]
            item = {"status": code.strip(), "file": record[3:]}
            if "R" in code or "C" in code:
                item["original_file"] = next(records, "")
            changed_files.append(item)

        diff_stat = self._run_git(repo_path, ["diff", "--stat"]) or ""

        return {
            "branch": branch,
            "has_uncommitted_changes": len(changed_files) > 0,
            "changed_files": changed_files,
            "diff_stat": diff_stat,
        }

    def _fetch_recent_commits(self, repo_path: Path, limit: int = 50) -> list[dict[str, Any]]:
        # Format: %H|%an|%ad|%s
        raw = self._run_git(
            repo_path,
            ["log", f"-n{limit}", "--pretty=format:%H|%an|%ad|%s", "--date=iso-strict"],
        )
        if not raw:
            return []

        commits = []
        for line in raw.splitlines():
            parts = line.strip().split("|", 3)
            if len(parts) == 4:
                commit_hash, author, date, message = parts
                commits.append({
                    "hash": commit_hash,
                    "author": author,
                    "date": date,
                    "message": message,
                    "changed_files": (self._run_git(repo_path, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", commit_hash]) or "").split("\0")[:-1],
                })
        return commits

    @staticmethod
    def _run_git(cwd: Path, args: list[str]) -> str | None:
        try:
            res = subprocess.run(
                [git_executable(), "-c", "core.pager=cat", "-c", "diff.external=", *args],
                cwd=str(cwd),
                env=git_environment(),
                capture_output=True,
                text=True,
                check=False,
                timeout=10,
            )
            if res.returncode == 0:
                return res.stdout
        except Exception as exc:
            logger.debug("Git command failed in %s: %s", cwd, exc)
        return None
