"""Utility functions and processing modules for InsightPDF."""

from app.utils.document_conversions import (
    docx_to_markdown,
    docx_to_pdf,
    pdf_to_docx,
    validate_docx,
)
from app.utils.generated_text import (
    normalize_document_content,
    normalize_generated_text,
)
from app.utils.pdf_operations import (
    add_page_numbers,
    compress_pdf,
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
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.utils.storage import ObjectStorage, S3Storage, StorageBackend
from app.utils.tool_registry import TOOL_BY_NAME, TOOLS, ToolDefinition, public_catalog
from app.utils.usage import record_ai_usage

__all__ = [
    "TOOLS",
    "TOOL_BY_NAME",
    "ObjectStorage",
    "S3Storage",
    "StorageBackend",
    "ToolDefinition",
    "add_page_numbers",
    "compress_pdf",
    "create_access_token",
    "create_refresh_token",
    "decode_access_token",
    "delete_pages",
    "docx_to_markdown",
    "docx_to_pdf",
    "hash_password",
    "hash_token",
    "images_to_pdf",
    "merge_pdfs",
    "normalize_document_content",
    "normalize_generated_text",
    "parse_ranges",
    "pdf_to_docx",
    "pdf_to_images",
    "public_catalog",
    "record_ai_usage",
    "rotate_pages",
    "select_pages",
    "split_pdf",
    "validate_docx",
    "verify_password",
    "watermark_pdf",
]
