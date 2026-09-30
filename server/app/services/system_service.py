"""Native operating system actions for Windows and cross-platform desktop integration.

Provides:
- Open file in default editor / OS handler
- Open folder in Windows Explorer
- Reveal file selected in Windows Explorer
- Validates path is within allowed workspaces before launching
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys

from app.core.security import validate_workspace_path
from app.services.workspace_service import WorkspaceService

logger = logging.getLogger("groundwork.system")


class SystemService:
    """Dispatches native desktop actions safely."""

    def __init__(self) -> None:
        self.workspace_service = WorkspaceService()

    def open_file(self, path_str: str) -> bool:
        """Opens a file using the operating system's default handler."""
        allowed_roots = self.workspace_service.get_allowed_roots()
        valid_path = validate_workspace_path(path_str, allowed_roots)

        if not valid_path.exists():
            raise FileNotFoundError(f"File not found: {valid_path}")

        try:
            if sys.platform == "win32":
                os.startfile(str(valid_path))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.run(["open", str(valid_path)], check=False)
            else:
                subprocess.run(["xdg-open", str(valid_path)], check=False)
            return True
        except Exception as exc:
            logger.warning("Failed to open file %s: %s", valid_path, exc)
            return False

    def open_folder(self, path_str: str) -> bool:
        """Opens a folder in the file manager."""
        allowed_roots = self.workspace_service.get_allowed_roots()
        valid_path = validate_workspace_path(path_str, allowed_roots)

        if not valid_path.exists():
            raise FileNotFoundError(f"Folder not found: {valid_path}")

        try:
            if sys.platform == "win32":
                subprocess.run(["explorer.exe", str(valid_path)], check=False)
            elif sys.platform == "darwin":
                subprocess.run(["open", str(valid_path)], check=False)
            else:
                subprocess.run(["xdg-open", str(valid_path)], check=False)
            return True
        except Exception as exc:
            logger.warning("Failed to open folder %s: %s", valid_path, exc)
            return False

    def reveal_in_explorer(self, path_str: str) -> bool:
        """Opens file manager with the specific file selected/highlighted."""
        allowed_roots = self.workspace_service.get_allowed_roots()
        valid_path = validate_workspace_path(path_str, allowed_roots)

        if not valid_path.exists():
            raise FileNotFoundError(f"File not found: {valid_path}")

        try:
            if sys.platform == "win32":
                # Windows Explorer /select,<path> highlights the item
                subprocess.run(["explorer.exe", f"/select,{valid_path}"], check=False)
            elif sys.platform == "darwin":
                subprocess.run(["open", "-R", str(valid_path)], check=False)
            else:
                subprocess.run(["xdg-open", str(valid_path.parent)], check=False)
            return True
        except Exception as exc:
            logger.warning("Failed to reveal file %s: %s", valid_path, exc)
            return False
