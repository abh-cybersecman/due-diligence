import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.engagement import Engagement, EngagementStatus
from app.models.file_upload import FileType
from app.models.risk_assessment import RiskAssessment, RiskAssessmentStatus, RiskItem
from app.schemas.risk_assessment import (
    RiskAssessmentCreate,
    RiskAssessmentResponse,
    RiskAssessmentUpdate,
)
from app.services.audit import log_action
from app.services.auth import get_admin_user

router = APIRouter(tags=["admin-risk-assessment"])


async def _get_engagement(db: AsyncSession, engagement_id: uuid.UUID) -> Engagement:
    result = await db.execute(
        select(Engagement)
        .where(Engagement.id == engagement_id)
        .options(selectinload(Engagement.files))
    )
    eng = result.scalar_one_or_none()
    if eng is None:
        raise HTTPException(404, "Engagement not found")
    return eng


async def _get_ra(db: AsyncSession, engagement_id: uuid.UUID, *, fresh: bool = False) -> RiskAssessment | None:
    q = (
        select(RiskAssessment)
        .where(RiskAssessment.engagement_id == engagement_id)
        .options(selectinload(RiskAssessment.risk_items))
    )
    if fresh:
        q = q.execution_options(populate_existing=True)
    result = await db.execute(q)
    return result.scalar_one_or_none()


@router.get("/engagements/{engagement_id}/risk-assessment", response_model=RiskAssessmentResponse)
async def get_risk_assessment(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_engagement(db, engagement_id)
    ra = await _get_ra(db, engagement_id)
    if ra is None:
        raise HTTPException(404, "No risk assessment found for this engagement")
    return RiskAssessmentResponse.model_validate(ra)


@router.post("/engagements/{engagement_id}/risk-assessment", response_model=RiskAssessmentResponse, status_code=201)
async def create_risk_assessment(
    engagement_id: uuid.UUID,
    body: RiskAssessmentCreate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_engagement(db, engagement_id)
    if await _get_ra(db, engagement_id) is not None:
        raise HTTPException(409, "Risk assessment already exists for this engagement")

    ra = RiskAssessment(
        engagement_id=engagement_id,
        overall_rating=body.overall_rating,
        summary=body.summary,
        status=RiskAssessmentStatus.DRAFT,
    )
    db.add(ra)
    await db.flush()

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="risk_assessment.created",
        description="Risk assessment created",
        engagement_id=engagement_id,
    )

    return RiskAssessmentResponse.model_validate(await _get_ra(db, engagement_id, fresh=True))


@router.patch("/engagements/{engagement_id}/risk-assessment", response_model=RiskAssessmentResponse)
async def update_risk_assessment(
    engagement_id: uuid.UUID,
    body: RiskAssessmentUpdate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_engagement(db, engagement_id)
    ra = await _get_ra(db, engagement_id)
    if ra is None:
        raise HTTPException(404, "No risk assessment found")

    changed: list[str] = []

    if body.overall_rating is not None:
        ra.overall_rating = body.overall_rating
        changed.append("overall_rating")
    if body.summary is not None:
        ra.summary = body.summary
        changed.append("summary")

    if body.risk_items is not None:
        # Replace all items
        for item in list(ra.risk_items):
            await db.delete(item)
        await db.flush()

        for idx, item_data in enumerate(body.risk_items):
            db.add(RiskItem(
                risk_assessment_id=ra.id,
                description=item_data.description,
                rating=item_data.rating,
                assigned_to=item_data.assigned_to,
                mitigation=item_data.mitigation,
                order=item_data.order if item_data.order != 0 else idx,
            ))
        changed.append("risk_items")

    ra.updated_at = datetime.now(timezone.utc)

    if changed:
        await log_action(
            db,
            actor=admin,
            actor_type=ActorType.ADMIN,
            action="risk_assessment.updated",
            description="Risk assessment updated",
            engagement_id=engagement_id,
            metadata={"changed": changed},
        )

    await db.flush()
    return RiskAssessmentResponse.model_validate(await _get_ra(db, engagement_id, fresh=True))


@router.post("/engagements/{engagement_id}/risk-assessment/finalise", response_model=RiskAssessmentResponse)
async def finalise_risk_assessment(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    engagement = await _get_engagement(db, engagement_id)
    ra = await _get_ra(db, engagement_id)

    if ra is None:
        raise HTTPException(400, "No risk assessment exists to finalise")
    if ra.status == RiskAssessmentStatus.FINALISED:
        raise HTTPException(400, "Risk assessment is already finalised")

    ra.status = RiskAssessmentStatus.FINALISED
    ra.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="risk_assessment.finalised",
        description="Risk assessment finalised",
        engagement_id=engagement_id,
    )

    # Auto-advance engagement when in RISK_ASSESSMENT_PENDING
    if engagement.status == EngagementStatus.RISK_ASSESSMENT_PENDING:
        has_nda = any(f.file_type == FileType.IR_NDA for f in engagement.files)
        has_sow = any(f.file_type == FileType.IR_SOW for f in engagement.files)
        new_status = (
            EngagementStatus.CLOSED if (has_nda and has_sow)
            else EngagementStatus.PENDING_CLOSURE
        )
        old_status = engagement.status
        engagement.status = new_status
        engagement.updated_at = datetime.now(timezone.utc)

        await log_action(
            db,
            actor="system",
            actor_type=ActorType.ADMIN,
            action="engagement.status.advanced",
            description=f"Engagement advanced to {new_status.value} after risk assessment finalised",
            engagement_id=engagement_id,
            metadata={"from": old_status.value, "to": new_status.value},
        )

    await db.flush()
    return RiskAssessmentResponse.model_validate(await _get_ra(db, engagement_id, fresh=True))


@router.post("/engagements/{engagement_id}/risk-assessment/reopen", response_model=RiskAssessmentResponse)
async def reopen_risk_assessment(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_engagement(db, engagement_id)
    ra = await _get_ra(db, engagement_id)

    if ra is None:
        raise HTTPException(404, "No risk assessment found")
    if ra.status == RiskAssessmentStatus.DRAFT:
        raise HTTPException(400, "Risk assessment is already in draft state")

    ra.status = RiskAssessmentStatus.DRAFT
    ra.updated_at = datetime.now(timezone.utc)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="risk_assessment.reopened",
        description="Risk assessment reopened to draft",
        engagement_id=engagement_id,
    )

    await db.flush()
    return RiskAssessmentResponse.model_validate(await _get_ra(db, engagement_id, fresh=True))
