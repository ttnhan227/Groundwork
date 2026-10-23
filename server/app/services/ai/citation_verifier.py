"""Deterministic citation verification and hallucination detection engine.

Validates that AI-generated statements and citations reference actual retrieved
documents, within their genuine line bounds, and flags unsupported claims.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from app.models.types import CitationItem


@dataclass
class CitationReference:
    raw: str
    filename: str
    line_start: int | None
    line_end: int | None
    is_valid_source: bool
    is_valid_lines: bool
    reason: str


@dataclass
class CitationVerificationReport:
    total_citations: int
    valid_citations: int
    invalid_citations: int
    citation_precision: float
    unsupported_claims_warning: bool
    grounded: bool
    references: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Regular expressions for matching citations in generated responses:
# e.g. [source: filename.py:42], [source: filename.py:10-25], [source: filename.py]
CITATION_PATTERNS = [
    re.compile(r"\[source:\s*([^:\]\s]+)(?::(\d+)(?:-(\d+))?)?\]", re.IGNORECASE),
    re.compile(r"\[([^:\]\s]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?\]"),
]

# Phrases that indicate safe refusal or explicit lack of evidence
SAFE_REFUSAL_PHRASES = [
    "no matching",
    "no relevant",
    "insufficient details",
    "insufficient context",
    "cannot answer",
    "does not contain sufficient",
    "information is missing",
    "not found in",
    "select files first",
    "could not be extracted",
    "no readable text",
    "local mode shows excerpts and does not generate an answer",
]


class CitationVerifier:
    """Verifies citation fidelity and factual grounding against retrieved sources."""

    @classmethod
    def verify(cls, answer: str, retrieved_citations: list[CitationItem]) -> CitationVerificationReport:
        retrieved_map: dict[str, CitationItem] = {}
        for c in retrieved_citations:
            base = Path(c.filename).name.lower()
            retrieved_map[base] = c

        parsed_refs: list[CitationReference] = []
        seen_raw = set()

        for pattern in CITATION_PATTERNS:
            for match in pattern.finditer(answer):
                raw = match.group(0)
                if raw in seen_raw:
                    continue
                seen_raw.add(raw)

                fname = match.group(1).strip()
                base_fname = Path(fname).name.lower()
                l_start = int(match.group(2)) if match.group(2) else None
                l_end = int(match.group(3)) if match.group(3) else l_start

                matched_item = retrieved_map.get(base_fname)
                if not matched_item:
                    parsed_refs.append(CitationReference(
                        raw=raw,
                        filename=fname,
                        line_start=l_start,
                        line_end=l_end,
                        is_valid_source=False,
                        is_valid_lines=False,
                        reason=f"File '{fname}' was not provided in the retrieved evidence.",
                    ))
                else:
                    valid_lines = True
                    reason = "Valid citation referencing retrieved evidence."
                    if l_start is not None:
                        src_start = matched_item.line_start or 1
                        src_end = matched_item.line_end or 1000000
                        if not (src_start <= l_start <= src_end):
                            valid_lines = False
                            reason = (
                                f"Cited line {l_start} is outside retrieved bounds "
                                f"[{src_start}-{src_end}] for '{matched_item.filename}'."
                            )
                        elif l_end is not None and not (src_start <= l_end <= src_end):
                            valid_lines = False
                            reason = (
                                f"Cited line range {l_start}-{l_end} exceeds retrieved bounds "
                                f"[{src_start}-{src_end}] for '{matched_item.filename}'."
                            )

                    parsed_refs.append(CitationReference(
                        raw=raw,
                        filename=fname,
                        line_start=l_start,
                        line_end=l_end,
                        is_valid_source=True,
                        is_valid_lines=valid_lines,
                        reason=reason,
                    ))

        total = len(parsed_refs)
        valid = sum(1 for r in parsed_refs if r.is_valid_source and r.is_valid_lines)
        invalid = total - valid

        # Check for ungrounded claims or safe refusals
        ans_lower = answer.lower()
        is_safe_refusal = any(phrase in ans_lower for phrase in SAFE_REFUSAL_PHRASES)

        if total > 0:
            precision = round(valid / total, 4)
            unsupported_warning = invalid > 0
            grounded = invalid == 0
        else:
            # No citations found in the generated response
            if is_safe_refusal:
                precision = 1.0
                unsupported_warning = False
                grounded = True
            elif not retrieved_citations:
                precision = 1.0
                unsupported_warning = False
                grounded = True
            else:
                # Text made statements without any citations despite having retrieved evidence
                precision = 0.0
                unsupported_warning = True
                grounded = False

        return CitationVerificationReport(
            total_citations=total,
            valid_citations=valid,
            invalid_citations=invalid,
            citation_precision=precision,
            unsupported_claims_warning=unsupported_warning,
            grounded=grounded,
            references=[asdict(r) for r in parsed_refs],
        )
