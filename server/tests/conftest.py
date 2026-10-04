import os

# API regression tests exercise the loopback desktop runtime.
os.environ['GROUNDWORK_RUNTIME'] = 'local'
