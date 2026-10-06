import tempfile
import time
from pathlib import Path

import pytest

from app.core import config
from app.services.organization_service import OrganizationService


@pytest.fixture
def org_env(tmp_path):
    folder = tmp_path / "files"
    folder.mkdir()
    journal = tmp_path / "journal"
    journal.mkdir()
    db_path = tmp_path / "test_org.db"
    config._settings = config.Settings(database_path=db_path, data_dir=tmp_path)
    from app.database.local_db import reset_db
    reset_db()
    service = OrganizationService(journal, [folder])
    yield service, folder
    from app.database.local_db import reset_db
    reset_db()


def test_preview_leaves_source_files_completely_unchanged(org_env):
    service, folder = org_env
    file_a = folder / "a.txt"
    file_a.write_text("content of file a", encoding="utf-8")
    original_stat = file_a.stat()

    plan = service.preview([{"source": str(file_a), "relative": "NewFolder/a.txt"}], str(folder))
    assert plan["status"] == "preview"
    # Source must remain on disk, unchanged
    assert file_a.exists()
    assert file_a.read_text(encoding="utf-8") == "content of file a"
    current_stat = file_a.stat()
    assert (current_stat.st_size, current_stat.st_mtime_ns) == (original_stat.st_size, original_stat.st_mtime_ns)
    # Proposed target must not exist before approval
    assert not (folder / "NewFolder" / "a.txt").exists()


def test_simple_non_ai_rules(org_env):
    service, folder = org_env
    pdf_file = folder / "statement.pdf"
    img_file = folder / "vacation.jpg"
    code_file = folder / "script.py"

    pdf_file.write_text("pdf bytes", encoding="utf-8")
    img_file.write_text("img bytes", encoding="utf-8")
    code_file.write_text("print(1)", encoding="utf-8")

    items = [{"source": str(pdf_file)}, {"source": str(img_file)}, {"source": str(code_file)}]
    rule_res = service.apply_simple_rule(items, "by_type")

    item_map = {Path(i["source"]).name: i for i in rule_res["items"]}
    assert item_map["statement.pdf"]["relative"] == "Documents/statement.pdf"
    assert item_map["vacation.jpg"]["relative"] == "Photos/vacation.jpg"
    assert item_map["script.py"]["relative"] == "Code/script.py"
    assert all(i["understanding"] == "non-AI rule" for i in rule_res["items"])


def test_leave_unchanged_preserves_item_and_reports_skipped(org_env):
    service, folder = org_env
    file_move = folder / "to_move.txt"
    file_keep = folder / "to_keep.txt"
    file_move.write_text("move me", encoding="utf-8")
    file_keep.write_text("keep me unchanged", encoding="utf-8")

    items = [
        {"source": str(file_move), "relative": "Organized/moved.txt"},
        {"source": str(file_keep), "relative": "to_keep.txt", "leave_unchanged": True},
    ]

    plan = service.preview(items, str(folder))
    assert plan["summary"]["skipped"] == 1
    assert any(r["status"] == "unchanged" for r in plan["items"])

    result = service.execute(plan["id"], approved=True)
    assert result["status"] == "completed"
    assert result["summary"]["completed"] == 1
    assert result["summary"]["skipped"] == 1
    assert result["summary"]["failed"] == 0

    assert (folder / "Organized" / "moved.txt").exists()
    assert not file_move.exists()
    assert file_keep.exists()
    assert file_keep.read_text(encoding="utf-8") == "keep me unchanged"


def test_saved_rules_and_rerun_filtering(org_env):
    service, folder = org_env
    f1 = folder / "doc1.pdf"
    f1.write_text("first pdf", encoding="utf-8")

    # 1. Save rule
    rule = service.save_rule(str(folder), "PDF Rule", "by_type")
    assert rule["name"] == "PDF Rule"
    assert rule["folder_path"] == str(folder)

    # 2. Run rule generates a preview
    plan = service.run_saved_rule(rule["id"])
    assert plan["status"] == "preview"
    assert len(plan["items"]) == 1

    # 3. Approve and execute
    service.execute(plan["id"], approved=True)
    assert (folder / "Documents" / "doc1.pdf").exists()

    # 4. Rerunning on the folder with no new files detects no changes
    rerun = service.run_saved_rule(rule["id"])
    assert rerun["status"] == "no_changes"

    # 5. Add a new file, rerun detects only the new file
    f2 = folder / "new_photo.png"
    f2.write_text("image bytes", encoding="utf-8")
    rerun2 = service.run_saved_rule(rule["id"])
    assert rerun2["status"] == "preview"
    assert len(rerun2["items"]) == 1
    assert Path(rerun2["items"][0]["source"]).name == "new_photo.png"


def test_transparent_local_memory_preferences(org_env):
    service, folder = org_env
    pref = service.save_preference("Invoices & Receipts", ["Invoices", "Receipts"], "Sort by vendor")
    assert pref["name"] == "Invoices & Receipts"

    prefs = service.list_preferences()
    assert any(p["name"] == "Invoices & Receipts" for p in prefs)

    deleted = service.delete_preference(pref["id"])
    assert deleted is True
    assert not any(p["id"] == pref["id"] for p in service.list_preferences())


def test_create_sample_folder(org_env):
    service, folder = org_env
    sample = service.create_sample_folder()
    assert Path(sample["folder_path"]).is_dir()
    assert len(sample["files"]) >= 3
    for p in sample["files"]:
        assert Path(p).is_file()


def test_unmatched_categories_stay_at_original_location(org_env):
    service, folder = org_env
    source = folder / "unclassified.txt"
    source.write_text("No category evidence")
    result = service.apply_simple_rule([{"source": str(source)}], "custom_categories", ["Invoices", "Taxes"])
    assert result["items"][0]["leave_unchanged"] is True
    plan = service.preview(result["items"], str(folder / "elsewhere"))
    assert plan["items"][0]["target"] == str(source)
    applied = service.execute(plan["id"], True)
    assert applied["summary"] == {"completed": 0, "skipped": 1, "failed": 0, "total": 1}
    assert source.exists()


def test_long_document_retrieves_later_relevant_section(org_env):
    service, folder = org_env
    from app.models.types import WorkspaceCreate
    from app.services.workspace_service import WorkspaceService
    from app.services.ai.tools import AIToolManager
    WorkspaceService().create_workspace(WorkspaceCreate(name="Reading fixture", path=str(folder)))
    source = folder / "long.txt"
    source.write_text("\n".join(["General background"] * 120 + ["Invoice payment receipt"] * 10))
    read = AIToolManager().execute_tool("read_file", {"path": str(source), "query": "invoice payment", "end_line": 40})
    assert "error" not in read, read
    assert read["start_line"] == 121
    assert read["total_lines"] == 130
    assert "Invoice payment" in read["content"]
