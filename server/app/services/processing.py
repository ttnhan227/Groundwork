from dataclasses import dataclass
from io import BytesIO

import fitz
import pytesseract
from PIL import Image


@dataclass(frozen=True)
class ExtractedPage:
    page_number: int
    text: str
    method: str


def requires_ocr(pdf_data: bytes, text_density_threshold: int, max_pages: int = 500) -> bool:
    """Return whether any page needs OCR while also validating the page limit."""
    document = fitz.open(stream=pdf_data, filetype="pdf")
    try:
        if document.page_count > max_pages:
            raise ValueError(f"PDF exceeds the {max_pages}-page limit")
        return any(len(page.get_text("text").strip()) < text_density_threshold for page in document)
    finally:
        document.close()


def extract_pages(
    pdf_data: bytes,
    text_density_threshold: int,
    ocr_language: str = "eng",
    max_pages: int = 500,
) -> list[ExtractedPage]:
    """Extract native text, using OCR only on pages with insufficient text."""
    document = fitz.open(stream=pdf_data, filetype="pdf")
    try:
        if document.page_count > max_pages:
            raise ValueError(f"PDF exceeds the {max_pages}-page limit")
        pages: list[ExtractedPage] = []
        for index, page in enumerate(document):
            native_text = page.get_text("text").strip()
            if len(native_text) >= text_density_threshold:
                pages.append(ExtractedPage(index + 1, native_text, "native"))
                continue
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.open(BytesIO(pixmap.tobytes("png")))
            text = pytesseract.image_to_string(image, lang=ocr_language).strip()
            pages.append(ExtractedPage(index + 1, text, "ocr"))
        return pages
    finally:
        document.close()
