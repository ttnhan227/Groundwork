import re
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.dependencies import current_user
from app.models import Document, User
from app.schemas import DocumentResponse
from app.storage import ObjectStorage

router = APIRouter(prefix="/documents", tags=["Documents"])


def safe_filename(name: str) -> str:
    basename = name.replace("\\", "/").split("/")[-1]
    value = re.sub(r"[^a-zA-Z0-9._ -]", "_", basename).strip(" .")
    return value[:180] or "document.pdf"


@router.get("", response_model=list[DocumentResponse])
async def list_documents(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[Document]:
    result = await session.scalars(select(Document).where(Document.owner_id == user.id).order_by(Document.created_at.desc()))
    return list(result)


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Document:
    settings = get_settings()
    filename = safe_filename(file.filename or "document.pdf")
    if not filename.lower().endswith(".pdf") or file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Only PDF files are accepted")
    data = await file.read(settings.max_file_size_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_file_size_mb} MB")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="The file is not a valid PDF")
    document_id = uuid.uuid4()
    object_key = f"{user.id}/{document_id}/{filename}"
    storage = ObjectStorage()
    try:
        storage.upload_pdf(object_key, data)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Document storage is temporarily unavailable") from exc
    document = Document(
        id=document_id,
        owner_id=user.id,
        filename=filename,
        object_key=object_key,
        content_type="application/pdf",
        size_bytes=len(data),
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)
    return document
