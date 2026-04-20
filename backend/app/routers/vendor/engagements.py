"""
Vendor portal — questionnaire, autosave, file upload, submit.

Security invariant enforced on every request via get_vendor_engagement():
  JWT type must be "vendor" AND JWT engagement_id must equal the engagement
  resolved by the vendor_token path parameter. These two checks are inseparable.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.engagement import Engagement, EngagementStatus
from app.models.file_upload import FileType, FileUpload
from app.models.question import Question
from app.models.response import Response
from app.schemas.vendor import (
    EngagementFormOut,
    QuestionOut,
    ResponseBatch,
    ResponseOut,
    SubmitOut,
    VendorFileOut,
)
from app.services.audit import log_action
from app.services.auth import get_vendor_user
from app.services.files import delete_vendor_file_from_disk, store_vendor_file
from app.utils.sanitize import sanitize_text

router = APIRouter()

EDITABLE_STATUSES = {EngagementStatus.DD_SENT_UNOPENED, EngagementStatus.DD_IN_PROGRESS}


async def get_vendor_engagement(
    token: str,
    vendor: dict = Depends(get_vendor_user),
    db: AsyncSession = Depends(get_db),
) -> tuple[Engagement, str]:
    """
    Resolve the engagement from the URL token, then enforce that the JWT's
    engagement_id matches. Called on every vendor endpoint — not just auth.
    """
    try:
        token_uuid = uuid.UUID(token)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    result = await db.execute(
        select(Engagement).where(Engagement.vendor_token == token_uuid)
    )
    engagement = result.scalar_one_or_none()

    if not engagement:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    # Critical: the token in the JWT must match this specific engagement.
    if vendor["engagement_id"] != str(engagement.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    return engagement, vendor["sub"]


VendorAuth = Annotated[tuple[Engagement, str], Depends(get_vendor_engagement)]


# ---------------------------------------------------------------------------
# GET /{token}  — form metadata: questions + already-uploaded files
# ---------------------------------------------------------------------------

@router.get("/{token}", response_model=EngagementFormOut)
async def get_form_metadata(
    auth: VendorAuth,
    db: AsyncSession = Depends(get_db),
) -> EngagementFormOut:
    engagement, _ = auth

    q_result = await db.execute(select(Question).order_by(Question.order))
    questions = q_result.scalars().all()

    f_result = await db.execute(
        select(FileUpload).where(
            FileUpload.engagement_id == engagement.id,
            FileUpload.file_type == FileType.VENDOR_ATTACHMENT,
        )
    )
    files = f_result.scalars().all()

    return EngagementFormOut(
        id=engagement.id,
        application_name=engagement.application_name,
        status=engagement.status.value,
        is_ai_application=engagement.is_ai_application,
        questions=[QuestionOut.model_validate(q) for q in questions],
        files=[VendorFileOut.model_validate(f) for f in files],
    )


# ---------------------------------------------------------------------------
# GET /{token}/responses  — saved responses
# ---------------------------------------------------------------------------

@router.get("/{token}/responses", response_model=list[ResponseOut])
async def get_responses(
    auth: VendorAuth,
    db: AsyncSession = Depends(get_db),
) -> list[ResponseOut]:
    engagement, _ = auth

    result = await db.execute(
        select(Response).where(Response.engagement_id == engagement.id)
    )
    return [ResponseOut.model_validate(r) for r in result.scalars().all()]


# ---------------------------------------------------------------------------
# POST /{token}/responses  — autosave (upsert one or many responses)
# ---------------------------------------------------------------------------

@router.post("/{token}/responses", response_model=list[ResponseOut])
async def save_responses(
    body: ResponseBatch,
    auth: VendorAuth,
    db: AsyncSession = Depends(get_db),
) -> list[ResponseOut]:
    engagement, email = auth

    if engagement.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Questionnaire is read-only at the current engagement status",
        )

    saved: list[Response] = []

    for item in body.responses:
        sanitised = sanitize_text(item.response_text)

        result = await db.execute(
            select(Response).where(
                Response.engagement_id == engagement.id,
                Response.question_id == item.question_id,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.response_text = sanitised
            existing.selected_options = item.selected_options
            existing.updated_at = datetime.now(timezone.utc)
            saved.append(existing)
        else:
            new_r = Response(
                engagement_id=engagement.id,
                question_id=item.question_id,
                response_text=sanitised,
                selected_options=item.selected_options,
                updated_at=datetime.now(timezone.utc),
            )
            db.add(new_r)
            saved.append(new_r)

    # Lifecycle: first save opens the questionnaire
    if engagement.status == EngagementStatus.DD_SENT_UNOPENED:
        engagement.status = EngagementStatus.DD_IN_PROGRESS
        engagement.updated_at = datetime.now(timezone.utc)
        await log_action(
            db=db,
            engagement_id=engagement.id,
            actor=email,
            actor_type=ActorType.VENDOR,
            action="engagement.status_change",
            description="Questionnaire opened by vendor — status advanced to DD_IN_PROGRESS",
            metadata={"old": "DD_SENT_UNOPENED", "new": "DD_IN_PROGRESS"},
        )

    await db.commit()
    for r in saved:
        await db.refresh(r)

    return [ResponseOut.model_validate(r) for r in saved]


# ---------------------------------------------------------------------------
# POST /{token}/files  — upload vendor attachment
# ---------------------------------------------------------------------------

@router.post("/{token}/files", response_model=VendorFileOut, status_code=201)
async def upload_file(
    auth: VendorAuth,
    file: UploadFile,
    question_id: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
) -> VendorFileOut:
    engagement, email = auth

    if engagement.status not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="File upload is locked at the current engagement status")

    q_uuid: Optional[uuid.UUID] = None
    if question_id:
        try:
            q_uuid = uuid.UUID(question_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid question_id")

    record = await store_vendor_file(
        file=file,
        engagement=engagement,
        question_id=q_uuid,
        uploaded_by=email,
        db=db,
    )
    db.add(record)

    await log_action(
        db=db,
        engagement_id=engagement.id,
        actor=email,
        actor_type=ActorType.VENDOR,
        action="file.upload",
        description=f"Vendor uploaded attachment: {file.filename}",
        metadata={
            "original_filename": file.filename,
            "size_bytes": record.file_size_bytes,
            "mime_type": record.mime_type,
            "question_id": str(q_uuid) if q_uuid else None,
        },
    )
    await db.commit()
    await db.refresh(record)

    return VendorFileOut.model_validate(record)


# ---------------------------------------------------------------------------
# DELETE /{token}/files/{file_id}  — remove a vendor attachment
# ---------------------------------------------------------------------------

@router.delete("/{token}/files/{file_id}", status_code=204)
async def delete_file(
    file_id: str,
    auth: VendorAuth,
    db: AsyncSession = Depends(get_db),
) -> None:
    engagement, email = auth

    if engagement.status not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="File deletion is locked at the current engagement status")

    try:
        file_uuid = uuid.UUID(file_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")

    result = await db.execute(
        select(FileUpload).where(
            FileUpload.id == file_uuid,
            FileUpload.engagement_id == engagement.id,
            FileUpload.file_type == FileType.VENDOR_ATTACHMENT,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    stored_path = record.stored_path
    original_name = record.original_filename

    await db.delete(record)
    await log_action(
        db=db,
        engagement_id=engagement.id,
        actor=email,
        actor_type=ActorType.VENDOR,
        action="file.delete",
        description=f"Vendor deleted attachment: {original_name}",
        metadata={"original_filename": original_name},
    )
    await db.commit()

    delete_vendor_file_from_disk(stored_path)


# ---------------------------------------------------------------------------
# POST /{token}/submit
# ---------------------------------------------------------------------------

@router.post("/{token}/submit", response_model=SubmitOut)
async def submit_questionnaire(
    auth: VendorAuth,
    db: AsyncSession = Depends(get_db),
) -> SubmitOut:
    engagement, email = auth

    if engagement.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit at current status: {engagement.status.value}",
        )

    now = datetime.now(timezone.utc)
    old_status = engagement.status.value
    engagement.status = EngagementStatus.RISK_ASSESSMENT_PENDING
    engagement.submitted_at = now
    engagement.updated_at = now

    await log_action(
        db=db,
        engagement_id=engagement.id,
        actor=email,
        actor_type=ActorType.VENDOR,
        action="engagement.submitted",
        description=f"Vendor submitted questionnaire for {engagement.doc_number}",
        metadata={"old_status": old_status, "new_status": "RISK_ASSESSMENT_PENDING"},
    )
    await db.commit()

    return SubmitOut(status=engagement.status.value, submitted_at=now)
