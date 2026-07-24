from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth import router as auth_router
from app.chat import router as chat_router
from app.config import get_settings
from app.documents import router as documents_router

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.3.0", description="Phase 3 API for InsightPDF.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")


@app.get("/health", tags=["System"])
async def health() -> dict[str, str]:
    return {"status": "healthy", "service": "insightpdf-api"}


@app.exception_handler(Exception)
async def unexpected_error(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred.", "details": {}}})
