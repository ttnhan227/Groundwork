import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth import router as auth_router
from app.ai_features import router as ai_router
from app.chat import router as chat_router
from app.collections import router as collections_router
from app.config import get_settings
from app.documents import router as documents_router
from app.deliverables import router as deliverables_router
from app.generation import router as generation_router
from app.jobs import router as jobs_router
from app.pdf_tools import router as pdf_tools_router
from app.users import router as users_router
from app.workflows import router as workflows_router
from app.workspace import router as workspace_router
from app.logging_config import configure_logging
from app.middleware import RateLimitMiddleware, RequestLoggingMiddleware, SecurityHeadersMiddleware

configure_logging()
logger = logging.getLogger("insightpdf.errors")
settings = get_settings()
app = FastAPI(title=settings.app_name, version="2.5.0", description="InsightPDF AI-first document workspace API.")
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
app.include_router(auth_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1")
app.include_router(generation_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(ai_router, prefix="/api/v1")
app.include_router(pdf_tools_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(workflows_router, prefix="/api/v1")
app.include_router(collections_router, prefix="/api/v1")
app.include_router(workspace_router, prefix="/api/v1")
app.include_router(deliverables_router, prefix="/api/v1")


@app.get("/health", tags=["System"])
async def health() -> dict[str, str]:
    return {"status": "healthy", "service": "insightpdf-api"}


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception(
        "unhandled_request_error",
        exc_info=error,
        extra={"method": request.method, "path": request.url.path},
    )
    return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred.", "details": {}}})
