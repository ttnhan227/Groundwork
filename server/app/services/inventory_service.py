"""High-performance metadata-only inventory service.

Performs:
1. Fast progressive filesystem discovery without reading file contents or hashing.
2. In-memory folder size aggregation avoiding per-folder database round-trips.
3. Batched SQLite transactions for maximum WAL throughput.
4. Incremental scanning that preserves unchanged files across app launches.
5. Safe handling of Windows NTFS junctions, symlink loops, and cloud placeholders.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from app.core.file_categories import LABELS, refresh_categories, storage_category
from app.database.local_db import get_db

logger = logging.getLogger("groundwork.inventory")

# Windows file attributes for cloud placeholders and reparse points
FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400
FILE_ATTRIBUTE_OFFLINE = 0x00001000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000
CLOUD_PLACEHOLDER_MASK = (
    FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
)


class InventoryService:
    def __init__(self) -> None:
        self.db = get_db()

    def scan(
        self,
        workspace: Any,
        cancelled: Callable[[], bool] = lambda: False,
        report: Callable[[int, str, List[str]], None] = lambda c, d, e: None,
    ) -> Tuple[int, List[str]]:
        try:
            return self._scan(workspace, cancelled, report)
        except Exception as exc:
            logger.exception("Inventory scan failed for %s: %s", workspace.path, exc)
            with self.db.get_connection() as conn:
                conn.execute(
                    "UPDATE inventory_scans SET status='failed', errors=?, updated_at=? WHERE workspace_id=?",
                    (json.dumps([str(exc)]), time.time(), workspace.id),
                )
            raise

    def _scan(
        self,
        workspace: Any,
        cancelled: Callable[[], bool],
        report: Callable[[int, str, List[str]], None],
    ) -> Tuple[int, List[str]]:
        root = Path(workspace.path)
        scan_id = uuid.uuid4().hex
        conn = self.db.get_connection()

        with conn:
            conn.execute(
                "INSERT OR REPLACE INTO inventory_scans (workspace_id, status, errors, updated_at) VALUES (?, 'scanning', '[]', ?)",
                (workspace.id, time.time()),
            )

        # 1. Load existing inventory for fast incremental change detection
        existing_rows = conn.execute(
            "SELECT path, mtime, size_bytes FROM inventory WHERE workspace_id = ?",
            (workspace.id,),
        ).fetchall()
        existing_cache: Dict[str, Tuple[float, int]] = {
            row["path"]: (row["mtime"], row["size_bytes"]) for row in existing_rows
        }

        seen_paths: Set[str] = set()
        count = 0
        errors: List[str] = []
        stack: List[Path] = [root]

        # In-memory folder size aggregation
        folder_direct_bytes: Dict[str, int] = defaultdict(int)
        folder_direct_files: Dict[str, int] = defaultdict(int)
        folder_parents: Dict[str, str] = {}
        all_folders: Set[str] = set()

        rows_to_save: List[Tuple] = []
        first_batch = True
        BATCH_SIZE = 2000
        FIRST_BATCH_SIZE = 64

        while stack and not cancelled():
            directory = stack.pop()
            dir_str = str(directory)
            all_folders.add(dir_str)

            try:
                with os.scandir(directory) as entries:
                    for entry in entries:
                        if cancelled():
                            break
                        try:
                            # Use follow_symlinks=False to prevent reading through directory links
                            stat = entry.stat(follow_symlinks=False)

                            # Handle Windows junctions and symlinks safely
                            is_link = entry.is_symlink() or (
                                # DirEntry.stat already supplies this attribute.
                                # Avoid a second Windows stat for every ordinary
                                # file merely to ask whether it is a junction.
                                bool(getattr(stat, "st_file_attributes", 0) & FILE_ATTRIBUTE_REPARSE_POINT)
                                and hasattr(os.path, "isjunction")
                                and os.path.isjunction(entry.path)
                            )
                            is_dir = not is_link and entry.is_dir(follow_symlinks=False)
                            kind = "link" if is_link else "folder" if is_dir else "file"

                            entry_path_str = entry.path
                            seen_paths.add(entry_path_str)

                            if kind == "folder":
                                folder_parents[entry_path_str] = dir_str
                                all_folders.add(entry_path_str)
                                # Never recurse into links/junctions; only regular directories
                                stack.append(Path(entry.path))
                            elif kind == "file":
                                count += 1
                                folder_direct_bytes[dir_str] += stat.st_size
                                folder_direct_files[dir_str] += 1

                            # Incremental check: if existing entry is unchanged, skip re-saving row
                            cached = existing_cache.get(entry_path_str)
                            file_size = stat.st_size if kind == "file" else 0
                            if cached is not None and cached[0] == stat.st_mtime and cached[1] == file_size:
                                continue

                            ext = Path(entry.name).suffix.lower() if kind == "file" else ""
                            rows_to_save.append(
                                (
                                    workspace.id,
                                    entry_path_str,
                                    dir_str,
                                    entry.name,
                                    kind,
                                    ext,
                                    file_size,
                                    stat.st_mtime,
                                    scan_id,
                                    0,  # initial file_count
                                )
                            )

                            # Progressive flush to SQLite: first batch small for <10ms responsiveness, then 2000
                            threshold = FIRST_BATCH_SIZE if first_batch else BATCH_SIZE
                            if len(rows_to_save) >= threshold:
                                first_batch = False
                                self._save_batch(conn, rows_to_save)
                                rows_to_save = []
                                report(count, dir_str, errors)

                        except OSError as exc:
                            errors.append(f"{entry.path}: {exc}")
            except OSError as exc:
                errors.append(f"{dir_str}: {exc}")

            if len(rows_to_save) >= BATCH_SIZE:
                self._save_batch(conn, rows_to_save)
                rows_to_save = []
                report(count, dir_str, errors)

        # Flush any remaining rows
        if rows_to_save:
            self._save_batch(conn, rows_to_save)
            rows_to_save = []
            report(count, str(root), errors)

        # Handle deletions incrementally: files in DB that no longer exist on disk
        if not cancelled() and not errors:
            deleted_paths = set(existing_cache.keys()) - seen_paths
            if deleted_paths:
                with conn:
                    conn.executemany(
                        "DELETE FROM inventory WHERE workspace_id = ? AND path = ?",
                        [(workspace.id, p) for p in deleted_paths],
                    )

        # In-memory folder size & file count rollup (bottom-up from leaves to root)
        if errors or cancelled():
            # Cached rows remain authoritative where discovery was incomplete.
            # A partial traversal must not zero previously known descendants.
            self.refresh_folder_sizes(workspace.id)
        else:
            self._rollup_folder_metrics(conn, workspace.id, all_folders, folder_parents, folder_direct_bytes, folder_direct_files, cancelled)

        # Recalculate totals once at the end in O(1) query
        with conn:
            conn.execute(
                """INSERT OR REPLACE INTO inventory_totals (workspace_id, files, bytes)
                SELECT ?, coalesce(sum(kind='file'), 0), coalesce(sum(CASE WHEN kind='file' THEN size_bytes ELSE 0 END), 0)
                FROM inventory WHERE workspace_id = ?""",
                (workspace.id, workspace.id),
            )
            refresh_categories(conn, workspace.id)

        status = "cancelled" if cancelled() else "completed_with_errors" if errors else "completed"
        with conn:
            conn.execute(
                "UPDATE inventory_scans SET status=?, errors=?, updated_at=? WHERE workspace_id=?",
                (status, json.dumps(errors[-50:]), time.time(), workspace.id),
            )

        return count, errors

    @staticmethod
    def _save_batch(conn, rows: List[Tuple]) -> None:
        if not rows:
            return
        with conn:
            conn.executemany(
                """INSERT INTO inventory (
                    workspace_id, path, parent, name, kind, extension, size_bytes, mtime, scan_id, file_count, category
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(workspace_id, path) DO UPDATE SET
                    parent = excluded.parent,
                    name = excluded.name,
                    kind = excluded.kind,
                    extension = excluded.extension,
                    category = excluded.category,
                    size_bytes = excluded.size_bytes,
                    mtime = excluded.mtime,
                    scan_id = excluded.scan_id;""",
                [(*row, storage_category(row[5], row[3]) if row[4] == "file" else "") for row in rows],
            )

    def _rollup_folder_metrics(
        self,
        conn,
        workspace_id: str,
        all_folders: Set[str],
        folder_parents: Dict[str, str],
        direct_bytes: Dict[str, int],
        direct_files: Dict[str, int],
        cancelled: Callable[[], bool],
    ) -> None:
        """Rolls up recursive folder sizes and file counts in memory, then updates SQLite in batch."""
        if cancelled():
            return

        total_bytes = dict(direct_bytes)
        total_files = dict(direct_files)

        # Process deepest folders first so child totals propagate to parents
        sorted_folders = sorted(all_folders, key=len, reverse=True)
        for folder_path in sorted_folders:
            parent = folder_parents.get(folder_path)
            if parent:
                total_bytes[parent] = total_bytes.get(parent, 0) + total_bytes.get(folder_path, 0)
                total_files[parent] = total_files.get(parent, 0) + total_files.get(folder_path, 0)

        # Single batch update for all folders
        updates = [
            (total_bytes.get(f, 0), total_files.get(f, 0), workspace_id, f)
            for f in all_folders
        ]
        if updates:
            with conn:
                conn.executemany(
                    "UPDATE inventory SET size_bytes = ?, file_count = ? WHERE workspace_id = ? AND path = ? AND kind = 'folder'",
                    updates,
                )

    def refresh_folder_sizes(self, workspace_id: str, cancelled: Callable[[], bool] = lambda: False) -> None:
        """Fallback folder size recalculation."""
        conn = self.db.get_connection()
        folders = conn.execute(
            "SELECT path, parent FROM inventory WHERE workspace_id = ? AND kind = 'folder' ORDER BY length(path) DESC",
            (workspace_id,),
        ).fetchall()
        if not folders or cancelled():
            return

        folder_bytes: Dict[str, int] = defaultdict(int)
        folder_files: Dict[str, int] = defaultdict(int)

        file_rows = conn.execute(
            "SELECT parent, size_bytes FROM inventory WHERE workspace_id = ? AND kind = 'file'",
            (workspace_id,),
        ).fetchall()
        for r in file_rows:
            folder_bytes[r["parent"]] += r["size_bytes"]
            folder_files[r["parent"]] += 1

        parent_map = {row["path"]: row["parent"] for row in folders}
        for f in folders:
            if cancelled():
                return
            p = parent_map.get(f["path"])
            if p:
                folder_bytes[p] += folder_bytes.get(f["path"], 0)
                folder_files[p] += folder_files.get(f["path"], 0)

        updates = [(folder_bytes.get(f["path"], 0), folder_files.get(f["path"], 0), workspace_id, f["path"]) for f in folders]
        with conn:
            conn.executemany(
                "UPDATE inventory SET size_bytes = ?, file_count = ? WHERE workspace_id = ? AND path = ? AND kind = 'folder'",
                updates,
            )

    def update_path(self, workspace: Any, path: str | Path, refresh: bool = True) -> None:
        path = Path(path)
        root = Path(workspace.path)
        if not path.is_relative_to(root):
            return
        for ancestor in [path, *path.parents]:
            if ancestor == root:
                break
            if ancestor.is_symlink() or (hasattr(ancestor, "is_junction") and ancestor.is_junction()):
                return
        conn = self.db.get_connection()
        if not path.exists():
            prefix = str(path) + os.sep
            with conn:
                conn.execute(
                    "DELETE FROM inventory WHERE workspace_id=? AND (path=? OR substr(path,1,?)=?)",
                    (workspace.id, str(path), len(prefix), prefix),
                )
        else:
            try:
                stat = path.stat(follow_symlinks=False)
                kind = "folder" if path.is_dir() else "file"
                self._save_batch(
                    conn,
                    [
                        (
                            workspace.id,
                            str(path),
                            str(path.parent),
                            path.name,
                            kind,
                            path.suffix.lower() if kind == "file" else "",
                            stat.st_size if kind == "file" else 0,
                            stat.st_mtime,
                            "watch",
                            0,
                        )
                    ],
                )
            except OSError:
                return

        # Recalculate parent folder sizes up to root
        parent = path if path.is_dir() else path.parent
        with conn:
            while parent.is_relative_to(root):
                conn.execute(
                    "UPDATE inventory SET size_bytes=(SELECT coalesce(sum(size_bytes),0) FROM inventory WHERE workspace_id=? AND parent=?), file_count=(SELECT coalesce(sum(CASE WHEN kind='file' THEN 1 ELSE file_count END),0) FROM inventory WHERE workspace_id=? AND parent=?) WHERE workspace_id=? AND path=? AND kind='folder'",
                    (workspace.id, str(parent), workspace.id, str(parent), workspace.id, str(parent)),
                )
                if parent == root:
                    break
                parent = parent.parent

        if refresh:
            self.refresh_totals(workspace.id)

    def refresh_totals(self, workspace_id: str) -> None:
        """Refresh workspace aggregates once per debounced watcher batch."""
        conn = self.db.get_connection()
        with conn:
            conn.execute(
                """INSERT OR REPLACE INTO inventory_totals (workspace_id, files, bytes)
                SELECT ?, coalesce(sum(kind='file'), 0), coalesce(sum(CASE WHEN kind='file' THEN size_bytes ELSE 0 END), 0)
                FROM inventory WHERE workspace_id = ?""",
                (workspace_id, workspace_id),
            )
            refresh_categories(conn, workspace_id)
            conn.execute("UPDATE inventory_scans SET updated_at=? WHERE workspace_id=?", (time.time(), workspace_id))

    def browse(
        self,
        workspace_id: Optional[str],
        parent: Optional[str] = None,
        query: str = "",
        extension: str = "",
        sort: str = "name",
        descending: bool = False,
        offset: int = 0,
        limit: int = 100,
        category: str = "",
        recursive: bool = False,
        kind: str = "",
        min_size: Optional[int] = None,
        modified_after: Optional[float] = None,
    ) -> Dict[str, Any]:
        conn = self.db.get_connection()
        scope = "workspace_id = ?" if workspace_id else "workspace_id IN (SELECT id FROM workspaces WHERE is_active=1)"
        scope_args = [workspace_id] if workspace_id else []
        source = "inventory"
        cte = ""
        deduplicate = False
        if not workspace_id:
            roots = [os.path.normcase(row["path"]).rstrip("\\/") for row in conn.execute("SELECT path FROM workspaces WHERE is_active=1")]
            deduplicate = any(root == other or root.startswith(other + os.sep) for index, root in enumerate(roots) for other in roots[:index]) or any(other.startswith(root + os.sep) for index, root in enumerate(roots) for other in roots[:index])
        if deduplicate:
            cte = """WITH unique_inventory AS (
                SELECT current.* FROM inventory current
                JOIN workspaces active ON active.id=current.workspace_id AND active.is_active=1
                WHERE NOT EXISTS (
                    SELECT 1 FROM inventory earlier JOIN workspaces previous
                    ON previous.id=earlier.workspace_id AND previous.is_active=1
                    WHERE earlier.path=current.path COLLATE NOCASE AND earlier.workspace_id<current.workspace_id
                )
            ) """
            source = "unique_inventory"
        clauses = [scope]
        args: List[Any] = list(scope_args)
        if parent is not None:
            # Workspace registration stores resolved paths, including Windows 8.3 aliases.
            parent = str(Path(parent).resolve())
            if recursive:
                prefix = parent.rstrip("\\/") + os.sep
                clauses.append("substr(path,1,?) = ?")
                args.extend([len(prefix), prefix])
            else:
                clauses.append("parent = ?")
                args.append(parent)
        if query:
            if "*" in query or "?" in query:
                clauses.append("lower(name) GLOB ?")
                args.append(query.lower())
            else:
                clauses.append("instr(lower(path), lower(?)) > 0")
                args.append(query)
        if kind:
            if kind not in {"file", "folder"}:
                raise ValueError("Unknown inventory kind")
            clauses.append("kind = ?")
            args.append(kind)
        if min_size is not None:
            clauses.append("size_bytes >= ?")
            args.append(min_size)
        if modified_after is not None:
            clauses.append("mtime >= ?")
            args.append(modified_after)
        if extension:
            clauses.append("extension = ?")
            args.append(extension.lower())
        if category:
            if category not in LABELS:
                raise ValueError("Unknown storage category")
            clauses.extend(["kind='file'", "category=?"])
            args.append(category)
        where = " AND ".join(clauses)
        order = {"name": "name COLLATE NOCASE", "size": "size_bytes", "modified": "mtime", "type": "extension"}.get(
            sort, "name COLLATE NOCASE"
        )
        total = conn.execute(cte + f"SELECT count(*) FROM {source} WHERE {where}", args).fetchone()[0]
        rows = conn.execute(
            cte + f"SELECT * FROM {source} WHERE {where} ORDER BY {order} {'DESC' if descending else 'ASC'}, path LIMIT ? OFFSET ?",
            args + [limit, offset],
        ).fetchall()
        summaries = conn.execute(f"SELECT workspace_id, files, bytes FROM inventory_totals WHERE {scope}", scope_args).fetchall()
        summary = {"files": sum(row["files"] for row in summaries), "bytes": sum(row["bytes"] for row in summaries)}
        if deduplicate:
            category_columns = ", ".join(f"sum(category='{key}') AS count_{key}, coalesce(sum(CASE WHEN category='{key}' THEN size_bytes ELSE 0 END),0) AS bytes_{key}" for key in LABELS)
            totals = conn.execute(cte + f"SELECT count(*) AS files, coalesce(sum(size_bytes),0) AS bytes, {category_columns} FROM unique_inventory WHERE kind='file'").fetchone()
            summary = {"files": totals["files"], "bytes": totals["bytes"]}

        # High speed: rows already contain file_count and size_bytes! No subqueries needed.
        items = [dict(row) for row in rows]
        for item in items:
            item.pop("membership_rank", None)
        # One bounded lookup supplies immediate-parent shares even for flat search
        # results across multiple locations. Folder rollups are already cached.
        parents = list({item["parent"] for item in items})
        parent_sizes = {}
        if parents:
            marks = ",".join("?" for _ in parents)
            parent_sizes = {(row["workspace_id"], row["path"]): row["size_bytes"] for row in conn.execute(
                f"SELECT workspace_id, path, size_bytes FROM inventory WHERE {scope} AND kind='folder' AND path IN ({marks})",
                scope_args + parents,
            ).fetchall()}
        root_sizes = {row["workspace_id"]: row["bytes"] for row in summaries}
        for item in items:
            item["parent_size_bytes"] = parent_sizes.get((item["workspace_id"], item["parent"]), root_sizes.get(item["workspace_id"], 0))
        category_rows = conn.execute(
            f"SELECT category, file_count, size_bytes FROM inventory_categories WHERE {scope}",
            scope_args,
        ).fetchall()
        if deduplicate:
            category_rows = [{"category": key, "file_count": totals[f"count_{key}"] or 0, "size_bytes": totals[f"bytes_{key}"]} for key in LABELS]
        categories = {}
        for row in category_rows:
            totals = categories.setdefault(row["category"], {"file_count": 0, "size_bytes": 0})
            totals["file_count"] += row["file_count"]
            totals["size_bytes"] += row["size_bytes"]
        category_bytes = sum(row["size_bytes"] for row in category_rows)
        breakdown = [{
            "category": key, "label": label,
            "file_count": categories[key]["file_count"] if key in categories else 0,
            "size_bytes": categories[key]["size_bytes"] if key in categories else 0,
            "percentage": 100 * categories[key]["size_bytes"] / category_bytes if key in categories and category_bytes else 0,
        } for key, label in LABELS.items()]
        parent_row = conn.execute(
            "SELECT size_bytes FROM inventory WHERE workspace_id=? AND path=? AND kind='folder'",
            (workspace_id, parent),
        ).fetchone() if parent else None
        parent_bytes = parent_row["size_bytes"] if parent_row else summary["bytes"]

        scans = conn.execute(f"SELECT * FROM inventory_scans WHERE {scope}", scope_args).fetchall()
        scan = next((row for row in scans if row["status"] == "scanning"), None) or next((row for row in scans if row["status"] != "completed"), None) or (scans[0] if scans else None)
        return {
            "items": items,
            "total": total,
            "files": summary["files"],
            "bytes": summary["bytes"],
            "parent_bytes": parent_bytes,
            "category_breakdown": breakdown,
            "scan_status": scan["status"] if scan else "not_scanned",
            "errors": [error for row in scans for error in json.loads(row["errors"])],
            "updated_at": max((row["updated_at"] for row in scans), default=None),
        }

    def search(
        self,
        query: str,
        workspace_id: Optional[str] = None,
        project_id: Optional[str] = None,
        limit: int = 25,
        file_type: Optional[str] = None,
        modified_after: Optional[float] = None,
    ) -> Any:
        from datetime import datetime, timezone

        from app.models.types import SearchResponse, SearchResultItem
        from app.services.file_parser import TEXT_EXTENSIONS, FileParser
        from app.services.document_reader import OFFICE_EXTENSIONS

        start = time.perf_counter()
        clauses = ["i.kind='file'", "w.is_active=1", "instr(lower(i.path),lower(?)) > 0"]
        args: List[Any] = [query.strip()]
        if workspace_id:
            clauses.append("i.workspace_id=?")
            args.append(workspace_id)
        if project_id:
            project = self.db.get_connection().execute("SELECT path FROM projects WHERE id=?", (project_id,)).fetchone()
            if not project:
                return SearchResponse(query=query, total_matches=0, results=[], duration_ms=0, search_mode="filename")
            prefix = project["path"] + os.sep
            clauses.append("substr(i.path,1,?)=?")
            args.extend([len(prefix), prefix])
        if modified_after is not None:
            clauses.append("i.mtime>=?")
            args.append(modified_after)

        def category(ext: str) -> str:
            return "document" if ext == ".pdf" else FileParser._categorize_extension(ext)

        supported = TEXT_EXTENSIONS | {".pdf"} | OFFICE_EXTENSIONS
        names = ("dockerfile", "makefile", "license", "readme")
        if file_type:
            extensions = sorted(e for e in supported if category(e) == file_type)
            marks = ",".join("?" for _ in extensions)
            if file_type == "other":
                clauses.append(
                    f"i.extension NOT IN ({','.join('?' for _ in supported)}) AND lower(i.name) NOT IN (?,?,?,?)"
                )
                args.extend(sorted(supported))
                args.extend(names)
            elif file_type == "text":
                clauses.append(f"(i.extension IN ({marks}) OR lower(i.name) IN (?,?,?,?))")
                args.extend(extensions)
                args.extend(names)
            elif extensions:
                clauses.append(f"i.extension IN ({marks})")
                args.extend(extensions)
            else:
                clauses.append("0")
        where = " AND ".join(clauses)
        conn = self.db.get_connection()
        total = conn.execute(
            f"SELECT count(DISTINCT i.path) FROM inventory i JOIN workspaces w ON w.id=i.workspace_id WHERE {where}",
            args,
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT i.*, w.path AS root FROM inventory i JOIN workspaces w ON w.id=i.workspace_id WHERE {where} GROUP BY i.path ORDER BY i.mtime DESC, i.path LIMIT ?",
            args + [limit],
        ).fetchall()
        results = []
        for row in rows:
            kind = category(row["extension"]) if FileParser.is_supported(Path(row["path"])) else "other"
            results.append(
                SearchResultItem(
                    file_id=row["path"],
                    path=row["path"],
                    filename=row["name"],
                    relative_path=str(Path(row["path"]).relative_to(row["root"])),
                    file_type=kind,
                    snippet=f"{row['size_bytes']:,} bytes / {row['extension'] or 'No extension'}",
                    score=1,
                    last_modified=datetime.fromtimestamp(row["mtime"], timezone.utc).isoformat(),
                )
            )
        return SearchResponse(
            query=query,
            total_matches=total,
            results=results,
            duration_ms=round((time.perf_counter() - start) * 1000, 2),
            search_mode="filename",
        )
