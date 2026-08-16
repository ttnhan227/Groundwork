import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: uuid.UUID
    workspace_id: uuid.UUID | None
    kind: str
    title: str
    message: str
    severity: str
    action: str | None
    subject_type: str | None
    subject_id: uuid.UUID | None
    metadata_json: dict
    read_at: datetime | None
    created_at: datetime


class NotificationCountResponse(BaseModel):
    unread: int
