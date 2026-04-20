import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.audit_log import ActorType


class AuditLogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    engagement_id: uuid.UUID | None = None
    actor: str
    actor_type: ActorType
    action: str
    description: str
    # ORM attribute is metadata_; output JSON key is metadata
    metadata: dict | None = Field(default=None, validation_alias="metadata_")
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogEntry]
    total: int
