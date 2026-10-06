from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine

from app.hosted.main import initialize_schema, readiness


def test_schema_check_rejects_existing_table_missing_required_columns():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE users (id VARCHAR PRIMARY KEY)')
    with pytest.raises(RuntimeError, match='schema migration required for users'):
        initialize_schema(engine)


def test_readiness_requires_database_and_reports_exact_commit(monkeypatch):
    monkeypatch.setenv('GROUNDWORK_COMMIT', 'a' * 40)
    db = Mock()
    assert readiness(db)['commit'] == 'a' * 40
    db.execute.side_effect = RuntimeError('private database connection details')
    with pytest.raises(HTTPException) as error:
        readiness(db)
    assert error.value.status_code == 503
    assert error.value.detail == 'Database unavailable'
