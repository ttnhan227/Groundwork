import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies import current_user
from app.models import Notification, User
from app.schemas import NotificationCountResponse, NotificationResponse

router = APIRouter(prefix="/notifications", tags=["Notifications"])


async def notify_user(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: str,
    title: str,
    message: str,
    *,
    severity: str = "info",
    action: str | None = None,
    workspace_id: uuid.UUID | None = None,
    subject_type: str | None = None,
    subject_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        workspace_id=workspace_id,
        kind=kind[:40],
        title=title[:180],
        message=message[:2000],
        severity=severity[:20],
        action=action[:40] if action else None,
        subject_type=subject_type[:30] if subject_type else None,
        subject_id=subject_id,
        metadata_json=metadata or {},
    )
    session.add(notification)
    return notification


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Notification]:
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    return list(await session.scalars(query.order_by(Notification.created_at.desc()).limit(limit)))


@router.get("/unread-count", response_model=NotificationCountResponse)
async def unread_count(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationCountResponse:
    count = await session.scalar(select(func.count(Notification.id)).where(
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
    ))
    return NotificationCountResponse(unread=count or 0)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Notification:
    item = await session.scalar(select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    ))
    if item is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if item.read_at is None:
        item.read_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(item)
    return item


@router.post("/read-all", status_code=204)
async def mark_all_read(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await session.execute(update(Notification).where(
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
    ).values(read_at=datetime.now(UTC)))
    await session.commit()
    return Response(status_code=204)


@router.delete("/{notification_id}", status_code=204)
async def remove_notification(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    result = await session.execute(delete(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    ))
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Notification not found")
    await session.commit()
    return Response(status_code=204)
