"""Exercise every Phase 4 API against the live Docker stack and configured LLM."""

import io
import sys
import time
import uuid

import fitz
import httpx

API = "http://api:8000/api/v1"


def pdf_bytes(lines: list[str]) -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "\n".join(lines), fontsize=11)
    data = document.tobytes()
    document.close()
    return data


def request(client: httpx.Client, method: str, path: str, token: str = "", **kwargs) -> dict:
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = client.request(method, f"{API}{path}", headers=headers, **kwargs)
    if not response.is_success:
        raise RuntimeError(f"{method} {path}: {response.status_code} {response.text}")
    return response.json()


def upload_and_wait(client: httpx.Client, token: str, filename: str, content: bytes) -> dict:
    document = request(
        client, "POST", "/documents", token,
        files={"file": (filename, io.BytesIO(content), "application/pdf")},
    )
    for _ in range(120):
        current = request(client, "GET", f"/documents/{document['id']}", token)
        if current["status"] == "ready":
            return current
        if current["status"] == "failed":
            raise RuntimeError(current.get("error_message") or "Document processing failed")
        time.sleep(1)
    raise RuntimeError("Timed out waiting for document processing")


def main() -> None:
    suffix = uuid.uuid4().hex[:10]
    with httpx.Client(timeout=120) as client:
        auth = request(client, "POST", "/auth/register", json={
            "email": f"phase4-{suffix}@example.com",
            "password": "PhaseFourTest!42",
            "display_name": "Phase Four Smoke",
        })
        token = auth["access_token"]
        original = upload_and_wait(client, token, "policy-v1.pdf", pdf_bytes([
            "Remote Work Policy Version 1",
            "Employees may work remotely two days per week.",
            "Expense claims must be submitted by March 15, 2026.",
            "The equipment allowance is $500.",
            "Contact person: Alex Nguyen at Insight Labs.",
        ]))
        revised = upload_and_wait(client, token, "policy-v2.pdf", pdf_bytes([
            "Remote Work Policy Version 2",
            "Employees may work remotely three days per week.",
            "Expense claims must be submitted by April 30, 2026.",
            "The equipment allowance is $750.",
            "Managers must approve requests before Friday.",
            "Contact person: Alex Nguyen at Insight Labs.",
        ]))

        summary = request(client, "POST", f"/ai/documents/{original['id']}/summary", token, json={"style": "short"})
        cached = request(client, "POST", f"/ai/documents/{original['id']}/summary", token, json={"style": "short"})
        quiz = request(client, "POST", f"/ai/documents/{original['id']}/quiz", token, json={"question_count": 2})
        extraction = request(client, "POST", f"/ai/documents/{original['id']}/extract", token, json={
            "categories": ["people", "dates", "companies", "monetary_values", "deadlines", "action_items"],
            "custom_fields": [],
        })
        translation = request(client, "POST", f"/ai/documents/{original['id']}/translate", token, json={
            "target_language": "Vietnamese", "page_numbers": [1], "format": "markdown",
        })
        comparison = request(client, "POST", "/ai/compare", token, json={
            "left_document_id": original["id"], "right_document_id": revised["id"],
        })

        assert summary["result"]["content"] and cached["cached"]
        assert len(quiz["result"]["questions"]) == 2
        assert extraction["result"]["items"]
        assert translation["result"]["content"] and translation["result"]["translated_pages"] == [1]
        assert comparison["result"]["changed_sections"] or comparison["result"]["numerical_changes"]
        print("PASS: summaries/cache, quiz, extraction, translation, and document comparison")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise
