"""Multi-format file parser, AST code symbol extractor, and context chunker.

Supports:
- Code files (Python, TypeScript, JavaScript, Rust, Go, Java, C#, C/C++, SQL, Shell)
- Markdown, Text, Config files (JSON, YAML, TOML, XML, CSV)
- PDF documents (via PyMuPDF)
- Structural AST symbol extraction (classes, functions, interfaces, imports)
"""

from __future__ import annotations

import ast
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from app.services.document_reader import OFFICE_EXTENSIONS, read_document

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.ico'}

logger = logging.getLogger("groundwork.parser")

TEXT_EXTENSIONS = {
    # Code
    ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java", ".cs",
    ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".rb", ".php", ".swift",
    ".kt", ".scala", ".sql", ".sh", ".bash", ".zsh", ".ps1", ".bat",
    # Documentation & Data
    ".md", ".markdown", ".txt", ".rst", ".adoc",
    ".json", ".yaml", ".yml", ".toml", ".xml", ".csv", ".tsv",
    ".html", ".css", ".scss", ".sass", ".less",
    ".env", ".gitignore", ".dockerignore", "dockerfile",
}


@dataclass
class ParsedChunk:
    chunk_index: int
    content: str
    char_start: int
    char_end: int
    line_start: int
    line_end: int


@dataclass
class CodeSymbol:
    kind: str  # function, class, interface, type, import
    name: str
    line: int
    details: str = ""


@dataclass
class FileParseResult:
    content: str
    chunks: list[ParsedChunk] = field(default_factory=list)
    symbols: list[CodeSymbol] = field(default_factory=list)
    file_type: str = "text"
    is_binary: bool = False
    coverage: str = 'Extracted text'


class FileParser:
    """Extracts text, structural symbols, and line-indexed chunks from workspace files."""

    @staticmethod
    def is_supported(path: Path) -> bool:
        """Checks if a file extension is supported for indexing."""
        name_lower = path.name.lower()
        if name_lower in ("dockerfile", "makefile", "license", "readme"):
            return True
        ext = path.suffix.lower()
        return ext in TEXT_EXTENSIONS or ext == ".pdf" or ext in OFFICE_EXTENSIONS

    @classmethod
    def parse_file(cls, path: Path, max_size_bytes: int = 5 * 1024 * 1024, allow_ocr: bool = False) -> FileParseResult:
        """Parses a file from disk into content, symbols, and chunks."""
        try:
            stat = path.stat()
            if stat.st_size > max_size_bytes:
                logger.debug("Skipping file %s: exceeds max size (%d bytes)", path, stat.st_size)
                return FileParseResult(content="", is_binary=True, file_type="large")

            ext = path.suffix.lower()

            if ext == ".pdf":
                return cls._parse_pdf(path, allow_ocr)
            if ext in OFFICE_EXTENSIONS:
                text = read_document(path)
                return FileParseResult(content=text, chunks=cls._create_chunks(text), file_type='document', coverage='Extracted document text; formatting and embedded images omitted.' + (' Spreadsheet formulas use saved results, not recalculated values.' if path.suffix.lower() in {'.xlsx', '.ods'} else ''))
            if ext in IMAGE_EXTENSIONS:
                if not allow_ocr:
                    return FileParseResult(content='', file_type='image', coverage='Image text has not been read.')
                from app.services.ocr_service import read_image
                text = read_image(path)
                return FileParseResult(content=text, chunks=cls._create_chunks(text), file_type='image', coverage='OCR text only; recognition may contain errors. Image scenes and objects were not interpreted.')

            return cls._parse_text_file(path, ext)
        except Exception as exc:
            logger.warning("Failed to parse file %s: %s", path, exc)
            return FileParseResult(content="", is_binary=True, file_type="error", coverage='Contents could not be extracted; file may be damaged, unsupported, or OCR unavailable.')

    @classmethod
    def _parse_text_file(cls, path: Path, ext: str) -> FileParseResult:
        try:
            raw = path.read_bytes()
            # Fast binary check: look for null bytes
            if b"\x00" in raw[:1024] and not raw.startswith((b'\xff\xfe', b'\xfe\xff')):
                return FileParseResult(content="", is_binary=True, file_type="binary")

            try:
                text = raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')
            except UnicodeDecodeError:
                text = raw.decode("latin-1", errors="replace")

            file_type = cls._categorize_extension(ext)
            symbols = cls._extract_symbols(text, ext)
            chunks = cls._create_chunks(text)

            return FileParseResult(
                content=text,
                chunks=chunks,
                symbols=symbols,
                file_type=file_type,
            )
        except Exception as exc:
            logger.debug("Error reading %s: %s", path, exc)
            return FileParseResult(content="", is_binary=True, file_type="error")

    @classmethod
    def _parse_pdf(cls, path: Path, allow_ocr: bool = False) -> FileParseResult:
        try:
            import fitz  # PyMuPDF
            pages_text = []
            ocr_pages = 0
            with fitz.open(str(path)) as doc:
                if doc.needs_pass:
                    return FileParseResult(content='', file_type='pdf', coverage='Password protected; contents not read.')
                for i in range(min(len(doc), 100)):
                    page = doc[i]
                    page_text = page.get_text()
                    if not page_text.strip() and allow_ocr and ocr_pages < 5:
                        from app.services.ocr_service import read_image
                        import tempfile
                        ocr_pages += 1
                        with tempfile.TemporaryDirectory(prefix='groundwork-page-') as folder:
                            image_path = Path(folder) / 'page.png'
                            scale = min(2, 2400 / max(page.rect.width, page.rect.height, 1))
                            page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(image_path)
                            try:
                                page_text = read_image(image_path)
                            except ValueError:
                                page_text = '[Image text could not be recognized on this page.]'
                    pages_text.append(f"--- Page {i + 1} ---\n" + (page_text or '[No selectable text; scanned content not read.]'))
                    if sum(map(len, pages_text)) > 500_000:
                        break
                coverage = f'PDF text from {len(pages_text)} of {len(doc)} pages; OCR attempted on {ocr_pages} scanned pages (limit 5). OCR may contain errors; diagrams and images not interpreted.'
            full_text = "\n\n".join(pages_text)
            chunks = cls._create_chunks(full_text)
            return FileParseResult(
                content=full_text,
                chunks=chunks,
                symbols=[],
                file_type="pdf",
                coverage=coverage,
            )
        except Exception as exc:
            logger.warning("PDF parsing failed for %s: %s", path, exc)
            return FileParseResult(content="", is_binary=True, file_type="pdf_error")

    @staticmethod
    def _categorize_extension(ext: str) -> str:
        code_exts = {
            ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java",
            ".cs", ".c", ".cpp", ".rb", ".php", ".swift", ".kt", ".sql",
        }
        if ext in code_exts:
            return "code"
        if ext in (".md", ".txt", ".rst", ".pdf") or ext in OFFICE_EXTENSIONS:
            return "document"
        if ext in (".json", ".yaml", ".yml", ".toml", ".xml", ".csv"):
            return "config"
        return "text"

    @classmethod
    def _extract_symbols(cls, text: str, ext: str) -> list[CodeSymbol]:
        symbols: list[CodeSymbol] = []

        if ext == ".py":
            try:
                tree = ast.parse(text)
                for node in ast.walk(tree):
                    if isinstance(node, ast.FunctionDef):
                        symbols.append(CodeSymbol(
                            kind="function",
                            name=node.name,
                            line=node.lineno,
                            details=f"def {node.name}()",
                        ))
                    elif isinstance(node, ast.AsyncFunctionDef):
                        symbols.append(CodeSymbol(
                            kind="async_function",
                            name=node.name,
                            line=node.lineno,
                            details=f"async def {node.name}()",
                        ))
                    elif isinstance(node, ast.ClassDef):
                        symbols.append(CodeSymbol(
                            kind="class",
                            name=node.name,
                            line=node.lineno,
                            details=f"class {node.name}",
                        ))
                    elif isinstance(node, ast.Import):
                        for alias in node.names:
                            symbols.append(CodeSymbol(kind="import", name=alias.name, line=node.lineno))
                    elif isinstance(node, ast.ImportFrom):
                        mod = node.module or ""
                        symbols.append(CodeSymbol(kind="import", name=mod, line=node.lineno))
                return symbols
            except Exception:
                pass  # Fall back to regex if syntax error

        # Regex symbol extraction for JS/TS/Rust/Go/Python
        lines = text.splitlines()
        for idx, line in enumerate(lines, start=1):
            line_str = line.strip()
            # TypeScript / JS exports & functions
            m = re.match(r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)", line_str)
            if m:
                symbols.append(CodeSymbol(kind="function", name=m.group(1), line=idx, details=line_str))
                continue
            m = re.match(r"^(?:export\s+)?(?:class|interface|type)\s+([A-Za-z0-9_$]+)", line_str)
            if m:
                symbols.append(CodeSymbol(kind="class_or_type", name=m.group(1), line=idx, details=line_str))
                continue
            # Rust fn / struct / impl
            m = re.match(r"^(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)", line_str)
            if m:
                symbols.append(CodeSymbol(kind="function", name=m.group(1), line=idx, details=line_str))
                continue
            m = re.match(r"^(?:pub\s+)?(?:struct|enum|trait)\s+([a-zA-Z0-9_]+)", line_str)
            if m:
                symbols.append(CodeSymbol(kind="struct", name=m.group(1), line=idx, details=line_str))
                continue
            # Go func / type
            m = re.match(r"^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)", line_str)
            if m:
                symbols.append(CodeSymbol(kind="function", name=m.group(1), line=idx, details=line_str))
                continue
            m = re.match(r"^type\s+([a-zA-Z0-9_]+)\s+(?:struct|interface)", line_str)
            if m:
                symbols.append(CodeSymbol(kind="type", name=m.group(1), line=idx, details=line_str))

        return symbols

    @staticmethod
    def _create_chunks(text: str, target_chunk_lines: int = 50, overlap_lines: int = 10) -> list[ParsedChunk]:
        """Splits text into overlapping line-indexed chunks."""
        lines = text.splitlines(keepends=True)
        if not lines:
            return []

        chunks: list[ParsedChunk] = []
        total_lines = len(lines)
        start_idx = 0
        chunk_num = 0

        # Calculate character offset lookup table for fast char_start/end
        line_offsets: list[int] = [0]
        cur = 0
        for line in lines:
            cur += len(line)
            line_offsets.append(cur)

        while start_idx < total_lines:
            end_idx = min(start_idx + target_chunk_lines, total_lines)
            chunk_content = "".join(lines[start_idx:end_idx])

            chunks.append(ParsedChunk(
                chunk_index=chunk_num,
                content=chunk_content.strip(),
                char_start=line_offsets[start_idx],
                char_end=line_offsets[end_idx],
                line_start=start_idx + 1,
                line_end=end_idx,
            ))
            chunk_num += 1

            if end_idx >= total_lines:
                break
            start_idx += max(1, target_chunk_lines - overlap_lines)

        return chunks
