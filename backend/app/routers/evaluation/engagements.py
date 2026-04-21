import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.engagement import Engagement, EngagementStatus
from app.models.file_upload import FileType, FileUpload
from app.models.response import Response
from app.schemas.engagement import EngagementStatusOut, IRDocumentOut, ResponseDetail
from app.services.audit import log_action
from app.services.auth import get_ir_user
from app.services.files import delete_ir_file, store_ir_file

router = APIRouter(prefix="/api/evaluation/engagements", tags=["evaluation"])

_IR_FILE_TYPES = {FileType.IR_FUNCTIONAL_EVALUATION, FileType.IR_NDA, FileType.IR_SOW}


async def _get_engagement_for_ir(
    token: str,
    ir_user: dict = Depends(get_ir_user),
    db: AsyncSession = Depends(get_db),
) -> Engagement:
    try:
        token_uuid = uuid.UUID(token)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")

    result = await db.execute(
        select(Engagement)
        .where(Engagement.ir_token == token_uuid)
        .options(selectinload(Engagement.files))
    )
    engagement = result.scalar_one_or_none()

    if not engagement:
        raise HTTPException(status_code=404, detail="Not found")

    # Enforce JWT scope — engagement_id in token must match this engagement
    if ir_user.get("engagement_id") != str(engagement.id):
        raise HTTPException(status_code=403, detail="Unauthorized")

    return engagement


@router.get("/{token}/status", response_model=EngagementStatusOut)
async def get_status(engagement: Engagement = Depends(_get_engagement_for_ir)):
    ir_docs = [f for f in engagement.files if f.file_type in _IR_FILE_TYPES]
    return EngagementStatusOut(
        id=engagement.id,
        doc_number=engagement.doc_number,
        application_name=engagement.application_name,
        status=engagement.status,
        is_ai_application=engagement.is_ai_application,
        created_at=engagement.created_at,
        updated_at=engagement.updated_at,
        ir_documents=[IRDocumentOut.model_validate(f) for f in ir_docs],
    )


@router.get("/{token}/responses", response_model=list[ResponseDetail])
async def get_responses(
    token: str,
    ir_user: dict = Depends(get_ir_user),
    db: AsyncSession = Depends(get_db),
):
    engagement = await _get_engagement_for_ir(token, ir_user, db)

    result = await db.execute(
        select(Response)
        .where(Response.engagement_id == engagement.id)
        .options(selectinload(Response.question))
    )
    responses = result.scalars().all()

    return [
        ResponseDetail(
            id=r.id,
            question_id=r.question_id,
            question_number=r.question.question_number,
            section=r.question.section,
            question_text=r.question.question_text,
            response_text=r.response_text,
            selected_options=r.selected_options,
            updated_at=r.updated_at,
        )
        for r in responses
        if r.question
    ]


@router.post("/{token}/files", response_model=IRDocumentOut, status_code=201)
async def upload_file(
    token: str,
    file_type: FileType = Form(...),
    file: UploadFile = ...,
    ir_user: dict = Depends(get_ir_user),
    db: AsyncSession = Depends(get_db),
):
    engagement = await _get_engagement_for_ir(token, ir_user, db)

    if file_type not in _IR_FILE_TYPES:
        raise HTTPException(400, "file_type must be IR_FUNCTIONAL_EVALUATION, IR_NDA, or IR_SOW")

    actor_email = ir_user["sub"]

    record = await store_ir_file(
        file=file,
        engagement=engagement,
        file_type=file_type,
        uploaded_by=actor_email,
        db=db,
    )
    db.add(record)

    await log_action(
        db,
        actor=actor_email,
        actor_type=ActorType.IR,
        action="ir.file.upload",
        description=f"IR uploaded {file_type.value}: {file.filename}",
        engagement_id=engagement.id,
        metadata={"file_type": file_type.value, "filename": file.filename},
    )

    # Lifecycle trigger: functional evaluation upload moves to Pending Dispatch
    if (
        file_type == FileType.IR_FUNCTIONAL_EVALUATION
        and engagement.status == EngagementStatus.FUNCTIONAL_EVALUATION_PENDING
    ):
        engagement.status = EngagementStatus.PENDING_DISPATCH
        await log_action(
            db,
            actor="system",
            actor_type=ActorType.IR,
            action="engagement.status.advanced",
            description=f"Engagement {engagement.doc_number} advanced to PENDING_DISPATCH after functional evaluation upload",
            engagement_id=engagement.id,
            metadata={
                "from": EngagementStatus.FUNCTIONAL_EVALUATION_PENDING.value,
                "to": EngagementStatus.PENDING_DISPATCH.value,
            },
        )

    await db.flush()
    await db.refresh(record)

    # Auto-resolve CLOSED_PENDING_IR_DOCS → CLOSED when NDA + SOW are both present
    if engagement.status == EngagementStatus.CLOSED_PENDING_IR_DOCS:
        from sqlalchemy import select as _select
        docs_result = await db.execute(
            _select(FileUpload).where(
                FileUpload.engagement_id == engagement.id,
                FileUpload.file_type.in_([FileType.IR_NDA, FileType.IR_SOW]),
            )
        )
        ir_docs = docs_result.scalars().all()
        has_nda = any(f.file_type == FileType.IR_NDA for f in ir_docs)
        has_sow = any(f.file_type == FileType.IR_SOW for f in ir_docs)
        if has_nda and has_sow:
            engagement.status = EngagementStatus.CLOSED
            await log_action(
                db,
                actor="system",
                actor_type=ActorType.IR,
                action="engagement.status.advanced",
                description=f"Engagement {engagement.doc_number} automatically closed after all required IR documents uploaded",
                engagement_id=engagement.id,
                metadata={
                    "from": EngagementStatus.CLOSED_PENDING_IR_DOCS.value,
                    "to": EngagementStatus.CLOSED.value,
                },
            )

    return IRDocumentOut.model_validate(record)


@router.delete("/{token}/files/{file_id}", status_code=204)
async def delete_file(
    token: str,
    file_id: uuid.UUID,
    ir_user: dict = Depends(get_ir_user),
    db: AsyncSession = Depends(get_db),
):
    engagement = await _get_engagement_for_ir(token, ir_user, db)

    result = await db.execute(
        select(FileUpload).where(
            FileUpload.id == file_id,
            FileUpload.engagement_id == engagement.id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "File not found")

    # Functional evaluation is locked once the vendor link has been dispatched
    _locked_statuses = {
        EngagementStatus.DD_IN_PROGRESS,
        EngagementStatus.RISK_ASSESSMENT_PENDING,
        EngagementStatus.CLOSED,
        EngagementStatus.CLOSED_PENDING_IR_DOCS,
        EngagementStatus.UNDER_REVIEW,
    }
    if record.file_type == FileType.IR_FUNCTIONAL_EVALUATION and engagement.status in _locked_statuses:
        raise HTTPException(403, "Functional evaluation cannot be deleted after the questionnaire has been dispatched to the vendor")

    actor_email = ir_user["sub"]

    await log_action(
        db,
        actor=actor_email,
        actor_type=ActorType.IR,
        action="ir.file.delete",
        description=f"IR deleted file: {record.original_filename}",
        engagement_id=engagement.id,
        metadata={"file_id": str(file_id), "filename": record.original_filename},
    )

    await delete_ir_file(record, db)
