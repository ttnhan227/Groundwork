import pytest

from app.hosted.core.config import CloudSettings


def test_cloud_run_environment(monkeypatch):
    monkeypatch.setenv('ENVIRONMENT', 'production')
    monkeypatch.setenv('JWT_SECRET', 'test-secret-with-more-than-32-characters')
    monkeypatch.setenv('DATABASE_URL', 'postgresql+psycopg2://user:password@pooler.example:5432/postgres?sslmode=require')
    monkeypatch.setenv('CORS_ORIGINS', 'https://groundwork-client.onrender.com')
    monkeypatch.setenv('ACCESS_TOKEN_MINUTES', '15')
    settings = CloudSettings(_env_file=None)
    assert settings.access_token_expire_minutes == 15
    assert settings.cors_origin_list == ['https://groundwork-client.onrender.com']
    assert settings.database_url.endswith('?sslmode=require')


def test_token_lifetime_rejects_invalid_values(monkeypatch):
    monkeypatch.setenv('ACCESS_TOKEN_MINUTES', '0')
    with pytest.raises(ValueError):
        CloudSettings(_env_file=None)


def test_async_driver_is_rejected(monkeypatch):
    monkeypatch.setenv('DATABASE_URL', 'postgresql+asyncpg://user:password@pooler.example:5432/postgres')
    with pytest.raises(ValueError, match='synchronous PostgreSQL driver'):
        CloudSettings(_env_file=None)
