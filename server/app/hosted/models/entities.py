"""SQLAlchemy entity models for Groundwork Cloud Sync."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.hosted.core.database import Base


def utcnow_str() -> str:
    return datetime.now(timezone.utc).isoformat()


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(String(50), default=utcnow_str)

    devices = relationship("Device", back_populates="user", cascade="all, delete-orphan")
    notes = relationship("CloudNote", back_populates="user", cascade="all, delete-orphan")
    saved_searches = relationship("CloudSavedSearch", back_populates="user", cascade="all, delete-orphan")
    settings = relationship("CloudSetting", back_populates="user", cascade="all, delete-orphan")


class GoogleIdentity(Base):
    __tablename__ = "google_identities"

    subject = Column(String(255), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    user = relationship("User")


class Device(Base):
    __tablename__ = "devices"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    device_name = Column(String(100), nullable=False)
    os_name = Column(String(50), default="Windows")
    registered_at = Column(String(50), default=utcnow_str)
    last_seen_at = Column(String(50), default=utcnow_str)

    user = relationship("User", back_populates="devices")


class CloudNote(Base):
    __tablename__ = "cloud_notes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    client_note_id = Column(String(36), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    tags_json = Column(Text, default="[]")
    version = Column(Integer, default=1)
    updated_at = Column(String(50), default=utcnow_str)

    __table_args__ = (
        UniqueConstraint("user_id", "client_note_id", name="uq_user_client_note"),
    )

    user = relationship("User", back_populates="notes")


class CloudSavedSearch(Base):
    __tablename__ = "cloud_saved_searches"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    client_search_id = Column(String(36), nullable=False)
    title = Column(String(255), nullable=False)
    query = Column(String(500), nullable=False)
    filters_json = Column(Text, default="{}")
    version = Column(Integer, default=1)
    updated_at = Column(String(50), default=utcnow_str)

    __table_args__ = (
        UniqueConstraint("user_id", "client_search_id", name="uq_user_client_search"),
    )

    user = relationship("User", back_populates="saved_searches")


class CloudSetting(Base):
    __tablename__ = "cloud_settings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    key = Column(String(100), nullable=False)
    value_json = Column(Text, nullable=False)
    updated_at = Column(String(50), default=utcnow_str)

    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_user_setting_key"),
    )

    user = relationship("User", back_populates="settings")


class SyncReceipt(Base):
    """Acknowledgements survive retries and process restarts."""
    __tablename__ = "sync_receipts"
    user_id = Column(String(36), ForeignKey("users.id"), primary_key=True)
    queue_id = Column(String(64), primary_key=True)
    payload_hash = Column(String(64), nullable=False)
    created_at = Column(String(50), default=utcnow_str)


class CloudTombstone(Base):
    __tablename__ = "cloud_tombstones"
    user_id = Column(String(36), ForeignKey("users.id"), primary_key=True)
    entity_type = Column(String(30), primary_key=True)
    entity_id = Column(String(100), primary_key=True)
    deleted_at = Column(String(50), default=utcnow_str)
