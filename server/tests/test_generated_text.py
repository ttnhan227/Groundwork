from app.generated_text import normalize_document_content, normalize_generated_text


def test_nested_json_is_rendered_as_reader_facing_markdown() -> None:
    value = '{"report_title":"Northstar Review","executive_summary":{"purpose":"Improve onboarding","key_findings":["Slow setup","Unclear ownership"]}}'

    result = normalize_generated_text(value)

    assert result.startswith("# Northstar Review")
    assert "# Executive Summary" in result
    assert "## Purpose\n\nImprove onboarding" in result
    assert "- Slow setup" in result
    assert '"executive_summary"' not in result


def test_plain_prose_is_preserved() -> None:
    assert normalize_generated_text("A concise recommendation.") == "A concise recommendation."


def test_document_content_normalizes_json_text_blocks() -> None:
    content, changed = normalize_document_content({"type": "doc", "blocks": [{"type": "paragraph", "text": '{"summary":"Useful"}'}]})

    assert changed is True
    assert content["blocks"][0]["text"] == "# Summary\n\nUseful"
