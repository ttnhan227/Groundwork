"""Local-only embeddings. Packaged builds include MiniLM; development can use hashing."""

from __future__ import annotations

import hashlib
import logging
import re
import sys
import threading
from pathlib import Path
from typing import Sequence

import numpy as np

from app.core.config import get_settings

logger = logging.getLogger("groundwork.embeddings")

VECTOR_DIM = 384


class EmbeddingEngine:
    """Configurable embedding generator for semantic search."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self._lock = threading.Lock()
        self.model = None
        model_path = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2])) / "models" / "minilm"
        if model_path.is_dir():
            from fastembed import TextEmbedding
            self.model = TextEmbedding("sentence-transformers/all-MiniLM-L6-v2", specific_model_path=str(model_path), local_files_only=True, threads=2)
        self.model_id = "minilm-l6-v2" if self.model else "hash-v1"

    def embed_text(self, text: str) -> list[float]:
        """Generates a normalized embedding vector for the given text."""
        # A generation provider must never change corpus vectors or upload files.
        # All stored/query vectors use the same deterministic local representation.
        if self.model:
            with self._lock:
                return next(self.model.embed([text])).tolist()
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
