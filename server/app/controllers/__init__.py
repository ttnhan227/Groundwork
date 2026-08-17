"""Controllers (HTTP API Routers) layer for InsightPDF."""

from app.controllers.ai_features import router as ai_router
from app.controllers.auth import router as auth_router
from app.controllers.chat import router as chat_router
from app.controllers.collections import router as collections_router
from app.controllers.deliverables import router as deliverables_router
from app.controllers.documents import router as documents_router
from app.controllers.generation import router as generation_router
from app.controllers.jobs import router as jobs_router
from app.controllers.notifications import router as notifications_router
from app.controllers.users import router as users_router
from app.controllers.workspace import router as workspace_router
from app.controllers.workspace_agent import router as workspace_agent_router

# Backward compatibility alias
notebook_agent_router = workspace_agent_router

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
    "users_router",
    "workspace_agent_router",
    "workspace_router",
]
