import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import admin_user, current_user
from app.models import (
    ActivityEvent,
    AIResult,
    AIUsageRecord,
    Conversation,
    Document,
    GeneratedArtifact,
    JobStatus,
    Notification,
    ProcessingJob,
    RefreshToken,
    User,
    Workspace,
    WorkspaceMember,
)
from app.schemas import (
    AdminUserResponse,
    DashboardResponse,
    PasswordChangeRequest,
    PrivacyConfirmationRequest,
    ProfileUpdateRequest,
    SecuritySessionResponse,
    UsageDetailResponse,
    UserPreferences,
    UserResponse,
    UserStatsResponse,
    UserStatusRequest,
)
from app.security import hash_password, verify_password
from app.storage import ObjectStorage

router = APIRouter(tags=["Users and dashboard"])


async def stats(user_id: uuid.UUID, session: AsyncSession) -> UserStatsResponse:
    document_count, pages, storage = (await session.execute(
        select(func.count(Document.id), func.coalesce(func.sum(Document.page_count), 0), func.coalesce(func.sum(Document.size_bytes), 0))
        .where(Document.owner_id == user_id)
    )).one()
    ai_requests = await session.scalar(select(func.count(AIUsageRecord.id)).where(AIUsageRecord.owner_id == user_id))
    generated = await session.scalar(select(func.count(GeneratedArtifact.id)).where(GeneratedArtifact.owner_id == user_id))
    failed = await session.scalar(
        select(func.count(ProcessingJob.id)).join(Document).where(Document.owner_id == user_id, ProcessingJob.status == JobStatus.FAILED)
    )
    return UserStatsResponse(
        document_count=document_count, page_count=pages, storage_bytes=storage,
        ai_requests=ai_requests or 0, generated_files=generated or 0, failed_jobs=failed or 0,
    )


@router.patch("/profile", response_model=UserResponse)
async def update_profile(payload: ProfileUpdateRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    user.display_name = payload.display_name.strip()
    await session.commit()
    await session.refresh(user)
    return user


@router.get("/profile/preferences", response_model=UserPreferences)
async def get_preferences(user: User = Depends(current_user)) -> UserPreferences:
    return UserPreferences.model_validate(user.preferences or {})


@router.put("/profile/preferences", response_model=UserPreferences)
async def update_preferences(
    payload: UserPreferences,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> UserPreferences:
    user.preferences = payload.model_dump()
    await session.commit()
    return payload


@router.post("/profile/password", status_code=204)
async def change_password(payload: PasswordChangeRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=422, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    tokens = list(await session.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))))
    from datetime import UTC, datetime
    for token in tokens:
        token.revoked_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=204)


@router.get("/profile/sessions", response_model=list[SecuritySessionResponse])
async def active_sessions(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RefreshToken]:
    return list(await session.scalars(select(RefreshToken).where(
        RefreshToken.user_id == user.id,
        RefreshToken.revoked_at.is_(None),
        RefreshToken.expires_at > datetime.now(UTC),
    ).order_by(RefreshToken.created_at.desc())))


@router.delete("/profile/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    token = await session.scalar(select(RefreshToken).where(
        RefreshToken.id == session_id,
        RefreshToken.user_id == user.id,
        RefreshToken.revoked_at.is_(None),
    ))
    if token is None:
        raise HTTPException(status_code=404, detail="Session not found")
    token.revoked_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=204)


@router.post("/profile/sessions/revoke-all", status_code=204)
async def revoke_all_sessions(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    tokens = list(await session.scalars(select(RefreshToken).where(
        RefreshToken.user_id == user.id,
        RefreshToken.revoked_at.is_(None),
    )))
    now = datetime.now(UTC)
    for token in tokens:
        token.revoked_at = now
    await session.commit()
    return Response(status_code=204)


@router.get("/profile/stats", response_model=UserStatsResponse)
async def profile_stats(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await stats(user.id, session)


@router.get("/profile/usage", response_model=UsageDetailResponse)
async def profile_usage(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> UsageDetailResponse:
    values = await stats(user.id, session)
    feature_rows = (await session.execute(select(
        AIUsageRecord.feature, func.count(AIUsageRecord.id)
    ).where(AIUsageRecord.owner_id == user.id).group_by(AIUsageRecord.feature))).all()
    job_rows = (await session.execute(select(
        ProcessingJob.status, func.count(ProcessingJob.id)
    ).where(ProcessingJob.owner_id == user.id).group_by(ProcessingJob.status))).all()
    recent = await session.scalar(select(func.count(AIUsageRecord.id)).where(
        AIUsageRecord.owner_id == user.id,
        AIUsageRecord.created_at >= datetime.now(UTC) - timedelta(days=30),
    ))
    return UsageDetailResponse(
        storage_limit_bytes=1024 * 1024 * 1024,
        storage_bytes=values.storage_bytes,
        ai_requests_total=values.ai_requests,
        ai_requests_30_days=recent or 0,
        ai_requests_by_feature={str(key): count for key, count in feature_rows},
        jobs_by_status={str(getattr(key, "value", key)): count for key, count in job_rows},
    )


@router.get("/profile/data-export")
async def export_account_data(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    workspaces = list(await session.scalars(
        select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
    ))
    values = await stats(user.id, session)
    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "account": {
            "id": str(user.id), "email": user.email, "display_name": user.display_name,
            "role": user.role.value, "created_at": user.created_at.isoformat(),
        },
        "preferences": user.preferences or {},
        "usage": values.model_dump(),
        "workspaces": [{"id": str(item.id), "name": item.name, "kind": item.kind} for item in workspaces],
    }


@router.delete("/profile/history", status_code=204)
async def clear_account_history(
    payload: PrivacyConfirmationRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    if payload.confirmation.strip().lower() != "clear history":
        raise HTTPException(status_code=422, detail='Type "clear history" to confirm')
    for model, owner_column in (
        (Conversation, Conversation.owner_id),
        (AIResult, AIResult.owner_id),
        (AIUsageRecord, AIUsageRecord.owner_id),
        (Notification, Notification.user_id),
        (ActivityEvent, ActivityEvent.actor_id),
    ):
        await session.execute(delete(model).where(owner_column == user.id))
    await session.commit()
    return Response(status_code=204)


@router.delete("/profile/account", status_code=204)
async def delete_account(
    payload: PrivacyConfirmationRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    if payload.confirmation.strip().lower() != user.email.lower():
        raise HTTPException(status_code=422, detail="Enter your account email to confirm deletion")
    document_keys = list(await session.scalars(select(Document.object_key).where(Document.owner_id == user.id)))
    artifact_keys = list(await session.scalars(select(GeneratedArtifact.object_key).where(GeneratedArtifact.owner_id == user.id)))
    storage = ObjectStorage()
    for key in [*document_keys, *artifact_keys]:
        try:
            storage.remove(key)
        except Exception:
            continue
    await session.delete(user)
    await session.commit()
    return Response(status_code=204)


@router.get("/dashboard", response_model=DashboardResponse)
async def dashboard(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    values = await stats(user.id, session)
    documents = list(await session.scalars(select(Document).where(Document.owner_id == user.id).order_by(Document.created_at.desc()).limit(5)))
    jobs = list(await session.scalars(
        select(ProcessingJob).join(Document).where(Document.owner_id == user.id).order_by(ProcessingJob.created_at.desc()).limit(5)
    ))
    return DashboardResponse(**values.model_dump(), recent_documents=documents, recent_jobs=jobs)


@router.get("/admin/users", response_model=list[AdminUserResponse])
async def admin_users(_: User = Depends(admin_user), session: AsyncSession = Depends(get_session)):
    users = list(await session.scalars(select(User).order_by(User.created_at.desc())))
    output = []
    for item in users:
        values = await stats(item.id, session)
        output.append(AdminUserResponse.model_validate({**UserResponse.model_validate(item).model_dump(), **values.model_dump()}))
    return output


@router.patch("/admin/users/{user_id}/status", response_model=UserResponse)
async def change_user_status(user_id: uuid.UUID, payload: UserStatusRequest, admin: User = Depends(admin_user), session: AsyncSession = Depends(get_session)):
    if user_id == admin.id and not payload.is_active:
        raise HTTPException(status_code=422, detail="You cannot disable your own account")
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = payload.is_active
    await session.commit()
    await session.refresh(user)
    return user


@router.get("/admin/stats", response_model=UserStatsResponse)
async def admin_stats(_: User = Depends(admin_user), session: AsyncSession = Depends(get_session)):
    document_count, pages, storage = (await session.execute(select(
        func.count(Document.id), func.coalesce(func.sum(Document.page_count), 0), func.coalesce(func.sum(Document.size_bytes), 0)
    ))).one()
    return UserStatsResponse(
        document_count=document_count, page_count=pages, storage_bytes=storage,
        ai_requests=await session.scalar(select(func.count(AIUsageRecord.id))) or 0,
        generated_files=await session.scalar(select(func.count(GeneratedArtifact.id))) or 0,
        failed_jobs=await session.scalar(select(func.count(ProcessingJob.id)).where(ProcessingJob.status == JobStatus.FAILED)) or 0,
    )
