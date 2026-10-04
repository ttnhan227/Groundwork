import httpx
import pytest

from app.services.ai.providers import GeminiProvider, OllamaProvider, OpenAIProvider


@pytest.mark.parametrize("provider,payload", [
    (GeminiProvider(api_key="test-only"), {"candidates": []}),
    (GeminiProvider(api_key="test-only"), {"candidates": [{"content": {"parts": [{"text": "private reasoning", "thought": True}]}}]}),
    (OpenAIProvider(api_key="test-only"), {"choices": [{"message": {"content": " "}}]}),
    (OllamaProvider(), {"message": {"content": ""}}),
])
def test_empty_answers_are_failures_not_successes(monkeypatch, provider, payload):
    client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))))
    with pytest.raises(RuntimeError, match="could not complete"):
        provider.generate("Synthetic test")


def test_gemini_returns_all_answer_parts_without_thoughts(monkeypatch):
    client = httpx.Client
    payload = {"candidates": [{"content": {"parts": [{"text": "private reasoning", "thought": True}, {"text": "First"}, {"text": "Second"}]}}]}
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))))
    assert GeminiProvider(api_key="test-only").generate("Synthetic test") == "First\nSecond"
