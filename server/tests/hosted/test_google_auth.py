import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.hosted.core.config import get_cloud_settings
from app.hosted.core.database import Base, get_db
from app.hosted.main import app
from app.hosted.routers import auth


@pytest.fixture
def google_client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'google.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    def database():
        with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(get_cloud_settings(), 'google_client_id', 'test-client')
    monkeypatch.setattr(auth.id_token, 'verify_oauth2_token', lambda token, request, audience: {
        'sub': token, 'email': 'google@example.com', 'email_verified': True,
    })
    yield TestClient(app)
    app.dependency_overrides.clear()
    engine.dispose()


def test_google_new_repeat_and_authenticated_access(google_client):
    first = google_client.post('/auth/google', json={'id_token': 'subject-1'})
    assert first.status_code == 200
    second = google_client.post('/auth/google', json={'id_token': 'subject-1'})
    assert second.json()['user_id'] == first.json()['user_id']
    headers = {'Authorization': 'Bearer ' + first.json()['access_token']}
    assert google_client.get('/auth/me', headers=headers).status_code == 200
    assert google_client.post('/devices', json={'device_name': 'Google device'}, headers=headers).status_code == 200


def test_existing_password_account_requires_authenticated_link(google_client):
    account = google_client.post('/auth/register', json={'email': 'google@example.com', 'password': 'a-long-test-password'}).json()
    assert google_client.post('/auth/google', json={'id_token': 'subject-1'}).status_code == 409
    assert google_client.post('/auth/google/link', json={'id_token': 'subject-1'}).status_code == 401
    headers = {'Authorization': 'Bearer ' + account['access_token']}
    assert google_client.post('/auth/google/link', json={'id_token': 'subject-1'}, headers=headers).status_code == 200
    assert google_client.post('/auth/google', json={'id_token': 'subject-1'}).json()['user_id'] == account['user_id']
    assert google_client.post('/auth/google/link', json={'id_token': 'subject-2'}, headers=headers).status_code == 409


def test_disabled_invalid_and_unverified_tokens(google_client, monkeypatch):
    monkeypatch.setattr(get_cloud_settings(), 'google_client_id', '')
    assert google_client.post('/auth/google', json={'id_token': 'bad'}).status_code == 503
    monkeypatch.setattr(get_cloud_settings(), 'google_client_id', 'test-client')
    def invalid(*args):
        raise ValueError('invalid audience or signature')
    monkeypatch.setattr(auth.id_token, 'verify_oauth2_token', invalid)
    assert google_client.post('/auth/google', json={'id_token': 'bad'}).status_code == 401
    monkeypatch.setattr(auth.id_token, 'verify_oauth2_token', lambda *args: {'sub': 's', 'email': 'google@example.com', 'email_verified': False})
    assert google_client.post('/auth/google', json={'id_token': 'bad'}).status_code == 401


def test_verifier_receives_configured_audience(monkeypatch):
    monkeypatch.setattr(get_cloud_settings(), 'google_client_id', 'expected-client')
    def verify(token, request, audience):
        assert token == 'credential'
        assert audience == 'expected-client'
        assert isinstance(request, auth.GoogleRequest)
        return {'sub': 'stable-subject', 'email': 'google@example.com', 'email_verified': True}
    monkeypatch.setattr(auth.id_token, 'verify_oauth2_token', verify)
    assert auth.verified_google_claims(auth.GoogleLoginRequest(id_token='credential')).sub == 'stable-subject'

@pytest.mark.parametrize('change', [{}, {'aud': 'other-client'}, {'iss': 'other-issuer'}, {'exp': 1}])
def test_real_google_verifier_checks_signed_claims(monkeypatch, change):
    import time

    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    monkeypatch.setattr(auth.id_token, '_fetch_certs', lambda *args, **kwargs: {'test-key': public})
    monkeypatch.setattr(get_cloud_settings(), 'google_client_id', 'test-client')
    claims = {'sub': 'subject', 'email': 'google@example.com', 'email_verified': True,
              'aud': 'test-client', 'iss': 'https://accounts.google.com', 'iat': int(time.time()), 'exp': int(time.time()) + 300}
    claims.update(change)
    token = jwt.encode(claims, key, algorithm='RS256', headers={'kid': 'test-key'})
    if change:
        with pytest.raises(HTTPException) as error:
            auth.verified_google_claims(auth.GoogleLoginRequest(id_token=token))
        assert error.value.status_code == 401
    else:
        assert auth.verified_google_claims(auth.GoogleLoginRequest(id_token=token)).sub == 'subject'
        wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        forged = jwt.encode(claims, wrong_key, algorithm='RS256', headers={'kid': 'test-key'})
        with pytest.raises(HTTPException) as error:
            auth.verified_google_claims(auth.GoogleLoginRequest(id_token=forged))
        assert error.value.status_code == 401


def test_verification_outage_and_mismatched_link(google_client, monkeypatch):
    account = google_client.post('/auth/register', json={'email': 'different@example.com', 'password': 'a-long-test-password'}).json()
    headers = {'Authorization': 'Bearer ' + account['access_token']}
    assert google_client.post('/auth/google/link', json={'id_token': 'subject'}, headers=headers).status_code == 409
    def unavailable(*args):
        raise auth.google_exceptions.TransportError('network unavailable')
    monkeypatch.setattr(auth.id_token, 'verify_oauth2_token', unavailable)
    assert google_client.post('/auth/google', json={'id_token': 'subject'}).status_code == 503


def test_existing_uuid_user_ids_match_new_identity_foreign_key(monkeypatch):
    import importlib

    from sqlalchemy import Uuid
    main = importlib.import_module('app.hosted.main')
    class ExistingDatabase:
        def has_table(self, name, schema=None):
            return name == 'users'
        def get_columns(self, name, schema=None):
            return [{'name': 'id', 'type': Uuid()}]
    monkeypatch.setattr(main, 'inspect', lambda bind: ExistingDatabase())
    monkeypatch.setattr(main.Base.metadata, 'create_all', lambda **kwargs: None)
    original_types = [(column, column.type) for table in main.Base.metadata.tables.values() for column in table.columns]
    try:
        main.initialize_schema(object())
        for table in main.Base.metadata.tables.values():
            for column in table.columns:
                if any(key.target_fullname == 'users.id' for key in column.foreign_keys):
                    assert isinstance(column.type, Uuid)
                    assert column.type.as_uuid is False
    finally:
        for column, original in original_types:
            column.type = original
