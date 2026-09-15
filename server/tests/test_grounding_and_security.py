import ipaddress
import pytest
from unittest.mock import AsyncMock, patch

from app.utils.security_ssrf import is_ip_blocked, validate_url_and_resolve
from app.services.rag import format_grounded_answer


def test_ssrf_blocks_private_and_loopback_ips():
    # Loopback
    assert is_ip_blocked(ipaddress.ip_address("127.0.0.1"))
    assert is_ip_blocked(ipaddress.ip_address("127.0.1.1"))
    assert is_ip_blocked(ipaddress.ip_address("::1"))

    # Private RFC1918
    assert is_ip_blocked(ipaddress.ip_address("10.0.0.1"))
    assert is_ip_blocked(ipaddress.ip_address("172.16.0.5"))
    assert is_ip_blocked(ipaddress.ip_address("192.168.1.1"))

    # Cloud metadata / link-local
    assert is_ip_blocked(ipaddress.ip_address("169.254.169.254"))

    # Public IP should NOT be blocked
    assert not is_ip_blocked(ipaddress.ip_address("8.8.8.8"))
    assert not is_ip_blocked(ipaddress.ip_address("1.1.1.1"))


def test_ssrf_rejects_disallowed_schemes():
    with pytest.raises(ValueError, match="Only http and https"):
        validate_url_and_resolve("ftp://example.com/file.txt")

    with pytest.raises(ValueError, match="Only http and https"):
        validate_url_and_resolve("file:///etc/passwd")

    with pytest.raises(ValueError, match="Access to localhost is prohibited"):
        validate_url_and_resolve("http://localhost:8000/secret")


def test_format_grounded_answer_maps_citation_tags():
    raw = "The company reported 45% revenue growth [Source 2] and opened a new lab [Source 1]."
    mapping = {2: 1, 1: 2}
    formatted = format_grounded_answer(raw, mapping)
    assert "[1]" in formatted
    assert "[2]" in formatted
    assert "[Source" not in formatted
    assert formatted.startswith("The company reported 45% revenue growth [1] and opened a new lab [2].")


def test_format_grounded_answer_leaves_uncited_prose_clean():
    raw = "The provided sources do not contain sufficient information to answer this question."
    formatted = format_grounded_answer(raw, {})
    assert formatted == "The provided sources do not contain sufficient information to answer this question."
