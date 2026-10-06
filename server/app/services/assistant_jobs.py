"""Bounded local background work; requests return immediately for UI polling."""

import threading
import time
import uuid


class AssistantJobs:
    lock = threading.Lock()
    jobs = {}

    @classmethod
    def start(cls, work):
        with cls.lock:
            if any(j["status"] == "running" for j in cls.jobs.values()):
                raise ValueError("Another assistant task is running. Wait or cancel the answer first.")
            cls.jobs = {key: job for key, job in cls.jobs.items() if time.time() - job["created"] < 3600}
            cls.jobs = dict(sorted(cls.jobs.items(), key=lambda entry: entry[1]["created"])[-63:])
            job_id = uuid.uuid4().hex
            job = {"id": job_id, "created": time.time(), "status": "running", "result": None, "error": None}
            cls.jobs[job_id] = job

        def run():
            try:
                result = work()
                job.update(result=result.model_dump() if hasattr(result, "model_dump") else result, status="complete")
            except InterruptedError:
                job.update(status="cancelled", error="Answer cancelled.")
            except (ValueError, RuntimeError) as exc:
                job.update(status="error", error=str(exc))
            except Exception:
                job.update(
                    status="error",
                    error="This task couldn't finish. Your files are safe; check operation history before retrying a move.",
                )

        threading.Thread(target=run, daemon=True).start()
        return job

    @classmethod
    def get(cls, job_id):
        with cls.lock:
            if job_id not in cls.jobs:
                raise ValueError("This task is no longer available. Check saved work or operation history.")
            return dict(cls.jobs[job_id])
