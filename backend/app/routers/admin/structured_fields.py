import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.engagement import Engagement
from app.models.risk_assessment import StructuredFields
from app.schemas.engagement import StructuredFieldsResponse, StructuredFieldsUpdate
from app.services.audit import log_action
from app.services.auth import get_admin_user

router = APIRouter(tags=["admin-structured-fields"])


async def _get_engagement_or_404(db: AsyncSession, engagement_id: uuid.UUID) -> Engagement:
    result = await db.execute(select(Engagement).where(Engagement.id == engagement_id))
    eng = result.scalar_one_or_none()
    if eng is None:
        raise HTTPException(404, "Engagement not found")
    return eng


@router.get("/engagements/{engagement_id}/structured-fields", response_model=StructuredFieldsResponse | None)
async def get_structured_fields(
    engagement_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_engagement_or_404(db, engagement_id)
    result = await db.execute(
        select(StructuredFields).where(StructuredFields.engagement_id == engagement_id)
    )
    sf = result.scalar_one_or_none()
    if sf is None:
        return None
    return StructuredFieldsResponse.model_validate(sf)


@router.patch("/engagements/{engagement_id}/structured-fields", response_model=StructuredFieldsResponse)
async def update_structured_fields(
    engagement_id: uuid.UUID,
    body: StructuredFieldsUpdate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_engagement_or_404(db, engagement_id)
    result = await db.execute(
        select(StructuredFields).where(StructuredFields.engagement_id == engagement_id)
    )
    sf = result.scalar_one_or_none()

    if sf is None:
        sf = StructuredFields(engagement_id=engagement_id)
        db.add(sf)

    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(sf, field, value)

    sf.updated_at = datetime.now(timezone.utc)

    if updates:
        await log_action(
            db,
            actor=admin,
            actor_type=ActorType.ADMIN,
            action="structured_fields.updated",
            description="Structured fields updated",
            engagement_id=engagement_id,
            metadata={"fields": list(updates.keys())},
        )

    await db.flush()
    await db.refresh(sf)
    return StructuredFieldsResponse.model_validate(sf)
