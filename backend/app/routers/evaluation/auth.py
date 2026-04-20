import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.engagement import Engagement
from app.schemas.auth import IRVerifyRequest, TokenResponse
from app.services.audit import log_action
from app.services.auth import create_ir_token
from app.utils.sanitize import sanitize_text

router = APIRouter(prefix="/api/evaluation/auth", tags=["evaluation-auth"])


@router.post("/verify", response_model=TokenResponse)
async def verify_ir(body: IRVerifyRequest, db: AsyncSession = Depends(get_db)):
    email = sanitize_text(body.email.strip().lower())

    try:
        token_uuid = uuid.UUID(body.token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Unauthorized")

    result = await db.execute(
        select(Engagement).where(Engagement.ir_token == token_uuid)
    )
    engagement = result.scalar_one_or_none()

    if not engagement or email not in [e.lower() for e in engagement.ir_emails]:
        # Log failure generically — do not reveal which part was wrong
        await log_action(
            db,
            actor=body.email,
            actor_type=ActorType.IR,
            action="auth.ir.failure",
            description="Failed IR authentication attempt",
            engagement_id=engagement.id if engagement else None,
        )
        raise HTTPException(status_code=401, detail="Unauthorized")

    await log_action(
        db,
        actor=email,
        actor_type=ActorType.IR,
        action="auth.ir.login",
        description=f"IR user authenticated for engagement {engagement.doc_number}",
        engagement_id=engagement.id,
    )

    access_token = create_ir_token(email, str(engagement.id))
    return TokenResponse(access_token=access_token)
