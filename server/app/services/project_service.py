"""Project discovery, metadata inspection, and structure analysis service.

Detects recognizable working areas via project markers (.git, package.json,
pyproject.toml, Cargo.toml, go.mod, etc.) and extracts rich project overviews.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.database.local_db import LocalDatabase, get_db
from app.models.types import ProjectOverview, ProjectResponse

logger = logging.getLogger("groundwork.projects")

PROJECT_MARKERS = (
    ".git",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "docker-compose.yml",
    "docker-compose.yaml",
)


class ProjectService:
    """Discovers and manages projects inside workspaces."""

    @property
    def db(self) -> LocalDatabase:
        return get_db()

    def discover_projects_in_workspace(self, workspace_id: str, workspace_path: Path) -> list[dict[str, Any]]:
        """Walks workspace tree looking for project roots and registers them."""
        discovered: list[dict[str, Any]] = []
        workspace_path = workspace_path.resolve()

        if not workspace_path.exists():
            return []

        # Check if the workspace root itself is a project
        root_markers = [m for m in PROJECT_MARKERS if (workspace_path / m).exists()]
        if root_markers:
            proj_info = self._analyze_project_directory(workspace_path, workspace_id)
            self._upsert_project(proj_info)
            discovered.append(proj_info)

        # Walk subdirectories (depth 3 to avoid deep recursion)
        for root, dirs, _files in os.walk(str(workspace_path)):
            # Skip ignored directories
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".venv", "target", "dist", "build")]
            cur_path = Path(root).resolve()
            if cur_path == workspace_path:
                continue

            # Check if this subdirectory is a project root
            markers = [m for m in PROJECT_MARKERS if (cur_path / m).exists()]
            if markers:
                proj_info = self._analyze_project_directory(cur_path, workspace_id)
                self._upsert_project(proj_info)
                discovered.append(proj_info)
                # Don't recurse deeper into this project root
                dirs.clear()

        return discovered

    def _analyze_project_directory(self, path: Path, workspace_id: str) -> dict[str, Any]:
        """Extracts language, frameworks, git metadata, and entry points for a project."""
        name = path.name
        detected_type = "Generic Project"
        language = "Unknown"
        frameworks: list[str] = []
        metadata: dict[str, Any] = {}

        # 1. Node / TypeScript / JavaScript
        pkg_json = path / "package.json"
        if pkg_json.exists():
            try:
                data = json.loads(pkg_json.read_text(encoding="utf-8"))
                name = data.get("name", name)
                deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
                language = "TypeScript" if (path / "tsconfig.json").exists() or "typescript" in deps else "JavaScript"

                if "react" in deps:
                    frameworks.append("React")
                if "vue" in deps:
                    frameworks.append("Vue")
                if "next" in deps:
                    frameworks.append("Next.js")
                if "@tauri-apps/api" in deps or (path / "src-tauri").exists():
                    frameworks.append("Tauri")
                if "vite" in deps:
                    frameworks.append("Vite")
                if "tailwindcss" in deps:
                    frameworks.append("Tailwind CSS")

                detected_type = f"{language} / {frameworks[0]}" if frameworks else language
                metadata["scripts"] = data.get("scripts", {})
                metadata["dependencies"] = list(deps.keys())[:25]
            except Exception as exc:
                logger.debug("Failed reading %s: %s", pkg_json, exc)

        # 2. Python
        pyproject = path / "pyproject.toml"
        req_txt = path / "requirements.txt"
        if pyproject.exists() or req_txt.exists() or (path / "setup.py").exists():
            language = "Python"
            py_text = ""
            if pyproject.exists():
                try:
                    py_text += pyproject.read_text(encoding="utf-8")
                except Exception:
                    pass
            if req_txt.exists():
                try:
                    py_text += req_txt.read_text(encoding="utf-8")
                except Exception:
                    pass

            py_lower = py_text.lower()
            if "fastapi" in py_lower:
                frameworks.append("FastAPI")
            if "flask" in py_lower:
                frameworks.append("Flask")
            if "django" in py_lower:
                frameworks.append("Django")
            if "pytest" in py_lower:
                frameworks.append("pytest")
            if "sqlalchemy" in py_lower:
                frameworks.append("SQLAlchemy")

            detected_type = f"Python / {frameworks[0]}" if frameworks else "Python"

        # 3. Rust
        cargo = path / "Cargo.toml"
        if cargo.exists():
            language = "Rust"
            try:
                cargo_text = cargo.read_text(encoding="utf-8")
                if "tauri" in cargo_text:
                    frameworks.append("Tauri")
                if "tokio" in cargo_text:
                    frameworks.append("Tokio")
                if "axum" in cargo_text:
                    frameworks.append("Axum")
            except Exception:
                pass
            detected_type = f"Rust / {frameworks[0]}" if frameworks else "Rust"

        # 4. Go
        if (path / "go.mod").exists():
            language = "Go"
            detected_type = "Go Project"

        # Git info
        git_dir = path / ".git"
        git_branch = None
        git_remote = None
        if git_dir.exists():
            git_branch = self._run_git(path, ["branch", "--show-current"])
            git_remote = self._run_git(path, ["remote", "get-url", "origin"])

        mtime = None
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
        except Exception:
            pass

        import uuid
        proj_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(path)))

        now_iso = datetime.now(timezone.utc).isoformat()
        return {
            "id": proj_id,
            "workspace_id": workspace_id,
            "name": name,
            "path": str(path),
            "detected_type": detected_type,
            "language": language,
            "frameworks": frameworks,
            "git_remote": git_remote,
            "git_branch": git_branch,
            "last_modified": mtime or now_iso,
            "metadata": metadata,
            "created_at": now_iso,
            "updated_at": now_iso,
        }

    def _upsert_project(self, info: dict[str, Any]) -> None:
        conn = self.db.get_connection()
        with conn:
            conn.execute("""
            INSERT INTO projects (
                id, workspace_id, name, path, detected_type, language,
                frameworks, git_remote, git_branch, last_modified,
                metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                detected_type = excluded.detected_type,
                language = excluded.language,
                frameworks = excluded.frameworks,
                git_remote = excluded.git_remote,
                git_branch = excluded.git_branch,
                last_modified = excluded.last_modified,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at;
            """, (
                info["id"],
                info["workspace_id"],
                info["name"],
                info["path"],
                info["detected_type"],
                info["language"],
                json.dumps(info["frameworks"]),
                info["git_remote"],
                info["git_branch"],
                info["last_modified"],
                json.dumps(info["metadata"]),
                info["created_at"],
                info["updated_at"],
            ))

    def list_projects(self, workspace_id: str | None = None) -> list[ProjectResponse]:
        conn = self.db.get_connection()
        query = "SELECT * FROM projects"
        params: list[Any] = []
        if workspace_id:
            query += " WHERE workspace_id = ?"
            params.append(workspace_id)
        query += " ORDER BY last_modified DESC;"

        rows = conn.execute(query, params).fetchall()
        projects: list[ProjectResponse] = []
        for r in rows:
            projects.append(ProjectResponse(
                id=r["id"],
                workspace_id=r["workspace_id"],
                name=r["name"],
                path=r["path"],
                detected_type=r["detected_type"],
                language=r["language"],
                frameworks=json.loads(r["frameworks"]) if r["frameworks"] else [],
                git_remote=r["git_remote"],
                git_branch=r["git_branch"],
                last_modified=r["last_modified"],
                metadata=json.loads(r["metadata_json"]) if r["metadata_json"] else {},
            ))
        return projects

    def get_project(self, project_id: str) -> ProjectResponse | None:
        conn = self.db.get_connection()
        row = conn.execute("SELECT * FROM projects WHERE id = ?;", (project_id,)).fetchone()
        if not row:
            return None
        return ProjectResponse(
            id=row["id"],
            workspace_id=row["workspace_id"],
            name=row["name"],
            path=row["path"],
            detected_type=row["detected_type"],
            language=row["language"],
            frameworks=json.loads(row["frameworks"]) if row["frameworks"] else [],
            git_remote=row["git_remote"],
            git_branch=row["git_branch"],
            last_modified=row["last_modified"],
            metadata=json.loads(row["metadata_json"]) if row["metadata_json"] else {},
        )

    def get_project_overview(self, project_id: str) -> ProjectOverview | None:
        """Constructs a comprehensive project overview with README, entry points, and commits."""
        proj = self.get_project(project_id)
        if not proj:
            return None

        p_path = Path(proj.path)
        readme_preview = None
        for rname in ("README.md", "README", "readme.markdown"):
            rfile = p_path / rname
            if rfile.exists():
                try:
                    readme_preview = rfile.read_text(encoding="utf-8")[:2000]
                    break
                except Exception:
                    pass

        # Identify likely entry points
        entry_points = []
        candidate_entry_points = [
            "src/main.tsx", "src/main.ts", "src/index.tsx", "src/index.ts",
            "src/App.tsx", "src/main.rs", "app/main.py", "main.py", "app.py",
            "server.js", "index.js", "cmd/main.go", "main.go"
        ]
        for ep in candidate_entry_points:
            if (p_path / ep).exists():
                entry_points.append(ep)

        # Get recent git commits from local db
        conn = self.db.get_connection()
        commit_rows = conn.execute("""
            SELECT commit_hash, author, date, message FROM git_commits
            WHERE project_id = ?
            ORDER BY date DESC LIMIT 10;
        """, (project_id,)).fetchall()

        recent_commits = [
            {"hash": c["commit_hash"][:7], "author": c["author"], "date": c["date"], "message": c["message"]}
            for c in commit_rows
        ]

        # Key files in project root
        key_files = []
        try:
            for item in sorted(p_path.iterdir()):
                if item.name.startswith(".") or item.name in ("node_modules", "target", "__pycache__"):
                    continue
                key_files.append({
                    "name": item.name,
                    "is_dir": item.is_dir(),
                    "size": item.stat().st_size if item.is_file() else 0,
                })
        except Exception:
            pass

        return ProjectOverview(
            **proj.model_dump(),
            readme_preview=readme_preview,
            entry_points=entry_points,
            dependencies=proj.metadata.get("dependencies", []),
            recent_commits=recent_commits,
            key_files=key_files[:20],
        )

    @staticmethod
    def _run_git(cwd: Path, args: list[str]) -> str | None:
        try:
            res = subprocess.run(
                ["git", *args],
                cwd=str(cwd),
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )
            if res.returncode == 0:
                return res.stdout.strip()
        except Exception:
            pass
        return None
