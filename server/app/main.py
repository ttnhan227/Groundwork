import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.configs import get_settings
from app.controllers import (
    ai_router,
    auth_router,
    chat_router,
    collections_router,
    deliverables_router,
    documents_router,
    generation_router,
    jobs_router,
    notifications_router,
    users_router,
    workspace_agent_router,
    workspace_router,
)
from app.middlewares import (
    RateLimitMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
    configure_logging,
)

configure_logging()
logger = logging.getLogger("groundwork.errors")
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="2.5.0",
    description="Groundwork AI-first document research workspace API with Clean Architecture.",
)

# --- Global Middlewares ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)

# --- API Routers (Controllers) ---
app.include_router(auth_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1")
app.include_router(generation_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(ai_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(collections_router, prefix="/api/v1")
app.include_router(workspace_router, prefix="/api/v1")
app.include_router(deliverables_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(workspace_agent_router, prefix="/api/v1")


@app.get("/health", tags=["System"])
async def health() -> dict[str, str]:
    return {"status": "healthy", "service": "groundwork-api"}


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception(
        "unhandled_request_error",
        exc_info=error,
        extra={"method": request.method, "path": request.url.path},
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred.",
                "details": {},
            }
        },
    )
