"""Validate and write public configuration for the packaged desktop engine."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def normalize_api_url(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Set DESKTOP_API_BASE_URL before building the installer (GitHub Repository Variables for CI).")
    parts = urlsplit(value)
    if not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("DESKTOP_API_BASE_URL must be an API address without credentials, query parameters, or a fragment.")
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1", "::1"}):
        raise ValueError("DESKTOP_API_BASE_URL must use HTTPS; HTTP is allowed only for local development.")
    path = parts.path.rstrip("/").removesuffix("/api/v1")
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


if __name__ == "__main__":
    destination = Path(__file__).resolve().parents[2] / "server/.packaging-build/desktop-config.json"
    url = normalize_api_url(os.environ.get("DESKTOP_API_BASE_URL", ""))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({"api_base_url": url}), encoding="utf-8")
    print("Desktop API configuration prepared.")
