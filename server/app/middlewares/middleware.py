import logging
import time
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from starlette.middleware.base import BaseHTTPMiddleware

from app.configs.config import get_settings

logger = logging.getLogger("groundwork.requests")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request_completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; frame-ancestors 'none'"
        )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or not request.url.path.startswith("/api/"):
            return await call_next(request)
        settings = get_settings()
        forwarded = request.headers.get("x-forwarded-for", "")
        address = forwarded.split(",", 1)[0].strip() or (request.client.host if request.client else "unknown")
        minute = int(time.time() // 60)
        path = request.url.path
        if path.endswith("/auth/register"):
            window = int(time.time() // 3600)
            key = f"rate:register:{address}:{window}"
            limit = settings.registration_rate_limit_per_hour
            expiry = 3700
            retry_after = "3600"
        elif any(segment in path for segment in ("/chat", "/ai/", "/jobs")) and request.method == "POST":
            key = f"rate:ai:{address}:{minute}"
            limit = settings.ai_rate_limit_per_minute
            expiry = 70
            retry_after = "60"
        else:
            key = f"rate:all:{address}:{minute}"
            limit = settings.request_rate_limit_per_minute
            expiry = 70
            retry_after = "60"
        redis = Redis.from_url(settings.redis_url, decode_responses=True)
        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, expiry)
            if count > limit:
                return JSONResponse(
                    status_code=429,
                    content={"error": {"code": "RATE_LIMITED", "message": "Too many requests. Try again shortly.", "details": {}}},
                    headers={"Retry-After": retry_after},
                )
        except Exception:
            pass
        finally:
            await redis.aclose()
        return await call_next(request)
