from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.audit_log import ActorType
from app.schemas.auth import AdminLoginRequest, TokenResponse
from app.services.audit import log_action
from app.services.auth import create_admin_token, get_admin_user, verify_password

router = APIRouter(tags=["admin-auth"])

_INVALID = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: AdminLoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    # Always run verify_password to prevent timing-based username enumeration
    password_ok = bool(settings.admin_password_hash) and verify_password(
        body.password, settings.admin_password_hash
    )

    if body.username != settings.admin_username or not password_ok:
        await log_action(
            db,
            actor=body.username,
            actor_type=ActorType.ADMIN,
            action="admin.auth.failure",
            description="Failed admin login attempt",
        )
        raise _INVALID

    await log_action(
        db,
        actor=settings.admin_username,
        actor_type=ActorType.ADMIN,
        action="admin.auth.login",
        description="Admin logged in",
    )
    return TokenResponse(access_token=create_admin_token())


@router.post("/auth/logout", status_code=204)
async def logout(
    actor: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await log_action(
        db,
        actor=actor,
        actor_type=ActorType.ADMIN,
        action="admin.auth.logout",
        description="Admin logged out",
    )
