"""Tests for activity tracking, timeline synthesis, context sessions, and notes."""

import tempfile
from pathlib import Path

from app.core import config
from app.models.types import ActivityType, ContextSessionCreate, NoteCreate
from app.services.activity_service import ActivityService
from app.services.context_service import ContextService
from app.services.notes_service import NotesService


def test_activity_timeline_and_what_was_i_doing():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        db_path = root / "test_act.db"
        config._settings = config.Settings(database_path=db_path, data_dir=root)

        act_svc = ActivityService()

        # Record activities
        act_svc.record_activity(
            activity_type=ActivityType.FILE_MODIFIED,
            summary="Modified search_engine.py",
            details={"file": "search_engine.py"},
        )
        act_svc.record_activity(
            activity_type=ActivityType.GIT_COMMIT,
            summary="Committed: Improve hybrid search ranking",
            details={"hash": "abc1234"},
        )

        activities = act_svc.list_activities(days=1)
        assert len(activities) == 2
        assert activities[0].activity_type == ActivityType.GIT_COMMIT

        summary = act_svc.get_what_was_i_doing_summary(days=1)
        assert "concise_summary" in summary
        from app.database.local_db import reset_db
        reset_db()


def test_context_sessions_continue_where_i_left_off():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        db_path = root / "test_ctx.db"
        config._settings = config.Settings(database_path=db_path, data_dir=root)

        ctx_svc = ContextService()

        # Create session
        session = ctx_svc.create_session(ContextSessionCreate(
            title="Groundwork indexing bug",
            summary="Investigating duplicate watcher events on Windows",
            files_inspected=["watcher.py", "indexer_service.py"],
            todos=["Add debounce test", "Verify file event cleanup"],
            last_command="pytest tests/test_indexer.py",
        ))

        assert session.id is not None
        assert session.status == "active"
        assert len(session.files_inspected) == 2

        # Update / resume session
        updated = ctx_svc.update_session(session.id, {
            "last_command": "pytest tests/test_search_engine.py",
            "todos": ["Done!"],
        })
        assert updated is not None
        assert updated.last_command == "pytest tests/test_search_engine.py"
        assert updated.todos == ["Done!"]
        from app.database.local_db import reset_db
        reset_db()


def test_notes_creation_and_search():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        db_path = root / "test_notes.db"
        config._settings = config.Settings(database_path=db_path, data_dir=root)

        notes_svc = NotesService()
        note = notes_svc.create_note(NoteCreate(
            title="Watcher note",
            content="Windows emits duplicate file events during rapid saves.",
            tags=["bug", "windows"],
        ))

        assert note.id is not None
        notes = notes_svc.list_notes(q="duplicate")
        assert len(notes) == 1
        assert notes[0].title == "Watcher note"
        from app.database.local_db import reset_db
        reset_db()
