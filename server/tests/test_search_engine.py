"""Tests for universal hybrid search engine, scoring, and ranking."""

import tempfile
from pathlib import Path

from app.models.types import WorkspaceCreate
from app.services.indexer_service import IndexerService
from app.services.search_engine import SearchEngine
from app.services.workspace_service import WorkspaceService


def test_hybrid_search_scoring_and_ranking():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        # Create mock project files
        proj_dir = root / "sample-project"
        proj_dir.mkdir()
        (proj_dir / "pyproject.toml").write_text("[project]\nname='sample-project'\n")
        (proj_dir / "README.md").write_text("# Sample Project\nProvides PostgreSQL migration utilities.\n")

        migration_file = proj_dir / "migration_v1.py"
        migration_file.write_text("""# PostgreSQL migration script
class DatabaseMigration:
    def apply_alembic_revision(self):
        print("Migrating PostgreSQL database schema with pgvector")
""")

        watcher_file = proj_dir / "watcher.py"
        watcher_file.write_text("""# Filesystem watcher
def handle_windows_events():
    print("Debounce duplicate filesystem events on Windows")
""")

        # Setup local test database
        db_path = root / "test_gw.db"
        from app.core import config
        config._settings = config.Settings(database_path=db_path, data_dir=root)

        ws_svc = WorkspaceService()
        ws = ws_svc.create_workspace(WorkspaceCreate(name="TestWS", path=str(root)))

        indexer = IndexerService.get_instance()
        # Index files synchronously
        file_paths = [migration_file, watcher_file, proj_dir / "README.md"]
        for fp in file_paths:
            indexer.index_single_file(fp, ws.id)

        searcher = SearchEngine()

        # Query 1: "PostgreSQL migration"
        res1 = searcher.search("PostgreSQL migration", mode="hybrid")
        assert res1.total_matches >= 1
        assert "migration" in res1.results[0].filename.lower() or "migration" in res1.results[0].snippet.lower()
        assert res1.results[0].score > 0
        assert "lexical" in res1.results[0].score_breakdown
        assert "semantic" in res1.results[0].score_breakdown

        # Query 2: "duplicate filesystem events"
        res2 = searcher.search("duplicate filesystem events", mode="hybrid")
        assert res2.total_matches >= 1
        assert res2.results[0].filename == "watcher.py"
        assert "duplicate" in res2.results[0].snippet.lower()

        from app.database.local_db import reset_db
        reset_db()
