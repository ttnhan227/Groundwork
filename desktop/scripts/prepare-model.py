"""Build-time model download; the installed app only loads bundled local files."""
from pathlib import Path
import shutil
import hashlib
import json
import urllib.request

from fastembed import TextEmbedding
from huggingface_hub import hf_hub_download

root = Path(__file__).resolve().parents[2]
destination = root / "server/models/minilm"
if not (destination / "model.onnx").is_file():
    model = TextEmbedding("sentence-transformers/all-MiniLM-L6-v2", cache_dir=str(root / "server/.model-cache"))
    model_path = Path(model.model._model_dir)
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(model_path, destination, dirs_exist_ok=True)
if not (destination / "LICENSE").is_file():
    card_path = hf_hub_download("sentence-transformers/all-MiniLM-L6-v2", "README.md", cache_dir=str(root / "server/.model-cache"))
    shutil.copyfile(card_path, destination / "MODEL_CARD.md")
    urllib.request.urlretrieve("https://www.apache.org/licenses/LICENSE-2.0.txt", destination / "LICENSE")
manifest = {"model": "sentence-transformers/all-MiniLM-L6-v2", "license": "Apache-2.0", "files": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in destination.iterdir() if path.is_file() and path.name != "manifest.json"}}
manifest_path = destination / "manifest.json"
manifest_text = json.dumps(manifest, indent=2)
if not manifest_path.is_file() or manifest_path.read_text(encoding="utf-8") != manifest_text:
    manifest_path.write_text(manifest_text, encoding="utf-8")
print(f"Bundled local model ready: {destination}")
