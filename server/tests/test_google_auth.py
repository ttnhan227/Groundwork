import pytest
from fastapi import HTTPException

from app import auth


def test_google_credential_is_verified_for_the_configured_audience(monkeypatch) -> None:
    observed: dict[str, str] = {}

    def fake_verify(credential, request, audience, clock_skew_in_seconds=0):
        observed.update(
            credential=credential,
            audience=audience,
            clock_skew_in_seconds=clock_skew_in_seconds,
        )
        return {
            "sub": "google-user-123",
            "email": "person@gmail.com",
            "email_verified": True,
            "name": "Person",
        }

    monkeypatch.setattr(auth.google_id_token, "verify_oauth2_token", fake_verify)

    claims = auth.verify_google_credential("signed-google-token", "web-client-id")

    assert claims["sub"] == "google-user-123"
    assert observed == {
        "credential": "signed-google-token",
        "audience": "web-client-id",
        "clock_skew_in_seconds": 10,
    }


def test_google_credential_requires_verified_email(monkeypatch) -> None:
    monkeypatch.setattr(
        auth.google_id_token,
        "verify_oauth2_token",
        lambda *_, **__: {"sub": "google-user-123", "email": "person@example.com", "email_verified": False},
    )

    with pytest.raises(HTTPException) as error:
        auth.verify_google_credential("signed-google-token", "web-client-id")

    assert error.value.status_code == 401


def test_google_sign_in_requires_configuration() -> None:
    with pytest.raises(HTTPException) as error:
        auth.verify_google_credential("signed-google-token", "")

    assert error.value.status_code == 503
