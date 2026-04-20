from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import AuditLog
from app.schemas.audit import AuditLogEntry, AuditLogListResponse
from app.services.auth import get_admin_user

router = APIRouter(tags=["admin-audit"])


@router.get("/audit", response_model=AuditLogListResponse)
async def get_system_audit(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> AuditLogListResponse:
    total = (await db.execute(select(func.count(AuditLog.id)))).scalar_one()

    result = await db.execute(
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [AuditLogEntry.model_validate(row) for row in result.scalars().all()]

    return AuditLogListResponse(items=items, total=total)
