from celery import Celery

from app.config import get_settings
from app.logging_config import configure_logging

configure_logging()
settings = get_settings()
celery_app = Celery("groundwork", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
)
celery_app.autodiscover_tasks(["app"])
