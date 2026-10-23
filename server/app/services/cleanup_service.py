"""Storage Analyzer, Cleanup Rules Scanner, and Confirmed File Removal Service.

Provides:
1. Drive & workspace storage overview (largest files, largest folders, category breakdown, proportional space map).
2. Rule-based cleanup candidate scanning (temp/log files, build/runtime caches, installers/archives, large stale files, and SHA-256 duplicates).
3. Token-confirmed, boundary-validated file/folder cleanup with truthful byte reclamation reporting.
"""

from __future__ import annotations

import ctypes
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

from app.core.file_categories import LABELS
from app.core.security import (
    consume_confirmation_token,
    generate_confirmation_token,
    validate_workspace_path,
)
from app.database.local_db import get_db
from app.services.duplicate_service import DuplicateService
from app.services.inventory_service import InventoryService
from app.services.storage_metadata import file_storage
from app.services.workspace_service import WorkspaceService

TEMP_LOG_EXTENSIONS = {
    ".tmp",
    ".temp",
    ".bak",
    ".old",
    ".orig",
    ".dmp",
    ".crash",
    ".swp",
    ".swo",
}
TEMP_FILENAMES = {"thumbs.db", ".ds_store", "desktop.ini"}
CACHE_DIR_NAMES = {
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".cache",
    ".parcel-cache",
    ".next",
    ".nuxt",
    ".turbo",
}
CACHE_FILE_EXTENSIONS = {".pyc", ".pyo"}
INSTALLER_ARCHIVE_EXTENSIONS = {
    ".msi",
    ".exe",
    ".iso",
    ".img",
    ".zip",
    ".7z",
    ".rar",
    ".tar",
    ".gz",
    ".tgz",
    ".xz",
}

# Critical system directories that must never be deleted under any mode
PROTECTED_WINDOWS_NAMES = {
    "windows",
    "system32",
    "syswow64",
    "program files",
    "program files (x86)",
    "programdata",
    "users",
    "recovery",
    "$recycle.bin",
    "system volume information",
}


def _is_protected_system_path(target: Path, allowed_roots: list[Path]) -> bool:
    """Returns True if target is a drive root, workspace root, user profile root, or OS directory."""
    resolved = target.resolve()
    # Never delete drive root (e.g. C:\)
    if resolved.parent == resolved:
        return True
    # Never delete an entire registered workspace root folder
    for root in allowed_roots:
        if resolved == root.resolve():
            return True
    # Never delete top-level protected Windows directories
    if len(resolved.parts) <= 2 and resolved.name.lower() in PROTECTED_WINDOWS_NAMES:
        return True
    # Never delete C:\Users\<username> root
    if len(resolved.parts) == 3 and resolved.parts[1].lower() == "users":
        return True
    return False


def _send_to_recycle_bin_windows(target: Path) -> bool:
    """Attempts to send a file or folder to the Windows Recycle Bin using SHFileOperationW."""
    if sys.platform != "win32":
        return False
    try:
        from ctypes import wintypes

        class SHFILEOPSTRUCTW(ctypes.Structure):
            _fields_ = [
                ("hwnd", wintypes.HWND),
                ("wFunc", wintypes.UINT),
                ("pFrom", wintypes.LPCWSTR),
                ("pTo", wintypes.LPCWSTR),
                ("fFlags", wintypes.WORD),
                ("fAnyOperationsAborted", wintypes.BOOL),
                ("hNameMappings", wintypes.LPVOID),
                ("lpszProgressTitle", wintypes.LPCWSTR),
            ]

        FO_DELETE = 3
        FOF_SILENT = 0x0004
        FOF_NOCONFIRMATION = 0x0010
        FOF_ALLOWUNDO = 0x0040
        FOF_NOERRORUI = 0x0400

        # pFrom must be double-null terminated
        from_buf = ctypes.create_unicode_buffer(str(target) + "\0\0")
        op = SHFILEOPSTRUCTW(
            hwnd=None,
            wFunc=FO_DELETE,
            pFrom=ctypes.cast(from_buf, wintypes.LPCWSTR),
            pTo=None,
            fFlags=FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT,
            fAnyOperationsAborted=False,
            hNameMappings=None,
            lpszProgressTitle=None,
        )
        res = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
        return res == 0 and not op.fAnyOperationsAborted and not target.exists()
    except Exception:
        return False


class CleanupService:
    """Provides storage overview, rule-based cleanup candidate discovery, and confirmed file removal."""

    def __init__(self) -> None:
        self.db = get_db()
        self.inventory = InventoryService()
        self.workspaces = WorkspaceService()

    def _active_workspaces(self, workspace_id: str | None = None) -> list[Any]:
        all_ws = [ws for ws in self.workspaces.list_workspaces() if ws.is_active]
        if workspace_id:
            return [ws for ws in all_ws if ws.id == workspace_id]
        return all_ws

    def _ensure_scanned(self, workspaces: list[Any]) -> None:
        conn = self.db.get_connection()
        for ws in workspaces:
            row = conn.execute(
                "SELECT status FROM inventory_scans WHERE workspace_id = ?",
                (ws.id,),
            ).fetchone()
            if not row:
                try:
                    self.inventory.scan(ws)
                except Exception:
                    continue

    def storage_overview(self, workspace_id: str | None = None, limit: int = 12) -> dict[str, Any]:
        """Returns comprehensive disk and workspace storage analytics."""
        active_ws = self._active_workspaces(workspace_id)
        self._ensure_scanned(active_ws)

        # 1. Drives overview
        drives = []
        try:
            import psutil

            seen_mounts = set()
            for part in psutil.disk_partitions():
                mount = part.mountpoint
                if mount in seen_mounts:
                    continue
                seen_mounts.add(mount)
                try:
                    usage = shutil.disk_usage(mount)
                except OSError:
                    continue
                used = max(0, usage.total - usage.free)
                pct = round((used / usage.total) * 100, 1) if usage.total > 0 else 0.0
                matching_ws = []
                for ws in active_ws:
                    try:
                        if Path(ws.path).resolve().drive.upper() == Path(mount).drive.upper():
                            matching_ws.append({"id": ws.id, "name": ws.name, "path": ws.path})
                    except Exception:
                        continue
                drives.append(
                    {
                        "path": mount,
                        "total_bytes": usage.total,
                        "used_bytes": used,
                        "free_bytes": usage.free,
                        "used_percent": pct,
                        "workspaces": matching_ws,
                    }
                )
        except Exception:
            pass

        conn = self.db.get_connection()
        ws_ids = [ws.id for ws in active_ws]
        if not ws_ids:
            return {
                "drives": drives,
                "workspaces": [],
                "total_files": 0,
                "total_bytes": 0,
                "category_breakdown": [],
                "largest_files": [],
                "largest_folders": [],
                "space_map": [],
            }

        placeholders = ",".join("?" for _ in ws_ids)

        # 2. Totals & Category breakdown
        totals_row = conn.execute(
            f"SELECT COUNT(*) as files, COALESCE(SUM(size_bytes), 0) as bytes "
            f"FROM inventory WHERE workspace_id IN ({placeholders}) AND kind = 'file'",
            ws_ids,
        ).fetchone()
        total_files = int(totals_row["files"] or 0)
        total_bytes = int(totals_row["bytes"] or 0)

        cat_rows = conn.execute(
            f"SELECT category, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as bytes "
            f"FROM inventory WHERE workspace_id IN ({placeholders}) AND kind = 'file' "
            f"GROUP BY category ORDER BY bytes DESC",
            ws_ids,
        ).fetchall()
        category_breakdown = [
            {
                "key": r["category"],
                "label": LABELS.get(r["category"], "Other"),
                "files": int(r["count"]),
                "bytes": int(r["bytes"]),
                "percent": round((int(r["bytes"]) / total_bytes) * 100, 1) if total_bytes > 0 else 0.0,
            }
            for r in cat_rows
            if r["count"]
        ]

        # 3. Largest files with physical allocation check on top items
        file_rows = conn.execute(
            f"SELECT workspace_id, path, name, parent, extension, category, size_bytes, mtime "
            f"FROM inventory WHERE workspace_id IN ({placeholders}) AND kind = 'file' "
            f"ORDER BY size_bytes DESC, name ASC LIMIT ?",
            [*ws_ids, max(1, min(limit, 50))],
        ).fetchall()

        largest_files = []
        for idx, r in enumerate(file_rows):
            item = dict(r)
            item["share_percent"] = round((int(item["size_bytes"]) / total_bytes) * 100, 1) if total_bytes > 0 else 0.0
            if idx < 8:
                try:
                    storage_info = file_storage(Path(item["path"]))
                    item["allocated_bytes"] = storage_info.get("allocated_bytes")
                    item["allocation_note"] = storage_info.get("allocation_note", "")
                except Exception:
                    item["allocated_bytes"] = None
                    item["allocation_note"] = ""
            largest_files.append(item)

        # 4. Largest folders using rolled-up folder sizes in SQLite inventory
        folder_rows = conn.execute(
            f"SELECT workspace_id, path, name, parent, size_bytes, file_count, mtime "
            f"FROM inventory WHERE workspace_id IN ({placeholders}) AND kind = 'folder' AND size_bytes > 0 "
            f"ORDER BY size_bytes DESC, name ASC LIMIT ?",
            [*ws_ids, max(1, min(limit, 50))],
        ).fetchall()

        largest_folders = []
        for r in folder_rows:
            d = dict(r)
            d["size_bytes"] = int(d["size_bytes"] or 0)
            d["file_count"] = int(d["file_count"] or 0)
            d["share_percent"] = round((d["size_bytes"] / total_bytes) * 100, 1) if total_bytes > 0 else 0.0
            largest_folders.append(d)

        # 5. Proportional Space Map (Top-level children of active workspaces)
        ws_root_paths = {str(Path(ws.path).resolve()): ws for ws in active_ws}
        space_map = []
        for root_str, ws in ws_root_paths.items():
            top_items = conn.execute(
                "SELECT workspace_id, path, name, kind, category, size_bytes, file_count, mtime "
                "FROM inventory WHERE workspace_id = ? AND parent = ?",
                (ws.id, root_str),
            ).fetchall()
            for r in top_items:
                d = dict(r)
                d["size_bytes"] = int(d["size_bytes"] or 0)
                d["file_count"] = int(d["file_count"] or 0) if d["kind"] == "folder" else 1
                if d["size_bytes"] > 0:
                    d["share_percent"] = round((d["size_bytes"] / total_bytes) * 100, 1) if total_bytes > 0 else 0.0
                    space_map.append(d)

        space_map.sort(key=lambda x: (-x["size_bytes"], x["name"].lower()))
        space_map = space_map[:24]

        # 6. Per-workspace summary
        ws_summaries = []
        for ws in active_ws:
            ws_row = conn.execute(
                "SELECT COUNT(*) as files, COALESCE(SUM(size_bytes), 0) as bytes "
                "FROM inventory WHERE workspace_id = ? AND kind = 'file'",
                (ws.id,),
            ).fetchone()
            scan_row = conn.execute(
                "SELECT status FROM inventory_scans WHERE workspace_id = ?",
                (ws.id,),
            ).fetchone()
            ws_summaries.append(
                {
                    "id": ws.id,
                    "name": ws.name,
                    "path": ws.path,
                    "files": int(ws_row["files"] or 0),
                    "bytes": int(ws_row["bytes"] or 0),
                    "scan_status": scan_row["status"] if scan_row else "completed",
                }
            )

        return {
            "drives": drives,
            "workspaces": ws_summaries,
            "total_files": total_files,
            "total_bytes": total_bytes,
            "category_breakdown": category_breakdown,
            "largest_files": largest_files,
            "largest_folders": largest_folders,
            "space_map": space_map,
        }

    def scan_cleanup_candidates(
        self,
        workspace_id: str | None = None,
        stale_days: int = 60,
        min_large_bytes: int = 25 * 1024 * 1024,
        min_archive_bytes: int = 5 * 1024 * 1024,
    ) -> dict[str, Any]:
        """Scans active workspaces using transparent, non-destructive cleanup rules."""
        active_ws = self._active_workspaces(workspace_id)
        self._ensure_scanned(active_ws)

        ws_ids = [ws.id for ws in active_ws]
        if not ws_ids:
            return {
                "rules": [],
                "total_candidates": 0,
                "total_reclaimable_bytes": 0,
                "scanned_workspaces": 0,
                "safety_notice": "No files are ever deleted automatically. Review each item and confirm before removal.",
            }

        conn = self.db.get_connection()
        placeholders = ",".join("?" for _ in ws_ids)
        rows = conn.execute(
            f"SELECT workspace_id, path, name, parent, extension, category, size_bytes, mtime "
            f"FROM inventory WHERE workspace_id IN ({placeholders}) AND kind = 'file' "
            f"ORDER BY size_bytes DESC",
            ws_ids,
        ).fetchall()

        now = time.time()
        stale_cutoff = now - max(1, stale_days) * 86400

        temp_items: list[dict[str, Any]] = []
        cache_items: list[dict[str, Any]] = []
        installer_items: list[dict[str, Any]] = []
        stale_items: list[dict[str, Any]] = []

        for r in rows:
            path_str = r["path"]
            name_lower = r["name"].lower()
            ext = (r["extension"] or "").lower()
            size = int(r["size_bytes"] or 0)
            mtime = float(r["mtime"] or 0)
            age_days = max(0, int((now - mtime) / 86400)) if mtime > 0 else 0
            path_parts_lower = {part.lower() for part in Path(path_str).parts}

            # Rule 1: Temp, Log & Backup files
            if (
                ext in TEMP_LOG_EXTENSIONS
                or name_lower in TEMP_FILENAMES
                or name_lower.endswith("~")
                or (ext == ".log" and size >= 256 * 1024)
            ):
                reason = (
                    f"Log file ({ext}, {age_days}d old)"
                    if ext == ".log"
                    else f"Temporary or backup artifact ({ext or name_lower})"
                )
                temp_items.append(
                    {
                        "path": path_str,
                        "name": r["name"],
                        "parent": r["parent"],
                        "size_bytes": size,
                        "mtime": mtime,
                        "age_days": age_days,
                        "rule_id": "temp_and_logs",
                        "confidence": "high",
                        "reason": reason,
                    }
                )

            # Rule 2: Build, Package & Runtime Caches
            matched_cache_dir = next((c for c in CACHE_DIR_NAMES if c in path_parts_lower), None)
            if matched_cache_dir or ext in CACHE_FILE_EXTENSIONS:
                reason = (
                    f"Inside cache/build directory '{matched_cache_dir}'"
                    if matched_cache_dir
                    else f"Compiled bytecode cache file ({ext})"
                )
                cache_items.append(
                    {
                        "path": path_str,
                        "name": r["name"],
                        "parent": r["parent"],
                        "size_bytes": size,
                        "mtime": mtime,
                        "age_days": age_days,
                        "rule_id": "cache_and_build",
                        "confidence": "high",
                        "reason": reason,
                    }
                )

            # Rule 3: Installers & Archives
            if ext in INSTALLER_ARCHIVE_EXTENSIONS and size >= min_archive_bytes:
                in_downloads = "downloads" in path_parts_lower
                reason = (
                    f"{'Downloaded installer/archive' if in_downloads else 'Installer or archive package'} "
                    f"({ext}, modified {age_days}d ago)"
                )
                installer_items.append(
                    {
                        "path": path_str,
                        "name": r["name"],
                        "parent": r["parent"],
                        "size_bytes": size,
                        "mtime": mtime,
                        "age_days": age_days,
                        "rule_id": "installers_and_archives",
                        "confidence": "review_required",
                        "reason": reason,
                    }
                )

            # Rule 4: Large Stale Files
            if size >= min_large_bytes and (mtime <= stale_cutoff or stale_days == 0):
                stale_items.append(
                    {
                        "path": path_str,
                        "name": r["name"],
                        "parent": r["parent"],
                        "size_bytes": size,
                        "mtime": mtime,
                        "age_days": age_days,
                        "rule_id": "large_stale_files",
                        "confidence": "review_required",
                        "reason": f"Large file untouched for {age_days} days",
                    }
                )

        # Rule 5: Exact SHA-256 Duplicates
        dup_report = DuplicateService().find_duplicates(workspace_id)
        duplicate_items: list[dict[str, Any]] = []
        for group in dup_report.get("exact_duplicates", []):
            files = group.get("files", [])
            if len(files) < 2:
                continue
            # Sort so oldest mtime or shortest path is kept as primary reference
            sorted_files = sorted(files, key=lambda f: (f.get("mtime", 0), len(f.get("path", ""))))
            kept = sorted_files[0]
            for extra in sorted_files[1:]:
                mtime = float(extra.get("mtime") or 0)
                age_days = max(0, int((now - mtime) / 86400)) if mtime > 0 else 0
                duplicate_items.append(
                    {
                        "path": extra["path"],
                        "name": extra["name"],
                        "parent": str(Path(extra["path"]).parent),
                        "size_bytes": int(extra["size_bytes"]),
                        "mtime": mtime,
                        "age_days": age_days,
                        "rule_id": "exact_duplicates",
                        "confidence": "high",
                        "sha256": group["sha256"],
                        "kept_reference_path": kept["path"],
                        "reason": f"Identical SHA-256 content to '{kept['name']}' ({kept['path']})",
                    }
                )

        rules = [
            {
                "id": "exact_duplicates",
                "name": "Exact Duplicate Files (SHA-256)",
                "description": "Redundant copies with identical byte-for-byte SHA-256 content hashes. One primary copy in each group is preserved.",
                "risk_level": "low",
                "candidate_count": len(duplicate_items),
                "reclaimable_bytes": sum(i["size_bytes"] for i in duplicate_items),
                "items": duplicate_items[:100],
            },
            {
                "id": "temp_and_logs",
                "name": "Temporary, Log & Backup Files",
                "description": "Scratch files (.tmp, .bak, .old, .dmp) and large log files that are safe to review for cleanup.",
                "risk_level": "low",
                "candidate_count": len(temp_items),
                "reclaimable_bytes": sum(i["size_bytes"] for i in temp_items),
                "items": temp_items[:100],
            },
            {
                "id": "cache_and_build",
                "name": "Build, Package & Runtime Caches",
                "description": "Generated cache files (__pycache__, .pytest_cache, .cache, .pyc) that tools recreate automatically.",
                "risk_level": "low",
                "candidate_count": len(cache_items),
                "reclaimable_bytes": sum(i["size_bytes"] for i in cache_items),
                "items": cache_items[:100],
            },
            {
                "id": "installers_and_archives",
                "name": "Installers & Compressed Archives",
                "description": "Setup packages (.exe, .msi, .iso) and large archives (.zip, .7z, .rar) that may no longer be needed after installation or extraction.",
                "risk_level": "medium",
                "candidate_count": len(installer_items),
                "reclaimable_bytes": sum(i["size_bytes"] for i in installer_items),
                "items": installer_items[:100],
            },
            {
                "id": "large_stale_files",
                "name": f"Large Untouched Files (>{max(1, min_large_bytes // (1024 * 1024))} MB, >{stale_days}d old)",
                "description": "High-capacity files that have not been modified recently. Always verify before removing.",
                "risk_level": "medium",
                "candidate_count": len(stale_items),
                "reclaimable_bytes": sum(i["size_bytes"] for i in stale_items),
                "items": stale_items[:100],
            },
        ]

        # Deduplicate across rules for accurate total reclaimable bytes
        unique_paths: dict[str, int] = {}
        for rule in rules:
            for item in rule["items"]:
                unique_paths[item["path"]] = item["size_bytes"]

        return {
            "rules": rules,
            "total_candidates": len(unique_paths),
            "total_reclaimable_bytes": sum(unique_paths.values()),
            "scanned_workspaces": len(active_ws),
            "safety_notice": "No files are ever deleted automatically. Review each item and confirm before removal.",
        }

    def _validate_cleanup_target(self, path_str: str, extra_allowed_roots: list[Path] | None = None) -> Path:
        allowed_roots = [Path(r).resolve() for r in self.workspaces.get_allowed_roots()]
        if extra_allowed_roots:
            allowed_roots.extend(r.resolve() for r in extra_allowed_roots)
        if not allowed_roots:
            raise PermissionError("No allowed workspace folders are configured.")
        target = validate_workspace_path(path_str, allowed_roots)
        if _is_protected_system_path(target, allowed_roots):
            raise PermissionError(f"Refusing to delete protected root or system path: '{path_str}'.")
        return target

    def propose_cleanup(
        self,
        paths: list[str],
        mode: str = "recycle",
        extra_allowed_roots: list[Path] | None = None,
    ) -> dict[str, Any]:
        """Validates candidate paths and issues an expiring confirmation token for deletion."""
        if mode not in {"recycle", "permanent"}:
            raise ValueError("Cleanup mode must be 'recycle' or 'permanent'.")
        deduped = list(dict.fromkeys(p.strip() for p in paths if p and p.strip()))
        if not deduped:
            raise ValueError("Select at least one file or folder to clean up.")
        if len(deduped) > 200:
            raise ValueError("Choose up to 200 items per cleanup batch.")

        valid_items: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []
        total_bytes = 0

        for raw_path in deduped:
            try:
                target = self._validate_cleanup_target(raw_path, extra_allowed_roots)
                if not target.exists():
                    skipped.append({"path": raw_path, "reason": "Item no longer exists on disk."})
                    continue
                if target.is_dir():
                    size = sum(f.stat().st_size for f in target.rglob("*") if f.is_file())
                    kind = "folder"
                else:
                    size = target.stat().st_size
                    kind = "file"
                total_bytes += size
                valid_items.append(
                    {
                        "path": str(target),
                        "name": target.name,
                        "kind": kind,
                        "size_bytes": size,
                    }
                )
            except (PermissionError, ValueError, OSError) as exc:
                skipped.append({"path": raw_path, "reason": str(exc)})

        if not valid_items:
            reasons = "; ".join(s["reason"] for s in skipped[:3]) or "No accessible items found."
            raise ValueError(f"None of the selected items can be removed: {reasons}")

        proposal = {
            "action": "cleanup-delete",
            "mode": mode,
            "paths": [item["path"] for item in valid_items],
            "total_bytes": total_bytes,
            "item_count": len(valid_items),
        }
        token = generate_confirmation_token("cleanup-delete", proposal)
        return {
            "proposal": proposal,
            "items": valid_items,
            "skipped": skipped,
            "total_bytes": total_bytes,
            "item_count": len(valid_items),
            "confirmation_token": token,
            "warning": (
                "Selected items will be moved to the Windows Recycle Bin (or permanently removed if Recycle Bin is unavailable for that drive)."
                if mode == "recycle"
                else "Selected items will be permanently deleted from disk and cannot be undone."
            ),
        }

    def execute_cleanup(
        self,
        proposal: dict[str, Any],
        confirmation_token: str,
        extra_allowed_roots: list[Path] | None = None,
    ) -> dict[str, Any]:
        """Executes a user-confirmed cleanup proposal and updates local inventory."""
        receipt = consume_confirmation_token(confirmation_token)
        if not receipt or receipt.get("action_type") != "cleanup-delete" or receipt.get("details") != proposal:
            raise PermissionError("Cleanup confirmation expired or does not match the proposed items. Please review and confirm again.")

        mode = proposal.get("mode", "recycle")
        paths: list[str] = proposal.get("paths", [])
        removed: list[dict[str, Any]] = []
        failed: list[dict[str, str]] = []
        skipped: list[dict[str, str]] = []
        bytes_reclaimed = 0

        conn = self.db.get_connection()

        for raw_path in paths:
            try:
                target = self._validate_cleanup_target(raw_path, extra_allowed_roots)
                if not target.exists():
                    skipped.append({"path": raw_path, "reason": "Already removed"})
                    continue
                is_dir = target.is_dir()
                size = (
                    sum(f.stat().st_size for f in target.rglob("*") if f.is_file())
                    if is_dir
                    else target.stat().st_size
                )

                used_method = mode
                if mode == "recycle":
                    recycled = _send_to_recycle_bin_windows(target)
                    if not recycled:
                        # Fallback to direct unlink/rmtree if Recycle Bin is unavailable (e.g. temp mount / non-Win32)
                        if is_dir:
                            shutil.rmtree(target)
                        else:
                            target.unlink()
                        used_method = "permanent_fallback"
                else:
                    if is_dir:
                        shutil.rmtree(target)
                    else:
                        target.unlink()

                bytes_reclaimed += size
                removed.append(
                    {
                        "path": str(target),
                        "name": target.name,
                        "kind": "folder" if is_dir else "file",
                        "size_bytes": size,
                        "method": used_method,
                    }
                )

                # Synchronize SQLite inventory and files tables immediately
                if is_dir:
                    prefix = str(target) + os.sep
                    conn.execute("DELETE FROM inventory WHERE path = ? OR path LIKE ?", (str(target), prefix + "%"))
                    conn.execute("DELETE FROM files WHERE path = ? OR path LIKE ?", (str(target), prefix + "%"))
                else:
                    conn.execute("DELETE FROM inventory WHERE path = ?", (str(target),))
                    conn.execute("DELETE FROM files WHERE path = ?", (str(target),))
            except Exception as exc:
                failed.append({"path": raw_path, "reason": str(exc)})

        conn.commit()
        for ws in self._active_workspaces():
            try:
                self.inventory.refresh_folder_sizes(ws.id)
                self.inventory.refresh_totals(ws.id)
            except Exception:
                continue

        return {
            "status": "completed" if not failed else ("partial" if removed else "failed"),
            "mode": mode,
            "removed": removed,
            "failed": failed,
            "skipped": skipped,
            "removed_count": len(removed),
            "bytes_reclaimed": bytes_reclaimed,
        }
