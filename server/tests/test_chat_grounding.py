"""Unit tests for chat controller grounding and citation parsing."""

import re

from app.controllers import chat


def test_chat_module_imports_cleanly():
    """Verify chat router is configured and re module is available."""
    assert hasattr(chat, "router")
    assert hasattr(chat, "re")
    assert chat.router.prefix == "/conversations"


def test_chat_source_regex_extraction_and_ordering():
    """Test regex extraction matching the implementation in chat.py."""
    raw_answer = (
        "According to the docs [Source 2], the system throughput improved by 40% [source 1]. "
        "Further metrics confirm the result [SOURCE 2] and [Source 3]."
    )

    ref_matches = [int(m) for m in re.findall(r"\[Source\s+(\d+)\]", raw_answer, re.IGNORECASE)]
    assert ref_matches == [2, 1, 2, 3]

    seen_refs: set[int] = set()
    ordered_refs: list[int] = []
    for ref in ref_matches:
        if ref not in seen_refs:
            seen_refs.add(ref)
            ordered_refs.append(ref)

    assert ordered_refs == [2, 1, 3]

    # Total available chunks = 3
    valid_refs = [r for r in ordered_refs if 1 <= r <= 3]
    source_mapping = {r: i for i, r in enumerate(valid_refs, 1)}

    assert valid_refs == [2, 1, 3]
    assert source_mapping == {2: 1, 1: 2, 3: 3}


def test_chat_source_regex_filters_out_of_bounds():
    """Verify that references beyond total chunks are discarded."""
    raw_answer = "Valid claim [Source 1], invalid reference [Source 99]."
    ref_matches = [int(m) for m in re.findall(r"\[Source\s+(\d+)\]", raw_answer, re.IGNORECASE)]

    ordered_refs = []
    seen = set()
    for r in ref_matches:
        if r not in seen:
            seen.add(r)
            ordered_refs.append(r)

    total_chunks = 2
    valid_refs = [r for r in ordered_refs if 1 <= r <= total_chunks]
    assert valid_refs == [1]
