from io import BytesIO
from typing import Protocol

from minio import Minio

from app.config import get_settings


class StorageBackend(Protocol):
    """Replaceable private-object storage contract."""

    def upload(self, object_key: str, data: bytes, content_type: str) -> None: ...
    def remove(self, object_key: str) -> None: ...
    def download(self, object_key: str) -> bytes: ...


class MinIOStorage:
    """MinIO/S3 implementation of the storage contract."""

    def __init__(self) -> None:
        settings = get_settings()
        self.bucket = settings.minio_bucket_originals
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )

    def ensure_bucket(self) -> None:
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)

    def upload_pdf(self, object_key: str, data: bytes) -> None:
        self.upload(object_key, data, "application/pdf")

    def upload(self, object_key: str, data: bytes, content_type: str) -> None:
        self.ensure_bucket()
        self.client.put_object(self.bucket, object_key, BytesIO(data), len(data), content_type=content_type)

    def remove(self, object_key: str) -> None:
        self.client.remove_object(self.bucket, object_key)

    def download(self, object_key: str) -> bytes:
        response = self.client.get_object(self.bucket, object_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()


class ObjectStorage:
    """Application-facing storage facade.

    Callers depend on this facade rather than the MinIO SDK. A different
    backend can be injected in tests or wired here for S3/Azure deployments.
    """

    def __init__(self, backend: StorageBackend | None = None) -> None:
        self.backend = backend or MinIOStorage()

    def upload_pdf(self, object_key: str, data: bytes) -> None:
        self.backend.upload(object_key, data, "application/pdf")

    def upload(self, object_key: str, data: bytes, content_type: str) -> None:
        self.backend.upload(object_key, data, content_type)

    def remove(self, object_key: str) -> None:
        self.backend.remove(object_key)

    def download(self, object_key: str) -> bytes:
        return self.backend.download(object_key)
