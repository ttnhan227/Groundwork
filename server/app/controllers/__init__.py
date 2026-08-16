"""Controllers (HTTP API Routers) layer for InsightPDF."""

from app.controllers.ai_features import router as ai_router
from app.controllers.auth import router as auth_router
from app.controllers.chat import router as chat_router
from app.controllers.collections import router as collections_router
from app.controllers.deliverables import router as deliverables_router
from app.controllers.documents import router as documents_router
from app.controllers.generation import router as generation_router
from app.controllers.jobs import router as jobs_router
from app.controllers.notebook_agent import router as notebook_agent_router
from app.controllers.notifications import router as notifications_router
from app.controllers.pdf_tools import router as pdf_tools_router
from app.controllers.users import router as users_router
from app.controllers.workflows import router as workflows_router
from app.controllers.workspace import router as workspace_router

__all__ = [
    "ai_router",
    "auth_router",
    "chat_router",
    "collections_router",
    "deliverables_router",
    "documents_router",
    "generation_router",
    "jobs_router",
    "notebook_agent_router",
    "notifications_router",
    "pdf_tools_router",
    "users_router",
    "workflows_router",
    "workspace_router",
]
