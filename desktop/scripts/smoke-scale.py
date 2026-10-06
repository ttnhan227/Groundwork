"""Reconcile a larger real directory, interrupted indexing, and rapid changes."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

binary = Path(__file__).resolve().parents[1] / "src-tauri/resources/groundwork-core/groundwork-core.exe"
document_count = int(os.environ.get("GROUNDWORK_SCALE_COUNT", "1100"))
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    workspace = root / "workspace"
    workspace.mkdir()
    oldest = workspace / "oldest.md"
    oldest.write_text("Overdue customer invoices are collected after thirty days. archival_invoice_needle", encoding="utf-8")
    os.utime(oldest, (1000, 1000))
    for index in range(document_count):
        (workspace / f"item-{index:04}.md").write_text(f"Garden flowers grow in sunlight. item_number_{index}", encoding="utf-8")
    for name in ("node_modules", "dist", ".git"):
        folder = workspace / name
        folder.mkdir()
        (folder / "ignored.py").write_text("excluded_secret_marker = True", encoding="utf-8")
    (workspace / ".env").write_text("excluded_secret_marker=private", encoding="utf-8")
    env = {**os.environ, "PATH": "", "GROUNDWORK_DATA_DIR": str(root / "state"), "GROUNDWORK_CORE_PORT": str(port), "GROUNDWORK_CORE_TOKEN": "scale-test"}
    with (root / "core.log").open("w", encoding="utf-8") as log:
        def launch():
            process = subprocess.Popen([str(binary)], cwd=root, env=env, stdout=log, stderr=log, creationflags=0x08000000)
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("Frozen core exited")
                try:
                    request("/health")
                    return process
                except urllib.error.URLError:
                    time.sleep(.2)
            raise RuntimeError("Readiness deadline exceeded")

        def request(path, payload=None):
            req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=None if payload is None else json.dumps(payload).encode(), headers={"Authorization": "Bearer scale-test", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)

        def wait(predicate, message):
            deadline = time.monotonic() + max(180, document_count / 15)
            next_report = time.monotonic() + 30
            while time.monotonic() < deadline:
                if predicate():
                    return
                if time.monotonic() >= next_report:
                    progress = request("/api/index/status")
                    print(json.dumps({"waiting": message, "phase": progress["phase"], "indexed": progress["files_indexed"], "discovered": progress["files_discovered"], "status": progress["status"]}), flush=True)
                    assert progress["status"] != "failed", progress
                    next_report = time.monotonic() + 30
                time.sleep(.3)
            raise AssertionError(message + ": " + json.dumps(request("/api/index/status")))

        process = launch()
        try:
            request("/api/workspaces", {"name": "Scale test", "path": str(workspace)})
            wait(lambda: request("/api/index/status")["files_indexed"] >= 5, "Indexing never began")
            if os.environ.get("GROUNDWORK_SCALE_CRASH") == "1":
                subprocess.run([str(Path(os.environ["SystemRoot"]) / "System32/taskkill.exe"), "/PID", str(process.pid), "/T", "/F"], check=True, capture_output=True)
                assert process.wait(timeout=15) != 0
            else:
                request("/api/system/shutdown", {})
                assert process.wait(timeout=15) == 0
            recovery_start = time.monotonic()
            process = launch()
            wait(lambda: request("/api/index/status")["status"] == "completed", "Startup reconciliation did not finish")
            print(json.dumps({"recovery_seconds": round(time.monotonic() - recovery_start, 3), "documents": document_count + 1}), flush=True)
            status = request("/api/system/status")
            assert status["counts"]["chunks"] == document_count + 1, status
            assert status["counts"]["files"] >= document_count + 1, status  # metadata also includes non-indexed files
            lexical = request("/api/search?q=archival_invoice_needle&mode=lexical")["results"]
            assert lexical[0]["filename"] == "oldest.md", lexical
            semantic = request("/api/search?q=overdue%20payments%20collected&mode=semantic")["results"]
            assert semantic[0]["filename"] == "oldest.md", semantic
            assert not request("/api/search?q=excluded_secret_marker&mode=lexical")["results"]
            rapid = workspace / "rapid.py"
            for index in range(30):
                rapid.write_text(f"rapid_final_marker = {index}\n", encoding="utf-8")
            wait(lambda: any("29" in item["snippet"] for item in request("/api/search?q=rapid_final_marker&mode=lexical")["results"]), "Rapid changes did not converge")
            (workspace / ".gitignore").write_text("rapid.py\n", encoding="utf-8")
            wait(lambda: not request("/api/search?q=rapid_final_marker&mode=lexical")["results"], "New ignore rule did not remove the file")
            request("/api/index/start", [])
            wait(lambda: request("/api/index/status")["status"] == "completed", "Explicit reindex did not finish")
            request("/api/system/shutdown", {})
            assert process.wait(timeout=15) == 0
            print(f"Frozen core: {document_count + 1:,} files; interrupted indexing/restart reconciliation; old-file lexical and trained semantic retrieval; ignored directories/secrets; 30 rapid edits; changed ignore rules; explicit reindex passed")
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
