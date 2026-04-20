import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import ActorType, AuditLog


async def log_action(
    db: AsyncSession,
    actor: str,
    actor_type: ActorType,
    action: str,
    description: str,
    engagement_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    entry = AuditLog(
        engagement_id=engagement_id,
        actor=actor,
        actor_type=actor_type,
        action=action,
        description=description,
        metadata_=metadata,
    )
    db.add(entry)
