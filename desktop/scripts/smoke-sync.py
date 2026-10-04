"""Real HTTP integration: frozen local core and isolated optional cloud service."""
import json
import os
import sys
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

repo = Path(__file__).resolve().parents[2]
binary = repo / "desktop/src-tauri/resources/groundwork-core/groundwork-core.exe"
python = Path(os.environ.get("GROUNDWORK_CLOUD_PYTHON", str(repo / "server/.venv/Scripts/python.exe")))
if not python.is_file():
    python = Path(sys.executable)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(url, payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, headers=headers, data=None if payload is None else json.dumps(payload).encode())
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def ready(url, process, token=None):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError("Service exited during integration startup")
        try:
            request(url + "/health", token=token)
            return
        except urllib.error.URLError:
            time.sleep(.2)
    raise RuntimeError("Readiness deadline exceeded")


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    cloud_port, local_port = free_port(), free_port()
    cloud_url, local_url = f"http://127.0.0.1:{cloud_port}", f"http://127.0.0.1:{local_port}"
    cloud_env = os.environ.copy()
    cloud_env.update(GROUNDWORK_RUNTIME="hosted", PYTHONPATH=str(repo / "server"), DATABASE_URL="sqlite:///" + str(root / "cloud.db").replace("\\", "/"), ENVIRONMENT="development", JWT_SECRET="integration-test-secret-not-used-in-production")
    local_env = os.environ.copy()
    local_env.update(PATH="", GROUNDWORK_DATA_DIR=str(root / "state"), GROUNDWORK_CORE_PORT=str(local_port), GROUNDWORK_CORE_TOKEN="sync-integration")
    with (root / "services.log").open("w", encoding="utf-8") as log:
        def start_cloud():
            return subprocess.Popen([str(python), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cloud_port)], env=cloud_env, cwd=root, stdout=log, stderr=log, creationflags=0x08000000)
        cloud = start_cloud()
        core = subprocess.Popen([str(binary)], env=local_env, cwd=root, stdout=log, stderr=log, creationflags=0x08000000)
        def local(path, payload=None):
            return request(local_url + path, payload, "sync-integration")
        try:
            ready(cloud_url, cloud)
            ready(local_url, core, "sync-integration")
            account = {"url": cloud_url, "email": "integration@example.com", "password": "integration-password-2026", "register": True}
            assert local("/api/sync/login", account)["status"] == "authenticated"
            token = request(cloud_url + "/auth/login", {"email": account["email"], "password": account["password"]})["access_token"]
            workspace = root / "workspace"
            workspace.mkdir()
            source = workspace / "private.py"
            source.write_text("workspace_private_needle = 'never sync this content'\n", encoding="utf-8")
            local("/api/workspaces", {"name": "Private workspace", "path": str(workspace)})
            note = local("/api/notes", {"title": "Integration note", "content": "Deliberately synced note", "file_path": str(source)})
            assert local("/api/sync/trigger", {})["status"] == "success"
            state = request(cloud_url + "/sync/pull", token=token)
            assert state["notes"][0]["content"] == "Deliberately synced note", state
            serialized = json.dumps(state)
            assert str(source) not in serialized and "workspace_private_needle" not in serialized and "never sync this content" not in serialized
            stranger = request(cloud_url + "/auth/register", {"email": "isolated@example.com", "password": "isolated-password-2026"})["access_token"]
            assert not request(cloud_url + "/sync/pull", token=stranger)["notes"]
            device = request(cloud_url + "/devices", {"device_name": "Integration desktop", "os_name": "Windows"}, token)
            assert request(cloud_url + "/devices", token=token)[0]["id"] == device["id"]
            try:
                request(cloud_url + "/sync/push", {"items": [{"queue_id": "invalid", "entity_type": "note", "entity_id": note["id"], "action": "upsert", "payload": {"title": "x", "content": "x", "file_path": str(source)}}]}, token)
                raise AssertionError("Cloud accepted a workspace path")
            except urllib.error.HTTPError as error:
                assert error.code == 422
            cloud.terminate()
            cloud.wait(timeout=5)
            local("/api/notes", {"title": "Offline note", "content": "Created while cloud is down"})
            assert local("/api/sync/trigger", {})["status"] == "offline"
            assert local("/api/sync/status")["pending_items"] > 0
            for _ in range(100):
                if local("/api/search?q=workspace_private_needle&mode=lexical")["results"]:
                    break
                time.sleep(.2)
            else:
                raise AssertionError("Local search stopped working without cloud")
            cloud = start_cloud()
            ready(cloud_url, cloud)
            assert local("/api/sync/trigger", {})["status"] == "success"
            assert len(request(cloud_url + "/sync/pull", token=token)["notes"]) == 2
            local("/api/sync/logout", {})
            assert local("/api/sync/status")["state"] == "disabled"
            assert local("/api/search?q=workspace_private_needle&mode=lexical")["results"]
            print("Real HTTP sync: register/login, metadata push/pull, device registration, tenant isolation, path rejection, cloud outage/queue retry, and local offline search passed")
        finally:
            if core.poll() is None:
                try:
                    local("/api/system/shutdown", {})
                    core.wait(timeout=10)
                except Exception:
                    core.terminate()
                    core.wait(timeout=5)
            if cloud.poll() is None:
                cloud.terminate()
                cloud.wait(timeout=5)
