"""Verify Phase 6 account, dashboard, document lifecycle, demo, and security behavior."""

import io
import sys
import time
import uuid

import fitz
import httpx

API = "http://api:8000/api/v1"


def call(client: httpx.Client, method: str, path: str, token: str = "", **kwargs) -> httpx.Response:
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = client.request(method, f"{API}{path}", headers=headers, **kwargs)
    if not response.is_success:
        raise RuntimeError(f"{method} {path}: {response.status_code} {response.text}")
    return response


def pdf() -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "Phase 6 lifecycle verification")
    data = document.tobytes()
    document.close()
    return data


def main() -> None:
    with httpx.Client(timeout=60) as client:
        demo = call(client, "POST", "/auth/login", json={
            "email": "demo@insightpdf.dev", "password": "DemoPassword123!",
        }).json()
        demo_documents = call(client, "GET", "/documents", demo["access_token"]).json()
        assert len(demo_documents) >= 3

        suffix = uuid.uuid4().hex[:10]
        auth = call(client, "POST", "/auth/register", json={
            "email": f"phase6-{suffix}@example.com", "password": "OriginalPassword!42", "display_name": "Phase Six User",
        }).json()
        token = auth["access_token"]
        document = call(client, "POST", "/documents", token, files={
            "file": ("lifecycle.pdf", io.BytesIO(pdf()), "application/pdf"),
        }).json()
        renamed = call(client, "PATCH", f"/documents/{document['id']}", token, json={"filename": "renamed-lifecycle"}).json()
        assert renamed["filename"] == "renamed-lifecycle.pdf"
        for _ in range(60):
            current = call(client, "GET", f"/documents/{document['id']}", token).json()
            if current["status"] in {"ready", "failed"}:
                break
            time.sleep(1)
        stats = call(client, "GET", "/profile/stats", token).json()
        dashboard = call(client, "GET", "/dashboard", token).json()
        assert stats["document_count"] == 1 and dashboard["recent_documents"]
        updated = call(client, "PATCH", "/profile", token, json={"display_name": "Updated Portfolio User"}).json()
        assert updated["display_name"] == "Updated Portfolio User"
        call(client, "DELETE", f"/documents/{document['id']}", token)
        assert call(client, "GET", "/profile/stats", token).json()["document_count"] == 0
        call(client, "POST", "/profile/password", token, json={
            "current_password": "OriginalPassword!42", "new_password": "UpdatedPassword!42",
        })
        login = call(client, "POST", "/auth/login", json={
            "email": f"phase6-{suffix}@example.com", "password": "UpdatedPassword!42",
        })
        assert login.headers["x-content-type-options"] == "nosniff"
        print("PASS: demo seed, profile/password, dashboard metrics, document rename/delete, and security headers")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise
