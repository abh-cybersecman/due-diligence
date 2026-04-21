import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response as FastAPIResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.audit_log import ActorType, AuditLog
from app.models.engagement import Engagement, EngagementStatus
from app.models.file_upload import FileUpload
from app.models.response import Response
from app.models.risk_assessment import RiskAssessment, RiskAssessmentStatus
from app.models.settings import OperatingCompany
from app.schemas.audit import AuditLogEntry, AuditLogListResponse
from app.schemas.engagement import (
    EngagementCreate,
    EngagementListResponse,
    EngagementResponse,
    EngagementUpdate,
    IRDocumentOut,
    ResponseDetail,
    SetStatusRequest,
)
from app.services.audit import log_action
from app.services.auth import get_admin_user
from app.services.export import generate_export
from app.services.extraction import extract_structured_fields
from app.services.lifecycle import validate_transition
from app.services.risk_ai import generate_risk_assessment

router = APIRouter(tags=["admin-engagements"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_engagement_or_404(db: AsyncSession, engagement_id: uuid.UUID) -> Engagement:
    result = await db.execute(
        select(Engagement).where(Engagement.id == engagement_id)
    )
    engagement = result.scalar_one_or_none()
    if engagement is None:
        raise HTTPException(status_code=404, detail="Engagement not found")
    return engagement


async def _generate_doc_number(db: AsyncSession) -> str:
    result = await db.execute(select(func.max(Engagement.doc_number)))
    max_doc: str | None = result.scalar_one_or_none()
    if max_doc is None:
        next_num = settings.doc_number_start
    else:
        try:
            suffix = max_doc[len(settings.doc_number_prefix):]
            next_num = int(suffix) + 1
        except (ValueError, IndexError):
            next_num = settings.doc_number_start
    return f"{settings.doc_number_prefix}{str(next_num).zfill(4)}"


async def _load_ocs(db: AsyncSession, oc_ids: list[uuid.UUID]) -> list[OperatingCompany]:
    if not oc_ids:
        return []
    result = await db.execute(
        select(OperatingCompany).where(OperatingCompany.id.in_(oc_ids))
    )
    ocs = list(result.scalars().all())
    if len(ocs) != len(oc_ids):
        raise HTTPException(status_code=400, detail="One or more operating company IDs not found")
    return ocs


async def _fetch_engagement(db: AsyncSession, engagement_id: uuid.UUID) -> Engagement:
    """Re-fetch engagement with selectin for operating_companies after writes."""
    result = await db.execute(
        select(Engagement)
        .where(Engagement.id == engagement_id)
        .options(selectinload(Engagement.operating_companies))
    )
    return result.scalar_one()


# ---------------------------------------------------------------------------
# Engagement list + create
# ---------------------------------------------------------------------------

@router.get("/engagements", response_model=EngagementListResponse)
async def list_engagements(
    status: EngagementStatus | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementListResponse:
    base_q = select(Engagement)
    count_q = select(func.count(Engagement.id))

    if status is not None:
        base_q = base_q.where(Engagement.status == status)
        count_q = count_q.where(Engagement.status == status)
    if search:
        like = f"%{search}%"
        base_q = base_q.where(Engagement.application_name.ilike(like))
        count_q = count_q.where(Engagement.application_name.ilike(like))

    total = (await db.execute(count_q)).scalar_one()
    items = (
        await db.execute(
            base_q.order_by(Engagement.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()

    return EngagementListResponse(
        items=[EngagementResponse.model_validate(e) for e in items],
        total=total,
    )


@router.post("/engagements", response_model=EngagementResponse, status_code=201)
async def create_engagement(
    body: EngagementCreate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    doc_number = await _generate_doc_number(db)
    ocs = await _load_ocs(db, body.operating_company_ids)

    engagement = Engagement(
        doc_number=doc_number,
        application_name=body.application_name,
        vendor_emails=[e.lower().strip() for e in body.vendor_emails],
        ir_emails=[e.lower().strip() for e in body.ir_emails],
        is_ai_application=body.is_ai_application,
        internal_notes=body.internal_notes,
    )
    engagement.operating_companies = ocs
    db.add(engagement)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.created",
        description=f"Engagement {doc_number} created for {body.application_name}",
        engagement_id=engagement.id,
        metadata={
            "doc_number": doc_number,
            "application_name": body.application_name,
            "vendor_emails": body.vendor_emails,
            "ir_emails": body.ir_emails,
        },
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement.id))


# ---------------------------------------------------------------------------
# Engagement detail + patch
# ---------------------------------------------------------------------------

@router.get("/engagements/{engagement_id}", response_model=EngagementResponse)
async def get_engagement(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    engagement = await _get_engagement_or_404(db, engagement_id)
    return EngagementResponse.model_validate(engagement)


@router.patch("/engagements/{engagement_id}", response_model=EngagementResponse)
async def update_engagement(
    engagement_id: uuid.UUID,
    body: EngagementUpdate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    engagement = await _get_engagement_or_404(db, engagement_id)
    changed: dict = {}

    if body.application_name is not None:
        changed["application_name"] = {
            "from": engagement.application_name,
            "to": body.application_name,
        }
        engagement.application_name = body.application_name

    if body.doc_number is not None:
        changed["doc_number"] = {"from": engagement.doc_number, "to": body.doc_number}
        engagement.doc_number = body.doc_number

    if body.vendor_emails is not None:
        changed["vendor_emails"] = True
        engagement.vendor_emails = [e.lower().strip() for e in body.vendor_emails]

    if body.ir_emails is not None:
        changed["ir_emails"] = True
        engagement.ir_emails = [e.lower().strip() for e in body.ir_emails]

    if body.is_ai_application is not None:
        changed["is_ai_application"] = {
            "from": engagement.is_ai_application,
            "to": body.is_ai_application,
        }
        engagement.is_ai_application = body.is_ai_application

    if body.internal_notes is not None:
        changed["internal_notes"] = True
        engagement.internal_notes = body.internal_notes

    if body.operating_company_ids is not None:
        ocs = await _load_ocs(db, body.operating_company_ids)
        engagement.operating_companies = ocs
        changed["operating_companies"] = True

    engagement.updated_at = datetime.now(timezone.utc)

    if changed:
        await log_action(
            db,
            actor=admin,
            actor_type=ActorType.ADMIN,
            action="engagement.updated",
            description=f"Engagement {engagement.doc_number} updated",
            engagement_id=engagement_id,
            metadata={"changed_fields": list(changed.keys())},
        )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


# ---------------------------------------------------------------------------
# Lifecycle transitions
# ---------------------------------------------------------------------------

@router.post("/engagements/{engagement_id}/advance", response_model=EngagementResponse)
async def advance_engagement(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Advance DRAFT → FUNCTIONAL_EVALUATION_PENDING."""
    engagement = await _get_engagement_or_404(db, engagement_id)
    validate_transition(engagement.status, EngagementStatus.FUNCTIONAL_EVALUATION_PENDING)

    old_status = engagement.status
    engagement.status = EngagementStatus.FUNCTIONAL_EVALUATION_PENDING
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.status.advanced",
        description=(
            f"Engagement {engagement.doc_number} advanced: "
            f"{old_status.value} → {EngagementStatus.FUNCTIONAL_EVALUATION_PENDING.value}"
        ),
        engagement_id=engagement_id,
        metadata={
            "from": old_status.value,
            "to": EngagementStatus.FUNCTIONAL_EVALUATION_PENDING.value,
        },
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


@router.post("/engagements/{engagement_id}/dispatch", response_model=EngagementResponse)
async def dispatch_engagement(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Dispatch vendor questionnaire: PENDING_DISPATCH → DD_SENT_UNOPENED."""
    engagement = await _get_engagement_or_404(db, engagement_id)
    validate_transition(engagement.status, EngagementStatus.DD_SENT_UNOPENED)

    old_status = engagement.status
    engagement.status = EngagementStatus.DD_SENT_UNOPENED
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.dispatched",
        description=f"Engagement {engagement.doc_number} dispatched to vendor: {old_status.value} → DD_SENT_UNOPENED",
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": EngagementStatus.DD_SENT_UNOPENED.value},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


@router.post("/engagements/{engagement_id}/reopen", response_model=EngagementResponse)
async def reopen_engagement(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Reopen submitted questionnaire: RISK_ASSESSMENT_PENDING → DD_IN_PROGRESS."""
    engagement = await _get_engagement_or_404(db, engagement_id)
    validate_transition(engagement.status, EngagementStatus.DD_IN_PROGRESS)

    old_status = engagement.status
    engagement.status = EngagementStatus.DD_IN_PROGRESS
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.status.reopened",
        description=(
            f"Engagement {engagement.doc_number} reopened: "
            f"{old_status.value} → DD_IN_PROGRESS"
        ),
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": EngagementStatus.DD_IN_PROGRESS.value},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


@router.post("/engagements/{engagement_id}/set-status", response_model=EngagementResponse)
async def set_status(
    engagement_id: uuid.UUID,
    body: SetStatusRequest,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Manually transition to a new status (validated against lifecycle rules)."""
    engagement = await _get_engagement_or_404(db, engagement_id)
    validate_transition(engagement.status, body.status)

    # Closing requires a finalised risk assessment
    if body.status in (EngagementStatus.CLOSED, EngagementStatus.CLOSED_PENDING_IR_DOCS):
        ra_result = await db.execute(
            select(RiskAssessment).where(RiskAssessment.engagement_id == engagement_id)
        )
        ra = ra_result.scalar_one_or_none()
        if ra is None or ra.status != RiskAssessmentStatus.FINALISED:
            raise HTTPException(
                status_code=400,
                detail="A finalised risk assessment is required before closing the engagement",
            )

    old_status = engagement.status
    engagement.status = body.status
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.status.changed",
        description=(
            f"Engagement {engagement.doc_number} status changed: "
            f"{old_status.value} → {body.status.value}"
        ),
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": body.status.value},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


# ---------------------------------------------------------------------------
# Responses (read-only for admin)
# ---------------------------------------------------------------------------

@router.get("/engagements/{engagement_id}/responses", response_model=list[ResponseDetail])
async def get_responses(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[ResponseDetail]:
    await _get_engagement_or_404(db, engagement_id)

    result = await db.execute(
        select(Response)
        .where(Response.engagement_id == engagement_id)
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


# ---------------------------------------------------------------------------
# File list + authenticated download
# ---------------------------------------------------------------------------

@router.get("/engagements/{engagement_id}/files", response_model=list[IRDocumentOut])
async def list_files(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[IRDocumentOut]:
    await _get_engagement_or_404(db, engagement_id)
    result = await db.execute(
        select(FileUpload)
        .where(FileUpload.engagement_id == engagement_id)
        .order_by(FileUpload.uploaded_at.asc())
    )
    return [IRDocumentOut.model_validate(f) for f in result.scalars().all()]


@router.get("/engagements/{engagement_id}/files/{file_id}")
async def download_file(
    engagement_id: uuid.UUID,
    file_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    result = await db.execute(
        select(FileUpload).where(
            FileUpload.id == file_id,
            FileUpload.engagement_id == engagement_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(record.stored_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=record.stored_path,
        media_type=record.mime_type,
        filename=record.original_filename,
    )


# ---------------------------------------------------------------------------
# Word export
# ---------------------------------------------------------------------------

@router.get("/engagements/{engagement_id}/export")
async def export_engagement(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> FastAPIResponse:
    engagement = await _get_engagement_or_404(db, engagement_id)
    doc_bytes = await generate_export(engagement_id, db)
    return FastAPIResponse(
        content=doc_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{engagement.doc_number}.docx"'
        },
    )


# ---------------------------------------------------------------------------
# Phase 3 stubs
# ---------------------------------------------------------------------------

@router.post("/engagements/{engagement_id}/extract")
async def extract_fields(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_engagement_or_404(db, engagement_id)
    return await extract_structured_fields(str(engagement_id))


@router.post("/engagements/{engagement_id}/assess-risk")
async def assess_risk(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_engagement_or_404(db, engagement_id)
    return await generate_risk_assessment(str(engagement_id))


# ---------------------------------------------------------------------------
# Audit log (per-engagement)
# ---------------------------------------------------------------------------

@router.get("/engagements/{engagement_id}/audit", response_model=AuditLogListResponse)
async def get_engagement_audit(
    engagement_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> AuditLogListResponse:
    await _get_engagement_or_404(db, engagement_id)

    count_q = select(func.count(AuditLog.id)).where(AuditLog.engagement_id == engagement_id)
    total = (await db.execute(count_q)).scalar_one()

    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.engagement_id == engagement_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [AuditLogEntry.model_validate(row) for row in result.scalars().all()]

    return AuditLogListResponse(items=items, total=total)
