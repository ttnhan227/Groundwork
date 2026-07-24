"""Idempotently create portfolio demo/admin accounts and sample PDFs."""

import asyncio
import uuid
from io import BytesIO

import fitz
from PIL import Image, ImageDraw
from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models import Document, JobStatus, ProcessingJob, User, UserRole
from app.security import hash_password
from app.storage import ObjectStorage


def text_pdf(title: str, lines: list[str]) -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "\n".join([title, "", *lines]), fontsize=12)
    data = document.tobytes()
    document.close()
    return data


def scanned_pdf() -> bytes:
    image = Image.new("RGB", (1200, 1600), "white")
    draw = ImageDraw.Draw(image)
    draw.text((90, 100), "Scanned Project Notes\nOwner: Demo User\nDeadline: December 15, 2026\nBudget: $12,000", fill="black")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    document = fitz.open()
    page = document.new_page(width=600, height=800)
    page.insert_image(page.rect, stream=buffer.getvalue())
    data = document.tobytes()
    document.close()
    return data


async def seed() -> None:
    settings = get_settings()
    async with SessionLocal() as session:
        demo = await session.scalar(select(User).where(User.email == settings.demo_email.lower()))
        if demo is None:
            demo = User(email=settings.demo_email.lower(), display_name="InsightPDF Demo", password_hash=hash_password(settings.demo_password))
            session.add(demo)
            await session.flush()
        if settings.admin_email and settings.admin_password:
            admin = await session.scalar(select(User).where(User.email == settings.admin_email.lower()))
            if admin is None:
                session.add(User(
                    email=settings.admin_email.lower(), display_name="InsightPDF Admin",
                    password_hash=hash_password(settings.admin_password), role=UserRole.ADMIN,
                ))
        existing = await session.scalar(select(Document.id).where(Document.owner_id == demo.id).limit(1))
        jobs: list[Document] = []
        if existing is None:
            samples = [
                ("employee-handbook-v1.pdf", text_pdf("Employee Handbook v1", ["Remote work: 2 days weekly.", "Equipment allowance: $500.", "Questions: HR team."])),
                ("employee-handbook-v2.pdf", text_pdf("Employee Handbook v2", ["Remote work: 3 days weekly.", "Equipment allowance: $750.", "Manager approval is required."])),
                ("scanned-project-notes.pdf", scanned_pdf()),
            ]
            storage = ObjectStorage()
            for filename, data in samples:
                identifier = uuid.uuid4()
                key = f"{demo.id}/{identifier}/{filename}"
                storage.upload_pdf(key, data)
                document = Document(
                    id=identifier, owner_id=demo.id, filename=filename, object_key=key,
                    content_type="application/pdf", size_bytes=len(data),
                )
                session.add(document)
                session.add(ProcessingJob(document_id=identifier, status=JobStatus.QUEUED, progress=0))
                jobs.append(document)
        await session.commit()
    if jobs:
        from app.tasks import process_document
        for document in jobs:
            process_document.delay(str(document.id))


if __name__ == "__main__":
    asyncio.run(seed())
