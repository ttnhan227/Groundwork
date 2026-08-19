"""Central provider boundary for every AI and embedding request.

This module intentionally contains no product prompts. Feature modules own their
prompts while this boundary owns authentication, timeouts, bounded retries,
response validation, streaming, and operational logging. All failures surface
explicit, actionable error details without silent fallbacks or masked responses.
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
    """A clear, actionable provider failure."""


def _json_object(content: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise AIProviderError(f"The language model returned invalid JSON: {cleaned[:200]}") from exc
    if not isinstance(value, dict):
        raise AIProviderError(f"The language model returned a {type(value).__name__} instead of a JSON object")
    return value


def _extract_error_detail(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        try:
            body = exc.response.json()
            if isinstance(body, list) and body and isinstance(body[0], dict):
                body = body[0]
            if isinstance(body, dict):
                err = body.get("error")
                if isinstance(err, dict) and "message" in err:
                    return f"AI provider error ({status_code}): {err['message']}"
                if "detail" in body:
                    detail = body["detail"]
                    if isinstance(detail, str):
                        return f"AI provider error ({status_code}): {detail}"
                    if isinstance(detail, dict) and "message" in detail:
                        return f"AI provider error ({status_code}): {detail['message']}"
                if "message" in body:
                    return f"AI provider error ({status_code}): {body['message']}"
        except Exception:
            pass
        response_snippet = exc.response.text.strip()[:200]
        return f"AI provider returned HTTP {status_code}: {response_snippet}"
    if isinstance(exc, httpx.RequestError):
        return f"Could not connect to AI provider ({type(exc).__name__}): {str(exc)}"
    return str(exc)


class AIOrchestrator:
    max_attempts = 2

    @staticmethod
    def _headers() -> dict[str, str]:
        settings = get_settings()
        if not settings.llm_api_key or not settings.llm_api_key.strip():
            raise AIProviderError(
                "LLM_API_KEY is not configured or empty. Please configure a valid API key in your environment variables."
            )
        return {"Authorization": f"Bearer {settings.llm_api_key.strip()}"}

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
                retryable = (
                    isinstance(exc, httpx.HTTPStatusError)
                    and exc.response.status_code in {408, 409, 425, 429, 500, 502, 503, 504}
                )
                if attempt >= self.max_attempts or not retryable:
                    break
                await asyncio.sleep(0.25 * (2 ** (attempt - 1)))
        error_msg = _extract_error_detail(last_error) if last_error else "Unknown AI provider failure"
        logger.warning(
            "ai_provider_failed operation=%s model=%s duration_ms=%s error=%s",
            operation,
            payload.get("model", "unknown"),
            round((time.monotonic() - started) * 1000),
            error_msg,
        )
        raise AIProviderError(error_msg) from last_error

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        operation: str,
        model: str | None = None,
        temperature: float = 0.1,
    ) -> str:
        settings = get_settings()
        target_model = model or settings.llm_model
        if not target_model:
            raise AIProviderError("LLM_MODEL is not configured. Please set LLM_MODEL in your environment variables or .env file.")
        response = await self._post(
            "chat/completions",
            {
                "model": target_model,
                "temperature": temperature,
                "messages": messages,
            },
            operation,
        )
        try:
            content = response.json()["choices"][0]["message"]["content"]
            if isinstance(content, str):
                return content.strip()
            raise AIProviderError(f"Unexpected response structure from AI provider: {response.text[:200]}")
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            raise AIProviderError(f"Could not parse choices from AI provider response: {response.text[:200]}") from exc

    async def complete_json(
        self,
        messages: list[dict[str, Any]],
        *,
        operation: str,
        model: str | None = None,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        settings = get_settings()
        target_model = model or settings.llm_model
        if not target_model:
            raise AIProviderError("LLM_MODEL is not configured. Please set LLM_MODEL in your environment variables or .env file.")
        response = await self._post(
            "chat/completions",
            {
                "model": target_model,
                "temperature": temperature,
                "response_format": {"type": "json_object"},
                "messages": messages,
            },
            operation,
        )
        try:
            content = response.json()["choices"][0]["message"]["content"]
            return _json_object(content)
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            raise AIProviderError(f"Could not parse JSON choice from AI provider: {response.text[:200]}") from exc

    async def embeddings(self, texts: list[str], *, operation: str = "embeddings") -> list[list[float]]:
        if not texts:
            return []
        settings = get_settings()
        if not settings.embedding_model:
            raise AIProviderError("EMBEDDING_MODEL is not configured. Please set EMBEDDING_MODEL in your environment variables or .env file.")
        vectors: list[list[float]] = []
        for start in range(0, len(texts), 64):
            response = await self._post(
                "embeddings",
                {"model": settings.embedding_model, "input": texts[start:start + 64]},
                operation,
            )
            try:
                data = response.json().get("data", [])
                items = sorted(data, key=lambda item: item.get("index", 0)) if isinstance(data, list) else []
                vectors.extend(item["embedding"] for item in items if isinstance(item, dict) and "embedding" in item)
            except Exception as exc:
                raise AIProviderError(f"Could not parse embeddings data from AI provider: {response.text[:200]}") from exc
        return vectors

    def embeddings_sync(self, texts: list[str], *, operation: str = "embeddings") -> list[list[float]]:
        """Synchronous adapter for worker ingestion paths."""
        if not texts:
            return []
        settings = get_settings()
        if not settings.embedding_model:
            raise AIProviderError("EMBEDDING_MODEL is not configured. Please set EMBEDDING_MODEL in your environment variables or .env file.")
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
                        data = response.json().get("data", [])
                        items = sorted(data, key=lambda item: item.get("index", 0)) if isinstance(data, list) else []
                        vectors.extend(item["embedding"] for item in items if isinstance(item, dict) and "embedding" in item)
                        break
                    except (httpx.HTTPError, KeyError, TypeError) as exc:
                        last_error = exc
                        retryable = (
                            isinstance(exc, httpx.HTTPStatusError)
                            and exc.response.status_code in {408, 409, 425, 429, 500, 502, 503, 504}
                        )
                        if attempt >= self.max_attempts or not retryable:
                            break
                        time.sleep(0.25 * (2 ** (attempt - 1)))
                if last_error and not vectors:
                    error_msg = _extract_error_detail(last_error)
                    logger.warning("ai_provider_embeddings_sync_failed operation=%s error=%s", operation, error_msg)
                    raise AIProviderError(error_msg) from last_error
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
        target_model = model or settings.llm_model
        if not target_model:
            raise AIProviderError("LLM_MODEL is not configured. Please set LLM_MODEL in your environment variables or .env file.")
        payload = {
            "model": target_model,
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
                    if response.status_code >= 400:
                        error_body = await response.aread()
                        try:
                            parsed = json.loads(error_body.decode("utf-8"))
                            if isinstance(parsed, list) and parsed:
                                parsed = parsed[0]
                            if isinstance(parsed, dict):
                                err = parsed.get("error", {})
                                if isinstance(err, dict) and "message" in err:
                                    raise AIProviderError(f"AI provider error ({response.status_code}): {err['message']}")
                                if "detail" in parsed:
                                    detail = parsed["detail"]
                                    msg = detail if isinstance(detail, str) else detail.get("message", str(detail))
                                    raise AIProviderError(f"AI provider error ({response.status_code}): {msg}")
                        except json.JSONDecodeError:
                            pass
                        raise AIProviderError(f"AI provider returned HTTP {response.status_code}: {error_body.decode('utf-8', errors='ignore')[:200]}")

                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if not raw or raw == "[DONE]":
                            continue
                        try:
                            event = json.loads(raw)
                            content = event.get("choices", [{}])[0].get("delta", {}).get("content")
                            if isinstance(content, str) and content:
                                yield content
                        except json.JSONDecodeError:
                            continue
                    return
        except Exception as exc:
            error_msg = _extract_error_detail(exc) if isinstance(exc, (httpx.HTTPError, httpx.RequestError)) else str(exc)
            logger.warning(
                "ai_provider_stream_failed operation=%s model=%s duration_ms=%s error=%s",
                operation,
                payload["model"],
                round((time.monotonic() - started) * 1000),
                error_msg,
            )
            if isinstance(exc, AIProviderError):
                raise
            raise AIProviderError(error_msg) from exc
        finally:
            logger.info(
                "ai_provider_stream_complete operation=%s model=%s duration_ms=%s",
                operation,
                payload["model"],
                round((time.monotonic() - started) * 1000),
            )


ai_orchestrator = AIOrchestrator()
