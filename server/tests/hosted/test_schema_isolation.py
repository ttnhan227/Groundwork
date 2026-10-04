"""Hosted SQL qualifies its own schema even when a pooler ignores search_path."""
import os
import subprocess
import sys
from pathlib import Path


def test_postgres_statements_do_not_select_legacy_public_tables():
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[2]),
               DATABASE_URL="postgresql+psycopg2://test:test@localhost/test",
               ENVIRONMENT="development", GROUNDWORK_DATABASE_SCHEMA="groundwork")
    code = """
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable
from app.hosted.core.database import Base
from app.hosted.models.entities import User, GoogleDesktopSession
assert Base.metadata.schema == 'groundwork'
assert 'groundwork.users' in str(select(User).compile(dialect=postgresql.dialect()))
ddl = str(CreateTable(GoogleDesktopSession.__table__).compile(dialect=postgresql.dialect()))
assert 'CREATE TABLE groundwork.google_desktop_sessions' in ddl
assert 'REFERENCES groundwork.users' in ddl
print('Schema isolation passed')
"""
    subprocess.run([sys.executable, "-c", code], env=env, check=True, capture_output=True)
