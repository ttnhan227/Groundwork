from io import BytesIO

import fitz
from docx import Document
from pptx import Presentation

from app.generation import (
    THEMES,
    GeneratedContent,
    _content,
    _docx,
    _docx_dynamic,
    _pdf,
    _pdf_dynamic,
    _pptx,
    _pptx_dynamic,
    _pptx_preview_slides,
)


def test_generation_builds_valid_office_and_pdf_files() -> None:
    title, sections = _content("Quarterly customer success plan", "")

    word_data = _docx(title, sections, THEMES["minimal"])
    pdf_data = _pdf(title, sections, THEMES["modern"])
    slides_data = _pptx(title, sections, THEMES["executive"])

    assert len(Document(BytesIO(word_data)).paragraphs) >= 10
    assert fitz.open(stream=pdf_data, filetype="pdf").page_count >= 1
    assert len(Presentation(BytesIO(slides_data)).slides) == 6


def test_generation_themes_cover_product_options() -> None:
    assert set(THEMES) == {"minimal", "executive", "modern", "warm"}


def test_generated_content_has_enough_sections() -> None:
    title, sections = _content("Customer retention strategy", "")
    assert title == "Customer retention strategy"
    assert len(sections) >= 5
    assert all(heading and len(body) >= 20 for heading, body in sections)


def test_dynamic_invoice_uses_table_and_distinct_layout() -> None:
    plan = GeneratedContent.model_validate({
        "title": "BrightWave Studio Invoice",
        "subtitle": "Design services for Northstar Cafe",
        "document_type": "invoice",
        "layout": "business",
        "accent_color": "#173B67",
        "metadata": [
            {"label": "Invoice number", "value": "BW-2026-041"},
            {"label": "Seller", "value": "BrightWave Studio"},
            {"label": "Client", "value": "Northstar Cafe"},
            {"label": "Due date", "value": "August 15, 2026"},
        ],
        "sections": [
            {"heading": f"Section {index}", "body": "Professional fictional invoice information for testing dynamic layouts."}
            for index in range(1, 6)
        ],
        "table": {
            "headers": ["Service", "Quantity", "Rate", "Amount"],
            "rows": [["Brand workshop", "1", "$900", "$900"], ["Menu design", "1", "$1,550", "$1,550"]],
        },
        "callout": "Subtotal $2,450 · Tax $196 · **Total $2,646**",
    })
    assert "**" not in plan.callout
    word_data = _docx_dynamic(plan, THEMES["executive"])
    pdf_data = _pdf_dynamic(plan, THEMES["executive"])
    slides_data = _pptx_dynamic(plan, THEMES["executive"])
    assert len(Document(BytesIO(word_data)).tables) >= 3
    assert fitz.open(stream=pdf_data, filetype="pdf").page_count >= 1
    assert len(Presentation(BytesIO(slides_data)).slides) == 6


def test_dynamic_presentation_constrains_long_copy_and_shapes_to_slide() -> None:
    plan = GeneratedContent.model_validate({
        "title": "A deliberately long presentation title explaining a complex transformation strategy across international markets",
        "subtitle": "A detailed subtitle for executive stakeholders that would previously collide with nearby elements when rendered in PowerPoint.",
        "document_type": "presentation",
        "layout": "modern",
        "accent_color": "#2F6BFF",
        "metadata": [],
        "sections": [
            {
                "heading": f"{index}. Operational transformation, customer outcomes, and implementation priorities",
                "body": " ".join([
                    "This slide contains deliberately verbose source material to exercise the renderer under realistic worst-case conditions.",
                    "It should remain readable, respect its allocated content region, preserve comfortable spacing, and never run beneath decorative elements.",
                    "The final presentation should communicate one focused idea instead of shrinking an entire paragraph into unreadable text.",
                ] * 2),
            }
            for index in range(1, 7)
        ],
        "table": None,
        "callout": "",
    })
    preview = _pptx_preview_slides(plan)
    assert len(preview[0]["title"]) <= 76
    assert all(len(slide["body"]) <= 330 for slide in preview[1:])

    deck = Presentation(BytesIO(_pptx_dynamic(plan, THEMES["modern"])))
    assert len(deck.slides) == 7
    for slide in deck.slides:
        for shape in slide.shapes:
            assert shape.left >= 0 and shape.top >= 0
            assert shape.left + shape.width <= deck.slide_width
            assert shape.top + shape.height <= deck.slide_height
