"""Bounded, passive previews. Documents never execute inside the desktop webview."""
import base64
import io
import warnings
from pathlib import Path

from app.services.collection_service import CollectionService
from app.services.file_parser import FileParser


class PreviewPageError(ValueError):
    """A caller requested a page outside the available document."""


class PreviewService:
    def preview(self, raw: str, page: int = 1):
        path = CollectionService().allowed(raw, require_file=False)
        if not path.exists():
            raise ValueError('This file is missing or unavailable. Refresh the folder and choose another file.')
        stat = path.stat()
        result = {"path": str(path), "name": path.name, "size": stat.st_size, "modified": stat.st_mtime, "page": page, "pages": 1, "kind": "unsupported", "message": "This format has no built-in preview. Open it with its default app.", "text": "", "image": "", "line_start": 1}
        if stat.st_size > 32 * 1024 * 1024:
            return {**result, "message": "This file exceeds the 32 MB preview limit. Open it with its default app."}
        extension = path.suffix.lower()
        try:
            if path.is_dir():
                from app.services.file_evidence import folder_evidence
                text = folder_evidence(path, CollectionService().allowed)
                return {**result, 'kind': 'text', 'text': text[:80000], 'total_lines': len(text.splitlines()), 'message': 'Folder details only. Ask AI to read a bounded sample of nearby documents.'}
            if extension == ".pdf":
                import fitz
                with fitz.open(path) as document:
                    if document.needs_pass:
                        return {**result, "message": "This PDF is password protected. Open it with its default app."}
                    result["pages"] = len(document)
                    if not 1 <= page <= len(document):
                        raise PreviewPageError("This page is no longer available.")
                    sheet = document[page - 1]
                    scale = min(1.5, 1600 / max(sheet.rect.width, sheet.rect.height, 1))
                    image = sheet.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes("png")
                    return {**result, "kind": "pdf", "image": self.data_image(image), "message": "AI reads PDF text and can recognize text on up to five scanned pages. It does not interpret diagrams or images."}
            if extension in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico"}:
                from PIL import Image, ImageOps
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(path) as source:
                        if source.width * source.height > 40_000_000:
                            return {**result, "message": "Image dimensions exceed the preview limit. Open it with its default app."}
                        image = ImageOps.exif_transpose(source)
                        image.thumbnail((1600, 1600))
                        image = image.convert("RGBA")
                        buffer = io.BytesIO()
                        image.save(buffer, format="PNG")
                        return {**result, "kind": "image", "image": self.data_image(buffer.getvalue()), "message": "AI can recognize written text in this image using local Windows OCR. It does not identify objects or interpret the whole scene."}
            from app.services.document_reader import OFFICE_EXTENSIONS, read_document
            if extension in OFFICE_EXTENSIONS:
                text = read_document(path)
                result["message"] = "Extracted document text. Layout and embedded images are omitted. AI can use this text." + (" Spreadsheet formula results use saved values, not recalculated values." if extension in {".xlsx", ".ods"} else "")
            elif FileParser.is_supported(path) and stat.st_size <= 5 * 1024 * 1024:
                raw_bytes = path.read_bytes()
                if b"\0" in raw_bytes[:4096] and not raw_bytes.startswith((b"\xff\xfe", b"\xfe\xff")):
                    return {**result, "message": "Binary content cannot be previewed as text."}
                try:
                    text = raw_bytes.decode("utf-16" if raw_bytes.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
                except UnicodeDecodeError:
                    text = raw_bytes.decode("latin-1")
                result["message"] = "Read-only text preview. Markup and scripts are displayed as text."
            else:
                return result
            lines = text.splitlines() or [""]
            result["pages"] = max(1, (len(lines) + 199) // 200)
            if not 1 <= page <= result["pages"]:
                raise PreviewPageError("This page is no longer available.")
            start = (page - 1) * 200
            excerpt = "\n".join(lines[start:start + 200])
            return {**result, "kind": "text", "text": excerpt[:80000], "line_start": start + 1, "total_lines": len(lines), "truncated": len(excerpt) > 80000}
        except PreviewPageError:
            raise
        except Exception:
            return {**result, "message": "This file could not be previewed. It may be damaged or unsupported. Open it with its default app."}

    @staticmethod
    def data_image(data):
        return "data:image/png;base64," + base64.b64encode(data).decode("ascii")
