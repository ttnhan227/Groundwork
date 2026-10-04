"""Equivalent lexical paths must index under their canonical workspace."""
from app.core import config
from app.database.local_db import reset_db
from app.models.types import WorkspaceCreate
from app.services.indexer_service import IndexerService
from app.services.search_engine import SearchEngine
from app.services.workspace_service import WorkspaceService


def test_index_path_alias(tmp_path):
    config._settings = config.Settings(database_path=tmp_path / 'test.db', data_dir=tmp_path)
    (tmp_path / 'nested').mkdir()
    (tmp_path / 'needle.py').write_text('canonical_path_needle = 42\n')
    alias = tmp_path / 'nested' / '..' / 'needle.py'
    try:
        workspace = WorkspaceService().create_workspace(WorkspaceCreate(name='Aliases', path=str(tmp_path)))
        assert IndexerService.get_instance().index_single_file(alias, workspace.id)
        result = SearchEngine().search('canonical_path_needle', mode='lexical')
        assert result.total_matches == 1
        assert result.results[0].path == str(alias.resolve())
    finally:
        reset_db()
