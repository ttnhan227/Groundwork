"""InsightPDF Enterprise Clean Layered Architecture root package.

Provides automated on-demand module resolution and backward-compatibility aliases:
- app.configs
- app.controllers
- app.database
- app.dtos
- app.middlewares
- app.models
- app.repositories
- app.seeders
- app.services
- app.utils
- app.tasks
"""

import importlib
import importlib.util
import sys
from importlib.abc import Loader, MetaPathFinder

_MODULE_MAPPING = {
    # Configurations
    "app.config": "app.configs.config",
    "app.core.config": "app.configs.config",
    "app.core": "app.configs",

    # Database
    "app.core.database": "app.database.database",

    # Security, Storage & Middlewares
    "app.security": "app.utils.security",
    "app.core.security": "app.utils.security",
    "app.storage": "app.utils.storage",
    "app.core.storage": "app.utils.storage",
    "app.middleware": "app.middlewares.middleware",
    "app.core.middleware": "app.middlewares.middleware",
    "app.logging_config": "app.middlewares.logging_config",
    "app.core.logging_config": "app.middlewares.logging_config",

    # Utilities & Engines
    "app.pdf_operations": "app.utils.pdf_operations",
    "app.engines.pdf_operations": "app.utils.pdf_operations",
    "app.document_conversions": "app.utils.document_conversions",
    "app.engines.document_conversions": "app.utils.document_conversions",
    "app.generated_text": "app.utils.generated_text",
    "app.engines.generated_text": "app.utils.generated_text",
    "app.tool_registry": "app.utils.tool_registry",
    "app.engines.tool_registry": "app.utils.tool_registry",
    "app.usage": "app.utils.usage",
    "app.engines.usage": "app.utils.usage",
    "app.engines": "app.utils",

    # DTOs & Schemas
    "app.schemas": "app.dtos.schemas",

    # Tasks & Workers
    "app.celery_app": "app.tasks.celery_app",

    # Services
    "app.ai_orchestration": "app.services.ai_orchestration",
    "app.deliverable_review": "app.services.deliverable_review",
    "app.rag": "app.services.rag",
    "app.processing": "app.services.processing",
    "app.auth_service": "app.services.auth_service",
    "app.user_service": "app.services.user_service",
    "app.workspace_service": "app.services.workspace_service",
    "app.deliverable_service": "app.services.deliverable_service",
    "app.document_service": "app.services.document_service",
    "app.pdf_service": "app.services.pdf_service",
    "app.notification_service": "app.services.notification_service",

    # Controllers
    "app.auth": "app.controllers.auth",
    "app.users": "app.controllers.users",
    "app.documents": "app.controllers.documents",
    "app.deliverables": "app.controllers.deliverables",
    "app.workspace_agent": "app.controllers.workspace_agent",
    "app.notebook_agent": "app.controllers.workspace_agent",
    "app.pdf_tools": "app.controllers.pdf_tools",
    "app.jobs": "app.controllers.jobs",
    "app.notifications": "app.controllers.notifications",
    "app.chat": "app.controllers.chat",
    "app.ai_features": "app.controllers.ai_features",
    "app.workflows": "app.controllers.workflows",
    "app.workspace": "app.controllers.workspace",
    "app.collections": "app.controllers.collections",
    "app.generation": "app.controllers.generation",
}


class _RedirectLoader(Loader):
    def __init__(self, target_name: str) -> None:
        self.target_name = target_name

    def create_module(self, spec):
        mod = importlib.import_module(self.target_name)
        sys.modules[spec.name] = mod
        return mod

    def exec_module(self, module):
        pass


class _RedirectFinder(MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname in _MODULE_MAPPING:
            target_name = _MODULE_MAPPING[fullname]
            spec = importlib.util.spec_from_loader(fullname, _RedirectLoader(target_name))
            return spec
        return None


if not any(isinstance(finder, _RedirectFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _RedirectFinder())
