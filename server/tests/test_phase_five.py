from io import BytesIO
from zipfile import ZipFile

import fitz
import pytest
from PIL import Image

from app.pdf_operations import (
    delete_pages,
    images_to_pdf,
    merge_pdfs,
    parse_ranges,
    pdf_to_images,
    rotate_pages,
    select_pages,
    split_pdf,
    watermark_pdf,
)


def sample_pdf(page_count: int = 3) -> bytes:
    document = fitz.open()
    for number in range(1, page_count + 1):
        page = document.new_page()
        page.insert_text((72, 72), f"Page {number} content")
    data = document.tobytes()
    document.close()
    return data


def pdf_pages(data: bytes) -> int:
    document = fitz.open(stream=data, filetype="pdf")
    count = document.page_count
    document.close()
    return count


def test_merge_extract_delete_and_rotate() -> None:
    source = sample_pdf(3)
    assert pdf_pages(merge_pdfs([source, sample_pdf(2)])) == 5
    assert pdf_pages(select_pages(source, [3, 1])) == 2
    assert pdf_pages(delete_pages(source, [2])) == 2
    rotated = fitz.open(stream=rotate_pages(source, [1], 90), filetype="pdf")
    assert rotated[0].rotation == 90
    rotated.close()


def test_split_and_pdf_to_images_create_downloadable_archives() -> None:
    source = sample_pdf(3)
    with ZipFile(BytesIO(split_pdf(source, "ranges", ["1-2", "3"], []))) as archive:
        assert len(archive.namelist()) == 2
        assert all(name.endswith(".pdf") for name in archive.namelist())
    with ZipFile(BytesIO(pdf_to_images(source, [1, 3], "png", 96))) as archive:
        assert archive.namelist() == ["page-1.png", "page-3.png"]
        assert archive.read("page-1.png").startswith(b"\x89PNG")


def test_images_to_pdf_and_watermark() -> None:
    image = Image.new("RGB", (120, 80), "navy")
    stream = BytesIO()
    image.save(stream, format="PNG")
    converted = images_to_pdf([stream.getvalue(), stream.getvalue()])
    assert pdf_pages(converted) == 2
    watermarked = watermark_pdf(sample_pdf(2), "CONFIDENTIAL", None, [1], "center", .3, 0)
    assert pdf_pages(watermarked) == 2
    document = fitz.open(stream=watermarked, filetype="pdf")
    assert "CONFIDENTIAL" in document[0].get_text()
    document.close()


def test_invalid_page_operations_are_rejected() -> None:
    with pytest.raises(ValueError, match="At least one page"):
        delete_pages(sample_pdf(2), [1, 2])
    with pytest.raises(ValueError, match="Rotation"):
        rotate_pages(sample_pdf(), [1], 45)
    with pytest.raises(ValueError, match="Invalid page range"):
        parse_ranges(["3-1"], 3)
