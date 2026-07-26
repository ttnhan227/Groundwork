from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import fitz
from PIL import Image


def _validated_pages(document: fitz.Document, page_numbers: list[int] | None) -> list[int]:
    pages = page_numbers or list(range(1, document.page_count + 1))
    unique = list(dict.fromkeys(pages))
    if not unique or any(page < 1 or page > document.page_count for page in unique):
        raise ValueError(f"Pages must be between 1 and {document.page_count}")
    return unique


def select_pages(data: bytes, page_numbers: list[int]) -> bytes:
    source = fitz.open(stream=data, filetype="pdf")
    output = fitz.open()
    try:
        for page in _validated_pages(source, page_numbers):
            output.insert_pdf(source, from_page=page - 1, to_page=page - 1)
        return output.tobytes(garbage=4, deflate=True)
    finally:
        output.close()
        source.close()


def merge_pdfs(files: list[bytes]) -> bytes:
    output = fitz.open()
    try:
        for data in files:
            source = fitz.open(stream=data, filetype="pdf")
            try:
                output.insert_pdf(source)
            finally:
                source.close()
        return output.tobytes(garbage=4, deflate=True)
    finally:
        output.close()


def rotate_pages(data: bytes, page_numbers: list[int], degrees: int) -> bytes:
    if degrees not in {90, 180, 270}:
        raise ValueError("Rotation must be 90, 180, or 270 degrees")
    document = fitz.open(stream=data, filetype="pdf")
    try:
        for page_number in _validated_pages(document, page_numbers):
            page = document[page_number - 1]
            page.set_rotation((page.rotation + degrees) % 360)
        return document.tobytes(garbage=4, deflate=True)
    finally:
        document.close()


def delete_pages(data: bytes, page_numbers: list[int]) -> bytes:
    document = fitz.open(stream=data, filetype="pdf")
    try:
        pages = _validated_pages(document, page_numbers)
        if len(pages) >= document.page_count:
            raise ValueError("At least one page must remain")
        document.delete_pages([page - 1 for page in pages])
        return document.tobytes(garbage=4, deflate=True)
    finally:
        document.close()


def parse_ranges(ranges: list[str], page_count: int) -> list[list[int]]:
    parsed: list[list[int]] = []
    for value in ranges:
        value = value.strip()
        if not value:
            continue
        if "-" in value:
            start_text, end_text = value.split("-", 1)
            start, end = int(start_text), int(end_text)
        else:
            start = end = int(value)
        if start < 1 or end < start or end > page_count:
            raise ValueError(f"Invalid page range: {value}")
        parsed.append(list(range(start, end + 1)))
    if not parsed:
        raise ValueError("Provide at least one valid page range")
    return parsed


def split_pdf(data: bytes, mode: str, ranges: list[str], selected: list[int]) -> bytes:
    document = fitz.open(stream=data, filetype="pdf")
    try:
        if mode == "every_page":
            groups = [[page] for page in range(1, document.page_count + 1)]
        elif mode == "selected":
            groups = [_validated_pages(document, selected)]
        else:
            groups = parse_ranges(ranges, document.page_count)
    finally:
        document.close()
    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for index, pages in enumerate(groups, 1):
            archive.writestr(f"part-{index}-pages-{'-'.join(map(str, pages))}.pdf", select_pages(data, pages))
    return stream.getvalue()


def pdf_to_images(data: bytes, page_numbers: list[int] | None, image_format: str, dpi: int) -> bytes:
    document = fitz.open(stream=data, filetype="pdf")
    stream = BytesIO()
    try:
        pages = _validated_pages(document, page_numbers)
        with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
            for page_number in pages:
                pixmap = document[page_number - 1].get_pixmap(dpi=dpi, alpha=False)
                extension = "jpg" if image_format == "jpeg" else "png"
                archive.writestr(f"page-{page_number}.{extension}", pixmap.tobytes(image_format))
        return stream.getvalue()
    finally:
        document.close()


def images_to_pdf(files: list[bytes]) -> bytes:
    output = fitz.open()
    try:
        for data in files:
            with Image.open(BytesIO(data)) as image:
                converted = image.convert("RGB")
                buffer = BytesIO()
                converted.save(buffer, format="PNG")
                width, height = converted.size
                page = output.new_page(width=width, height=height)
                page.insert_image(page.rect, stream=buffer.getvalue())
        return output.tobytes(garbage=4, deflate=True)
    finally:
        output.close()


def watermark_pdf(
    data: bytes,
    text: str | None,
    image_data: bytes | None,
    page_numbers: list[int] | None,
    position: str,
    opacity: float,
    rotation: int,
) -> bytes:
    if not text and not image_data:
        raise ValueError("Provide watermark text or an image")
    if not 0.05 <= opacity <= 1:
        raise ValueError("Opacity must be between 0.05 and 1")
    if rotation not in {0, 90, 180, 270}:
        raise ValueError("Rotation must be 0, 90, 180, or 270 degrees")
    document = fitz.open(stream=data, filetype="pdf")
    try:
        for page_number in _validated_pages(document, page_numbers):
            page = document[page_number - 1]
            width, height = page.rect.width, page.rect.height
            centers = {
                "center": (width / 2, height / 2),
                "top_left": (width * .2, height * .15),
                "top_right": (width * .8, height * .15),
                "bottom_left": (width * .2, height * .85),
                "bottom_right": (width * .8, height * .85),
            }
            if position not in centers:
                raise ValueError("Invalid watermark position")
            x, y = centers[position]
            if text:
                rect = fitz.Rect(x - width * .3, y - 35, x + width * .3, y + 35)
                page.insert_textbox(
                    rect, text, fontsize=max(14, min(42, width / max(len(text), 8))),
                    color=(.45, .4, .65), align=fitz.TEXT_ALIGN_CENTER,
                    rotate=rotation, fill_opacity=opacity, overlay=True,
                )
            if image_data:
                with Image.open(BytesIO(image_data)) as image:
                    rgba = image.convert("RGBA")
                    alpha = rgba.getchannel("A").point(lambda value: int(value * opacity))
                    rgba.putalpha(alpha)
                    buffer = BytesIO()
                    rgba.save(buffer, format="PNG")
                    box_width = width * .28
                    ratio = rgba.height / max(rgba.width, 1)
                    box_height = box_width * ratio
                    page.insert_image(
                        fitz.Rect(x - box_width / 2, y - box_height / 2, x + box_width / 2, y + box_height / 2),
                        stream=buffer.getvalue(), rotate=rotation, overlay=True,
                    )
        return document.tobytes(garbage=4, deflate=True)
    finally:
        document.close()


def compress_pdf(data: bytes, preset: str = "balanced") -> bytes:
    if preset not in {"basic", "balanced", "strong"}:
        raise ValueError("Compression preset must be basic, balanced, or strong")
    document = fitz.open(stream=data, filetype="pdf")
    try:
        # PyMuPDF's safe structural compression preserves searchable text. Stronger
        # presets additionally clean duplicate and unreachable objects.
        garbage = {"basic": 2, "balanced": 3, "strong": 4}[preset]
        return document.tobytes(garbage=garbage, deflate=True, deflate_images=True, deflate_fonts=True)
    finally:
        document.close()


def add_page_numbers(
    data: bytes,
    page_numbers: list[int] | None = None,
    position: str = "bottom_center",
    start_number: int = 1,
) -> bytes:
    document = fitz.open(stream=data, filetype="pdf")
    try:
        pages = _validated_pages(document, page_numbers)
        alignments = {
            "bottom_left": (fitz.TEXT_ALIGN_LEFT, False),
            "bottom_center": (fitz.TEXT_ALIGN_CENTER, False),
            "bottom_right": (fitz.TEXT_ALIGN_RIGHT, False),
            "top_left": (fitz.TEXT_ALIGN_LEFT, True),
            "top_center": (fitz.TEXT_ALIGN_CENTER, True),
            "top_right": (fitz.TEXT_ALIGN_RIGHT, True),
        }
        if position not in alignments:
            raise ValueError("Invalid page-number position")
        alignment, top = alignments[position]
        for offset, page_number in enumerate(pages):
            page = document[page_number - 1]
            y = 18 if top else page.rect.height - 30
            box = fitz.Rect(28, y, page.rect.width - 28, y + 16)
            page.insert_textbox(box, str(start_number + offset), fontsize=10, color=(.2, .2, .2), align=alignment, overlay=True)
        return document.tobytes(garbage=4, deflate=True)
    finally:
        document.close()
