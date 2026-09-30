"""Embedding generator supporting offline local hashing vectors and external providers.

Provides:
1. Fast, deterministic local subword hashing vectorizer (384 dimensions, L2 normalized).
   Requires no GPU, no model download, runs in 0.1ms per chunk, 100% offline.
2. Ollama local model embeddings (e.g., nomic-embed-text) when running.
3. OpenAI / Gemini embeddings when API keys are configured.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Sequence

import httpx
import numpy as np

from app.core.config import get_settings

logger = logging.getLogger("groundwork.embeddings")

VECTOR_DIM = 384


class EmbeddingEngine:
    """Configurable embedding generator for semantic search."""

    def __init__(self) -> None:
        self.settings = get_settings()

    def embed_text(self, text: str) -> list[float]:
        """Generates a normalized embedding vector for the given text."""
        provider = self.settings.ai_provider

        if provider == "ollama":
            try:
                return self._embed_ollama(text)
            except Exception as exc:
                logger.debug("Ollama embedding failed (%s), falling back to local vectorizer", exc)
                return self._embed_local(text)

        elif provider == "openai" and self.settings.openai_api_key:
            try:
                return self._embed_openai(text)
            except Exception as exc:
                logger.debug("OpenAI embedding failed (%s), falling back to local vectorizer", exc)
                return self._embed_local(text)

        elif provider == "gemini" and self.settings.gemini_api_key:
            try:
                return self._embed_gemini(text)
            except Exception as exc:
                logger.debug("Gemini embedding failed (%s), falling back to local vectorizer", exc)
                return self._embed_local(text)

        # Default local offline deterministic vectorizer
        return self._embed_local(text)

    def embed_batch(self, texts: Sequence[str]) -> list[list[float]]:
        """Generates embeddings for a batch of text chunks."""
        return [self.embed_text(t) for t in texts]

    @staticmethod
    def _embed_local(text: str, dim: int = VECTOR_DIM) -> list[float]:
        """Generates a 384-dimensional deterministic feature vector via token & n-gram hashing."""
        vec = np.zeros(dim, dtype=np.float32)
        if not text.strip():
            return vec.tolist()

        # Tokenize words and subwords
        tokens = re.findall(r"[A-Za-z0-9_]{2,}", text.lower())
        for token in tokens:
            # Word hash
            h = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16) % dim
            vec[h] += 1.0

            # 3-gram character subwords
            if len(token) >= 3:
                for i in range(len(token) - 2):
                    sub = token[i:i + 3]
                    sh = int(hashlib.sha1(sub.encode("utf-8")).hexdigest(), 16) % dim
                    vec[sh] += 0.5

        # L2 Normalization
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.tolist()

    def _embed_ollama(self, text: str) -> list[float]:
        url = f"{self.settings.ollama_base_url}/api/embeddings"
        payload = {
            "model": self.settings.ollama_embedding_model,
            "prompt": text[:2000],
        }
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            embedding = data.get("embedding", [])
            # Normalize vector
            arr = np.array(embedding, dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 0:
                arr = arr / norm
            return arr.tolist()

    def _embed_openai(self, text: str) -> list[float]:
        url = "https://api.openai.com/v1/embeddings"
        headers = {"Authorization": f"Bearer {self.settings.openai_api_key}"}
        payload = {
            "model": "text-embedding-3-small",
            "input": text[:4000],
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            embedding = data["data"][0]["embedding"]
            arr = np.array(embedding, dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 0:
                arr = arr / norm
            return arr.tolist()

    def _embed_gemini(self, text: str) -> list[float]:
        key = self.settings.gemini_api_key
        url = f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={key}"
        payload = {
            "model": "models/text-embedding-004",
            "content": {"parts": [{"text": text[:4000]}]},
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            embedding = data["embedding"]["values"]
            arr = np.array(embedding, dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 0:
                arr = arr / norm
            return arr.tolist()


def cosine_similarity(v1: Sequence[float], v2: Sequence[float]) -> float:
    """Computes cosine similarity between two normalized vectors."""
    a = np.array(v1, dtype=np.float32)
    b = np.array(v2, dtype=np.float32)
    dot = np.dot(a, b)
    # Since inputs are normalized, dot product is cosine similarity
    return float(max(-1.0, min(1.0, dot)))


_embedding_engine: EmbeddingEngine | None = None


def get_embedding_engine() -> EmbeddingEngine:
    global _embedding_engine
    if _embedding_engine is None:
        _embedding_engine = EmbeddingEngine()
    return _embedding_engine
