"""Hosted defaults must never accidentally expose the local filesystem API."""
import json
import os
import subprocess
import sys
from pathlib import Path


def routes(runtime):
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]),
               DATABASE_URL='sqlite://', ENVIRONMENT='development',
               JWT_SECRET='test-secret-with-at-least-32-characters')
    env.pop('GROUNDWORK_RUNTIME', None)
    if runtime:
        env['GROUNDWORK_RUNTIME'] = runtime
    output = subprocess.check_output(
        [sys.executable, '-c', 'import json; from app.main import app; print(json.dumps([r.path for r in app.routes]))'],
        env=env, text=True,
    )
    return json.loads(output)


def test_server_defaults_to_hosted_api():
    paths = routes(None)
    assert '/auth/login' in paths
    assert '/sync/push' in paths
    assert '/api/workspaces' not in paths


def test_explicit_local_runtime_preserves_desktop_api():
    paths = routes('local')
    assert '/api/workspaces' in paths
    assert '/auth/login' not in paths
