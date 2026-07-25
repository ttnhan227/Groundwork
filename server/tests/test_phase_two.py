from unittest.mock import patch

import fitz
from sqlalchemy.pool import NullPool

from app.database import engine
from app.processing import extract_pages, requires_ocr


def make_pdf(text: str = "") -> bytes:
    document = fitz.open()
    page = document.new_page()
    if text:
        page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def test_native_text_skips_ocr() -> None:
    with patch("app.processing.pytesseract.image_to_string") as ocr:
        pages = extract_pages(make_pdf("A sufficiently long native text page"), 10)
    assert pages[0].method == "native"
    assert "sufficiently long" in pages[0].text
    ocr.assert_not_called()


def test_sparse_page_uses_ocr() -> None:
    with patch("app.processing.pytesseract.image_to_string", return_value="Scanned page text") as ocr:
        pages = extract_pages(make_pdf(), 10)
    assert pages[0].method == "ocr"
    assert pages[0].text == "Scanned page text"
    ocr.assert_called_once()


def test_ocr_preflight_detects_sparse_pages() -> None:
    assert requires_ocr(make_pdf(), 10)
    assert not requires_ocr(make_pdf("A sufficiently long native text page"), 10)


def test_page_limit_is_enforced() -> None:
    document = fitz.open()
    document.new_page()
    document.new_page()
    data = document.tobytes()
    document.close()
    try:
        extract_pages(data, 10, max_pages=1)
    except ValueError as error:
        assert "page limit" in str(error)
    else:
        raise AssertionError("Expected the page limit to be enforced")


def test_database_connections_are_safe_across_celery_event_loops() -> None:
    assert isinstance(engine.sync_engine.pool, NullPool)
