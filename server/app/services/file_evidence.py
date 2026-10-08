"""Metadata evidence for every permitted file and bounded folder summaries."""
import json
import mimetypes
import os
from pathlib import Path


def metadata(path: Path, reason: str) -> str:
    stat = path.stat()
    data = {'name': path.name, 'location': str(path.parent), 'extension': path.suffix.lower(), 'type': mimetypes.guess_type(path.name)[0] or 'Unknown file format', 'size_bytes': stat.st_size, 'modified_timestamp': stat.st_mtime, 'coverage': 'Metadata only. Contents were not read.', 'reason': reason, 'safety': 'Metadata cannot establish whether a file is safe to delete or execute.'}
    if os.name == 'nt' and path.suffix:
        # Read the registered association; never execute an association command.
        import winreg
        prog_id = None
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + path.suffix + '\\UserChoice') as key:
                prog_id = winreg.QueryValueEx(key, 'ProgId')[0]
        except OSError:
            try:
                with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, path.suffix) as key:
                    prog_id = winreg.QueryValueEx(key, '')[0]
            except OSError:
                pass
        if prog_id:
            data['windows_file_association'] = prog_id
    if path.suffix.lower() in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.ico'}:
        try:
            from PIL import Image
            with Image.open(path) as image:
                data.update(width=image.width, height=image.height, image_format=image.format)
        except Exception:
            pass
    if path.suffix.lower() in {'.mp3', '.wav', '.flac', '.ogg'}:
        from app.services.media_metadata import read_audio_metadata
        data['audio_tags'] = read_audio_metadata(path)
    return json.dumps(data, ensure_ascii=False, indent=2)


def folder_evidence(path: Path, allowed) -> str:
    # A shallow sample avoids traversing the user's entire disk or following links.
    entries, examined, total_bytes = [], 0, 0
    for child in path.iterdir():
        examined += 1
        if examined > 200:
            break
        try:
            child = allowed(str(child), require_file=False)
            stat = child.stat()
            is_folder = child.is_dir()
            entry = {'name': child.name, 'kind': 'folder' if is_folder else 'file', 'size_bytes': None if is_folder else stat.st_size}
            if is_folder:
                from app.database.local_db import get_db
                cached = get_db().get_connection().execute('SELECT MAX(i.size_bytes) AS bytes, MAX(s.updated_at) AS scanned_at FROM inventory i JOIN workspaces w ON w.id=i.workspace_id LEFT JOIN inventory_scans s ON s.workspace_id=i.workspace_id WHERE i.path=? AND w.is_active=1', (str(child),)).fetchone()
                if cached and cached['bytes'] is not None:
                    entry['cached_folder_bytes'] = cached['bytes']
                    entry['inventory_scan_timestamp'] = cached['scanned_at']
            entries.append(entry)
            if not is_folder:
                total_bytes += stat.st_size
        except (OSError, ValueError, PermissionError):
            continue
    entries.sort(key=lambda item: -(item.get('size_bytes') or item.get('cached_folder_bytes') or 0))
    return json.dumps({'folder': path.name, 'location': str(path), 'coverage': 'Folder listing only; child contents were not read. Cached nested folder sizes, when available, come from the inventory and may be stale. At most 200 direct entries examined; privacy exclusions omitted.', 'listed_file_bytes': total_bytes, 'sample_limited': examined > 200, 'entries': entries, 'safety': 'Do not recommend deleting files solely from their names or sizes.'}, ensure_ascii=False, indent=2)
