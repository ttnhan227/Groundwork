"""Business logic and local services layer for Groundwork Local."""

from app.services.activity_service import ActivityService
from app.services.context_service import ContextService
from app.services.embeddings import EmbeddingEngine, get_embedding_engine
from app.services.file_parser import FileParser
from app.services.git_service import GitService
from app.services.indexer_service import IndexerService
from app.services.notes_service import NotesService
from app.services.project_service import ProjectService
from app.services.saved_search_service import SavedSearchService
from app.services.search_engine import SearchEngine
from app.services.sync_service import SyncService
from app.services.system_service import SystemService
from app.services.watcher_service import WatcherService
from app.services.workspace_service import WorkspaceService

__all__ = [
    "ActivityService",
    "ContextService",
    "EmbeddingEngine",
    "FileParser",
    "GitService",
    "IndexerService",
    "NotesService",
    "ProjectService",
    "SavedSearchService",
    "SearchEngine",
    "SyncService",
    "SystemService",
    "WatcherService",
    "WorkspaceService",
    "get_embedding_engine",
]
