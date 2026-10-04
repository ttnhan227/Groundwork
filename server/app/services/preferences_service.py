"""Private per-user provider preferences. Credentials never enter the sync database."""
from __future__ import annotations

import base64
import ctypes
import json
import os
import sys
from urllib.parse import urlparse

from app.core.config import get_settings

ALLOWED = {"ai_provider", "ollama_base_url", "ollama_model", "openai_model", "gemini_model", "openai_api_key", "gemini_api_key", "cloud_sync_enabled", "cloud_sync_url", "cloud_sync_token"}
SECRETS = {"openai_api_key", "gemini_api_key", "cloud_sync_token"}


def validate_url(value: str, local_only: bool = False) -> str:
    parsed = urlparse(value)
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.username or parsed.password or not parsed.hostname or parsed.scheme not in {"http", "https"} or (parsed.scheme != "https" and not loopback) or (local_only and not loopback):
        raise ValueError("Use HTTPS for cloud services and a loopback address for local services")
    return value.rstrip("/")


def _protect(data: bytes, decrypt: bool = False) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("Private preference persistence requires Windows; configure development providers through the environment")
    class Blob(ctypes.Structure):
        _fields_ = [("size", ctypes.c_uint32), ("data", ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    function = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise OSError("Windows could not protect provider preferences")
    ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    ctypes.windll.kernel32.LocalFree.restype = ctypes.c_void_p
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


class PreferencesService:
    def __init__(self):
        self.settings = get_settings()
        self.path = self.settings.get_database_path().parent / "preferences.dat"

    def load(self):
        if not self.path.exists():
            return
        data = json.loads(_protect(base64.b64decode(self.path.read_bytes()), decrypt=True))
        if data.get("gemini_model") == "gemini-1.5-flash":
            data["gemini_model"] = "gemini-3.8-flash"
        for key, value in data.items():
            if key in ALLOWED:
                setattr(self.settings, key, value)

    def update(self, values: dict):
        if set(values) - ALLOWED:
            raise ValueError("Unknown preference")
        for key in {"cloud_sync_url", "ollama_base_url"}.intersection(values):
            values[key] = validate_url(values[key], local_only=key == "ollama_base_url")
        snapshot = {key: values.get(key, getattr(self.settings, key)) for key in ALLOWED}
        encrypted = base64.b64encode(_protect(json.dumps(snapshot).encode()))
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(encrypted)
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.path)
        for key, value in values.items():
            setattr(self.settings, key, value)
        return self.public()

    def public(self):
        data = {key: getattr(self.settings, key) for key in ALLOWED - SECRETS}
        data.update({f"{key}_configured": bool(getattr(self.settings, key)) for key in SECRETS})
        return data
