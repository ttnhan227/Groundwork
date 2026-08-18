"""Live Phase 1-3 smoke test for a running Docker Compose stack."""

import argparse
import sys
import time
import uuid

import fitz
import httpx


def make_pdf() -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text(
        (72, 72),
        "Groundwork live smoke test. The verified launch code is 7391. "
        "This validates extraction, indexing, retrieval, and citation.",
    )
    data = document.tobytes()
    document.close()
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000/api/v1")
    parser.add_argument("--timeout", type=int, default=420)
    args = parser.parse_args()

    email = f"phase3-smoke-{uuid.uuid4().hex[:10]}@example.com"
    with httpx.Client(timeout=60) as client:
        auth = client.post(
            f"{args.base_url}/auth/register",
            json={"email": email, "password": "Smoke-test-password-7391", "display_name": "Phase 3 Smoke"},
        )
        auth.raise_for_status()
        headers = {"Authorization": f"Bearer {auth.json()['access_token']}"}
        upload = client.post(
            f"{args.base_url}/documents",
            headers=headers,
            files={"file": ("phase-3-smoke.pdf", make_pdf(), "application/pdf")},
        )
        upload.raise_for_status()
        document = upload.json()
        print(f"uploaded document={document['id']}")

        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            response = client.get(f"{args.base_url}/documents/{document['id']}", headers=headers)
            response.raise_for_status()
            document = response.json()
            print(f"status={document['status']}")
            if document["status"] == "ready":
                break
            if document["status"] == "failed":
                raise RuntimeError(document.get("error_message") or "Document processing failed")
            time.sleep(3)
        else:
            raise TimeoutError("Document did not become ready before the smoke-test timeout")

        conversation = client.post(
            f"{args.base_url}/conversations",
            headers=headers,
            json={"title": "Phase 3 live smoke", "document_ids": [document["id"]]},
        )
        conversation.raise_for_status()
        answer = client.post(
            f"{args.base_url}/conversations/{conversation.json()['id']}/messages",
            headers=headers,
            json={"question": "What is the verified launch code?"},
        )
        answer.raise_for_status()
        payload = answer.json()
        if "7391" not in payload["answer"]:
            raise AssertionError(f"Grounded value missing from answer: {payload['answer']}")
        if not payload["citations"] or payload["citations"][0]["page_number"] != 1:
            raise AssertionError(f"Expected a Page 1 citation: {payload['citations']}")
        print("PASS: authentication, upload, processing, indexing, RAG chat, and Page 1 citation")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise
