"""SSRF defense utility for validating and safely fetching external URLs."""

import ipaddress
import socket
from urllib.parse import urljoin, urlparse
import httpx

BLOCKED_IP_NETWORKS = [
    # IPv4 loopback & private
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),  # Link-local / Cloud metadata (AWS, GCP, Azure)
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),  # Carrier-grade NAT
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),   # Documentation / TEST-NET-1
    ipaddress.ip_network("198.18.0.0/15"),  # Network benchmark
    ipaddress.ip_network("198.51.100.0/24"), # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),  # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),    # Multicast
    ipaddress.ip_network("240.0.0.0/4"),    # Reserved
    # IPv6 loopback & private
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),       # Unique local
    ipaddress.ip_network("fe80::/10"),      # Link-local
    ipaddress.ip_network("::ffff:0:0/96"),  # IPv4-mapped IPv6
]

MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB limit
FETCH_TIMEOUT_SECONDS = 15.0


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Check whether an IP address belongs to any blocked/private/metadata ranges."""
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return True
    for network in BLOCKED_IP_NETWORKS:
        if ip in network:
            return True
    return False


def validate_url_and_resolve(url: str) -> tuple[str, str]:
    """
    Validate that the URL has an allowed scheme (http/https) and that
    the resolved host IP does not point to a loopback, private, or metadata endpoint.

    Returns:
        (validated_url, resolved_ip_str)
    Raises:
        ValueError if URL is malformed, uses unsupported scheme, or resolves to blocked IP.
    """
    parsed = urlparse(url)
    if parsed.scheme.lower() not in ("http", "https"):
        raise ValueError("Only http and https protocols are allowed.")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL must have a valid hostname.")

    # Check for localhost literal
    if hostname.lower() in ("localhost", "localhost.localdomain", "ip6-localhost"):
        raise ValueError("Access to localhost is prohibited.")

    # Resolve hostname to IP addresses via DNS
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve hostname '{hostname}': {exc}") from exc

    if not addr_info:
        raise ValueError(f"No IP addresses resolved for hostname '{hostname}'.")

    # Check every resolved IP address
    for entry in addr_info:
        sockaddr = entry[4]
        raw_ip = sockaddr[0]
        try:
            ip_obj = ipaddress.ip_address(raw_ip)
            if is_ip_blocked(ip_obj):
                raise ValueError(f"Access to host '{hostname}' (resolved to protected IP {raw_ip}) is prohibited.")
        except ValueError as ip_err:
            if "prohibited" in str(ip_err):
                raise
            raise ValueError(f"Invalid IP address resolved: {raw_ip}") from ip_err

    # Return validated URL and primary resolved IP
    primary_ip = addr_info[0][4][0]
    return url, primary_ip


async def safe_fetch_url(url: str, max_redirects: int = 3) -> tuple[str, str]:
    """
    Safely fetch external web content, validating against SSRF on initial URL
    and on every redirect.

    Returns:
        (content_text, final_url)
    Raises:
        ValueError or httpx.HTTPError on failure.
    """
    current_url = url
    for _ in range(max_redirects + 1):
        validated_url, _ = validate_url_and_resolve(current_url)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 GroundworkBot/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        }

        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = await client.get(validated_url, headers=headers)

            # Check if this is a redirect
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                if not location:
                    raise ValueError("Redirect response missing Location header.")
                current_url = urljoin(validated_url, location)
                continue

            response.raise_for_status()

            # Enforce content length
            content_length_header = response.headers.get("Content-Length")
            if content_length_header and int(content_length_header) > MAX_CONTENT_LENGTH:
                raise ValueError(f"Content exceeds maximum allowable size of {MAX_CONTENT_LENGTH // (1024 * 1024)} MB.")

            # Validate body size
            content_bytes = response.content
            if len(content_bytes) > MAX_CONTENT_LENGTH:
                raise ValueError(f"Downloaded content exceeds maximum limit of {MAX_CONTENT_LENGTH // (1024 * 1024)} MB.")

            return response.text, str(response.url)

    raise ValueError(f"Too many redirects (exceeded limit of {max_redirects}).")
