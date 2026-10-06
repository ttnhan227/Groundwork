"""Non-AI exact duplicate detection and storage insight service.

Groups candidate files by exact logical size first, then performs on-demand
SHA-256 content hashing only on size collisions.
Distinguishes exact duplicates from merely similar filenames.
Never labels files as 'unnecessary' and does not perform destructive deletion.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.database.local_db import get_db
from app.services.windows_files import stream_hashes
from app.services.workspace_service import WorkspaceService


class DuplicateService:
    def __init__(self) -> None:
        self.db = get_db()
        self.workspace_service = WorkspaceService()

    def find_duplicates(self, workspace_id: str | None = None) -> dict[str, Any]:
        """Finds exact duplicates and similar names on demand using size filtering followed by SHA-256."""
        conn = self.db.get_connection()
        allowed_roots = self.workspace_service.get_allowed_roots()

        # Step 1: Identify file sizes with at least 2 entries (non-empty files only)
        clauses = ["kind = 'file'", "size_bytes > 0", "workspace_id IN (SELECT id FROM workspaces WHERE is_active=1)"]
        params: list[Any] = []
        if workspace_id:
            clauses.append("workspace_id = ?")
            params.append(workspace_id)
        where_sql = " AND ".join(clauses)

        size_rows = conn.execute(
            f"""SELECT size_bytes, count(*) as count
            FROM inventory
            WHERE {where_sql}
            GROUP BY size_bytes
            HAVING count(*) > 1
            ORDER BY size_bytes DESC""",
            params,
        ).fetchall()

        if not size_rows:
            return {
                "exact_duplicates": [],
                "similar_names": self._find_similar_names(conn, where_sql, params),
                "total_exact_groups": 0,
                "total_duplicate_files": 0,
                "total_potential_waste_bytes": 0,
                "note": "No duplicate file sizes found in inventory.",
            }

        # Step 2: Fetch files for colliding sizes and hash on demand
        duplicate_sizes = [r["size_bytes"] for r in size_rows]
        marks = ",".join("?" for _ in duplicate_sizes)

        candidate_rows = conn.execute(
            f"""SELECT path, name, size_bytes, mtime, extension, workspace_id
            FROM inventory
            WHERE {where_sql} AND size_bytes IN ({marks})
            ORDER BY size_bytes DESC, path ASC""",
            params + duplicate_sizes,
        ).fetchall()

        # Group by size first
        candidates_by_size = defaultdict(list)
        for r in candidate_rows:
            candidates_by_size[r["size_bytes"]].append(r)

        # Hash each candidate file and group by sha256
        hash_groups = defaultdict(list)
        seen_paths = set()
        for size_bytes, rows in candidates_by_size.items():
            for row in rows:
                path = Path(row["path"])
                try:
                    resolved = path.resolve()
                except OSError:
                    continue
                key = os.path.normcase(str(resolved))
                if key in seen_paths or not any(resolved.is_relative_to(root) for root in allowed_roots):
                    continue
                seen_paths.add(key)
                if not path.is_file() or path.is_symlink() or any(parent.is_symlink() or parent.is_junction() for parent in path.parents):
                    continue
                try:
                    before = path.stat()
                    digest = hashlib.sha256()
                    with path.open("rb") as f:
                        while chunk := f.read(1024 * 1024):
                            digest.update(chunk)
                    file_hash = digest.hexdigest()
                    streams = tuple(sorted(stream_hashes(path).items()))
                    after = path.stat()
                    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or after.st_size != size_bytes:
                        continue
                    hash_groups[(size_bytes, file_hash, streams)].append(
                        {
                            "path": str(path),
                            "name": row["name"],
                            "size_bytes": size_bytes,
                            "mtime": row["mtime"],
                            "extension": row["extension"],
                            "workspace_id": row["workspace_id"],
                            "_identity": (after.st_dev, after.st_ino),
                        }
                    )
                except OSError:
                    continue

        exact_duplicate_groups = []
        for (size_bytes, sha256, _streams), files in hash_groups.items():
            if len(files) > 1:
                unique_files = len({file.pop("_identity") for file in files})
                potential_waste = (unique_files - 1) * size_bytes
                exact_duplicate_groups.append(
                    {
                        "sha256": sha256,
                        "size_bytes": size_bytes,
                        "file_count": len(files),
                        "potential_waste_bytes": potential_waste,
                        "hard_link_aliases": len(files) - unique_files,
                        "files": files,
                    }
                )

        # Sort groups by largest potential waste first
        exact_duplicate_groups.sort(key=lambda g: g["potential_waste_bytes"], reverse=True)

        total_exact_files = sum(g["file_count"] for g in exact_duplicate_groups)
        total_waste = sum(g["potential_waste_bytes"] for g in exact_duplicate_groups)

        similar_names = self._find_similar_names(conn, where_sql, params)

        return {
            "exact_duplicates": exact_duplicate_groups,
            "similar_names": similar_names,
            "total_exact_groups": len(exact_duplicate_groups),
            "total_duplicate_files": total_exact_files,
            "total_potential_waste_bytes": total_waste,
            "note": "Primary contents and named data streams matched with SHA-256. Potential duplicate bytes are logical sizes; hard-linked aliases count once. Allocated space can differ. Review files before deleting anything.",
        }

    def _find_similar_names(self, conn, where_sql: str, params: list[Any]) -> list[dict[str, Any]]:
        """Finds files with similar base names or copy suffixes that have different content/sizes."""
        # Find files matching ' (1)', ' - Copy', '_copy', etc.
        rows = conn.execute(
            f"""SELECT path, name, size_bytes, mtime, extension
            FROM inventory
            WHERE {where_sql}
            ORDER BY name ASC""",
            params,
        ).fetchall()

        stem_groups = defaultdict(list)
        seen_paths = set()
        for r in rows:
            key = os.path.normcase(r["path"])
            if key in seen_paths:
                continue
            seen_paths.add(key)
            name = r["name"]
            # Normalize copy patterns like "report (1).pdf" -> "report", "doc - Copy.txt" -> "doc"
            clean_stem = re.sub(r"\s*(?:\(\d+\)|-\s*Copy|_copy)$", "", Path(name).stem, flags=re.IGNORECASE).strip().lower()
            if clean_stem:
                stem_groups[clean_stem].append(
                    {
                        "path": r["path"],
                        "name": r["name"],
                        "size_bytes": r["size_bytes"],
                        "mtime": r["mtime"],
                        "extension": r["extension"],
                    }
                )

        similar = []
        for stem, files in stem_groups.items():
            if len(files) > 1:
                # Only include if there is variation in names or sizes (i.e. not already identical)
                names = {f["name"] for f in files}
                if len(names) > 1:
                    similar.append(
                        {
                            "base_name": stem,
                            "file_count": len(files),
                            "files": files,
                        }
                    )

        similar.sort(key=lambda s: s["file_count"], reverse=True)
        return similar[:50]
