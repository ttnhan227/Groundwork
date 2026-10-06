"""Explicit desktop actions; no shell command interpretation."""

import os
import shutil
import sys
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

from app.core.config import get_settings

APPS = {"applications": None, "calculator": "calc.exe", "notepad": "notepad.exe", "paint": "mspaint.exe"}


def health():
    import psutil

    battery = psutil.sensors_battery()
    memory = psutil.virtual_memory()
    drives = []
    for partition in psutil.disk_partitions():
        try:
            usage = shutil.disk_usage(partition.mountpoint)
            drives.append({"path": partition.mountpoint, "total": usage.total, "free": usage.free})
        except OSError:
            continue
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "memory_percent": memory.percent,
        "memory_used": memory.used,
        "memory_total": memory.total,
        "drives": drives,
        "battery": None if battery is None else {"percent": battery.percent, "plugged_in": battery.power_plugged},
    }


def perform(action, value):
    if action == "website":
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
            raise ValueError("Enter a website beginning with https:// or http:// without credentials")
        if not webbrowser.open(value):
            raise RuntimeError("Could not open browser")
        return {"success": True}
    if action == "app":
        if sys.platform != "win32" or value not in APPS:
            raise ValueError("Choose an available app")
        if value == "applications":
            os.startfile("shell:AppsFolder")
            return {"success": True}
        # Resolve trusted Windows binaries, never a file supplied by the caller.
        binary = Path(os.environ["WINDIR"]) / "System32" / APPS[value]
        import subprocess

        subprocess.Popen([str(binary)])
        return {"success": True}
    if action == "screenshot-open":
        import re

        root = (get_settings().data_dir / "screenshots").resolve()
        target = Path(value).resolve()
        if target.parent != root or not re.fullmatch(r"screen-[0-9a-f]{32}\.png", target.name) or not target.is_file():
            raise ValueError("Choose a screenshot saved by Groundwork")
        if sys.platform == "win32":
            os.startfile(str(target))
        else:
            import subprocess

            subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", str(target)], check=True)
        return {"success": True}
    if action == "screenshot":
        from PIL import ImageGrab

        directory = get_settings().data_dir / "screenshots"
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / f"screen-{uuid.uuid4().hex}.png"
        ImageGrab.grab(all_screens=True).save(destination)
        return {"success": True, "path": str(destination)}
    raise ValueError("Unknown desktop action")
