"""Tests for Storage Analyzer, Cleanup Rules Engine, Installed Apps Manager, Uninstaller, Leftover Scanner, and AI Operator."""

from __future__ import annotations

import os
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.database.local_db import reset_db
from app.main import app
from app.models.types import AIQueryRequest, WorkspaceCreate
from app.services import installed_apps
from app.services.ai.context_engine import AIContextEngine
from app.services.ai.tools import AIToolManager
from app.services.cleanup_service import CleanupService
from app.services.workspace_service import WorkspaceService


@pytest.fixture
def utility_env(tmp_path, monkeypatch):
    reset_db()
    db_path = tmp_path / "utility_test.db"
    monkeypatch.setattr(
        config,
        "_settings",
        config.Settings(database_path=db_path, data_dir=tmp_path, ai_provider="local"),
    )
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()
    yield tmp_path, ws_root
    reset_db()


def test_storage_overview_and_folder_rollups(utility_env):
    _, ws_root = utility_env
    media_dir = ws_root / "Media"
    docs_dir = ws_root / "Documents"
    media_dir.mkdir()
    docs_dir.mkdir()

    video = media_dir / "recording.mp4"
    video.write_bytes(b"V" * 200_000)
    pdf = docs_dir / "manual.pdf"
    pdf.write_bytes(b"P" * 50_000)

    ws = WorkspaceService().create_workspace(WorkspaceCreate(name="Main", path=str(ws_root)))
    svc = CleanupService()
    overview = svc.storage_overview(ws.id, limit=10)

    assert overview["total_files"] == 2
    assert overview["total_bytes"] == 250_000
    assert len(overview["largest_files"]) == 2
    assert overview["largest_files"][0]["name"] == "recording.mp4"
    assert overview["largest_files"][0]["size_bytes"] == 200_000

    folder_names = {f["name"]: f["size_bytes"] for f in overview["largest_folders"]}
    assert folder_names["Media"] == 200_000
    assert folder_names["Documents"] == 50_000
    assert len(overview["space_map"]) >= 2


def test_cleanup_rules_scanner_and_confirmed_deletion(utility_env):
    tmp_path, ws_root = utility_env

    # 1. Exact duplicate pair
    dup_a = ws_root / "report_original.txt"
    dup_b = ws_root / "report_copy.txt"
    dup_content = b"Duplicate content payload for SHA-256 verification.\n" * 200
    dup_a.write_bytes(dup_content)
    dup_b.write_bytes(dup_content)

    # 2. Temporary file
    temp_file = ws_root / "crash_dump.tmp"
    temp_file.write_bytes(b"T" * 15_000)

    # 3. Cache file inside __pycache__
    cache_dir = ws_root / "__pycache__"
    cache_dir.mkdir()
    pyc_file = cache_dir / "module.cpython-312.pyc"
    pyc_file.write_bytes(b"C" * 12_000)

    # 4. Old stale file (set mtime to 120 days ago)
    stale_file = ws_root / "ancient_dataset.bin"
    stale_file.write_bytes(b"S" * (2 * 1024 * 1024))
    old_time = time.time() - (120 * 86400)
    os.utime(stale_file, (old_time, old_time))

    ws = WorkspaceService().create_workspace(WorkspaceCreate(name="CleanupWS", path=str(ws_root)))
    svc = CleanupService()
    scan = svc.scan_cleanup_candidates(
        workspace_id=ws.id,
        stale_days=60,
        min_large_bytes=1 * 1024 * 1024,
    )

    rules_by_id = {r["id"]: r for r in scan["rules"]}
    assert rules_by_id["exact_duplicates"]["candidate_count"] == 1
    assert rules_by_id["temp_and_logs"]["candidate_count"] == 1
    assert rules_by_id["cache_and_build"]["candidate_count"] == 1
    assert rules_by_id["large_stale_files"]["candidate_count"] == 1
    assert scan["total_candidates"] >= 4
    assert scan["total_reclaimable_bytes"] > 2 * 1024 * 1024

    # Security boundary checks: outside workspace and workspace root itself must be rejected
    outside_file = tmp_path / "outside.txt"
    outside_file.write_text("outside")
    with pytest.raises(ValueError, match="None of the selected items can be removed"):
        svc.propose_cleanup([str(outside_file)], mode="permanent")

    with pytest.raises(ValueError, match="None of the selected items can be removed"):
        svc.propose_cleanup([str(ws_root)], mode="permanent")

    # Propose valid cleanup for temp_file and pyc_file
    proposal_res = svc.propose_cleanup([str(temp_file), str(pyc_file)], mode="permanent")
    assert proposal_res["item_count"] == 2
    assert proposal_res["total_bytes"] == 27_000
    token = proposal_res["confirmation_token"]

    # Tampered proposal or wrong token must be denied
    with pytest.raises(PermissionError):
        svc.execute_cleanup(proposal_res["proposal"], "invalid-token")

    # Execute with valid single-use token
    exec_res = svc.execute_cleanup(proposal_res["proposal"], token)
    assert exec_res["status"] == "completed"
    assert exec_res["removed_count"] == 2
    assert exec_res["bytes_reclaimed"] == 27_000
    assert not temp_file.exists()
    assert not pyc_file.exists()

    # Re-using consumed token must fail
    with pytest.raises(PermissionError):
        svc.execute_cleanup(proposal_res["proposal"], token)


def test_installed_apps_metadata_and_uninstall_workflow(monkeypatch, tmp_path):
    uninstaller_exe = tmp_path / "unins000.exe"
    uninstaller_exe.write_bytes(b"MZ")

    raw_entry_1 = {
        "id": "reg:VendorApp",
        "name": "Vendor Studio",
        "publisher": "CN=Vendor Corp, O=Vendor Corp, C=US",
        "version": "2.4.1",
        "install_location": str(tmp_path),
        "install_date": "20260315",
        "uninstall_string": f'"{uninstaller_exe}" /SILENT',
        "estimated_size_kb": 1024,
    }
    raw_entry_2 = {
        "id": "Store.App!Main",
        "name": "Store Utility",
        "publisher": "Store Pub",
        "version": "1.0.0",
        "estimated_size_kb": None,
    }
    norm_1 = installed_apps._normalize_app_entry(dict(raw_entry_1))
    norm_2 = installed_apps._normalize_app_entry(dict(raw_entry_2))

    assert norm_1["publisher"] == "Vendor Corp"
    assert norm_1["install_date"] == "2026-03-15"
    assert norm_1["estimated_size_bytes"] == 1024 * 1024
    assert norm_1["can_uninstall"] is True
    assert norm_1["can_launch"] is False

    # Missing size must remain None, never 0
    assert norm_2["estimated_size_bytes"] is None
    assert norm_2["can_uninstall"] is False
    assert norm_2["can_launch"] is True

    # Command parsing & injection protection
    argv = installed_apps.parse_uninstall_command(f'"{uninstaller_exe}" /SILENT /NORESTART')
    assert argv == [str(uninstaller_exe), "/SILENT", "/NORESTART"]

    msi_argv = installed_apps.parse_uninstall_command("MsiExec.exe /X{12345678-1234-1234-1234-1234567890AB}")
    assert msi_argv[0].lower().endswith("msiexec.exe")
    assert msi_argv[1] == "/X{12345678-1234-1234-1234-1234567890AB}"

    for unsafe in [f'"{uninstaller_exe}" & calc.exe', "cmd.exe | dir", "unins.exe; rm -rf /"]:
        with pytest.raises(ValueError, match="unsafe shell operators"):
            installed_apps.parse_uninstall_command(unsafe)

    # Guided uninstall proposal & execution
    monkeypatch.setattr(installed_apps, "list_apps", lambda refresh=False: {"apps": [norm_1, norm_2], "supported": True})
    prop = installed_apps.propose_uninstall("reg:VendorApp")
    assert prop["proposal"]["app_name"] == "Vendor Studio"
    assert prop["confirmation_token"]

    launched_cmds = []
    monkeypatch.setattr(
        installed_apps.subprocess,
        "Popen",
        lambda args, shell=False: launched_cmds.append((args, shell)) or SimpleNamespace(pid=4321),
    )
    res = installed_apps.execute_uninstall(prop["proposal"], prop["confirmation_token"])
    assert res["status"] == "launched"
    assert res["pid"] == 4321
    assert launched_cmds == [([str(uninstaller_exe), "/SILENT"], False)]


def test_app_leftover_scanner_confidence_and_cleanup(utility_env):
    tmp_path, _ = utility_env
    local_appdata = tmp_path / "AppData" / "Local"
    roaming_appdata = tmp_path / "AppData" / "Roaming"
    local_appdata.mkdir(parents=True)
    roaming_appdata.mkdir(parents=True)

    # High confidence: exact app name folder in Roaming
    exact_folder = roaming_appdata / "HyperNotes"
    exact_folder.mkdir()
    (exact_folder / "settings.json").write_bytes(b"{" + b"a" * 4000 + b"}")

    # High confidence: nested under Publisher\App in Local
    vendor_folder = local_appdata / "NebulaSoft"
    nested_app = vendor_folder / "HyperNotes"
    nested_app.mkdir(parents=True)
    (nested_app / "cache.bin").write_bytes(b"X" * 8000)

    # Review required: partial match folder
    partial_folder = local_appdata / "HyperNotesUpdaterTemp"
    partial_folder.mkdir()
    (partial_folder / "patch.dat").write_bytes(b"P" * 2000)

    # Unrelated folder that must not be flagged
    unrelated = local_appdata / "TotallyDifferentApp"
    unrelated.mkdir()
    (unrelated / "keep.txt").write_bytes(b"K" * 1000)

    roots = [("AppData (Local)", local_appdata), ("AppData (Roaming)", roaming_appdata)]
    report = installed_apps.scan_app_leftovers(
        app_name="HyperNotes",
        publisher="NebulaSoft",
        search_roots=roots,
    )

    assert report["total_count"] == 3
    assert report["high_confidence_count"] == 2
    assert report["review_required_count"] == 1
    assert report["total_reclaimable_bytes"] == 14_002

    found_paths = {item["path"]: item for item in report["leftovers"]}
    assert str(exact_folder.resolve()) in found_paths
    assert found_paths[str(exact_folder.resolve())]["confidence"] == "high"
    assert str(nested_app.resolve()) in found_paths
    assert found_paths[str(nested_app.resolve())]["confidence"] == "high"
    assert str(partial_folder.resolve()) in found_paths
    assert found_paths[str(partial_folder.resolve())]["confidence"] == "review_required"
    assert str(unrelated.resolve()) not in found_paths

    # Leftover cleanup proposal & execution with extra_roots
    prop = installed_apps.propose_leftover_cleanup(
        [str(exact_folder)],
        mode="permanent",
        extra_roots=[local_appdata, roaming_appdata],
    )
    exec_res = installed_apps.execute_leftover_cleanup(
        prop["proposal"],
        prop["confirmation_token"],
        extra_roots=[local_appdata, roaming_appdata],
    )
    assert exec_res["removed_count"] == 1
    assert not exact_folder.exists()
    assert unrelated.exists()


def test_ai_operator_tools_and_api_endpoints(utility_env, monkeypatch):
    _, ws_root = utility_env
    big_file = ws_root / "archive_backup.zip"
    big_file.write_bytes(b"Z" * (6 * 1024 * 1024))
    temp_file = ws_root / "session.tmp"
    temp_file.write_bytes(b"T" * 50_000)

    ws = WorkspaceService().create_workspace(WorkspaceCreate(name="OperatorWS", path=str(ws_root)))

    # 1. Direct AIToolManager operator tools
    tools = AIToolManager()
    storage_res = tools.execute_tool("analyze_storage", {"workspace_id": ws.id, "limit": 5})
    assert storage_res["total_files"] == 2
    assert storage_res["largest_files"][0]["name"] == "archive_backup.zip"

    cleanup_res = tools.execute_tool("scan_cleanup_candidates", {"workspace_id": ws.id, "stale_days": 60})
    assert cleanup_res["total_candidates"] >= 2

    # 2. AIContextEngine operator query without manually selected files
    engine = AIContextEngine()
    ai_resp = engine.query(
        AIQueryRequest(
            question="What is taking up the most space and how can I free up space?",
            workspace_id=ws.id,
        )
    )
    assert ai_resp.provider_used == "local-operator"
    assert "Storage Overview" in ai_resp.answer
    assert "Cleanup & Duplicate Analysis" in ai_resp.answer
    assert "archive_backup.zip" in ai_resp.answer
    assert any(c.filename == "archive_backup.zip" for c in ai_resp.citations)
    assert ai_resp.citation_verification["grounded"] is True

    # 3. Verify HTTP endpoints via TestClient
    client = TestClient(app)
    ov_http = client.get(f"/api/system/storage-overview?workspace_id={ws.id}")
    assert ov_http.status_code == 200
    assert ov_http.json()["total_files"] == 2

    cl_http = client.get(f"/api/system/cleanup/scan?workspace_id={ws.id}")
    assert cl_http.status_code == 200
    assert cl_http.json()["total_candidates"] >= 2
