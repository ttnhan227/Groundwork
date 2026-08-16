"""Normalize generated document content into reader-facing Markdown."""

import json
import re
from typing import Any

_TITLE_KEYS = {"title", "report_title", "document_title", "proposal_title"}


def _label(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("_", " ").replace("-", " ")).strip().title()


def _scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value).strip()


def _render(value: Any, level: int = 1) -> list[str]:
    if isinstance(value, dict):
        lines: list[str] = []
        for key, child in value.items():
            normalized_key = str(key).strip().casefold()
            if normalized_key in _TITLE_KEYS and not isinstance(child, (dict, list)):
                title = _scalar(child)
                if title:
                    lines.extend([f"{'#' * min(level, 6)} {title}", ""])
                continue

            heading = _label(str(key)) or "Section"
            lines.extend([f"{'#' * min(level, 6)} {heading}", ""])
            if isinstance(child, (dict, list)):
                lines.extend(_render(child, level + 1))
            else:
                text = _scalar(child)
                if text:
                    lines.extend([text, ""])
        return lines

    if isinstance(value, list):
        lines = []
        for index, child in enumerate(value, 1):
            if isinstance(child, dict):
                title_key = next((key for key in child if str(key).strip().casefold() in _TITLE_KEYS | {"name", "heading"}), None)
                if title_key is not None and not isinstance(child[title_key], (dict, list)):
                    title = _scalar(child[title_key])
                    if title:
                        lines.extend([f"{'#' * min(level, 6)} {title}", ""])
                    child = {key: item for key, item in child.items() if key != title_key}
                else:
                    lines.extend([f"{'#' * min(level, 6)} Item {index}", ""])
                lines.extend(_render(child, level + 1))
            elif isinstance(child, list):
                lines.extend(_render(child, level + 1))
            else:
                text = _scalar(child)
                if text:
                    lines.append(f"- {text}")
        if lines and lines[-1] != "":
            lines.append("")
        return lines

    text = _scalar(value)
    return [text, ""] if text else []


def normalize_generated_text(value: Any) -> str:
    """Return prose unchanged and render a complete JSON object/array as Markdown."""
    text = _scalar(value)
    if not text:
        return ""

    candidate = text.strip()
    if candidate.startswith("```") and candidate.endswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate, flags=re.IGNORECASE)
        candidate = re.sub(r"\s*```$", "", candidate)
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        return text
    if not isinstance(parsed, (dict, list)):
        return text

    rendered = "\n".join(_render(parsed)).strip()
    return re.sub(r"\n{3,}", "\n\n", rendered)


def normalize_document_content(content: dict[str, Any] | None) -> tuple[dict[str, Any], bool]:
    """Normalize JSON-shaped text blocks while preserving the native document schema."""
    normalized = dict(content or {})
    blocks = [dict(block) for block in normalized.get("blocks", [])]
    changed = False
    for block in blocks:
        current = block.get("text", "")
        replacement = normalize_generated_text(current)
        if replacement != current:
            block["text"] = replacement
            changed = True
    normalized["blocks"] = blocks
    return normalized, changed
