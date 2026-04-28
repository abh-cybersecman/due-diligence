import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from fastapi.responses import FileResponse, Response as FastAPIResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.audit_log import ActorType, AuditLog
from app.models.engagement import Engagement, EngagementStatus
from app.models.file_upload import FileType, FileUpload
from app.models.question import Question
from app.models.questionnaire_section import QuestionnaireSection
from app.models.questionnaire_version import QuestionnaireVersion
from app.models.response import Response
from app.models.risk_assessment import RiskAssessment, RiskAssessmentStatus
from app.models.settings import OperatingCompany
from app.schemas.audit import AuditLogEntry, AuditLogListResponse
from app.schemas.engagement import (
    EngagementCreate,
    EngagementListResponse,
    EngagementResponse,
    EngagementResponsesPayload,
    EngagementUpdate,
    IRDocumentOut,
    RefreshEngagementRequest,
    ResponseEntry,
    SetStatusRequest,
    VendorAttachmentEntry,
)
from app.schemas.questionnaire import QuestionnaireSectionSchema
from app.services.audit import log_action
from app.services.auth import get_admin_user, verify_password
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
    """Compute the next original doc_number. Refresh rows (-R*) are excluded
    from the sequence — only originals (parent_engagement_id IS NULL) participate.
    """
    result = await db.execute(
        select(func.max(Engagement.doc_number)).where(
            Engagement.parent_engagement_id.is_(None)
        )
    )
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


async def _find_root_and_family(
    db: AsyncSession, engagement: Engagement
) -> tuple[Engagement, list[Engagement]]:
    """Walk parent_engagement_id up to the root, then BFS down to gather
    every transitive descendant. Returns (root, family) where family includes
    the root.
    """
    root = engagement
    visited: set[uuid.UUID] = {engagement.id}
    while root.parent_engagement_id is not None:
        if root.parent_engagement_id in visited:
            break  # defensive: should never happen, would be a cycle
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
            select(Engagement.id).where(
                Engagement.parent_engagement_id.in_(frontier)
            )
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
        .options(selectinload(Engagement.operating_companies))
    )
    family = list(fam_result.scalars().all())
    return root, family


def _latest_in_family(family: list[Engagement]) -> Engagement:
    return max(family, key=lambda e: e.revision_number)


async def _build_revision_meta(
    db: AsyncSession, engagement: Engagement
) -> dict:
    """Compute revision metadata for an engagement detail response."""
    root, family = await _find_root_and_family(db, engagement)
    latest = _latest_in_family(family)

    parent_doc_number: str | None = None
    if engagement.parent_engagement_id is not None:
        for member in family:
            if member.id == engagement.parent_engagement_id:
                parent_doc_number = member.doc_number
                break

    is_latest = engagement.id == latest.id
    return {
        "is_latest_revision": is_latest,
        "latest_revision_id": None if is_latest else latest.id,
        "latest_revision_doc_number": None if is_latest else latest.doc_number,
        "root_doc_number": root.doc_number,
        "parent_doc_number": parent_doc_number,
    }


async def _serialize_with_meta(
    db: AsyncSession, engagement: Engagement
) -> EngagementResponse:
    payload = EngagementResponse.model_validate(engagement)
    meta = await _build_revision_meta(db, engagement)
    return payload.model_copy(update=meta)


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

    current_version_id = (
        await db.execute(
            select(QuestionnaireVersion.id).where(QuestionnaireVersion.is_current.is_(True))
        )
    ).scalar_one_or_none()
    if current_version_id is None:
        raise HTTPException(
            status_code=500,
            detail="No current questionnaire version is published",
        )

    engagement = Engagement(
        doc_number=doc_number,
        application_name=body.application_name,
        vendor_emails=[e.lower().strip() for e in body.vendor_emails],
        ir_emails=[e.lower().strip() for e in body.ir_emails],
        is_ai_application=body.is_ai_application,
        internal_notes=body.internal_notes,
        questionnaire_version_id=current_version_id,
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
    await _get_engagement_or_404(db, engagement_id)
    engagement = await _fetch_engagement(db, engagement_id)
    return await _serialize_with_meta(db, engagement)


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
    """Dispatch vendor questionnaire: PENDING_DISPATCH → DD_IN_PROGRESS."""
    engagement = await _get_engagement_or_404(db, engagement_id)
    validate_transition(engagement.status, EngagementStatus.DD_IN_PROGRESS)

    old_status = engagement.status
    engagement.status = EngagementStatus.DD_IN_PROGRESS
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.dispatched",
        description=f"Engagement {engagement.doc_number} dispatched to vendor: {old_status.value} → DD_IN_PROGRESS",
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": EngagementStatus.DD_IN_PROGRESS.value},
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


@router.post("/engagements/{engagement_id}/close-questionnaire", response_model=EngagementResponse)
async def close_questionnaire(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Close vendor questionnaire: DD_IN_PROGRESS → RISK_ASSESSMENT_PENDING."""
    engagement = await _get_engagement_or_404(db, engagement_id)
    validate_transition(engagement.status, EngagementStatus.RISK_ASSESSMENT_PENDING)

    old_status = engagement.status
    engagement.status = EngagementStatus.RISK_ASSESSMENT_PENDING
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.questionnaire.closed",
        description=(
            f"Engagement {engagement.doc_number} questionnaire closed: "
            f"{old_status.value} → RISK_ASSESSMENT_PENDING"
        ),
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": EngagementStatus.RISK_ASSESSMENT_PENDING.value},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


class CancelEngagementRequest(BaseModel):
    password: str


@router.post("/engagements/{engagement_id}/cancel", response_model=EngagementResponse)
async def cancel_engagement(
    engagement_id: uuid.UUID,
    body: CancelEngagementRequest,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Cancel engagement from any status — requires password re-confirmation."""
    if not verify_password(body.password, settings.admin_password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password")

    engagement = await _get_engagement_or_404(db, engagement_id)

    if engagement.status == EngagementStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Engagement is already cancelled")

    old_status = engagement.status
    engagement.status = EngagementStatus.CANCELLED
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.cancelled",
        description=f"Engagement {engagement.doc_number} cancelled: {old_status.value} → CANCELLED",
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": EngagementStatus.CANCELLED.value},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


@router.post("/engagements/{engagement_id}/reopen-from-cancelled", response_model=EngagementResponse)
async def reopen_from_cancelled(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Reopen a cancelled engagement, returning it to DRAFT."""
    engagement = await _get_engagement_or_404(db, engagement_id)

    if engagement.status != EngagementStatus.CANCELLED:
        raise HTTPException(
            status_code=400,
            detail=f"Engagement is not cancelled (current: {engagement.status.value})",
        )

    old_status = engagement.status
    engagement.status = EngagementStatus.DRAFT
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.reopened_from_cancelled",
        description=f"Engagement {engagement.doc_number} reopened from cancelled: CANCELLED → DRAFT",
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": EngagementStatus.DRAFT.value},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


# ---------------------------------------------------------------------------
# Refresh — create a new revision (R1, R2, …) from a closed engagement
# ---------------------------------------------------------------------------

REFRESHABLE_STATUSES = {EngagementStatus.CLOSED, EngagementStatus.UNDER_REVIEW}


@router.post("/engagements/{engagement_id}/refresh", response_model=EngagementResponse)
async def refresh_engagement(
    engagement_id: uuid.UUID,
    body: RefreshEngagementRequest,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Create a new revision (R1, R2, …) from a CLOSED or UNDER_REVIEW engagement.

    Pre-fills responses for questions whose `question_key` matches between the
    source engagement's pinned version and the current published version, when
    response types also match. The new engagement gets fresh tokens, an empty
    risk assessment slot, and starts at DRAFT status.
    """
    source = await _get_engagement_or_404(db, engagement_id)

    if source.status not in REFRESHABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Refresh is only allowed from CLOSED or UNDER_REVIEW status "
                f"(current: {source.status.value})"
            ),
        )

    if not settings.admin_password_hash or not verify_password(
        body.password, settings.admin_password_hash
    ):
        raise HTTPException(status_code=403, detail="Incorrect password")

    # Re-fetch source with operating_companies eagerly loaded for the copy.
    source = await _fetch_engagement(db, engagement_id)

    root, family = await _find_root_and_family(db, source)
    latest = _latest_in_family(family)
    if source.id != latest.id:
        raise HTTPException(
            status_code=400,
            detail=(
                "Refresh is only allowed on the latest revision in the family "
                f"(latest is {latest.doc_number})"
            ),
        )

    next_rev = max(member.revision_number for member in family) + 1
    new_doc_number = f"{root.doc_number}-R{next_rev}"

    # Pin to the current published version (not the source's version).
    current_version_row = (
        await db.execute(
            select(QuestionnaireVersion).where(QuestionnaireVersion.is_current.is_(True))
        )
    ).scalar_one_or_none()
    if current_version_row is None:
        raise HTTPException(
            status_code=500,
            detail="No current questionnaire version is published",
        )

    source_version_row = (
        await db.execute(
            select(QuestionnaireVersion).where(
                QuestionnaireVersion.id == source.questionnaire_version_id
            )
        )
    ).scalar_one()

    new_engagement = Engagement(
        doc_number=new_doc_number,
        application_name=source.application_name,
        vendor_emails=list(source.vendor_emails or []),
        ir_emails=list(source.ir_emails or []),
        is_ai_application=source.is_ai_application,
        internal_notes="",
        status=EngagementStatus.DRAFT,
        questionnaire_version_id=current_version_row.id,
        parent_engagement_id=source.id,
        revision_number=next_rev,
        vendor_token=uuid.uuid4(),
        ir_token=uuid.uuid4(),
    )
    new_engagement.operating_companies = list(source.operating_companies)
    db.add(new_engagement)
    await db.flush()

    # ---- Pre-fill responses by matching question_key across versions -------
    new_questions = (
        await db.execute(
            select(Question).where(Question.version_id == current_version_row.id)
        )
    ).scalars().all()

    source_questions = (
        await db.execute(
            select(Question).where(Question.version_id == source.questionnaire_version_id)
        )
    ).scalars().all()
    source_by_key: dict[str, Question] = {q.question_key: q for q in source_questions}

    source_responses = (
        await db.execute(
            select(Response).where(Response.engagement_id == source.id)
        )
    ).scalars().all()
    source_resp_by_qid: dict[uuid.UUID, Response] = {
        r.question_id: r for r in source_responses
    }

    new_keys = {q.question_key for q in new_questions}
    source_keys = set(source_by_key.keys())

    new_question_count = len(new_keys - source_keys)
    removed_question_count = len(source_keys - new_keys)
    carried_count = 0

    now = datetime.now(timezone.utc)
    new_engagement.created_at = now
    for new_q in new_questions:
        src_q = source_by_key.get(new_q.question_key)
        if src_q is None:
            continue
        if src_q.response_type != new_q.response_type:
            continue
        src_r = source_resp_by_qid.get(src_q.id)
        if src_r is None:
            continue
        # Treat as "non-empty" if any of the saved fields contain a value.
        has_text = bool((src_r.response_text or "").strip())
        has_options = bool(src_r.selected_options)
        has_other = bool((src_r.other_text or "").strip())
        if not (has_text or has_options or has_other):
            continue
        copied = Response(
            engagement_id=new_engagement.id,
            question_id=new_q.id,
            response_text=src_r.response_text,
            selected_options=list(src_r.selected_options) if src_r.selected_options else None,
            other_text=src_r.other_text,
            updated_at=now,
        )
        db.add(copied)
        carried_count += 1

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.refreshed",
        description=(
            f"Engagement {source.doc_number} refreshed → {new_doc_number} "
            f"({carried_count} response(s) carried over)"
        ),
        engagement_id=new_engagement.id,
        metadata={
            "source_id": str(source.id),
            "source_doc_number": source.doc_number,
            "source_version": source_version_row.version_label,
            "new_id": str(new_engagement.id),
            "new_doc_number": new_doc_number,
            "new_version": current_version_row.version_label,
            "carried_count": carried_count,
            "new_question_count": new_question_count,
            "removed_question_count": removed_question_count,
        },
    )

    await db.flush()
    fresh = await _fetch_engagement(db, new_engagement.id)
    return await _serialize_with_meta(db, fresh)


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
    if body.status in (EngagementStatus.CLOSED, EngagementStatus.PENDING_CLOSURE):
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
# Close from UNDER_REVIEW — auto-routes based on IR doc presence
# ---------------------------------------------------------------------------

@router.post("/engagements/{engagement_id}/close", response_model=EngagementResponse)
async def close_engagement(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Close from UNDER_REVIEW: routes to CLOSED if NDA+SOW present, else PENDING_CLOSURE."""
    engagement = await _get_engagement_or_404(db, engagement_id)

    if engagement.status != EngagementStatus.UNDER_REVIEW:
        raise HTTPException(
            status_code=400,
            detail=f"Can only close from UNDER_REVIEW (current: {engagement.status.value})",
        )

    docs_result = await db.execute(
        select(FileUpload).where(
            FileUpload.engagement_id == engagement_id,
            FileUpload.file_type.in_([FileType.IR_NDA, FileType.IR_SOW]),
        )
    )
    ir_docs = docs_result.scalars().all()
    has_nda = any(f.file_type == FileType.IR_NDA for f in ir_docs)
    has_sow = any(f.file_type == FileType.IR_SOW for f in ir_docs)
    target = EngagementStatus.CLOSED if (has_nda and has_sow) else EngagementStatus.PENDING_CLOSURE

    old_status = engagement.status
    engagement.status = target
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.status.changed",
        description=f"Engagement {engagement.doc_number} closed: {old_status.value} → {target.value}",
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": target.value, "has_nda": has_nda, "has_sow": has_sow},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


@router.post("/engagements/{engagement_id}/close-from-pending", response_model=EngagementResponse)
async def close_from_pending(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponse:
    """Manually close from PENDING_CLOSURE. Requires finalised risk assessment."""
    engagement = await _get_engagement_or_404(db, engagement_id)

    if engagement.status != EngagementStatus.PENDING_CLOSURE:
        raise HTTPException(
            status_code=400,
            detail=f"Can only close from PENDING_CLOSURE (current: {engagement.status.value})",
        )

    ra_result = await db.execute(
        select(RiskAssessment).where(RiskAssessment.engagement_id == engagement_id)
    )
    ra = ra_result.scalar_one_or_none()
    if ra is None or ra.status != RiskAssessmentStatus.FINALISED:
        raise HTTPException(
            status_code=400,
            detail="A finalised risk assessment is required before closing the engagement",
        )

    docs_result = await db.execute(
        select(FileUpload).where(
            FileUpload.engagement_id == engagement_id,
            FileUpload.file_type.in_([FileType.IR_NDA, FileType.IR_SOW]),
        )
    )
    ir_docs = docs_result.scalars().all()
    has_nda = any(f.file_type == FileType.IR_NDA for f in ir_docs)
    has_sow = any(f.file_type == FileType.IR_SOW for f in ir_docs)
    if not (has_nda and has_sow):
        missing = []
        if not has_nda:
            missing.append("NDA")
        if not has_sow:
            missing.append("SOW")
        raise HTTPException(
            status_code=400,
            detail=f"Cannot close: missing IR document(s): {', '.join(missing)}. Request the IR to upload the required documents.",
        )

    old_status = engagement.status
    engagement.status = EngagementStatus.CLOSED
    engagement.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="engagement.status.changed",
        description=f"Engagement {engagement.doc_number} manually closed: {old_status.value} → CLOSED",
        engagement_id=engagement_id,
        metadata={"from": old_status.value, "to": EngagementStatus.CLOSED.value},
    )

    await db.flush()
    return EngagementResponse.model_validate(await _fetch_engagement(db, engagement_id))


# ---------------------------------------------------------------------------
# Responses (read-only for admin)
# ---------------------------------------------------------------------------

@router.get("/engagements/{engagement_id}/responses", response_model=EngagementResponsesPayload)
async def get_responses(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> EngagementResponsesPayload:
    engagement = await _get_engagement_or_404(db, engagement_id)

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
        select(Response).where(Response.engagement_id == engagement_id)
    )
    responses = r_result.scalars().all()

    att_result = await db.execute(
        select(FileUpload).where(
            FileUpload.engagement_id == engagement_id,
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


class AdminFileDeleteRequest(BaseModel):
    password: str


@router.delete("/engagements/{engagement_id}/files/{file_id}", status_code=204)
async def admin_delete_file(
    engagement_id: uuid.UUID,
    file_id: uuid.UUID,
    body: AdminFileDeleteRequest,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Admin-privileged file deletion — requires password re-confirmation."""
    if not verify_password(body.password, settings.admin_password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password")

    result = await db.execute(
        select(FileUpload).where(
            FileUpload.id == file_id,
            FileUpload.engagement_id == engagement_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="File not found")

    stored_path = record.stored_path
    original_name = record.original_filename
    file_type = record.file_type.value

    await db.delete(record)
    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="file.admin_delete",
        description=f"Admin deleted file: {original_name} ({file_type})",
        engagement_id=engagement_id,
        metadata={"file_id": str(file_id), "filename": original_name, "file_type": file_type},
    )
    await db.commit()

    try:
        if os.path.exists(stored_path):
            os.unlink(stored_path)
    except OSError:
        pass


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
