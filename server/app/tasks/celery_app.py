import ssl
from celery import Celery

from app.config import get_settings
from app.logging_config import configure_logging

configure_logging()
settings = get_settings()

broker_use_ssl = {"ssl_cert_reqs": ssl.CERT_NONE} if settings.redis_url.startswith("rediss://") else None
redis_backend_use_ssl = {"ssl_cert_reqs": ssl.CERT_NONE} if settings.redis_url.startswith("rediss://") else None

celery_app = Celery("groundwork", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    broker_use_ssl=broker_use_ssl,
    redis_backend_use_ssl=redis_backend_use_ssl,
)
celery_app.autodiscover_tasks(["app"])
