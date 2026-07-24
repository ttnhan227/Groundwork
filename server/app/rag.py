from dataclasses import dataclass
from functools import lru_cache
import re
from typing import TypeVar

import httpx

from app.config import get_settings


@dataclass(frozen=True)
class TextChunk:
    page_number: int
    chunk_index: int
    text: str


T = TypeVar("T")


def cited_sources(answer: str, sources: list[T], source_key) -> list[T]:
    """Return only referenced sources, collapsed to one citation per document page."""
    referenced = {
        int(match) - 1
        for match in re.findall(r"\[Source\s+(\d+)\]", answer, flags=re.IGNORECASE)
        if 0 < int(match) <= len(sources)
    }
    candidates = [sources[index] for index in sorted(referenced)]
    unique: list[T] = []
    seen: set[object] = set()
    for source in candidates:
        key = source_key(source)
        if key not in seen:
            seen.add(key)
            unique.append(source)
    return unique


def is_casual_message(message: str) -> bool:
    normalized = re.sub(r"[^a-z\s]", "", message.lower()).strip()
    return normalized in {
        "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
        "thanks", "thank you", "ok", "okay",
    }


def clean_user_answer(answer: str) -> str:
    """Remove internal retrieval labels while preserving readable prose."""
    cleaned = re.sub(
        r"\bis\s+(?:stated|mentioned|shown|found|listed)\s+in\s+\*{0,2}Source\s+\d+\*{0,2}\s*:?",
        "is:",
        answer,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\baccording\s+to\s+\*{0,2}Source\s+\d+\*{0,2}\s*,?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\*{0,2}Source\s+\d+\*{0,2}\s+(?:says|states|mentions|shows)\s*",
        "The document states ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s*\[Source\s+\d+\]", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\*{0,2}Source\s+\d+\*{0,2}\s*:?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r" {2,}", " ", cleaned)
    return cleaned.strip()


def build_retrieval_query(question: str, history: list[tuple[str, str]]) -> str:
    """Include recent context so ambiguous follow-ups retrieve the original subject."""
    recent = [
        clean_user_answer(content)
        for _, content in history[-4:]
    ]
    return "\n".join([*recent, question])


def relevant_snippet(text: str, answer: str, question: str, limit: int = 350) -> str:
    """Choose a readable excerpt around answer terms instead of the chunk's beginning."""
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    ignored = {
        "about", "answer", "document", "from", "mentioned", "page", "school",
        "source", "that", "their", "there", "this", "what", "which", "with",
    }
    terms = [
        term
        for term in re.findall(r"[A-Za-z0-9][A-Za-z0-9.+#-]{2,}", f"{answer} {question}")
        if term.lower() not in ignored
    ]
    positions = [compact.lower().find(term.lower()) for term in terms]
    matches = [position for position in positions if position >= 0]
    center = min(matches) if matches else 0
    start = max(0, center - limit // 3)
    if start:
        next_space = compact.find(" ", start)
        start = next_space + 1 if next_space >= 0 else start
    end = min(len(compact), start + limit)
    if end < len(compact):
        end = compact.rfind(" ", start, end)
    prefix = "…" if start else ""
    suffix = "…" if end < len(compact) else ""
    return f"{prefix}{compact[start:end].strip()}{suffix}"


def chunk_pages(pages: list[tuple[int, str]], size: int, overlap: int) -> list[TextChunk]:
    if size <= 0 or overlap < 0 or overlap >= size:
        raise ValueError("Chunk size must be positive and overlap must be smaller than size")
    chunks: list[TextChunk] = []
    index = 0
    for page_number, raw_text in pages:
        text = " ".join(raw_text.split())
        start = 0
        while start < len(text):
            end = min(len(text), start + size)
            if end < len(text):
                boundary = text.rfind(" ", start + size // 2, end)
                if boundary > start:
                    end = boundary
            value = text[start:end].strip()
            if value:
                chunks.append(TextChunk(page_number, index, value))
                index += 1
            if end >= len(text):
                break
            start = max(start + 1, end - overlap)
    return chunks


@lru_cache(maxsize=1)
def embedding_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(get_settings().embedding_model)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    vectors = embedding_model().encode(texts, normalize_embeddings=True)
    return [vector.tolist() for vector in vectors]


async def generate_answer(question: str, context: list[str], history: list[tuple[str, str]]) -> str:
    settings = get_settings()
    if not settings.llm_api_key:
        raise RuntimeError("LLM_API_KEY is not configured")
    sources = "\n\n".join(f"[Source {index + 1}]\n{text}" for index, text in enumerate(context))
    messages = [
        {
            "role": "system",
            "content": (
                "Answer only from the supplied PDF sources. If the answer is absent, say so clearly. "
                "Do not invent facts. Write a polished Markdown response with short paragraphs, headings, "
                "and bullets when useful. Cite only the sources that directly support the answer using "
                "[Source N] at the end of the supported paragraph. Source labels are internal markers: "
                "never discuss, explain, or mention 'Source N' in the prose itself. Avoid repeating the "
                "same citation after every sentence."
                " When the context contains recognizable section headings such as Education, Experience, "
                "or Skills, refer to that visible section name instead of any source identifier."
            ),
        },
        *[
            {
                "role": role,
                "content": re.sub(r"\[Source\s+\d+\]", "", content, flags=re.IGNORECASE),
            }
            for role, content in history[-8:]
        ],
        {"role": "user", "content": f"PDF sources:\n{sources}\n\nQuestion: {question}"},
    ]
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        response = await client.post(
            f"{settings.llm_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            json={"model": settings.llm_model, "messages": messages, "temperature": 0.1},
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"].strip()
