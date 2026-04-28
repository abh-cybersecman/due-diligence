import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.engagement import Engagement, EngagementStatus
from app.models.file_upload import FileType, FileUpload
from app.models.question import Question
from app.models.questionnaire_section import QuestionnaireSection
from app.models.questionnaire_version import QuestionnaireVersion
from app.models.response import Response
from app.schemas.engagement import (
    EngagementResponsesPayload,
    EngagementStatusOut,
    IRDocumentOut,
    ResponseEntry,
    VendorAttachmentEntry,
)
from app.schemas.questionnaire import QuestionnaireSectionSchema
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


async def _walk_family_for_ir(
    db: AsyncSession, engagement: Engagement
) -> list[Engagement]:
    """Walk parent_engagement_id up, then BFS down — same logic as admin side
    but kept local so the evaluation router stays decoupled from admin.
    """
    root = engagement
    visited: set[uuid.UUID] = {engagement.id}
    while root.parent_engagement_id is not None and root.parent_engagement_id not in visited:
        result = await db.execute(
            select(Engagement).where(Engagement.id == root.parent_engagement_id)
        )
        parent = result.scalar_one_or_none()
        if parent is None:
            break
        visited.add(parent.id)
        root = parent

    family_ids: set[uuid.UUID] = {root.id}
    frontier: list[uuid.UUID] = [root.id]
    while frontier:
        result = await db.execute(
            select(Engagement.id).where(Engagement.parent_engagement_id.in_(frontier))
        )
        new_ids: list[uuid.UUID] = []
        for row in result.all():
            eid = row[0]
            if eid not in family_ids:
                family_ids.add(eid)
                new_ids.append(eid)
        frontier = new_ids

    fam_result = await db.execute(
        select(Engagement)
        .where(Engagement.id.in_(family_ids))
        .options(selectinload(Engagement.files))
    )
    return list(fam_result.scalars().all())


@router.get("/{token}/status", response_model=EngagementStatusOut)
async def get_status(
    engagement: Engagement = Depends(_get_engagement_for_ir),
    db: AsyncSession = Depends(get_db),
):
    family = await _walk_family_for_ir(db, engagement)
    rev_by_id = {m.id: m.revision_number for m in family}
    ir_docs: list[IRDocumentOut] = []
    for member in family:
        for f in member.files:
            if f.file_type in _IR_FILE_TYPES:
                payload = IRDocumentOut.model_validate(f)
                ir_docs.append(payload.model_copy(update={
                    "engagement_id": f.engagement_id,
                    "revision_number": rev_by_id.get(f.engagement_id, 0),
                }))
    ir_docs.sort(key=lambda d: d.uploaded_at, reverse=True)
    return EngagementStatusOut(
        id=engagement.id,
        doc_number=engagement.doc_number,
        application_name=engagement.application_name,
        status=engagement.status,
        is_ai_application=engagement.is_ai_application,
        created_at=engagement.created_at,
        updated_at=engagement.updated_at,
        ir_documents=ir_docs,
    )


@router.get("/{token}/responses", response_model=EngagementResponsesPayload)
async def get_responses(
    token: str,
    ir_user: dict = Depends(get_ir_user),
    db: AsyncSession = Depends(get_db),
):
    engagement = await _get_engagement_for_ir(token, ir_user, db)

    version = (
        await db.execute(
            select(QuestionnaireVersion).where(
                QuestionnaireVersion.id == engagement.questionnaire_version_id
            )
        )
    ).scalar_one()

    sec_result = await db.execute(
        select(QuestionnaireSection)
        .where(QuestionnaireSection.version_id == engagement.questionnaire_version_id)
        .options(selectinload(QuestionnaireSection.questions).selectinload(Question.options))
        .order_by(QuestionnaireSection.order)
    )
    sections = sec_result.scalars().all()

    r_result = await db.execute(
        select(Response).where(Response.engagement_id == engagement.id)
    )
    responses = r_result.scalars().all()

    att_result = await db.execute(
        select(FileUpload).where(
            FileUpload.engagement_id == engagement.id,
            FileUpload.file_type == FileType.VENDOR_ATTACHMENT,
            FileUpload.question_id.is_not(None),
        )
    )
    attachments = att_result.scalars().all()

    return EngagementResponsesPayload(
        engagement_id=engagement.id,
        questionnaire_version_id=version.id,
        version_label=version.version_label,
        is_ai_application=engagement.is_ai_application,
        sections=[QuestionnaireSectionSchema.model_validate(s) for s in sections],
        responses=[ResponseEntry.model_validate(r) for r in responses],
        vendor_attachments=[VendorAttachmentEntry.model_validate(f) for f in attachments],
    )


@router.post("/{token}/files", response_model=IRDocumentOut, status_code=201)
async def upload_file(
    token: str,
    file_type: FileType = Form(...),
    file: UploadFile = ...,
    ir_user: dict = Depends(get_ir_user),
    db: AsyncSession = Depends(get_db),
):
    engagement = await _get_engagement_for_ir(token, ir_user, db)

    if engagement.status == EngagementStatus.CLOSED:
        raise HTTPException(403, "Document uploads are locked. Contact the Information Security Team to reopen the engagement.")

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

    return IRDocumentOut.model_validate(record)


@router.delete("/{token}/files/{file_id}", status_code=204)
async def delete_file(
    token: str,
    file_id: uuid.UUID,
    ir_user: dict = Depends(get_ir_user),
    db: AsyncSession = Depends(get_db),
):
    engagement = await _get_engagement_for_ir(token, ir_user, db)

    if engagement.status == EngagementStatus.CLOSED:
        raise HTTPException(403, "Document uploads are locked. Contact the Information Security Team to reopen the engagement.")

    # IR can only delete files attached to their own engagement (the revision
    # tied to their token). Files from prior revisions are immutable.
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
        EngagementStatus.PENDING_CLOSURE,
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
