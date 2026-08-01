import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import admin_user, current_user
from app.models import AIUsageRecord, Document, GeneratedArtifact, JobStatus, ProcessingJob, RefreshToken, User
from app.schemas import (
    AdminUserResponse,
    DashboardResponse,
    PasswordChangeRequest,
    ProfileUpdateRequest,
    UserResponse,
    UserPreferences,
    UserStatsResponse,
    UserStatusRequest,
)
from app.security import hash_password, verify_password

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


@router.get("/profile/stats", response_model=UserStatsResponse)
async def profile_stats(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await stats(user.id, session)


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
