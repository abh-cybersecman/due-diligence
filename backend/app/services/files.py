import io
import os
import uuid as uuid_lib
from typing import Callable

import aiofiles
import magic
from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.engagement import Engagement
from app.models.file_upload import FileType, FileUpload

_IMAGE_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

_DOCUMENT_MIMES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

_IR_ALLOWED_MIMES = _DOCUMENT_MIMES | _IMAGE_MIMES

_IR_FILE_TYPES = {FileType.IR_FUNCTIONAL_EVALUATION, FileType.IR_NDA, FileType.IR_SOW}


def _validate_magic(content: bytes) -> str:
    detected = magic.from_buffer(content, mime=True)
    if detected not in _IR_ALLOWED_MIMES:
        raise HTTPException(400, f"File type not permitted ({detected})")
    return detected


def _validate_image(content: bytes) -> None:
    try:
        img = Image.open(io.BytesIO(content))
        img.verify()
    except (UnidentifiedImageError, Exception):
        raise HTTPException(400, "Invalid image file")


async def _check_ir_limits(
    db: AsyncSession, engagement: Engagement, incoming_size: int
) -> None:
    result = await db.execute(
        select(func.count(FileUpload.id), func.coalesce(func.sum(FileUpload.file_size_bytes), 0)).where(
            FileUpload.engagement_id == engagement.id,
            FileUpload.file_type.in_(_IR_FILE_TYPES),
        )
    )
    count, total_bytes = result.one()

    if count >= settings.ir_max_files_per_engagement:
        raise HTTPException(
            400, f"Maximum {settings.ir_max_files_per_engagement} IR files per engagement reached"
        )

    max_total = settings.ir_max_total_upload_mb * 1024 * 1024
    if total_bytes + incoming_size > max_total:
        raise HTTPException(
            400,
            f"Upload would exceed the {settings.ir_max_total_upload_mb} MB total limit for this engagement",
        )


async def store_ir_file(
    file: UploadFile,
    engagement: Engagement,
    file_type: FileType,
    uploaded_by: str,
    db: AsyncSession,
) -> FileUpload:
    if file_type not in _IR_FILE_TYPES:
        raise HTTPException(400, "Invalid IR file type")

    content = await file.read()

    max_bytes = settings.ir_max_file_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(400, f"File exceeds the {settings.ir_max_file_size_mb} MB per-file limit")

    # Check engagement-level limits BEFORE touching disk
    await _check_ir_limits(db, engagement, len(content))

    # Magic-byte validation
    detected_mime = _validate_magic(content)

    # Extra Pillow validation for images
    if detected_mime in _IMAGE_MIMES:
        _validate_image(content)

    upload_dir = settings.ir_upload_dir
    os.makedirs(upload_dir, mode=0o755, exist_ok=True)

    stored_filename = str(uuid_lib.uuid4())
    stored_path = os.path.join(upload_dir, stored_filename)

    try:
        async with aiofiles.open(stored_path, "wb") as f:
            await f.write(content)
    except Exception:
        if os.path.exists(stored_path):
            os.unlink(stored_path)
        raise HTTPException(500, "File storage failed")

    record = FileUpload(
        engagement_id=engagement.id,
        file_type=file_type,
        original_filename=file.filename or "upload",
        stored_filename=stored_filename,
        stored_path=stored_path,
        mime_type=detected_mime,
        file_size_bytes=len(content),
        uploaded_by=uploaded_by,
    )
    return record


async def delete_ir_file(
    file_record: FileUpload, db: AsyncSession
) -> None:
    if file_record.file_type not in _IR_FILE_TYPES:
        raise HTTPException(403, "Cannot delete this file via the IR portal")

    stored_path = file_record.stored_path
    await db.delete(file_record)

    try:
        if os.path.exists(stored_path):
            os.unlink(stored_path)
    except OSError:
        pass


_VENDOR_ALLOWED_MIMES = _DOCUMENT_MIMES | _IMAGE_MIMES


async def store_vendor_file(
    file: UploadFile,
    engagement: Engagement,
    question_id: "uuid.UUID | None",
    uploaded_by: str,
    db: AsyncSession,
) -> FileUpload:
    import uuid as uuid_mod
    content = await file.read()

    max_bytes = settings.vendor_max_file_size_mb * 1024 * 1024
    if len(content) == 0:
        raise HTTPException(400, "Empty file not allowed")
    if len(content) > max_bytes:
        raise HTTPException(400, f"File exceeds the {settings.vendor_max_file_size_mb} MB per-file limit")

    # Check engagement-level limits BEFORE touching disk
    result = await db.execute(
        select(
            func.count(FileUpload.id),
            func.coalesce(func.sum(FileUpload.file_size_bytes), 0),
        ).where(
            FileUpload.engagement_id == engagement.id,
            FileUpload.file_type == FileType.VENDOR_ATTACHMENT,
        )
    )
    count, total_bytes = result.one()

    if count >= settings.vendor_max_files_per_engagement:
        raise HTTPException(400, f"Maximum {settings.vendor_max_files_per_engagement} files per engagement reached")

    max_total = settings.vendor_max_total_upload_mb * 1024 * 1024
    if total_bytes + len(content) > max_total:
        raise HTTPException(
            400,
            f"Upload would exceed the {settings.vendor_max_total_upload_mb} MB total limit for this engagement",
        )

    # Magic-byte validation
    detected = magic.from_buffer(content, mime=True)
    if detected not in _VENDOR_ALLOWED_MIMES:
        raise HTTPException(400, f"File type not permitted ({detected})")

    if detected in _IMAGE_MIMES:
        _validate_image(content)

    upload_dir = settings.upload_dir
    os.makedirs(upload_dir, mode=0o755, exist_ok=True)

    stored_filename = str(uuid_mod.uuid4())
    stored_path = os.path.join(upload_dir, stored_filename)

    try:
        async with aiofiles.open(stored_path, "wb") as f:
            await f.write(content)
    except Exception:
        if os.path.exists(stored_path):
            os.unlink(stored_path)
        raise HTTPException(500, "File storage failed")

    return FileUpload(
        engagement_id=engagement.id,
        question_id=question_id,
        file_type=FileType.VENDOR_ATTACHMENT,
        original_filename=file.filename or "upload",
        stored_filename=stored_filename,
        stored_path=stored_path,
        mime_type=detected,
        file_size_bytes=len(content),
        uploaded_by=uploaded_by,
    )


def delete_vendor_file_from_disk(stored_path: str) -> None:
    try:
        if os.path.exists(stored_path):
            os.unlink(stored_path)
    except OSError:
        pass
