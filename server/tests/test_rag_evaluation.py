"""Unit tests for Groundwork RAG evaluation suite and Reciprocal Rank Fusion (RRF)."""

from app.services.rag import compute_reciprocal_rank_fusion
from eval.metrics import (
    answer_relevance_score,
    context_recall_score,
    faithfulness_score,
    rank_chunks_hybrid,
    rejection_accuracy,
)
from eval.runner import load_dataset, run_benchmark


def test_rrf_scoring_combines_ranks_correctly():
    """Verify RRF formula: sum(1 / (k + rank)) across candidate lists."""
    list_dense = ["chunk_a", "chunk_b", "chunk_c"]
    list_lexical = ["chunk_b", "chunk_d", "chunk_a"]

    # chunk_a: 1/(60+1) + 1/(60+3) = 0.01639 + 0.01587 = 0.03226
    # chunk_b: 1/(60+2) + 1/(60+1) = 0.01613 + 0.01639 = 0.03252 -> #1
    # chunk_c: 1/(60+3) = 0.01587
    # chunk_d: 1/(60+2) = 0.01613
    fused = compute_reciprocal_rank_fusion([list_dense, list_lexical], k=60)
    assert fused[0] == "chunk_b"
    assert fused[1] == "chunk_a"
    assert len(fused) == 4


def test_rrf_handles_empty_or_single_list():
    assert compute_reciprocal_rank_fusion([]) == []
    single = ["c1", "c2"]
    assert compute_reciprocal_rank_fusion([single]) == ["c1", "c2"]


def test_context_recall_score():
    retrieved = "PostgreSQL 16 runs on port 5432 with pgvector."
    assert context_recall_score(retrieved, ["5432", "pgvector"]) == 1.0
    assert context_recall_score(retrieved, ["5432", "missing_token"]) == 0.5
    assert context_recall_score(retrieved, []) == 1.0


def test_faithfulness_detects_unsupported_factual_entities():
    context = "The invoice amount for BlueFin Ltd was $8,900 under reference INV-98235."
    grounded_answer = "BlueFin Ltd was invoiced $8,900 under reference INV-98235."
    hallucinated_answer = "BlueFin Ltd was invoiced $12,500 under reference INV-99999."

    assert faithfulness_score(grounded_answer, context) == 1.0
    assert faithfulness_score(hallucinated_answer, context) < 0.5


def test_faithfulness_rewards_clean_rejection_for_unanswerable():
    declined_answer = "The provided sources do not contain sufficient information to answer this question."
    hallucinated_answer = "The refund policy allows refunds within 30 days."

    assert faithfulness_score(declined_answer, "some context", is_unanswerable=True) == 1.0
    assert faithfulness_score(hallucinated_answer, "some context", is_unanswerable=True) == 0.0


def test_rejection_accuracy():
    declined = "Information cannot be found in the provided sources."
    answered = "The port is 5432."

    assert rejection_accuracy(declined, is_unanswerable=True) is True
    assert rejection_accuracy(answered, is_unanswerable=True) is False
    assert rejection_accuracy(answered, is_unanswerable=False) is True
    assert rejection_accuracy(declined, is_unanswerable=False) is False


def test_answer_relevance_score():
    assert answer_relevance_score("PostgreSQL 16 runs on port 5432.", "What port does PostgreSQL run on?") > 0.5
    assert answer_relevance_score("Sources do not contain information.", "What port?", is_unanswerable=True) == 1.0


def test_rank_chunks_hybrid():
    chunks = [
        "Irrelevant chunk about weather.",
        "Crucial contract clause with id INV-9901.",
    ]
    dense, lexical, fused = rank_chunks_hybrid("INV-9901 invoice", chunks, top_k=2)
    assert 1 in fused



def test_eval_dataset_schema_integrity():
    dataset = load_dataset()
    assert len(dataset) >= 20

    for item in dataset:
        assert "id" in item
        assert "category" in item
        assert "corpus_chunks" in item
        assert len(item["corpus_chunks"]) >= 2
        assert "question" in item
        assert "ground_truth_answer" in item
        assert "is_unanswerable" in item
        target = item["target_chunk_index"]
        if not item["is_unanswerable"]:
            assert 0 <= target < len(item["corpus_chunks"])
        else:
            assert target == -1


def test_run_benchmark_returns_passing_summary():
    summary = run_benchmark()
    assert summary["total_test_cases"] >= 20
    assert summary["avg_faithfulness_pct"] > 85.0
    assert summary["rejection_precision_pct"] == 100.0
    assert summary["hybrid_recall_top1_pct"] >= 80.0
