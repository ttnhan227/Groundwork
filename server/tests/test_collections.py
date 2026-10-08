import json
import uuid
import pytest
from app.core import config
from app.database.local_db import reset_db, get_db, LocalDatabase, SCHEMA_VERSION
from app.models.types import AIQueryRequest, WorkspaceCreate
from app.services.workspace_service import WorkspaceService
from app.services.indexer_service import IndexerService
from app.services.collection_service import CollectionService, CollectionInput, CollectionConflict
from app.services.ai.context_engine import AIContextEngine


@pytest.fixture
def documents(tmp_path, monkeypatch):
    reset_db()
    monkeypatch.setattr(config, '_settings', config.Settings(database_path=tmp_path/'state.db', data_dir=tmp_path, ai_provider='local'))
    root = tmp_path/'documents'
    root.mkdir()
    WorkspaceService().create_workspace(WorkspaceCreate(name='Documents', path=str(root)))
    yield root
    reset_db()


def save(paths, title='Launch'):
    return CollectionService().save(uuid.uuid4().hex, CollectionInput(title=title, members=[{'path': str(p)} for p in paths]))


def test_membership_is_virtual_multiple_and_deduplicated(documents):
    path = documents/'plan.md'
    path.write_text('Launch deadline November 25.', encoding='utf-8')
    before = (path.read_bytes(), path.stat().st_mtime_ns)
    first = save([path, path])
    second = save([path], 'Applications')
    assert len(first['members']) == 1
    assert len(CollectionService().list()) == 2
    CollectionService().delete(first['id'], first['revision'])
    assert CollectionService().get(second['id'])['members'][0]['available']
    assert (path.read_bytes(), path.stat().st_mtime_ns) == before


def test_revisions_prevent_lost_updates_and_duplicate_saves(documents):
    collection = save([])
    with pytest.raises(CollectionConflict):
        CollectionService().save(collection['id'], CollectionInput(title='Duplicate', revision=0))
    changed = CollectionService().save(collection['id'], CollectionInput(title='Updated', revision=1))
    with pytest.raises(CollectionConflict):
        CollectionService().delete(changed['id'], 1)
    assert CollectionService().get(collection['id'])['title'] == 'Updated'


def test_missing_members_remain_visible_and_can_be_removed(documents):
    path = documents/'plan.md'
    path.write_text('Plan')
    collection = save([path])
    path.unlink()
    updated = CollectionService().get(collection['id'])
    assert not updated['members'][0]['available']
    retained = CollectionService().save(collection['id'], CollectionInput(title='Renamed', revision=1, members=updated['members']))
    assert len(retained['members']) == 1
    removed = CollectionService().save(collection['id'], CollectionInput(title='Renamed', revision=2, members=[]))
    assert not removed['members']


def test_unregistered_and_ignored_paths_never_reach_provider(documents, monkeypatch):
    from app.services import collection_service
    secret = documents/'.env'
    secret.write_text('TOKEN=private')
    outside = documents.parent/'outside.md'
    outside.write_text('private')
    monkeypatch.setattr(collection_service, 'get_llm_provider', lambda *_: pytest.fail('Private paths reached provider'))
    for path in (secret, outside):
        with pytest.raises((ValueError, PermissionError)):
            save([path])
        with pytest.raises((ValueError, PermissionError)):
            CollectionService().suggest([str(path)], 'builtin')


def test_proposals_are_review_only_and_reject_unknown_ids(documents, monkeypatch):
    from app.services import collection_service
    path = documents/'plan.md'
    path.write_text('Launch deadline November 25.', encoding='utf-8')
    class Provider:
        response = {'groups': [{'title': 'Launch planning', 'members': [{'id': '0', 'reason': 'Contains a launch deadline'}]}]}
        def generate_structured(self, prompt, system, schema):
            assert 'Launch deadline November 25' in prompt
            assert 'untrusted' in system
            return json.dumps(self.response)
    provider = Provider()
    monkeypatch.setattr(collection_service, 'get_llm_provider', lambda *_: provider)
    result = CollectionService().suggest([str(path)], 'builtin')
    assert result['groups'][0]['members'][0]['path'] == str(path)
    assert CollectionService().list() == []
    provider.response['groups'][0]['members'][0]['id'] = '../../outside'
    with pytest.raises(ValueError, match='invalid collection'):
        CollectionService().suggest([str(path)], 'builtin')
    assert CollectionService().list() == []


def test_collection_question_never_falls_back_to_other_locations(documents):
    inside = documents/'plan.md'
    inside.write_text('Launch deadline November 25.', encoding='utf-8')
    outside = documents/'unrelated.md'
    outside.write_text('Launch deadline December 30. Secret project.', encoding='utf-8')
    workspace = WorkspaceService().list_workspaces()[0]
    IndexerService().index_workspace_sync(workspace.id)
    collection = save([inside])
    result = AIContextEngine().query(AIQueryRequest(question='What is the launch deadline?', collection_id=collection['id'], search_workspace=True, provider='local'))
    assert [c.path for c in result.citations] == [str(inside)]
    assert 'December 30' not in result.answer
    empty = save([])
    result = AIContextEngine().query(AIQueryRequest(question='launch', collection_id=empty['id'], search_workspace=True))
    assert result.evidence_count == 0
    with pytest.raises(ValueError, match='not available'):
        AIContextEngine().query(AIQueryRequest(question='launch', collection_id=collection['id'], file_paths=[str(outside)]))


def test_v1_upgrade_preserves_existing_data_and_backs_up(tmp_path):
    path = tmp_path/'old.db'
    database = LocalDatabase(path)
    with database.get_connection() as conn:
        conn.execute('DROP TABLE file_collections')
        conn.execute('PRAGMA user_version = 1')
    database.close()
    upgraded = LocalDatabase(path)
    assert upgraded.get_connection().execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
    assert path.with_name('old.db.schema-v1.bak').exists()
    assert upgraded.get_connection().execute('SELECT count(*) FROM file_collections').fetchone()[0] == 0
    upgraded.close()
