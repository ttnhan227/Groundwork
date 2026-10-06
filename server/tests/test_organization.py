from pathlib import Path

import pytest

from app.services.organization_service import OrganizationService


@pytest.fixture
def organizer(tmp_path):
    folder = tmp_path / "files"
    folder.mkdir()
    return OrganizationService(tmp_path / "journal", [folder]), folder


def test_approved_move_and_undo_preserve_contents(organizer):
    service, folder = organizer
    source = folder / "old.txt"
    source.write_text("original contents", encoding="utf-8")
    plan = service.preview([{"source": str(source), "relative": "Topic/new.txt"}], str(folder))
    assert source.exists()
    with pytest.raises(ValueError, match="approval"):
        service.execute(plan["id"], False)
    result = service.execute(plan["id"], True)
    assert result["status"] == "completed"
    moved = folder / "Topic/new.txt"
    assert not source.exists() and moved.read_text() == "original contents"
    with pytest.raises(ValueError, match="already"):
        service.execute(plan["id"], True)
    result = service.execute(plan["id"], True, undo=True)
    assert result["status"] == "undone"
    assert source.read_text() == "original contents" and not moved.exists()


def test_collision_after_preview_never_overwrites(organizer):
    service, folder = organizer
    source, target = folder / "a.txt", folder / "b.txt"
    source.write_text("a")
    plan = service.preview([{"source": str(source), "relative": target.name}], str(folder))
    target.write_text("keep me")
    result = service.execute(plan["id"], True)
    assert result["status"] == "needs-review"
    assert source.read_text() == "a" and target.read_text() == "keep me"


def test_changed_file_and_undo_conflicts_are_preserved(organizer):
    service, folder = organizer
    source = folder / "a.txt"
    source.write_text("a")
    plan = service.preview([{"source": str(source), "relative": "b.txt"}], str(folder))
    source.write_text("changed")
    assert service.execute(plan["id"], True)["status"] == "needs-review"
    assert not (folder / "b.txt").exists()
    plan = service.preview([{"source": str(source), "relative": "b.txt"}], str(folder))
    service.execute(plan["id"], True)
    source.write_text("new original")
    result = service.execute(plan["id"], True, undo=True)
    assert result["status"] == "needs-review"
    assert source.read_text() == "new original" and (folder / "b.txt").read_text() == "changed"


@pytest.mark.parametrize("relative", ["../outside.txt", "CON.txt", "bad?.txt", "C:/outside.txt", "trailing./file.txt"])
def test_invalid_names_and_escape_rejected(organizer, relative):
    service, folder = organizer
    source = folder / "a.txt"
    source.write_text("a")
    with pytest.raises(ValueError):
        service.preview([{"source": str(source), "relative": relative}], str(folder))


def test_interrupted_copy_keeps_original_and_reports_both(organizer, monkeypatch):
    service, folder = organizer
    source = folder / "a.txt"
    source.write_text("a")
    plan = service.preview([{"source": str(source), "relative": "b.txt"}], str(folder))
    original_unlink = Path.unlink

    def blocked(path, *args, **kwargs):
        if path == source:
            raise PermissionError("busy")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", blocked)
    result = service.execute(plan["id"], True)
    assert result["items"][0]["status"] == "copied"
    assert result["summary"]["failed"] == 1
    assert result["summary"]["completed"] == 0
    assert source.exists() and (folder / "b.txt").exists()

    result = service.execute(plan["id"], True, undo=True)
    assert "Both original" in result["items"][0]["error"]
    assert source.exists() and (folder / "b.txt").exists()


def test_cancellation_preserves_remaining_files_and_undo(organizer, monkeypatch):
    service, folder = organizer
    a, b = folder / "a.txt", folder / "b.txt"
    a.write_text("first")
    b.write_text("second")
    plan = service.preview([{"source": str(p), "relative": f"Moved/{p.name}"} for p in [a, b]], str(folder))
    move = service._move

    def cancel_after_first(*args, **kwargs):
        move(*args, **kwargs)
        service.cancel()

    monkeypatch.setattr(service, "_move", cancel_after_first)
    result = service.execute(plan["id"], True)
    assert result["status"] == "cancelled"
    assert result["summary"] == {"completed": 1, "skipped": 1, "failed": 0, "total": 2}
    assert b.read_text() == "second"
    monkeypatch.setattr(service, "_move", move)
    assert service.execute(plan["id"], True, undo=True)["status"] == "undone"
    assert a.read_text() == "first"


def test_cancellation_during_copy_removes_only_partial_destination(organizer, monkeypatch):
    service, folder = organizer
    source = folder / "large.bin"
    source.write_bytes(b"fixture" * 200000)
    plan = service.preview([{"source": str(source), "relative": "Moved/large.bin"}], str(folder))
    save = service._save

    def cancel_when_copying(current):
        save(current)
        if current["items"][0]["status"] == "copying":
            service.cancel()

    monkeypatch.setattr(service, "_save", cancel_when_copying)
    result = service.execute(plan["id"], True)
    assert result["status"] == "cancelled"
    assert result["summary"]["skipped"] == 1
    assert source.read_bytes() == b"fixture" * 200000
    assert not (folder / "Moved/large.bin").exists()


def test_cancelled_undo_counts_only_restored_files(organizer, monkeypatch):
    service, folder = organizer
    sources = [folder / "a.txt", folder / "b.txt"]
    for source in sources:
        source.write_text(source.name)
    plan = service.preview([{"source": str(p), "relative": f"Moved/{p.name}"} for p in sources], str(folder))
    service.execute(plan["id"], True)
    move = service._move

    def cancel_after_first(*args, **kwargs):
        move(*args, **kwargs)
        service.cancel()

    monkeypatch.setattr(service, "_move", cancel_after_first)
    result = service.execute(plan["id"], True, undo=True)
    assert result["status"] == "cancelled"
    assert result["summary"] == {"completed": 1, "skipped": 1, "failed": 0, "total": 2}
    monkeypatch.setattr(service, "_move", move)
    assert service.execute(plan["id"], True, undo=True)["status"] == "undone"


def test_unreadable_selection_does_not_load_or_contact_provider(organizer, monkeypatch):
    service, folder = organizer
    source = folder / "unreadable.bin"
    source.write_bytes(b"fixture")
    from app.services.ai.tools import AIToolManager
    from app.services.ai import providers
    monkeypatch.setattr(AIToolManager, "execute_tool", lambda *args: {"error": "Unsupported format"})
    monkeypatch.setattr(providers, "get_llm_provider", lambda *args: pytest.fail("No evidence must not contact AI"))
    result = service.suggest([str(source)], "Organize by topic")
    assert result["items"][0]["leave_unchanged"] is True
    assert "Metadata only" in result["items"][0]["coverage"]


def test_windows_readonly_source_is_preserved_on_move_failure(organizer):
    import os
    import stat
    if os.name != "nt":
        pytest.skip("Windows read-only attribute")
    service, folder = organizer
    source, target = folder / "readonly.txt", folder / "moved.txt"
    source.write_text("protected original", encoding="utf-8")
    source.chmod(stat.S_IREAD)
    try:
        plan = service.preview([{"source": str(source), "relative": target.name}], str(folder))
        result = service.execute(plan["id"], True)
        assert result["status"] == "needs-review"
        assert source.read_text(encoding="utf-8") == "protected original"
        if target.exists():
            assert target.read_text(encoding="utf-8") == "protected original"
    finally:
        source.chmod(stat.S_IWRITE)
        if target.exists():
            target.chmod(stat.S_IWRITE)
