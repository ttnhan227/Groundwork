"""Server entry point: hosted account/sync API or explicitly selected local core."""
import importlib
import os
import sys

runtime = 'local' if getattr(sys, 'frozen', False) else os.environ.get('GROUNDWORK_RUNTIME', 'hosted')
if runtime not in {'local', 'hosted'}:
    raise ValueError('GROUNDWORK_RUNTIME must be local or hosted')
module = 'app.local_main' if runtime == 'local' else 'app.hosted.main'
app = importlib.import_module(module).app
