"""RAG Evaluation Metrics: Context Recall, Faithfulness, Relevance, and Fusion Scoring.

Calculates key indicators of RAG pipeline quality:
1. Context Recall: Whether the retrieval step surfaced the necessary ground-truth facts.
2. Faithfulness (Groundedness): Whether generated statements are supported by the context without hallucination.
3. Answer Relevance: Whether the response directly addresses the inquiry.
4. Context Rejection Precision: Whether the system declines to answer when context is insufficient.
"""

from __future__ import annotations

import re
from typing import Sequence

from app.services.rag import answer_declines_context, compute_reciprocal_rank_fusion


def tokenize(text: str) -> set[str]:
    """Extract lowercase alpha-numeric search tokens."""
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def context_recall_score(retrieved_text: str, ground_truth_keywords: Sequence[str]) -> float:
    """Measure fraction of ground-truth keywords/entities retrieved in context.

    Returns a score between 0.0 and 1.0.
    """
    if not ground_truth_keywords:
        return 1.0
    text_lower = retrieved_text.lower()
    matches = sum(1 for kw in ground_truth_keywords if kw.lower() in text_lower)
    return matches / len(ground_truth_keywords)


def faithfulness_score(answer: str, context: str, is_unanswerable: bool = False) -> float:
    """Measure whether the answer is strictly grounded in the context without hallucinating.

    1. If the question is unanswerable:
       - Score is 1.0 if the answer cleanly declines context (e.g., 'not found in the provided sources').
       - Score is 0.0 if the system hallucinates an answer to an unanswerable question.
    2. If the question is answerable:
       - Checks that key entities, numbers, and proper nouns in the answer exist in the context.
    """
    if is_unanswerable:
        return 1.0 if answer_declines_context(answer) else 0.0

    # If the system declined when context was actually present, penalized
    if answer_declines_context(answer):
        return 0.2

    # Extract factual tokens (numbers, capitalized words, codes, snake_case/kebab-case identifiers)
    factual_entities = re.findall(r"\b(?:\$?\d+(?:\.\d+)?%?|[A-Z][A-Za-z0-9_-]+|[a-z0-9]+[_-][a-z0-9_-]+)\b", answer)
    if not factual_entities:
        return 1.0

    context_lower = context.lower()
    supported = sum(1 for entity in factual_entities if entity.lower() in context_lower)
    return supported / len(factual_entities)


def answer_relevance_score(answer: str, question: str, is_unanswerable: bool = False) -> float:
    """Measure topical alignment between user question and generated answer."""
    if is_unanswerable:
        # A clean refusal to an unanswerable question is 100% relevant
        return 1.0 if answer_declines_context(answer) else 0.0

    q_tokens = tokenize(question)
    # Remove common stop words
    stop_words = {"what", "how", "why", "when", "where", "which", "who", "does", "is", "are", "the", "a", "an", "and", "in", "of", "to"}
    meaningful_q = q_tokens - stop_words
    if not meaningful_q:
        return 1.0

    a_tokens = tokenize(answer)
    overlap = len(meaningful_q.intersection(a_tokens))
    return min(1.0, (overlap / len(meaningful_q)) * 1.5)


def rejection_accuracy(answer: str, is_unanswerable: bool) -> bool:
    """Verify correct refusal when ground truth is absent."""
    declined = answer_declines_context(answer)
    return declined if is_unanswerable else (not declined)


def lexical_score(query: str, chunk_text: str) -> float:
    """Lightweight BM25-like token overlap scoring for lexical retrieval."""
    q_tokens = tokenize(query)
    c_tokens = tokenize(chunk_text)
    if not q_tokens or not c_tokens:
        return 0.0
    common = q_tokens.intersection(c_tokens)
    # Give higher weight to rare tokens (alphanumeric codes, numbers)
    weighted_score = 0.0
    for token in common:
        weight = 2.0 if any(char.isdigit() or char in "-_" for char in token) else 1.0
        weighted_score += weight
    return weighted_score / len(q_tokens)


def dense_similarity_proxy(query: str, chunk_text: str) -> float:
    """Proxy for dense semantic embedding similarity based on n-gram and jaccard overlap."""
    q_tokens = tokenize(query)
    c_tokens = tokenize(chunk_text)
    if not q_tokens or not c_tokens:
        return 0.0
    jaccard = len(q_tokens.intersection(c_tokens)) / len(q_tokens.union(c_tokens))
    return jaccard


def rank_chunks_hybrid(
    query: str,
    chunks: list[str],
    top_k: int = 2,
    k: int = 60,
) -> tuple[list[int], list[int], list[int]]:
    """Rank chunks using:
    1. Dense similarity alone
    2. Lexical keyword matching alone
    3. Hybrid RRF fusion

    Returns (dense_ranked_indices, lexical_ranked_indices, fused_ranked_indices).
    """
    indexed = list(enumerate(chunks))

    # Dense ranking
    dense_scored = sorted(indexed, key=lambda pair: dense_similarity_proxy(query, pair[1]), reverse=True)
    dense_ranks = [i for i, _ in dense_scored]

    # Lexical ranking
    lexical_scored = sorted(indexed, key=lambda pair: lexical_score(query, pair[1]), reverse=True)
    lexical_ranks = [i for i, _ in lexical_scored]

    # Reciprocal Rank Fusion
    fused_indices = compute_reciprocal_rank_fusion(
        [dense_ranks, lexical_ranks],
        k=k,
        key_func=lambda idx: idx,
    )

    return dense_ranks[:top_k], lexical_ranks[:top_k], fused_indices[:top_k]
