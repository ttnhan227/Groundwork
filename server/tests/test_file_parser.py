"""Tests for multi-format file parser, AST symbol extraction, and chunking."""

import tempfile
from pathlib import Path

from app.services.file_parser import FileParser


def test_python_ast_symbol_extraction():
    code = '''"""Module docstring."""
import os
from typing import List

class SearchController:
    def __init__(self, engine):
        self.engine = engine

    async def execute_query(self, query: str) -> List[str]:
        return []
'''
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(code)
        f_path = Path(f.name)

    try:
        res = FileParser.parse_file(f_path)
        assert res.file_type == "code"
        assert not res.is_binary
        assert len(res.chunks) >= 1

        symbol_names = [s.name for s in res.symbols]
        assert "SearchController" in symbol_names
        assert "__init__" in symbol_names
        assert "execute_query" in symbol_names
        assert "os" in symbol_names
    finally:
        f_path.unlink()


def test_typescript_symbol_extraction_and_chunking():
    ts_code = '''export interface WorkspaceConfig {
  path: string;
  name: string;
}

export async function initializeDesktopApp(): Promise<void> {
  console.log("Starting Groundwork desktop");
}

export class AppState {
  private activeProject: string | null = null;
}
'''
    with tempfile.NamedTemporaryFile("w", suffix=".ts", delete=False) as f:
        f.write(ts_code)
        f_path = Path(f.name)

    try:
        res = FileParser.parse_file(f_path)
        assert res.file_type == "code"
        symbol_names = [s.name for s in res.symbols]
        assert "WorkspaceConfig" in symbol_names
        assert "initializeDesktopApp" in symbol_names
        assert "AppState" in symbol_names

        # Verify line indexes
        assert res.chunks[0].line_start == 1
        assert res.chunks[0].line_end >= 10
    finally:
        f_path.unlink()


def test_binary_file_detection():
    with tempfile.NamedTemporaryFile("wb", suffix=".bin", delete=False) as f:
        f.write(b"\x00\x01\x02\x03\xff\xfe")
        f_path = Path(f.name)

    try:
        res = FileParser.parse_file(f_path)
        assert res.is_binary
    finally:
        f_path.unlink()
