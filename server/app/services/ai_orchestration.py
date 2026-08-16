"""Central provider boundary for every AI and embedding request.

This module intentionally contains no product prompts. Feature modules own their
prompts while this boundary owns authentication, timeouts, bounded retries,
response validation, streaming, and operational logging.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class AIProviderError(RuntimeError):
    """A safe, feature-agnostic provider failure."""


def _json_object(content: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise AIProviderError("The language model returned invalid structured data") from exc
    if not isinstance(value, dict):
        raise AIProviderError("The language model returned an invalid structured result")
    return value


class AIOrchestrator:
    max_attempts = 3

    @staticmethod
    def _headers() -> dict[str, str]:
        settings = get_settings()
        if not settings.llm_api_key:
            raise AIProviderError("LLM_API_KEY is not configured")
        return {"Authorization": f"Bearer {settings.llm_api_key}"}

    async def _post(self, path: str, payload: dict[str, Any], operation: str) -> httpx.Response:
        settings = get_settings()
        started = time.monotonic()
        last_error: Exception | None = None
        for attempt in range(1, self.max_attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                    response = await client.post(
                        f"{settings.llm_base_url.rstrip('/')}/{path.lstrip('/')}",
                        headers=self._headers(),
                        json=payload,
                    )
                response.raise_for_status()
                logger.info(
                    "ai_provider_complete operation=%s model=%s attempt=%s duration_ms=%s",
                    operation,
                    payload.get("model", "unknown"),
                    attempt,
                    round((time.monotonic() - started) * 1000),
                )
                return response
            except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
                last_error = exc
                retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code in {408, 409, 425, 429} or exc.response.status_code >= 500
                if attempt >= self.max_attempts or not retryable:
                    break
                await asyncio.sleep(0.25 * (2 ** (attempt - 1)))
        logger.warning(
            "ai_provider_failed operation=%s model=%s duration_ms=%s error=%s",
            operation,
            payload.get("model", "unknown"),
            round((time.monotonic() - started) * 1000),
            type(last_error).__name__ if last_error else "unknown",
        )
        raise AIProviderError("The configured AI provider is unavailable") from last_error

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        operation: str,
        model: str | None = None,
        temperature: float = 0.1,
    ) -> str:
        settings = get_settings()
        response = await self._post(
            "chat/completions",
            {
                "model": model or settings.llm_model,
                "temperature": temperature,
                "messages": messages,
            },
            operation,
        )
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AIProviderError("The AI provider returned an invalid response") from exc
        if not isinstance(content, str) or not content.strip():
            raise AIProviderError("The AI provider returned an empty response")
        return content.strip()

    async def complete_json(
        self,
        messages: list[dict[str, Any]],
        *,
        operation: str,
        model: str | None = None,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        settings = get_settings()
        response = await self._post(
            "chat/completions",
            {
                "model": model or settings.llm_model,
                "temperature": temperature,
                "response_format": {"type": "json_object"},
                "messages": messages,
            },
            operation,
        )
        try:
            return _json_object(response.json()["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as exc:
            raise AIProviderError("The AI provider returned an invalid response") from exc

    async def embeddings(self, texts: list[str], *, operation: str = "embeddings") -> list[list[float]]:
        if not texts:
            return []
        settings = get_settings()
        vectors: list[list[float]] = []
        for start in range(0, len(texts), 64):
            response = await self._post(
                "embeddings",
                {"model": settings.embedding_model, "input": texts[start:start + 64]},
                operation,
            )
            try:
                items = sorted(response.json()["data"], key=lambda item: item["index"])
                vectors.extend(item["embedding"] for item in items)
            except (KeyError, TypeError) as exc:
                raise AIProviderError("The embedding provider returned an invalid response") from exc
        return vectors

    def embeddings_sync(self, texts: list[str], *, operation: str = "embeddings") -> list[list[float]]:
        """Synchronous adapter for worker-only ingestion paths."""
        if not texts:
            return []
        settings = get_settings()
        vectors: list[list[float]] = []
        started = time.monotonic()
        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            for start in range(0, len(texts), 64):
                last_error: Exception | None = None
                for attempt in range(1, self.max_attempts + 1):
                    try:
                        response = client.post(
                            f"{settings.llm_base_url.rstrip('/')}/embeddings",
                            headers=self._headers(),
                            json={"model": settings.embedding_model, "input": texts[start:start + 64]},
                        )
                        response.raise_for_status()
                        items = sorted(response.json()["data"], key=lambda item: item["index"])
                        vectors.extend(item["embedding"] for item in items)
                        break
                    except (httpx.HTTPError, KeyError, TypeError) as exc:
                        last_error = exc
                        retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code in {408, 409, 425, 429} or exc.response.status_code >= 500
                        if attempt >= self.max_attempts or not retryable:
                            raise AIProviderError("The configured embedding provider is unavailable") from exc
                        time.sleep(0.25 * (2 ** (attempt - 1)))
                if last_error and not vectors:
                    raise AIProviderError("The configured embedding provider is unavailable") from last_error
        logger.info(
            "ai_provider_complete operation=%s model=%s duration_ms=%s",
            operation,
            settings.embedding_model,
            round((time.monotonic() - started) * 1000),
        )
        return vectors

    async def stream(
        self,
        messages: list[dict[str, Any]],
        *,
        operation: str,
        model: str | None = None,
        temperature: float = 0.1,
    ) -> AsyncIterator[str]:
        settings = get_settings()
        payload = {
            "model": model or settings.llm_model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                async with client.stream(
                    "POST",
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if not raw or raw == "[DONE]":
                            continue
                        event = json.loads(raw)
                        content = event.get("choices", [{}])[0].get("delta", {}).get("content")
                        if isinstance(content, str) and content:
                            yield content
        except (httpx.HTTPError, json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise AIProviderError("The configured AI provider is unavailable") from exc
        finally:
            logger.info(
                "ai_provider_stream_complete operation=%s model=%s duration_ms=%s",
                operation,
                payload["model"],
                round((time.monotonic() - started) * 1000),
            )


ai_orchestrator = AIOrchestrator()
