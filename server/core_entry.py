"""Frozen local-core entry point. No shell, reload, or external runtime required."""
import multiprocessing
import os
import uvicorn

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from app.local_main import app
    port = int(os.environ.get("GROUNDWORK_PORT") or os.environ.get("GROUNDWORK_CORE_PORT") or "8000")
    host = os.environ.get("GROUNDWORK_HOST") or "127.0.0.1"
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_config=None))
    app.state.request_shutdown = lambda: setattr(server, "should_exit", True)
    server.run()
