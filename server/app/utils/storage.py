from typing import Protocol

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.configs.config import get_settings


class StorageBackend(Protocol):
    """Replaceable private-object storage contract."""

    def upload(self, object_key: str, data: bytes, content_type: str) -> None: ...
    def remove(self, object_key: str) -> None: ...
    def download(self, object_key: str) -> bytes: ...


class S3Storage:
    """S3-compatible storage, including Supabase Storage and MinIO."""

    def __init__(self) -> None:
        settings = get_settings()
        self.bucket = settings.minio_bucket_originals
        endpoint = settings.minio_endpoint.rstrip("/")
        if not endpoint.startswith(("http://", "https://")):
            scheme = "https" if settings.minio_secure else "http"
            endpoint = f"{scheme}://{endpoint}"
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            region_name=settings.minio_region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status not in (404, 400):
                raise
            self.client.create_bucket(Bucket=self.bucket)

    def upload_pdf(self, object_key: str, data: bytes) -> None:
        self.upload(object_key, data, "application/pdf")

    def upload(self, object_key: str, data: bytes, content_type: str) -> None:
        self.ensure_bucket()
        self.client.put_object(Bucket=self.bucket, Key=object_key, Body=data, ContentType=content_type)

    def remove(self, object_key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=object_key)

    def download(self, object_key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=object_key)
        return response["Body"].read()


class ObjectStorage:
    """Application-facing storage facade.

    Callers depend on this facade rather than the MinIO SDK. A different
    backend can be injected in tests or wired here for S3/Azure deployments.
    """

    def __init__(self, backend: StorageBackend | None = None) -> None:
        self.backend = backend or S3Storage()

    def upload_pdf(self, object_key: str, data: bytes) -> None:
        self.backend.upload(object_key, data, "application/pdf")

    def upload(self, object_key: str, data: bytes, content_type: str) -> None:
        self.backend.upload(object_key, data, content_type)

    def remove(self, object_key: str) -> None:
        self.backend.remove(object_key)

    def download(self, object_key: str) -> bytes:
        return self.backend.download(object_key)
