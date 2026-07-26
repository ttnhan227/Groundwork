from app.documents import safe_filename, unique_archive_name
from app.security import hash_password, verify_password
from app.storage import ObjectStorage


def test_password_hash_round_trip() -> None:
    password_hash = hash_password("correct-horse-battery-staple")
    assert password_hash != "correct-horse-battery-staple"
    assert verify_password("correct-horse-battery-staple", password_hash)
    assert not verify_password("wrong-password", password_hash)


def test_filename_is_sanitized() -> None:
    assert safe_filename("../../quarterly<script>.pdf") == "quarterly_script_.pdf"


def test_archive_filenames_are_unique() -> None:
    used: set[str] = set()
    assert unique_archive_name("report.pdf", used) == "report.pdf"
    assert unique_archive_name("REPORT.pdf", used) == "REPORT (2).pdf"
    assert unique_archive_name("../../report.pdf", used) == "report (3).pdf"


def test_storage_facade_accepts_replaceable_backend() -> None:
    class MemoryStorage:
        objects: dict[str, bytes] = {}

        def upload(self, object_key: str, data: bytes, content_type: str) -> None:
            self.objects[object_key] = data

        def remove(self, object_key: str) -> None:
            self.objects.pop(object_key, None)

        def download(self, object_key: str) -> bytes:
            return self.objects[object_key]

    backend = MemoryStorage()
    storage = ObjectStorage(backend)
    storage.upload_pdf("originals/document.pdf", b"%PDF-test")
    assert storage.download("originals/document.pdf") == b"%PDF-test"
    storage.remove("originals/document.pdf")
    assert backend.objects == {}
