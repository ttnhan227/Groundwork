import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.models.types import IndexStatus
from app.services.watcher_service import WatcherService


@pytest.mark.parametrize('cancelled', [False, True])
def test_watcher_reconciles_files_changed_before_registration(tmp_path, monkeypatch, cancelled):
    watcher = WatcherService.__new__(WatcherService)
    watcher._stop_event = threading.Event()
    watcher.workspace_service = Mock()
    watcher.workspace_service.get_allowed_roots.return_value = [tmp_path]
    watcher.indexer_service = Mock()
    watcher.indexer_service.get_progress.return_value = SimpleNamespace(
        status=IndexStatus.CANCELLED if cancelled else IndexStatus.COMPLETED)
    missed_file = tmp_path / 'before-registration.txt'

    def registered_watch(*args, **kwargs):
        missed_file.write_text('new content', encoding='utf-8')
        yield set()
        watcher._stop_event.set()

    def reconcile():
        assert missed_file.read_text(encoding='utf-8') == 'new content'

    watcher.indexer_service.start_indexing.side_effect = reconcile
    monkeypatch.setattr('app.services.watcher_service.watchfiles.watch', registered_watch)
    watcher._watch_loop()
    assert watcher.indexer_service.start_indexing.call_count == (0 if cancelled else 1)
