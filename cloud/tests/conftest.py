import sys
import os
from pathlib import Path

# Tests must never inherit the obsolete root .env database connection.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ENVIRONMENT"] = "development"
os.environ["JWT_SECRET"] = "test-only-cloud-secret-with-at-least-32-characters"

# Ensure cloud root takes precedence over server when running cloud tests
cloud_root = str(Path(__file__).resolve().parent.parent)
sys.path = [p for p in sys.path if not p.endswith("server")]
if cloud_root not in sys.path:
    sys.path.insert(0, cloud_root)

# Purge any imported app modules from server
for mod in list(sys.modules.keys()):
    if mod == "app" or mod.startswith("app."):
        del sys.modules[mod]
