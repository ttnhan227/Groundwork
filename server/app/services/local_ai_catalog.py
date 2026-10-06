"""Pinned upstream artifacts. No moving 'latest' URLs or user supplied binaries.

Verified against GitHub release asset digests and HF LFS SHA256 on 2026-10-05.
Models: Apache-2.0; llama.cpp: MIT. Keep notices with downloaded artifacts.
"""

ENGINE_VERSION = "b11404"
ENGINES = {
    "AMD64": {
        "size": 19390831,
        "sha256": "c583d6a9a34d21c9b9d5c4e30a36ebc390c72befb537ec6acc89caa2fd9d86bf",
        "file": "llama-b11404-bin-win-cpu-x64.zip",
    },
    "ARM64": {
        "size": 12221514,
        "sha256": "ca46bfa2a65e36cbe46e80cd6783aac5c74cbb075d3c382eccd0a80eb585f892",
        "file": "llama-b11404-bin-win-cpu-arm64.zip",
    },
}
for artifact in ENGINES.values():
    artifact["url"] = f"https://github.com/ggml-org/llama.cpp/releases/download/{ENGINE_VERSION}/{artifact['file']}"

MODELS = {
    "compact": {
        "name": "Qwen 2.5 · compact (limited accuracy)",
        "size": 397808192,
        "sha256": "6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653",
        "file": "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
        "revision": "41ba88dbac95fed2528c92514c131d73eb5a174b",
        "repo": "bartowski/Qwen2.5-0.5B-Instruct-GGUF",
    },
    "small": {
        "name": "Qwen 2.5 · small",
        "size": 986048768,
        "sha256": "1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370",
        "file": "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
        "revision": "9eadc66189c7641e1ddd226b8267a9119b2ce2d4",
        "repo": "bartowski/Qwen2.5-1.5B-Instruct-GGUF",
    },
}
MODELS["compact"].update(
    base_repo="Qwen/Qwen2.5-0.5B-Instruct", base_revision="7ae557604adf67be50417f59c2c2f167def9a775"
)
MODELS["small"].update(base_repo="Qwen/Qwen2.5-1.5B-Instruct", base_revision="989aa7980e4cf806f80c7fef2b1adb7bc71aa306")
MODELS["larger"] = {
    "name": "Qwen 3 · larger",
    "size": 2497280960,
    "sha256": "fbe1d5edd4ce802ae3ae7c7e4ab7d09789d697fdac1fc7929f8df4ca3c41bae3",
    "file": "Qwen_Qwen3-4B-Q4_K_M.gguf",
    "revision": "cb76885dc66d50759b207c5a48c4e78dfa00c638",
    "repo": "bartowski/Qwen_Qwen3-4B-GGUF",
    "base_repo": "Qwen/Qwen3-4B",
    "base_revision": "1cfa9a7208912126459214e8b04321603b3df60c",
}
for artifact in MODELS.values():
    artifact["url"] = f"https://huggingface.co/{artifact['repo']}/resolve/{artifact['revision']}/{artifact['file']}"
    artifact["license"] = "Apache-2.0"
