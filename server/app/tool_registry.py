from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    title: str
    category: str
    description: str
    input_schema: dict[str, Any]
    risk: str = "low"
    cost: str = "deterministic"
    confirmation: str = "none"
    verification: str = "pdf_integrity"


TOOLS = (
    ToolDefinition("compress_pdf", "Compress PDF", "Organize", "Reduce file size with a quality preset.",
                   {"type": "object", "properties": {"preset": {"enum": ["basic", "balanced", "strong"]}}, "required": ["document_id"]}),
    ToolDefinition("add_page_numbers", "Add page numbers", "Edit", "Add configurable page numbers to a PDF.",
                   {"type": "object", "properties": {"position": {"enum": ["bottom_left", "bottom_center", "bottom_right", "top_left", "top_center", "top_right"]}, "start_number": {"type": "integer", "minimum": 0}, "page_numbers": {"type": "array", "items": {"type": "integer"}}}, "required": ["document_id"]}),
    ToolDefinition("rotate", "Rotate pages", "Organize", "Rotate selected pages clockwise.",
                   {"type": "object", "properties": {"degrees": {"enum": [90, 180, 270]}, "page_numbers": {"type": "array", "items": {"type": "integer"}}}, "required": ["document_id", "page_numbers"]}),
    ToolDefinition("delete_pages", "Delete pages", "Organize", "Remove selected pages from a copy.",
                   {"type": "object", "properties": {"page_numbers": {"type": "array", "items": {"type": "integer"}}}, "required": ["document_id", "page_numbers"]},
                   risk="medium", confirmation="required", verification="page_count"),
    ToolDefinition("extract_pages", "Extract pages", "Organize", "Create a PDF from selected pages.",
                   {"type": "object", "properties": {"page_numbers": {"type": "array", "items": {"type": "integer"}}}, "required": ["document_id", "page_numbers"]},
                   verification="page_count"),
    ToolDefinition("watermark", "Watermark", "Edit", "Apply a text watermark.",
                   {"type": "object", "properties": {"text": {"type": "string"}, "opacity": {"type": "number"}}, "required": ["document_id", "text"]}),
    ToolDefinition("pdf_to_docx", "PDF to Word", "Convert", "Convert a PDF into an editable Word document.",
                   {"type": "object", "properties": {}, "required": ["document_id"]}, verification="output_opens"),
    ToolDefinition("pdf_to_images", "PDF to images", "Convert", "Render PDF pages as PNG or JPEG.",
                   {"type": "object", "properties": {"format": {"enum": ["png", "jpeg"]}, "dpi": {"type": "integer", "minimum": 72, "maximum": 300}}, "required": ["document_id"]}, verification="output_opens"),
    ToolDefinition("summary", "Summarize", "AI", "Create a grounded document summary.",
                   {"type": "object", "properties": {"style": {"enum": ["short", "detailed", "key_points", "action_items"]}}, "required": ["document_id"]},
                   cost="ai", verification="schema"),
)

TOOL_BY_NAME = {tool.name: tool for tool in TOOLS}


def public_catalog() -> list[dict[str, Any]]:
    return [asdict(tool) for tool in TOOLS]
