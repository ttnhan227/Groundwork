"""Exercise every Phase 5 operation against the live Docker stack."""

import io
import sys
import time
import uuid
from zipfile import ZipFile

import fitz
import httpx
from PIL import Image

API = "http://api:8000/api/v1"


def pdf_bytes(label: str, pages: int) -> bytes:
    document = fitz.open()
    for number in range(1, pages + 1):
        page = document.new_page()
        page.insert_text((72, 72), f"{label} - Page {number}")
    data = document.tobytes()
    document.close()
    return data


def image_bytes(color: str) -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (180, 120), color).save(stream, format="PNG")
    return stream.getvalue()


def call(client: httpx.Client, method: str, path: str, token: str = "", **kwargs):
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = client.request(method, f"{API}{path}", headers=headers, **kwargs)
    if not response.is_success:
        raise RuntimeError(f"{method} {path}: {response.status_code} {response.text}")
    return response


def upload(client: httpx.Client, token: str, name: str, data: bytes) -> dict:
    document = call(client, "POST", "/documents", token, files={"file": (name, data, "application/pdf")}).json()
    for _ in range(120):
        current = call(client, "GET", f"/documents/{document['id']}", token).json()
        if current["status"] == "ready":
            return current
        if current["status"] == "failed":
            raise RuntimeError(current.get("error_message") or "Processing failed")
        time.sleep(1)
    raise RuntimeError("Timed out processing test PDF")


def artifact(client: httpx.Client, token: str, path: str, **kwargs) -> tuple[dict, bytes]:
    item = call(client, "POST", path, token, **kwargs).json()
    data = call(client, "GET", f"/pdf-tools/artifacts/{item['id']}/download", token).content
    return item, data


def pages(data: bytes) -> int:
    document = fitz.open(stream=data, filetype="pdf")
    count = document.page_count
    document.close()
    return count


def main() -> None:
    with httpx.Client(timeout=120) as client:
        suffix = uuid.uuid4().hex[:10]
        auth = call(client, "POST", "/auth/register", json={
            "email": f"phase5-{suffix}@example.com", "password": "PhaseFiveTest!42", "display_name": "Phase Five Smoke",
        }).json()
        token = auth["access_token"]
        first = upload(client, token, "first.pdf", pdf_bytes("First", 3))
        second = upload(client, token, "second.pdf", pdf_bytes("Second", 2))

        _, merged = artifact(client, token, "/pdf-tools/merge", json={"document_ids": [first["id"], second["id"]]})
        _, extracted = artifact(client, token, "/pdf-tools/extract", json={"document_id": first["id"], "page_numbers": [3, 1]})
        _, deleted = artifact(client, token, "/pdf-tools/delete-pages", json={"document_id": first["id"], "page_numbers": [2]})
        _, rotated = artifact(client, token, "/pdf-tools/rotate", json={"document_id": first["id"], "page_numbers": [1], "degrees": 90})
        _, split = artifact(client, token, "/pdf-tools/split", json={"document_id": first["id"], "mode": "ranges", "ranges": ["1-2", "3"], "page_numbers": []})
        _, rendered = artifact(client, token, "/pdf-tools/pdf-to-images", json={"document_id": first["id"], "page_numbers": [1, 3], "format": "png", "dpi": 96})
        _, from_images = artifact(client, token, "/pdf-tools/images-to-pdf", files=[
            ("files", ("blue.png", image_bytes("blue"), "image/png")),
            ("files", ("green.png", image_bytes("green"), "image/png")),
        ])
        _, text_watermark = artifact(client, token, "/pdf-tools/watermark", data={
            "document_id": first["id"], "text": "CONFIDENTIAL", "page_numbers": "1", "position": "center", "opacity": ".3", "rotation": "0",
        })
        _, image_watermark = artifact(client, token, "/pdf-tools/watermark", data={
            "document_id": first["id"], "text": "", "page_numbers": "", "position": "bottom_right", "opacity": ".4", "rotation": "0",
        }, files={"image": ("mark.png", image_bytes("red"), "image/png")})

        assert pages(merged) == 5 and pages(extracted) == 2 and pages(deleted) == 2
        rotated_pdf = fitz.open(stream=rotated, filetype="pdf")
        assert rotated_pdf[0].rotation == 90
        rotated_pdf.close()
        with ZipFile(io.BytesIO(split)) as archive:
            assert len(archive.namelist()) == 2
        with ZipFile(io.BytesIO(rendered)) as archive:
            assert archive.namelist() == ["page-1.png", "page-3.png"]
        assert pages(from_images) == 2 and pages(text_watermark) == 3 and pages(image_watermark) == 3
        assert len(call(client, "GET", "/pdf-tools/artifacts", token).json()) == 9
        print("PASS: merge, split, rotate, delete/extract pages, conversions, text/image watermarks, and secured downloads")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise
