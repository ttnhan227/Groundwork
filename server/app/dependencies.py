import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import User, UserRole
from app.repositories.artifact_repository import ArtifactRepository
from app.repositories.deliverable_repository import DeliverableRepository
from app.repositories.document_repository import DocumentRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.user_repository import UserRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.auth_service import AuthService
from app.services.deliverable_service import DeliverableService
from app.services.document_service import DocumentService
from app.services.notification_service import NotificationService
from app.services.pdf_service import PdfService
from app.services.user_service import UserService
from app.services.workspace_service import WorkspaceService
from app.utils.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        user_id = decode_access_token(credentials.credentials)
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token") from None
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled")
    return user


async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


# --- Dependency Injection Providers ---

def get_user_repository(session: AsyncSession = Depends(get_session)) -> UserRepository:
    return UserRepository(session)


def get_auth_service(user_repo: UserRepository = Depends(get_user_repository)) -> AuthService:
    return AuthService(user_repo)


def get_user_service(user_repo: UserRepository = Depends(get_user_repository)) -> UserService:
    return UserService(user_repo)


def get_workspace_repository(session: AsyncSession = Depends(get_session)) -> WorkspaceRepository:
    return WorkspaceRepository(session)


def get_workspace_service(workspace_repo: WorkspaceRepository = Depends(get_workspace_repository)) -> WorkspaceService:
    return WorkspaceService(workspace_repo)


def get_document_repository(session: AsyncSession = Depends(get_session)) -> DocumentRepository:
    return DocumentRepository(session)


def get_document_service(doc_repo: DocumentRepository = Depends(get_document_repository)) -> DocumentService:
    return DocumentService(doc_repo)


def get_deliverable_repository(session: AsyncSession = Depends(get_session)) -> DeliverableRepository:
    return DeliverableRepository(session)


def get_deliverable_service(
    deliverable_repo: DeliverableRepository = Depends(get_deliverable_repository),
    workspace_repo: WorkspaceRepository = Depends(get_workspace_repository),
) -> DeliverableService:
    return DeliverableService(deliverable_repo, workspace_repo)


def get_notification_repository(session: AsyncSession = Depends(get_session)) -> NotificationRepository:
    return NotificationRepository(session)


def get_notification_service(notif_repo: NotificationRepository = Depends(get_notification_repository)) -> NotificationService:
    return NotificationService(notif_repo)


def get_artifact_repository(session: AsyncSession = Depends(get_session)) -> ArtifactRepository:
    return ArtifactRepository(session)


def get_pdf_service(artifact_repo: ArtifactRepository = Depends(get_artifact_repository)) -> PdfService:
    return PdfService(artifact_repo)
