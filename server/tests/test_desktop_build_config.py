"""Installer configuration must be explicit and safe to ship publicly."""
import runpy
from pathlib import Path

import pytest

normalize = runpy.run_path(str(Path(__file__).resolve().parents[2] / "desktop/scripts/prepare-desktop-config.py"))["normalize_api_url"]


def test_normalizes_root_and_api_prefix():
    assert normalize(" https://accounts.example.com/api/v1/ ") == "https://accounts.example.com"
    assert normalize("http://localhost:8080/") == "http://localhost:8080"


@pytest.mark.parametrize("value", ["", "http://accounts.example.com", "https://user:password@accounts.example.com", "https://accounts.example.com?key=secret", "https://accounts.example.com#fragment", "not-a-url"])
def test_rejects_missing_or_unsafe_build_configuration(value):
    with pytest.raises(ValueError):
        normalize(value)
