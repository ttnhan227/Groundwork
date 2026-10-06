"""Managed CPU llama.cpp runtime and resumable, verified artifact installation."""

from __future__ import annotations

import atexit
import hashlib
import json
import os
import platform
import secrets
import socket
import subprocess
import threading
import time
import zipfile
from pathlib import Path

import httpx
import psutil

from app.core.config import get_settings
from app.services.local_ai_catalog import ENGINE_VERSION, ENGINES, MODELS
from app.services.process_lifetime import close_owner, own_child


class LocalAIService:
    _instance = None
    _instance_lock = threading.Lock()

    @classmethod
    def instance(cls):
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def __init__(self, root: Path | None = None):
        self.root = root or get_settings().get_database_path().parent / "local-ai"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.generation_lock = threading.Lock()
        self.cancel_download = threading.Event()
        self.cancel_generation = threading.Event()
        self.worker = None
        self.process = None
        self.process_owner = None
        self.log = None
        self.port = None
        self.key = None
        self.loaded = None
        self.last_used = 0.0
        self.selected = "small"
        self.gpus = self._gpu_names()
        self.progress = {"phase": "idle", "bytes": 0, "total": 0, "error": None}
        state = self.root / "selection.json"
        if state.exists():
            try:
                saved = json.loads(state.read_text(encoding="utf-8"))
                if saved.get("model") in MODELS:
                    self.selected = saved["model"]
            except (OSError, ValueError):
                pass
        atexit.register(self.close)
        threading.Thread(target=self._idle_monitor, daemon=True).start()

    @staticmethod
    def _gpu_names():
        if platform.system() != "Windows":
            return []
        try:
            executable = Path(os.environ["WINDIR"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
            result = subprocess.run(
                [
                    str(executable),
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress",
                ],
                capture_output=True,
                text=True,
                timeout=8,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            value = json.loads(result.stdout)
            return [value] if isinstance(value, str) else value if isinstance(value, list) else []
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return []

    def _idle_monitor(self):
        while True:
            time.sleep(15)
            if self.generation_lock.acquire(blocking=False):
                try:
                    if self.process and time.monotonic() - self.last_used > 180:
                        self.unload()
                finally:
                    self.generation_lock.release()

    def engine(self):
        arch = os.environ.get("PROCESSOR_ARCHITEW6432", platform.machine()).upper()
        arch = {"X86_64": "AMD64", "AARCH64": "ARM64"}.get(arch, arch)
        if platform.system() != "Windows" or arch not in ENGINES:
            raise ValueError("Built-in AI currently has Windows x64 and ARM64 CPU builds. File browsing still works.")
        return arch, ENGINES[arch]

    def status(self):
        memory = psutil.virtual_memory()
        try:
            arch, engine = self.engine()
            engine_size = engine["size"]
            supported = True
        except ValueError:
            arch, engine_size, supported = platform.machine(), 0, False
        with self.lock:
            models = [
                {
                    "id": key,
                    "name": model["name"],
                    "size": model["size"],
                    "license": model["license"],
                    "installed": self._installed(model),
                }
                for key, model in MODELS.items()
            ]
            return {
                "hardware": {
                    "architecture": arch,
                    "ram_total": memory.total,
                    "ram_available": memory.available,
                    "cpu_threads": psutil.cpu_count(),
                    "gpus": self.gpus,
                    "acceleration": "CPU only; GPU acceleration has not been validated",
                },
                "supported": supported,
                "engine_size": engine_size,
                "models": models,
                "selected": self.selected,
                "loaded": self.loaded,
                "generating": self.generation_lock.locked(),
                "download": dict(self.progress),
            }

    def _installed(self, artifact):
        path = self.root / artifact["file"]
        marker = path.with_suffix(path.suffix + ".verified")
        return (
            path.is_file()
            and path.stat().st_size == artifact["size"]
            and marker.exists()
            and marker.read_text(encoding="ascii") == artifact["sha256"]
        )

    def select(self, model_id):
        if model_id not in MODELS:
            raise ValueError("Unknown model choice")
        if not self.generation_lock.acquire(blocking=False):
            raise ValueError("Cancel the current answer before changing models.")
        try:
            self.unload()
            self.selected = model_id
            path = self.root / "selection.json"
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps({"model": model_id}), encoding="utf-8")
            os.replace(temporary, path)
        finally:
            self.generation_lock.release()

    def import_model(self, file_path_str: str, model_id: str | None = None) -> dict:
        """Imports an existing compatible GGUF model without downloading another copy."""
        source_path = Path(file_path_str).resolve()
        if not source_path.is_file():
            raise ValueError(f"File not found: {file_path_str}")
        if source_path.stat().st_size < 10 * 1024 * 1024:
            raise ValueError("File is too small to be a valid GGUF model.")
        with source_path.open("rb") as f:
            if f.read(4) != b"GGUF":
                raise ValueError("The selected file is not a valid GGUF model.")

        digest = hashlib.sha256()
        with source_path.open("rb") as f:
            while chunk := f.read(1024 * 1024):
                digest.update(chunk)
        file_sha256 = digest.hexdigest()

        target_id = model_id
        if not target_id:
            for mid, m in MODELS.items():
                if m.get("sha256") == file_sha256:
                    target_id = mid
                    break

        import shutil
        if target_id and target_id in MODELS:
            artifact = MODELS[target_id]
            if file_sha256 != artifact["sha256"]:
                raise ValueError(f"The model checksum does not match the pinned revision for '{target_id}'.")
            target_file = self.root / artifact["file"]
            if source_path != target_file:
                shutil.copy2(source_path, target_file)
            target_file.with_suffix(target_file.suffix + ".verified").write_text(artifact["sha256"], encoding="ascii")
            return {"status": "imported", "model_id": target_id, "name": artifact["name"]}
        else:
            target_file = self.root / source_path.name
            if source_path != target_file:
                shutil.copy2(source_path, target_file)
            target_file.with_suffix(target_file.suffix + ".verified").write_text(file_sha256, encoding="ascii")
            custom_id = f"custom_{source_path.stem}"
            MODELS[custom_id] = {
                "name": f"Imported: {source_path.stem}",
                "size": target_file.stat().st_size,
                "sha256": file_sha256,
                "file": source_path.name,
                "license": "Imported model",
                "custom": True,
            }
            return {"status": "imported", "model_id": custom_id, "name": f"Imported: {source_path.stem}"}

    def install(self, model_id):
        if model_id not in MODELS:
            raise ValueError("Unknown model choice")
        self.engine()
        with self.lock:
            if self.worker and self.worker.is_alive():
                raise ValueError("A download is already running.")
            self.cancel_download.clear()
            self.progress = {"phase": "starting", "bytes": 0, "total": 0, "error": None}
            self.worker = threading.Thread(target=self._install, args=(model_id,), daemon=True)
            self.worker.start()

    def _download(self, artifact):
        target = self.root / artifact["file"]
        partial = target.with_suffix(target.suffix + ".part")
        if self._installed(artifact):
            digest = hashlib.sha256()
            with target.open("rb") as source:
                while block := source.read(1024 * 1024):
                    if self.cancel_download.is_set():
                        raise InterruptedError()
                    digest.update(block)
            if digest.hexdigest() == artifact["sha256"]:
                return target
            target.with_suffix(target.suffix + ".verified").unlink(missing_ok=True)
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > artifact["size"]:
            partial.unlink()
            offset = 0
        self.progress.update(phase="downloading", artifact=artifact["file"], bytes=offset, total=artifact["size"])
        if offset < artifact["size"]:
            with httpx.Client(follow_redirects=True, timeout=30, trust_env=False) as client:
                with client.stream(
                    "GET", artifact["url"], headers={"Range": f"bytes={offset}-", "Accept-Encoding": "identity"}
                ) as response:
                    response.raise_for_status()
                    if response.status_code == 206:
                        expected = f"bytes {offset}-"
                        if not response.headers.get("content-range", "").startswith(expected):
                            raise ValueError(
                                "The download server returned an invalid resume range. Retry the download."
                            )
                    elif response.status_code == 200:
                        offset = 0
                    else:
                        raise ValueError("The download server returned an unexpected response.")
                    with partial.open("ab" if offset else "wb") as output:
                        for block in response.iter_bytes(1024 * 256):
                            if self.cancel_download.is_set():
                                raise InterruptedError()
                            if offset + len(block) > artifact["size"]:
                                raise ValueError("Downloaded file is larger than expected.")
                            output.write(block)
                            offset += len(block)
                            self.progress["bytes"] = offset
                        output.flush()
                        os.fsync(output.fileno())
        if partial.stat().st_size != artifact["size"]:
            raise ValueError("Download interrupted. Retry to resume the remaining data.")
        self.progress["phase"] = "checking"
        digest = hashlib.sha256()
        with partial.open("rb") as source:
            while block := source.read(1024 * 1024):
                if self.cancel_download.is_set():
                    raise InterruptedError()
                digest.update(block)
        if digest.hexdigest() != artifact["sha256"]:
            partial.unlink()
            raise ValueError("The download failed its safety check. Retry to download a fresh copy.")
        os.replace(partial, target)
        target.with_suffix(target.suffix + ".verified").write_text(artifact["sha256"], encoding="ascii")
        return target

    def _install(self, model_id):
        try:
            arch, artifact = self.engine()
            archive = self._download(artifact)
            folder = self.root / f"engine-{ENGINE_VERSION}-{arch}"
            folder.mkdir(exist_ok=True)
            self.progress["phase"] = "installing"
            with zipfile.ZipFile(archive) as bundle:
                for member in bundle.infolist():
                    destination = (folder / member.filename).resolve()
                    if (
                        not destination.is_relative_to(folder.resolve())
                        or (member.external_attr >> 16) & 0o170000 == 0o120000
                    ):
                        raise ValueError("Unsafe engine archive")
                bundle.extractall(folder)
            if not list(folder.rglob("llama-server.exe")):
                raise ValueError("The engine download is missing its executable.")
            hashes = {
                str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in folder.rglob("*")
                if path.is_file() and path.name != "integrity.json"
            }
            (folder / "integrity.json").write_text(json.dumps(hashes), encoding="utf-8")
            self._download(MODELS[model_id])
            # Retain the actual upstream license texts, not just a UI label.
            model = MODELS[model_id]
            notices = [
                ("llama.cpp-MIT.txt", f"https://raw.githubusercontent.com/ggml-org/llama.cpp/{ENGINE_VERSION}/LICENSE"),
                (
                    f"{model_id}-Apache-2.0.txt",
                    f"https://huggingface.co/{model['base_repo']}/resolve/{model['base_revision']}/LICENSE",
                ),
            ]
            with httpx.Client(follow_redirects=True, timeout=30, trust_env=False) as client:
                for filename, url in notices:
                    response = client.get(url)
                    response.raise_for_status()
                    (self.root / filename).write_text(response.text, encoding="utf-8")
            (self.root / "sources.json").write_text(
                json.dumps({"engine": artifact, "models": MODELS}, indent=2), encoding="utf-8"
            )
            self.progress.update(phase="complete", error=None)
        except InterruptedError:
            self.progress.update(phase="cancelled", error=None)
        except Exception as exc:
            # Avoid exposing network URLs or credentials in ordinary UI.
            message = (
                str(exc)
                if isinstance(exc, ValueError)
                else "Couldn't finish the download. Check your connection and free disk space, then retry to resume."
            )
            self.progress.update(phase="error", error=message)

    def unload(self):
        with self.lock:
            process, self.process = self.process, None
            self.loaded = None
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            if self.log:
                self.log.close()
                self.log = None
            close_owner(self.process_owner)
            self.process_owner = None

    def close(self):
        self.cancel_download.set()
        self.cancel_generation.set()
        self.unload()

    def cancel(self):
        self.cancel_generation.set()
        self.unload()

    def _load(self):
        arch, artifact = self.engine()
        model = MODELS[self.selected]
        if not self._installed(model) or not self._installed(artifact):
            raise ValueError("Set up built-in AI first. Your files can still be browsed and searched.")
        if (
            not (self.root / "llama.cpp-MIT.txt").is_file()
            or not (self.root / f"{self.selected}-Apache-2.0.txt").is_file()
        ):
            raise ValueError(
                "AI setup needs to finish downloading its license notices. Choose Repair download in AI setup."
            )
        # Conservative available-memory guard, not a published hardware requirement.
        reserve = max(1024**3, int(psutil.virtual_memory().total * 0.15))
        if psutil.virtual_memory().available < model["size"] * 3 + reserve:
            raise ValueError(
                "There isn't enough free memory right now. Close other apps or choose the smaller model. File browsing still works."
            )
        if self.process and self.process.poll() is None:
            return
        executables = list((self.root / f"engine-{ENGINE_VERSION}-{arch}").rglob("llama-server.exe"))
        if len(executables) != 1:
            raise ValueError("The AI engine needs repair. Download it again from AI setup.")
        folder = self.root / f"engine-{ENGINE_VERSION}-{arch}"
        try:
            hashes = json.loads((folder / "integrity.json").read_text(encoding="utf-8"))
            for relative, digest in hashes.items():
                path = (folder / relative).resolve()
                if not path.is_relative_to(folder.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise ValueError("Engine files changed. Download the engine again to repair it.")
            model_path = self.root / model["file"]
            digest = hashlib.sha256()
            with model_path.open("rb") as source:
                if source.read(4) != b"GGUF":
                    raise ValueError("This model isn't a supported GGUF file. Download it again.")
                source.seek(0)
                while block := source.read(1024 * 1024):
                    if self.cancel_generation.is_set():
                        raise InterruptedError("Answer cancelled")
                    digest.update(block)
            if digest.hexdigest() != model["sha256"]:
                model_path.with_suffix(model_path.suffix + ".verified").unlink(missing_ok=True)
                raise ValueError("Model files changed. Download this model again to repair it.")
        except (OSError, KeyError) as exc:
            raise ValueError("The AI engine needs repair. Download it again from AI setup.") from exc
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.key = secrets.token_hex(32)
        # Keep authentication out of process arguments and inherited provider settings.
        env = {
            k: v
            for k, v in os.environ.items()
            if not k.startswith("LLAMA_")
            and k not in {"OPENAI_API_KEY", "GEMINI_API_KEY", "CLOUD_SYNC_TOKEN", "GROUNDWORK_CORE_TOKEN"}
        }
        env["LLAMA_API_KEY"] = self.key
        self.log = (self.root / "engine.log").open("ab")
        self.process = subprocess.Popen(
            [
                str(executables[0]),
                "-m",
                str(self.root / model["file"]),
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "-c",
                "4096",
                "-np",
                "1",
                "-ngl",
                "0",
                "-t",
                str(max(1, min(4, (os.cpu_count() or 2) - 1))),
                "--no-webui",
            ],
            stdin=subprocess.DEVNULL,
            stdout=self.log,
            stderr=self.log,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            self.process_owner = own_child(self.process)
        except OSError as exc:
            self.unload()
            raise ValueError("The AI engine couldn't start safely. Restart Groundwork and try again.") from exc
        deadline = time.monotonic() + 90
        with httpx.Client(timeout=1, trust_env=False) as client:
            while time.monotonic() < deadline:
                if self.cancel_generation.is_set():
                    raise InterruptedError("Answer cancelled")
                if not self.process or self.process.poll() is not None:
                    self.unload()
                    raise ValueError("The AI engine couldn't load. Try freeing memory or download the engine again.")
                try:
                    if (
                        client.get(
                            f"http://127.0.0.1:{self.port}/health", headers={"Authorization": f"Bearer {self.key}"}
                        ).status_code
                        == 200
                    ):
                        self.loaded = self.selected
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(0.2)
        self.unload()
        raise ValueError("AI took too long to load. Try the smaller model or free some memory.")

    def generate(self, prompt, system_prompt="", schema=None):
        if not self.generation_lock.acquire(blocking=False):
            raise ValueError("Another answer is running. Wait or cancel it first.")
        self.cancel_generation.clear()
        started = time.monotonic()
        try:
            self._load()
            messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]
            headers = {"Authorization": f"Bearer {self.key}"}
            with httpx.Client(timeout=180, trust_env=False) as client:
                tokenized = client.post(
                    f"http://127.0.0.1:{self.port}/apply-template",
                    headers=headers,
                    json={"messages": messages, "chat_template_kwargs": {"enable_thinking": False}},
                )
                tokenized.raise_for_status()
                tokens = client.post(
                    f"http://127.0.0.1:{self.port}/tokenize",
                    headers=headers,
                    json={"content": tokenized.json()["prompt"]},
                )
                tokens.raise_for_status()
                max_output = 768 if schema is not None else 512
                if len(tokens.json()["tokens"]) > 4096 - max_output - 184:
                    raise ValueError(
                        "These excerpts are too long for this model. Select fewer files or a shorter passage."
                    )
                payload = {
                    "messages": messages,
                    "max_tokens": max_output,
                    "temperature": 0.2,
                    "stream": False,
                    "chat_template_kwargs": {"enable_thinking": False},
                }
                if schema is not None:
                    payload["response_format"] = {"type": "json_object", "schema": schema}
                response = client.post(
                    f"http://127.0.0.1:{self.port}/v1/chat/completions",
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
                answer = response.json()["choices"][0]["message"]["content"]
            if self.cancel_generation.is_set():
                raise InterruptedError("Answer cancelled")
            elapsed = time.monotonic() - started
            rss = psutil.Process(self.process.pid).memory_info().rss if self.process else 0
            (self.root / "last-run.json").write_text(
                json.dumps(
                    {
                        "model": self.selected,
                        "elapsed_seconds": elapsed,
                        "resident_bytes_after_answer": rss,
                        "quality_evaluated": False,
                    }
                ),
                encoding="utf-8",
            )
            return answer
        except InterruptedError:
            self.unload()
            raise
        except httpx.HTTPError as exc:
            if self.cancel_generation.is_set():
                raise InterruptedError("Answer cancelled") from exc
            self.unload()
            raise ValueError(
                "The local answer failed. Try fewer files, the smaller model, or free some memory."
            ) from exc
        finally:
            self.last_used = time.monotonic()
            self.generation_lock.release()
