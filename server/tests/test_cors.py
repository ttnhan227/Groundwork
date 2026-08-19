from fastapi.testclient import TestClient
from app.configs import get_settings
from app.main import app


def test_health_cors_headers_with_allowed_origin() -> None:
    settings = get_settings()
    origin = settings.cors_origin_list[0] if settings.cors_origin_list else "http://localhost:3000"
    client = TestClient(app)
    response = client.get(
        "/health",
        headers={"Origin": origin},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_preflight_options_cors_headers() -> None:
    settings = get_settings()
    origin = settings.cors_origin_list[0] if settings.cors_origin_list else "http://localhost:3000"
    client = TestClient(app)
    response = client.options(
        "/api/v1/auth/google",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "POST" in response.headers.get("access-control-allow-methods", "")
