import uuid
from io import BytesIO

import fitz
import pytest
from fastapi import HTTPException

from app.pdf_operations import add_page_numbers, compress_pdf
from app.workflows import build_plan


def sample_pdf() -> bytes:
    document = fitz.open()
    for text in ("First page", "Second page", "Third page"):
        page = document.new_page()
        page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def test_copilot_builds_safe_ordered_multitool_plan() -> None:
    plan = build_plan("Rotate pages 1-2 by 90, add page numbers, then compress strongly", uuid.uuid4())
    assert [step.tool for step in plan] == ["rotate", "add_page_numbers", "compress_pdf"]
    assert plan[0].parameters["page_numbers"] == [1, 2]
    assert plan[-1].parameters["preset"] == "strong"


def test_copilot_requires_pages_for_destructive_operation() -> None:
    with pytest.raises(HTTPException) as error:
        build_plan("Delete some pages", uuid.uuid4())
    assert error.value.status_code == 422


def test_compression_returns_valid_pdf() -> None:
    result = compress_pdf(sample_pdf(), "balanced")
    document = fitz.open(stream=result, filetype="pdf")
    assert document.page_count == 3
    document.close()


def test_page_numbers_are_added_without_changing_pages() -> None:
    result = add_page_numbers(sample_pdf(), [2, 3], "bottom_center", 7)
    document = fitz.open(stream=BytesIO(result), filetype="pdf")
    assert document.page_count == 3
    assert "7" in document[1].get_text()
    assert "8" in document[2].get_text()
    document.close()
