import pytest
from app.core import config
from app.database.local_db import reset_db
from app.models.types import AIQueryRequest, WorkspaceCreate
from app.services.ai.context_engine import AIContextEngine
from app.services.indexer_service import IndexerService
from app.services.workspace_service import WorkspaceService

@pytest.fixture
def workspace(tmp_path, monkeypatch):
    reset_db()
    monkeypatch.setattr(config, '_settings', config.Settings(database_path=tmp_path/'state.db', data_dir=tmp_path, ai_provider='local'))
    root=tmp_path/'documents';root.mkdir()
    yield root
    reset_db()

def add(root):
    ws=WorkspaceService().create_workspace(WorkspaceCreate(name='Documents',path=str(root)))
    IndexerService().index_workspace_sync(ws.id)
    return ws

def test_question_finds_relevant_document_without_manual_selection(workspace):
    doc=workspace/'launch.md';doc.write_text('Launch deadline: November 18.\nOwner: Design team.\n',encoding='utf-8')
    (workspace/'garden.md').write_text('Flowers grow in the garden.\n',encoding='utf-8')
    add(workspace)
    result=AIContextEngine().query(AIQueryRequest(question='What is the launch deadline?',search_workspace=True,provider='local'))
    assert [c.path for c in result.citations]==[str(doc)]
    assert 'November 18' in result.answer

def test_no_evidence_does_not_call_model(workspace,monkeypatch):
    from app.services.ai import context_engine
    add(workspace)
    monkeypatch.setattr(context_engine,'get_llm_provider',lambda *_:pytest.fail('No evidence must not reach model'))
    result=AIContextEngine().query(AIQueryRequest(question='quasar contract deadline',search_workspace=True))
    assert result.evidence_count==0
    assert 'No relevant indexed files' in result.answer

def test_selected_long_file_reads_relevant_late_passage(workspace):
    doc=workspace/'contract.txt';doc.write_text(('General introduction.\n'*120)+'The cancellation deadline is December 12.\n',encoding='utf-8')
    add(workspace)
    result=AIContextEngine().query(AIQueryRequest(question='cancellation deadline',file_paths=[str(doc)],provider='local'))
    assert result.citations[0].line_start>40
    assert 'December 12' in result.answer
    assert 'Coverage notice' in result.answer

def test_auto_search_excludes_unregistered_and_ignored_files(workspace):
    (workspace/'public.md').write_text('Launch schedule: Monday.',encoding='utf-8')
    secret=workspace/'.env';secret.write_text('Launch secret token: private-value',encoding='utf-8')
    outside=workspace.parent/'outside.txt';outside.write_text('Launch confidential outside material',encoding='utf-8')
    add(workspace)
    result=AIContextEngine().query(AIQueryRequest(question='launch',search_workspace=True,provider='local'))
    assert all(c.path not in (str(secret),str(outside)) for c in result.citations)
    assert 'private-value' not in result.answer
