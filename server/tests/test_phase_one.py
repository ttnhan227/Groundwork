from app.documents import safe_filename
from app.security import hash_password, verify_password


def test_password_hash_round_trip() -> None:
    password_hash = hash_password("correct-horse-battery-staple")
    assert password_hash != "correct-horse-battery-staple"
    assert verify_password("correct-horse-battery-staple", password_hash)
    assert not verify_password("wrong-password", password_hash)


def test_filename_is_sanitized() -> None:
    assert safe_filename("../../quarterly<script>.pdf") == "quarterly_script_.pdf"
