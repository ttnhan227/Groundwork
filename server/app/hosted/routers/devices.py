"""Device registration router for Groundwork Cloud Sync."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.hosted.core.database import get_db
from app.hosted.models.entities import Device, User
from app.hosted.routers.auth import get_current_user

devices_router = APIRouter(prefix="/devices", tags=["Devices"])


class DeviceCreate(BaseModel):
    device_name: str
    os_name: str = "Windows"


@devices_router.get("")
def list_devices(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    devices = db.query(Device).filter(Device.user_id == user.id).all()
    return [
        {
            "id": d.id,
            "device_name": d.device_name,
            "os_name": d.os_name,
            "registered_at": d.registered_at,
            "last_seen_at": d.last_seen_at,
        }
        for d in devices
    ]


@devices_router.post("")
def register_device(
    req: DeviceCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    device = Device(
        user_id=user.id,
        device_name=req.device_name,
        os_name=req.os_name,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return {
        "id": device.id,
        "device_name": device.device_name,
        "os_name": device.os_name,
        "registered_at": device.registered_at,
    }


@devices_router.delete("/{device_id}")
def delete_device(
    device_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    device = db.query(Device).filter(Device.id == device_id, Device.user_id == user.id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    db.delete(device)
    db.commit()
    return {"deleted": True}
