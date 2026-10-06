"""Validate and write public configuration for the packaged desktop engine."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def normalize_api_url(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Set DESKTOP_API_BASE_URL in the root .env or terminal (GitHub Repository Variables for CI).")
    parts = urlsplit(value)
    if not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("DESKTOP_API_BASE_URL must be an API address without credentials, query parameters, or a fragment.")
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in {"localhost", "127.0.0.1", "::1"}):
        raise ValueError("DESKTOP_API_BASE_URL must use HTTPS; HTTP is allowed only for local development.")
    path = parts.path.rstrip("/").removesuffix("/api/v1")
    if os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("GROUNDWORK_RELEASE_BUILD") == "1":
        if parts.scheme != "https" or parts.hostname in {"localhost", "127.0.0.1", "::1", "0.0.0.0"} or parts.hostname.endswith(".localhost"):
            raise ValueError("Release builds require an HTTPS backend address that is reachable by users, not localhost.")
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def read_api_url(root: Path) -> str:
    # Explicit build settings take precedence; never load local secrets into CI.
    if "DESKTOP_API_BASE_URL" in os.environ:
        return normalize_api_url(os.environ["DESKTOP_API_BASE_URL"])
    if os.environ.get("GITHUB_ACTIONS") == "true":
        return normalize_api_url("")
    from dotenv import dotenv_values
    values = dotenv_values(root / ".env", interpolate=False)
    return normalize_api_url(values.get("DESKTOP_API_BASE_URL") or "")


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    destination = root / "server/.packaging-build/desktop-config.json"
    url = read_api_url(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({"api_base_url": url}), encoding="utf-8")
    print("Desktop API configuration prepared.")
