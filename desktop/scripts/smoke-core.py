"""Exercise the frozen core in an isolated directory without invoking Python inside it."""
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
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    env = os.environ.copy()
    env.update(GROUNDWORK_DATA_DIR=str(root / "state"), GROUNDWORK_CORE_PORT=str(port), GROUNDWORK_CORE_TOKEN="isolated-packaging-test")
    # Empty PATH demonstrates that startup needs no Python/Node executable.
    env["PATH"] = ""
    with (root / "core.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen([str(binary)], cwd=root, env=env, stdout=log, stderr=log, creationflags=0x08000000)
        def request(path, payload=None, authenticated=True):
            headers = {"Content-Type": "application/json"}
            if authenticated:
                headers["Authorization"] = "Bearer isolated-packaging-test"
            req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers=headers, data=json.dumps(payload).encode() if payload is not None else None)
            with urllib.request.urlopen(req, timeout=5) as response:
                return json.load(response)
        try:
            for attempt in range(80):
                if process.poll() is not None:
                    log.flush()
                    raise RuntimeError((root / "core.log").read_text(encoding="utf-8"))
                try:
                    assert request("/health")["service"] == "groundwork-local"
                    break
                except urllib.error.URLError:
                    time.sleep(.25)
            else:
                raise RuntimeError("Packaged core readiness deadline exceeded")
            assert request("/api/system/preferences")["gemini_model"] == "gemini-3.8-flash", "Packaged AI setup retained a retired default model"
            try:
                request("/api/workspaces", authenticated=False)
                raise AssertionError("Unauthenticated access succeeded")
            except urllib.error.HTTPError as error:
                assert error.code == 401
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / "sample.py").write_text("def packaging_needle():\n    return 'local evidence'\n", encoding="utf-8")
            for args in (["init"], ["config", "user.name", "Packaging Test"], ["config", "user.email", "packaging@example.com"], ["add", "."], ["commit", "-m", "Initialize packaging needle"]):
                subprocess.run(["git", *args], cwd=workspace, check=True, capture_output=True)
            ws = request("/api/workspaces", {"name": "Packaging smoke", "path": str(workspace)})
            request(f"/api/index/start?workspace_id={ws['id']}", {})
            for attempt in range(80):
                progress = request("/api/index/status")
                if progress["status"] in {"completed", "failed"}:
                    assert progress["status"] == "completed", progress
                    break
                time.sleep(.25)
            results = request("/api/search?q=packaging_needle&mode=lexical")
            assert any(result["filename"] == "sample.py" for result in results["results"]), results
            def wait_for_match(term, name, exists=True):
                for _ in range(100):
                    matches = request(f"/api/search?q={term}&mode=lexical")["results"]
                    if any(item["filename"] == name for item in matches) == exists:
                        return
                    time.sleep(.2)
                raise AssertionError(f"Watcher did not reconcile {name}: {matches}")
            # Allow the root watch subscription to be established, then mutate
            # real files without calling the indexing endpoint again.
            time.sleep(2)
            changed = workspace / "created.py"
            changed.write_text("watcher_created = 'initial'\n", encoding="utf-8")
            wait_for_match("watcher_created", "created.py")
            changed.write_text("watcher_modified = 'changed'\n", encoding="utf-8")
            wait_for_match("watcher_modified", "created.py")
            renamed = workspace / "renamed.py"
            changed.rename(renamed)
            wait_for_match("watcher_modified", "renamed.py")
            wait_for_match("watcher_modified", "created.py", False)
            nested = workspace / "nested"
            nested.mkdir()
            moved = nested / "moved.py"
            renamed.rename(moved)
            wait_for_match("watcher_modified", "moved.py")
            moved.unlink()
            wait_for_match("watcher_modified", "moved.py", False)
            projects = request("/api/projects")
            assert projects and projects[0]["git_branch"], projects
            project_id = projects[0]["id"]
            commits = request("/api/git/commits?query=packaging")
            assert commits and "sample.py" in commits[0]["changed_files"], commits
            sample = workspace / "sample.py"
            sample.write_text("def packaging_needle():\n    return 'updated local evidence'\n", encoding="utf-8")
            history = request(f"/api/git/projects/{project_id}/file-history?path=sample.py")
            assert history["commits"] and "updated local evidence" in history["diff"], history
            answer = request("/api/ai/query", {"question": "packaging_needle", "provider": "local", "focused_path": str(sample)})
            assert answer["citations"] and "updated local evidence" in answer["citations"][0]["snippet"], answer
            assert answer["citations"][0]["line_end"] == 2, answer
            try:
                request("/api/ai/query", {"question": "packaging_needle", "provider": "openai"})
                raise AssertionError("Provider without API key succeeded")
            except urllib.error.HTTPError as error:
                assert error.code == 502
            investigation = request("/api/ai/investigate", {"problem_statement": "packaging_needle", "provider": "local"})
            assert investigation["session_id"] and investigation["citations"], investigation
            action = {"tool_name": "create_note", "arguments": {"title": "Packaging review", "content": "Persisted evidence"}}
            proposal = request("/api/ai/tools/execute", action)
            assert proposal["requires_confirmation"] and not request("/api/notes"), proposal
            action["confirmation_token"] = proposal["confirmation_token"]
            assert request("/api/ai/tools/execute", action)["status"] == "created"
            assert request("/api/ai/tools/execute", action)["status"] == "denied"
            request("/api/system/shutdown", {})
            assert process.wait(timeout=10) == 0
            process = subprocess.Popen([str(binary)], cwd=root, env=env, stdout=log, stderr=log, creationflags=0x08000000)
            for _ in range(100):
                try:
                    request("/health")
                    break
                except urllib.error.URLError:
                    time.sleep(.2)
            assert request("/api/workspaces")[0]["id"] == ws["id"]
            assert request("/api/notes")[0]["title"] == "Packaging review"
            assert request("/api/context-sessions")[0]["id"] == investigation["session_id"]
            request("/api/system/shutdown", {})
            assert process.wait(timeout=10) == 0
            print("Frozen core with empty PATH: authenticated startup; index/search; watcher create/modify/rename/move/delete; bundled Git history/diff; AI citations/provider error; action confirmation; graceful shutdown/restart/persistence passed")
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
