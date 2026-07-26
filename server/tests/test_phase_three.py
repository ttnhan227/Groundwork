from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.rag import (
    answer_declines_context,
    build_retrieval_query,
    chunk_pages,
    clean_user_answer,
    cited_sources,
    embed_texts,
    generate_answer,
    requires_visual_answer,
    is_casual_message,
    relevant_snippet,
)


def test_chunking_preserves_page_citations_and_overlap() -> None:
    chunks = chunk_pages([(3, "alpha beta gamma delta epsilon zeta eta theta")], size=24, overlap=6)
    assert len(chunks) > 1
    assert all(chunk.page_number == 3 for chunk in chunks)
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert "alpha" in chunks[0].text
    assert "theta" in chunks[-1].text


def test_chunking_rejects_invalid_overlap() -> None:
    with pytest.raises(ValueError):
        chunk_pages([(1, "content")], size=10, overlap=10)


def test_hosted_embeddings_are_batched_sorted_and_normalized() -> None:
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "data": [
            {"index": 1, "embedding": [0.0, 2.0]},
            {"index": 0, "embedding": [3.0, 4.0]},
        ]
    }
    client = MagicMock()
    client.__enter__.return_value.post.return_value = response
    with (
        patch("app.rag.get_settings") as settings,
        patch("app.rag.httpx.Client", return_value=client),
    ):
        settings.return_value.embedding_provider = "api"
        settings.return_value.embedding_model = "mistral-embed"
        settings.return_value.embedding_dimensions = 3
        settings.return_value.llm_api_key = "test"
        settings.return_value.llm_base_url = "https://api.example/v1"
        settings.return_value.llm_timeout_seconds = 10
        vectors = embed_texts(["first", "second"])
    assert vectors == [[0.6, 0.8, 0.0], [0.0, 1.0, 0.0]]
    assert client.__enter__.return_value.post.call_args.kwargs["json"] == {
        "model": "mistral-embed",
        "input": ["first", "second"],
    }


def test_citations_use_referenced_sources_and_collapse_duplicate_pages() -> None:
    sources = [
        {"document": "resume", "page": 1, "text": "summary"},
        {"document": "resume", "page": 1, "text": "skills"},
        {"document": "resume", "page": 2, "text": "projects"},
    ]
    selected = cited_sources(
        "The candidate has backend experience [Source 1] and projects [Source 3].",
        sources,
        lambda source: (source["document"], source["page"]),
    )
    assert selected == [sources[0], sources[2]]


def test_uncited_answer_does_not_attach_irrelevant_sources() -> None:
    assert cited_sources("Hello! How can I help?", [1, 2], lambda source: source) == []


def test_context_decline_detection_prevents_fallback_citations() -> None:
    assert answer_declines_context("The answer cannot be found in the provided context.")
    assert not answer_declines_context("The policy allows two remote days each week.")


def test_casual_messages_are_detected_without_matching_real_questions() -> None:
    assert is_casual_message("Hi!")
    assert is_casual_message("thank you")
    assert not is_casual_message("Tell me the school name")


def test_visual_questions_are_routed_to_page_image_analysis() -> None:
    assert requires_visual_answer("Who is the character in this PDF?")
    assert requires_visual_answer("What is shown in the picture?")
    assert not requires_visual_answer("What is the payment deadline?")


def test_follow_up_retrieval_includes_recent_subject() -> None:
    query = build_retrieval_query(
        "What do you mean by that?",
        [("user", "Tell me the school"), ("assistant", "FPT Academy (Aptech) [Source 2]")],
    )
    assert "FPT Academy" in query
    assert "[Source 2]" not in query


def test_snippet_is_centered_on_supporting_answer_text() -> None:
    text = ("Technical skills and project details. " * 20) + "Education: FPT Academy (Aptech), Software Engineering."
    snippet = relevant_snippet(text, "The school is FPT Academy (Aptech).", "What is the school name?", 180)
    assert "FPT Academy" in snippet
    assert len(snippet) <= 182


def test_internal_source_labels_are_removed_from_user_answer() -> None:
    answer = "The degree earned is stated in **Source 1**:\n\n**Advanced Diploma in Software Engineering**."
    cleaned = clean_user_answer(answer)
    assert "Source 1" not in cleaned
    assert cleaned.startswith("The degree earned is:")
    assert "Advanced Diploma" in cleaned


def test_source_says_phrase_is_rewritten_as_document_language() -> None:
    cleaned = clean_user_answer("**Source 2** states the school is FPT Academy.")
    assert cleaned == "The document states the school is FPT Academy."


@pytest.mark.asyncio
async def test_llm_prompt_is_grounded_and_includes_history() -> None:
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"choices": [{"message": {"content": "Grounded answer [Source 1]"}}]}
    client = AsyncMock()
    client.__aenter__.return_value.post.return_value = response
    with (
        patch("app.rag.get_settings") as settings,
        patch("app.rag.httpx.AsyncClient", return_value=client),
    ):
        settings.return_value.llm_api_key = "test"
        settings.return_value.llm_base_url = "https://llm.example/v1"
        settings.return_value.llm_model = "test-model"
        settings.return_value.llm_timeout_seconds = 10
        answer = await generate_answer("What changed?", ["The total is 42."], [("user", "Earlier question")])
    assert answer == "Grounded answer [Source 1]"
    request = client.__aenter__.return_value.post.call_args.kwargs["json"]
    assert "Answer only from" in request["messages"][0]["content"]
    assert request["messages"][1]["content"] == "Earlier question"
    assert "The total is 42." in request["messages"][-1]["content"]
