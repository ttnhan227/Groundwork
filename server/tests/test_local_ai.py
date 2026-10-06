import hashlib

import httpx
import pytest

from app.services.local_ai_service import LocalAIService

REAL_CLIENT = httpx.Client


@pytest.fixture
def manager(tmp_path, monkeypatch):
    monkeypatch.setattr(LocalAIService, "_idle_monitor", lambda self: None)
    service = LocalAIService(tmp_path)
    yield service
    service.close()


def artifact(data):
    return {
        "file": "model.gguf",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "url": "https://example.test/model",
    }


def use_transport(monkeypatch, handler):
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: REAL_CLIENT(transport=httpx.MockTransport(handler), **kwargs))


def test_download_resumes_and_checks_hash(manager, monkeypatch):
    data = b"GGUF" + b"contents" * 100
    item = artifact(data)
    (manager.root / "model.gguf.part").write_bytes(data[:30])

    def response(request):
        assert request.headers["range"] == "bytes=30-"
        return httpx.Response(
            206, headers={"Content-Range": f"bytes 30-{len(data) - 1}/{len(data)}"}, content=data[30:]
        )

    use_transport(monkeypatch, response)
    assert manager._download(item).read_bytes() == data
    assert manager._installed(item)


def test_server_ignoring_range_restarts_download(manager, monkeypatch):
    data = b"GGUF-full"
    (manager.root / "model.gguf.part").write_bytes(b"GG")
    use_transport(monkeypatch, lambda request: httpx.Response(200, content=data))
    assert manager._download(artifact(data)).read_bytes() == data


def test_checksum_failure_not_installed_and_can_retry(manager, monkeypatch):
    use_transport(monkeypatch, lambda request: httpx.Response(200, content=b"wrong"))
    with pytest.raises(ValueError, match="safety check"):
        manager._download(artifact(b"right"))
    assert not (manager.root / "model.gguf").exists()
    assert not (manager.root / "model.gguf.part").exists()


def test_cancel_retains_partial_and_invalid_range_rejected(manager, monkeypatch):
    data = b"GGUF-full"
    manager.cancel_download.set()
    use_transport(monkeypatch, lambda request: httpx.Response(200, content=data))
    with pytest.raises(InterruptedError):
        manager._download(artifact(data))
    assert not manager._installed(artifact(data))
    manager.cancel_download.clear()
    (manager.root / "model.gguf.part").write_bytes(b"GG")
    use_transport(
        monkeypatch, lambda request: httpx.Response(206, headers={"Content-Range": "bytes 0-8/9"}, content=data)
    )
    with pytest.raises(ValueError, match="resume range"):
        manager._download(artifact(data))


def test_generation_is_single_and_model_switch_waits(manager):
    manager.generation_lock.acquire()
    try:
        with pytest.raises(ValueError, match="Another answer"):
            manager.generate("test")
        with pytest.raises(ValueError, match="Cancel"):
            manager.select("larger")
    finally:
        manager.generation_lock.release()


def test_uninstalled_model_never_launches_process(manager, monkeypatch):
    monkeypatch.setattr(manager, "engine", lambda: ("AMD64", artifact(b"test")))
    with pytest.raises(ValueError, match="Set up"):
        manager.generate("question")
    assert manager.process is None and not manager.generation_lock.locked()


@pytest.mark.parametrize("total_gib,available_gib,model", [(8, 1, "small"), (16, 3, "larger"), (32, 2, "small")])
def test_low_available_memory_never_starts_engine(manager, monkeypatch, total_gib, available_gib, model):
    from types import SimpleNamespace

    from app.services import local_ai_service
    manager.selected = model
    monkeypatch.setattr(manager, "engine", lambda: ("AMD64", artifact(b"test")))
    monkeypatch.setattr(manager, "_installed", lambda item: True)
    (manager.root / "llama.cpp-MIT.txt").write_text("MIT")
    (manager.root / f"{model}-Apache-2.0.txt").write_text("Apache-2.0")
    monkeypatch.setattr(local_ai_service.psutil, "virtual_memory", lambda: SimpleNamespace(total=total_gib * 1024**3, available=available_gib * 1024**3))
    monkeypatch.setattr(local_ai_service.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("Low memory must not launch an engine"))
    with pytest.raises(ValueError, match="enough free memory"):
        manager.generate("question")
    assert manager.process is None
    assert not manager.generation_lock.locked()


def test_repair_rebuilds_integrity_without_hashing_its_own_manifest(manager, monkeypatch):
    import zipfile

    from app.services.local_ai_catalog import ENGINE_VERSION
    archive = manager.root / "engine.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("llama-server.exe", b"test engine")
    monkeypatch.setattr(manager, "engine", lambda: ("AMD64", {"file": "engine.zip"}))
    monkeypatch.setattr(manager, "_download", lambda artifact: archive)
    use_transport(monkeypatch, lambda request: httpx.Response(200, text="Test license"))
    for _ in range(2):
        manager._install("small")
        assert manager.progress["phase"] == "complete"
        import json
        folder = manager.root / f"engine-{ENGINE_VERSION}-AMD64"
        hashes = json.loads((folder / "integrity.json").read_text())
        assert "integrity.json" not in hashes
        assert hashes["llama-server.exe"] == hashlib.sha256(b"test engine").hexdigest()


def test_structured_request_uses_llama_schema_and_rejects_oversized_context(manager, monkeypatch):
    monkeypatch.setattr(manager, "_load", lambda: None)
    manager.port = 9999
    manager.key = "test"
    schema = {"type": "object", "properties": {"value": {"const": "safe"}}, "required": ["value"]}
    def response(request):
        import json
        body = json.loads(request.content)
        if request.url.path == "/apply-template":
            return httpx.Response(200, json={"prompt": "test"})
        if request.url.path == "/tokenize":
            return httpx.Response(200, json={"tokens": [1]})
        assert body["response_format"] == {"type": "json_object", "schema": schema}
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"value":"safe"}'}}]})
    use_transport(monkeypatch, response)
    assert manager.generate("test", schema=schema) == '{"value":"safe"}'
    use_transport(monkeypatch, lambda request: httpx.Response(200, json={"prompt": "test", "tokens": list(range(4000))}))
    with pytest.raises(ValueError, match="too long"):
        manager.generate("test", schema=schema)
