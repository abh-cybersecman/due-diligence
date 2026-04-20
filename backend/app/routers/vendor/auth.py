import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.engagement import Engagement
from app.schemas.auth import TokenResponse
from app.schemas.vendor import VendorAuthRequest
from app.services.audit import log_action
from app.services.auth import create_vendor_token

router = APIRouter()


@router.post("/verify", response_model=TokenResponse)
async def vendor_verify(
    body: VendorAuthRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    try:
        token_uuid = uuid.UUID(body.token)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    result = await db.execute(
        select(Engagement).where(Engagement.vendor_token == token_uuid)
    )
    engagement = result.scalar_one_or_none()

    if not engagement:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    email_lower = body.email.lower().strip()
    vendor_emails_lower = [e.lower() for e in (engagement.vendor_emails or [])]

    if email_lower not in vendor_emails_lower:
        await log_action(
            db=db,
            actor=email_lower,
            actor_type=ActorType.VENDOR,
            action="auth.failure",
            description="Vendor login failed — email not authorised",
            metadata={"token_prefix": str(token_uuid)[:8]},
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    access_token = create_vendor_token(email_lower, str(engagement.id))

    await log_action(
        db=db,
        engagement_id=engagement.id,
        actor=email_lower,
        actor_type=ActorType.VENDOR,
        action="auth.login",
        description=f"Vendor authenticated for engagement {engagement.doc_number}",
    )
    await db.commit()

    return TokenResponse(access_token=access_token)
